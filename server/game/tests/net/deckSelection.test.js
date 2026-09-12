import { EVENTS } from "../../net/protocol.js";
import { createNetHarness } from "./harness.js";
import { createSeededGame } from "../../gameFactory.js";
import { devRoomLoggingBackends } from "../../logging/GameFileLogger.js";
import { cards, getCardIdByName } from "../utils.js";
import { buildSlugIndex } from "../../../../server/utils/card-catalog.js";

/**
 * Deck selection over the real transport: both seats pick decks through the
 * gateway, the game starts with those decks, and selectability follows the
 * room type (legal-only in normal rooms, anything buildable in dev rooms).
 */

const slugByCardId = new Map(Object.values(cards).map((card) => [card.cardId, card.slug]));
const cardIdBySlug = buildSlugIndex(cards);

/** A legal 30-slug deck holding exactly `MAX_CARD_COPIES` of Test Scout. */
const deckWithTripleScout = () => {
  const scout = slugByCardId.get(getCardIdByName("Test Scout"));
  const filler = Object.values(cards)
    .filter((card) => {
      if (card.slug === scout) return false;
      if ((card.deckConstraints || []).some((constraint) => constraint.type === "unreachable")) return false;
      return card.name.startsWith("Test Filler");
    })
    .map((card) => card.slug);
  return [scout, scout, scout, ...filler.slice(0, 27)];
};

const slugKey = (slugs) => [...slugs].sort().join("|");

describe("deck selection over the wire", () => {
  let harness;

  // The gateway validates picks against the fixture catalog (injected by the
  // harness), so the dealt decks are built from the same catalog.
  const bootHarness = async () => {
    harness = await createNetHarness({
      createGame: ({ roomCode, usernames, seed, decks, enforceDeckRules }) =>
        createSeededGame({ roomCode, usernames, seed, decks, enforceDeckRules, cards }),
    });
  };

  afterEach(async () => {
    if (harness) await harness.close();
  });

  test("a lone seat picks while waiting and the status broadcast carries the pick", async () => {
    await bootHarness();
    const roomCode = harness.createRoom();
    harness.joinRoom(roomCode, "Alice");
    harness.joinRoom(roomCode, "Bob");
    const alice = await harness.connectPlayer({ username: "Alice", roomCode });

    await harness.waitFor(
      () => alice.lastPayloadOf(EVENTS.GAME_DECK_STATUS) !== null,
      "the lone seat never received the deck status."
    );
    const initial = alice.lastPayloadOf(EVENTS.GAME_DECK_STATUS);
    expect(initial.dev).toBe(false);
    expect(initial.seats).toEqual([
      { username: "Alice", deckChosen: false, connected: true, deckId: null, deckName: null, illegal: false },
      { username: "Bob", deckChosen: false, connected: false, deckId: null, deckName: null, illegal: false },
    ]);

    const deck = await harness.createDeck("Alice", "Scout deck", deckWithTripleScout());
    harness.selectDeck(alice, deck.id);

    const status = await alice.next(EVENTS.GAME_DECK_STATUS);
    expect(status.seats[0]).toEqual({
      username: "Alice",
      deckChosen: true,
      connected: true,
      deckId: deck.id,
      deckName: "Scout deck",
      illegal: false,
    });
    expect(harness.registry.get(roomCode).isStarted).toBe(false);
  });

  test("the status broadcast keeps the picker's deck identity away from the other seat", async () => {
    await bootHarness();
    const roomCode = harness.createRoom();
    harness.joinRoom(roomCode, "Alice");
    harness.joinRoom(roomCode, "Bob");
    const alice = await harness.connectPlayer({ username: "Alice", roomCode });
    const bob = await harness.connectPlayer({ username: "Bob", roomCode });

    const deck = await harness.createDeck("Alice", "Scout deck", deckWithTripleScout());
    harness.selectDeck(alice, deck.id);

    await harness.waitFor(
      () => bob.lastPayloadOf(EVENTS.GAME_DECK_STATUS)?.seats[0].deckChosen === true,
      "the other seat never saw the pick."
    );

    // The other seat learns that a pick landed, and nothing about it: knowing
    // the opponent's deck before both picks are locked allows a counter-pick.
    const bobStatus = bob.lastPayloadOf(EVENTS.GAME_DECK_STATUS);
    expect(bobStatus.seats[0]).toEqual({
      username: "Alice",
      deckChosen: true,
      connected: true,
      deckId: null,
      deckName: null,
      illegal: false,
    });
    const bobWire = JSON.stringify(bobStatus);
    expect(bobWire).not.toContain("Scout deck");
    expect(bobWire).not.toContain(deck.id);

    // The picker keeps her own identity, and the other seat stays redacted.
    const aliceStatus = alice.lastPayloadOf(EVENTS.GAME_DECK_STATUS);
    expect(aliceStatus.seats[0]).toEqual({
      username: "Alice",
      deckChosen: true,
      connected: true,
      deckId: deck.id,
      deckName: "Scout deck",
      illegal: false,
    });
    expect(aliceStatus.seats[1]).toEqual({
      username: "Bob",
      deckChosen: false,
      connected: true,
      deckId: null,
      deckName: null,
      illegal: false,
    });
  });

  test("both picks reveal the two decks on the wire, before the board arrives", async () => {
    await bootHarness();
    const roomCode = harness.createRoom();
    harness.joinRoom(roomCode, "Alice");
    harness.joinRoom(roomCode, "Bob");
    const alice = await harness.connectPlayer({ username: "Alice", roomCode });
    const bob = await harness.connectPlayer({ username: "Bob", roomCode });

    const aliceDeck = await harness.createDeck("Alice", "Scout deck", deckWithTripleScout());
    const bobDeck = await harness.createDeck("Bob", "Plain deck", harness.legalDeckSlugs());

    // The reveal precedes the board it introduces, so the two messages are
    // recorded off each seat's own wire, in arrival order.
    const boardEvents = [EVENTS.GAME_DECK_REVEAL, EVENTS.GAME_INIT];
    const orderFor = (client) => {
      const seen = [];
      client.socket.onAny((event) => {
        if (boardEvents.includes(event)) seen.push(event);
      });
      return seen;
    };
    const aliceOrder = orderFor(alice);
    const bobOrder = orderFor(bob);

    await harness.selectDecks({ alice, bob }, { Alice: aliceDeck.id, Bob: bobDeck.id });

    expect(aliceOrder).toEqual([EVENTS.GAME_DECK_REVEAL, EVENTS.GAME_INIT]);
    expect(bobOrder).toEqual([EVENTS.GAME_DECK_REVEAL, EVENTS.GAME_INIT]);

    const reveal = alice.lastPayloadOf(EVENTS.GAME_DECK_REVEAL);
    expect(reveal).toEqual(bob.lastPayloadOf(EVENTS.GAME_DECK_REVEAL));
    expect(reveal.seats.map((seat) => seat.username)).toEqual(["Alice", "Bob"]);
    expect(reveal.seats.map((seat) => seat.deckName)).toEqual(["Scout deck", "Plain deck"]);

    const decks = { Alice: aliceDeck, Bob: bobDeck };
    for (const seat of reveal.seats) {
      // The fan is a few cards of the deck picked, and the deck's full list
      // never goes out.
      expect(Object.keys(seat)).toEqual(["username", "deckName", "fan"]);
      expect(seat.fan.length).toBeGreaterThan(0);
      expect(seat.fan.length).toBeLessThanOrEqual(3);
      expect(new Set(seat.fan).size).toBe(seat.fan.length);
      for (const slug of seat.fan) {
        expect(cardIdBySlug.has(slug)).toBe(true);
        expect(decks[seat.username].cards).toContain(slug);
      }
    }
  });

  test("an illegal deck is rejected in a normal room over the wire", async () => {
    await bootHarness();
    const roomCode = harness.createRoom();
    harness.joinRoom(roomCode, "Alice");
    harness.joinRoom(roomCode, "Bob");
    const alice = await harness.connectPlayer({ username: "Alice", roomCode });

    const illegal = await harness.createDeck("Alice", "Broken deck", ["no_such_slug", ...harness.legalDeckSlugs().slice(1)]);
    harness.selectDeck(alice, illegal.id);

    const error = await alice.next(EVENTS.GAME_ERROR);
    expect(error.message).toContain("unknown cards");
    const session = harness.registry.get(roomCode);
    expect(session.isStarted).toBe(false);
    expect(session.getDeckPick("Alice")).toBeNull();
  });

  test("a deck edited between pick and start reveals the deck that is dealt", async () => {
    await bootHarness();
    const roomCode = harness.createRoom();
    harness.joinRoom(roomCode, "Alice");
    harness.joinRoom(roomCode, "Bob");
    const alice = await harness.connectPlayer({ username: "Alice", roomCode });
    const bob = await harness.connectPlayer({ username: "Bob", roomCode });

    const picked = await harness.createDeck("Alice", "Picked name", harness.legalDeckSlugs());
    harness.selectDeck(alice, picked.id);
    await alice.next(EVENTS.GAME_DECK_STATUS);

    // Alice edits the deck in another tab between picking it and the start: the
    // start re-reads the library, so the game deals the edited deck, and the
    // reveal has to describe that deck rather than the pick's snapshot.
    const edited = await harness.updateDeck(picked.id, "Alice", {
      name: "Edited name",
      cards: deckWithTripleScout(),
    });

    const bobDeck = await harness.createDeck("Bob", "Bob deck", harness.legalDeckSlugs());
    harness.selectDeck(bob, bobDeck.id);

    const reveal = await alice.next(EVENTS.GAME_DECK_REVEAL);
    const session = harness.registry.get(roomCode);
    const dealt = [...session.game.playerStates.Alice.deck, ...session.game.playerStates.Alice.hand].map((card) =>
      slugByCardId.get(card.cardId)
    );

    expect(slugKey(dealt)).toBe(slugKey(edited.cards));
    const aliceSeat = reveal.seats.find((seat) => seat.username === "Alice");
    expect(aliceSeat.deckName).toBe("Edited name");
    expect(aliceSeat.fan.length).toBeGreaterThan(0);
    for (const slug of aliceSeat.fan) expect(edited.cards).toContain(slug);
  });

  test("both picks start the game and the dealt decks match the selected decks", async () => {
    await bootHarness();
    const roomCode = harness.createRoom();
    harness.joinRoom(roomCode, "Alice");
    harness.joinRoom(roomCode, "Bob");
    const alice = await harness.connectPlayer({ username: "Alice", roomCode });
    const bob = await harness.connectPlayer({ username: "Bob", roomCode });

    const aliceDeck = await harness.createDeck("Alice", "Scout deck", deckWithTripleScout());
    const bobDeck = await harness.createDeck("Bob", "Plain deck", harness.legalDeckSlugs());

    await harness.selectDecks({ alice, bob }, { Alice: aliceDeck.id, Bob: bobDeck.id });

    const session = harness.registry.get(roomCode);
    expect(session.isStarted).toBe(true);
    for (const [username, deck] of [["Alice", aliceDeck], ["Bob", bobDeck]]) {
      const player = session.game.playerStates[username];
      const dealt = [...player.deck, ...player.hand].map((card) => card.cardId);
      expect(dealt).toHaveLength(30);
      expect(slugKey(dealt.map((cardId) => slugByCardId.get(cardId)))).toBe(slugKey(deck.cards));
    }

    // The triple scout survived the deal.
    const aliceDealt = [...session.game.playerStates.Alice.deck, ...session.game.playerStates.Alice.hand];
    expect(aliceDealt.filter((card) => card.name === "Test Scout")).toHaveLength(3);
  });

  test("a dev room starts with an illegal deck and enforcement disabled", async () => {
    await bootHarness();
    const roomCode = "TESTROOM99";
    harness.rooms[roomCode] = { players: [], opponent: "friend", difficulty: null, seed: 1 };
    harness.joinRoom(roomCode, "Alice");
    harness.joinRoom(roomCode, "Bob");
    const alice = await harness.connectPlayer({ username: "Alice", roomCode });
    const bob = await harness.connectPlayer({ username: "Bob", roomCode });

    // 12 cards only: illegal size, but buildable — exactly what a dev room
    // accepts and a normal room rejects.
    const tiny = await harness.createDeck("Alice", "Tiny deck", harness.legalDeckSlugs().slice(0, 12));
    const legal = await harness.createDeck("Bob", "Bob deck", harness.legalDeckSlugs());

    // The connect-time status announces the dev room.
    const status = alice.lastPayloadOf(EVENTS.GAME_DECK_STATUS);
    expect(status.dev).toBe(true);

    await harness.selectDecks({ alice, bob }, { Alice: tiny.id, Bob: legal.id });

    const session = harness.registry.get(roomCode);
    expect(session.isStarted).toBe(true);
    const aliceDealt = [...session.game.playerStates.Alice.deck, ...session.game.playerStates.Alice.hand];
    expect(aliceDealt).toHaveLength(12);
    expect(aliceDealt.map((card) => card.cardId).sort((a, b) => a - b)).toEqual(
      tiny.cards.map((slug) => cardIdBySlug.get(slug).cardId).sort((a, b) => a - b)
    );
  });

  test("a deck deleted between pick and start returns the seat to selection", async () => {
    await bootHarness();
    const roomCode = harness.createRoom();
    harness.joinRoom(roomCode, "Alice");
    harness.joinRoom(roomCode, "Bob");
    const alice = await harness.connectPlayer({ username: "Alice", roomCode });
    const bob = await harness.connectPlayer({ username: "Bob", roomCode });

    const doomed = await harness.createDeck("Alice", "Doomed deck", harness.legalDeckSlugs());
    harness.selectDeck(alice, doomed.id);
    await alice.next(EVENTS.GAME_DECK_STATUS);

    await harness.deckLibrary.deleteDeck(doomed.id, "Alice");
    const replacement = await harness.createDeck("Alice", "Replacement", harness.legalDeckSlugs());
    const bobDeck = await harness.createDeck("Bob", "Bob deck", harness.legalDeckSlugs());

    await harness.selectDecks({ alice, bob }, { Alice: replacement.id, Bob: bobDeck.id });

    const session = harness.registry.get(roomCode);
    expect(session.isStarted).toBe(true);
    const aliceDealt = [...session.game.playerStates.Alice.deck, ...session.game.playerStates.Alice.hand].map((c) => c.cardId);
    expect([...aliceDealt.map((cardId) => slugByCardId.get(cardId))].sort()).toEqual([...replacement.cards].sort());
  });

  test("a pick after the game started is rejected over the wire", async () => {
    await bootHarness();
    const { roomCode, alice } = await harness.seatPlayers();

    const late = await harness.createDeck("Alice", "Late deck", harness.legalDeckSlugs());
    harness.selectDeck(alice, late.id);

    const error = await alice.next(EVENTS.GAME_ERROR);
    expect(error.message).toBe("The game has already started.");
    expect(harness.registry.get(roomCode).getDeckPick("Alice")).toBeNull();
  });
});
