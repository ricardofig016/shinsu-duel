import { EVENTS } from "../../net/protocol.js";
import { createNetHarness } from "./harness.js";
import { createSeededGame } from "../../gameFactory.js";
import { cards } from "../utils.js";

/**
 * Bot rooms over the real transport: a bot room seats its bot the moment the
 * human connects, the human's pick starts the game with the bot's deck
 * resolved at start time by the room's deck method, and the bot drives its
 * own turns through the gateway's validated paths like any player.
 */

const BOT_WHATEVER = "[BOT] Whatever";

describe("bot rooms over the wire", () => {
  let harness;

  beforeEach(() => {
    harness = null;
  });

  afterEach(async () => {
    if (harness) await harness.close();
  });

  const bootHarness = async () => {
    harness = await createNetHarness({
      createGame: ({ roomCode, usernames, seed, decks, enforceDeckRules }) =>
        createSeededGame({ roomCode, usernames, seed, decks, enforceDeckRules, cards }),
    });
  };

  const connectBotRoom = async ({ bot, deckMethod }) => {
    const roomCode = harness.createRoom({ opponent: "bot", bot, deckMethod });
    harness.joinRoom(roomCode, "Alice");
    const alice = await harness.connectPlayer({ username: "Alice", roomCode });
    // The status broadcast can land before the test subscribes; the capture
    // in wrapSocket already holds it.
    await harness.waitFor(
      () => alice.lastPayloadOf(EVENTS.GAME_DECK_STATUS) !== null,
      "the bot seat never reported its deck status."
    );
    const status = alice.lastPayloadOf(EVENTS.GAME_DECK_STATUS);
    return { roomCode, alice, status };
  };

  /**
   * Alice passes whenever it is her turn, once per turn. Returns a poll step
   * the test calls in its wait loops so the bot's turns keep coming.
   */
  const alicePasses = (alice) => {
    let lastPass = null;
    return () => {
      const update = alice.lastPayloadOf(EVENTS.GAME_UPDATE);
      if (!update || update.currentTurn !== "Alice") return;
      const marker = `${update.round}:${update.currentTurn}`;
      if (marker === lastPass) return;
      lastPass = marker;
      alice.emit(EVENTS.GAME_ACTION, { type: "pass-turn-action", data: {} });
    };
  };

  test("a bot seat is present, connected, and marked as a bot the moment the human connects", async () => {
    await bootHarness();
    const { roomCode, status } = await connectBotRoom({ bot: "whatever", deckMethod: "generated" });

    const session = harness.registry.get(roomCode);
    expect(session).not.toBeNull();
    expect(session.usernames).toEqual(["Alice", BOT_WHATEVER]);
    expect(session.isStarted).toBe(false);
    expect(status.seats).toEqual([
      { username: "Alice", deckChosen: false, connected: true, bot: false, deckId: null, deckName: null, illegal: false },
      { username: BOT_WHATEVER, deckChosen: false, connected: true, bot: true, deckId: null, deckName: null, illegal: false },
    ]);
  });

  test("the human's pick starts the game and the mirrored bot deck is dealt at start", async () => {
    await bootHarness();
    const { roomCode, alice } = await connectBotRoom({ bot: "whatever", deckMethod: "mirror" });
    const deck = await harness.createDeck("Alice", "Alice's deck", harness.legalDeckSlugs());
    harness.selectDeck(alice, deck.id);

    await harness.waitFor(
      () => alice.lastPayloadOf(EVENTS.GAME_DECK_REVEAL) !== null,
      "the versus reveal never arrived."
    );
    const reveal = alice.lastPayloadOf(EVENTS.GAME_DECK_REVEAL);
    const ownReveal = reveal.seats.find((seat) => seat.username === "Alice");
    const botReveal = reveal.seats.find((seat) => seat.username === BOT_WHATEVER);
    expect(botReveal.deckName).toBe("Alice's deck");
    expect(botReveal.fan).toEqual(ownReveal.fan);

    await harness.waitFor(
      () => alice.lastPayloadOf(EVENTS.GAME_INIT) !== null,
      "the game never started."
    );
    const init = alice.lastPayloadOf(EVENTS.GAME_INIT);
    expect(init.gameOver).toBeNull();
    expect(harness.registry.get(roomCode).isStarted).toBe(true);

    // Whatever passes its own turns, and Alice passes hers: reaching a later
    // round takes a pass from both seats, so round 2 proves the bot acted
    // through the gateway.
    const pass = alicePasses(alice);
    await harness.waitFor(
      () => {
        pass();
        const update = alice.lastPayloadOf(EVENTS.GAME_UPDATE);
        return update !== null && update.round >= 2;
      },
      "the bot never passed."
    );
    expect(alice.payloadsOf(EVENTS.GAME_ERROR)).toHaveLength(0);
  });

  test("a generated bot deck fields a deck the reveal names, and the game runs to a later round", async () => {
    await bootHarness();
    const { alice } = await connectBotRoom({ bot: "whatever", deckMethod: "generated" });
    const deck = await harness.createDeck("Alice", "Alice's deck", harness.legalDeckSlugs());
    harness.selectDeck(alice, deck.id);

    await harness.waitFor(
      () => alice.lastPayloadOf(EVENTS.GAME_DECK_REVEAL) !== null,
      "the versus reveal never arrived."
    );
    const botReveal = alice.lastPayloadOf(EVENTS.GAME_DECK_REVEAL).seats.find((seat) => seat.username === BOT_WHATEVER);
    expect(botReveal.deckName).toBe("Randomly Generated");

    await harness.waitFor(
      () => alice.lastPayloadOf(EVENTS.GAME_INIT) !== null,
      "the game never started."
    );
    const pass = alicePasses(alice);
    await harness.waitFor(
      () => {
        pass();
        const update = alice.lastPayloadOf(EVENTS.GAME_UPDATE);
        return update !== null && update.round >= 3;
      },
      "the game never reached a later round; the bot is not driving its turns.",
      8000
    );
    expect(alice.payloadsOf(EVENTS.GAME_ERROR)).toHaveLength(0);
  });

  test("a drunk bot plays its turns from the view-verifiable pool", async () => {
    await bootHarness();
    const { alice } = await connectBotRoom({ bot: "drunk", deckMethod: "generated" });
    const deck = await harness.createDeck("Alice", "Alice's deck", harness.legalDeckSlugs());
    harness.selectDeck(alice, deck.id);

    await harness.waitFor(
      () => alice.lastPayloadOf(EVENTS.GAME_INIT) !== null,
      "the game never started."
    );
    const pass = alicePasses(alice);
    await harness.waitFor(
      () => {
        pass();
        const update = alice.lastPayloadOf(EVENTS.GAME_UPDATE);
        return update !== null && update.round >= 3;
      },
      "the game never reached a later round; the drunk bot is not driving its turns.",
      8000
    );
    // Every bot move the engine accepted, whatever it was, left the room
    // error-free — the pool only emits moves the seat can verify.
    expect(alice.payloadsOf(EVENTS.GAME_ERROR)).toHaveLength(0);
  });

  test("a broken bot record refuses the connection instead of half-seating the room", async () => {
    await bootHarness();
    const roomCode = harness.createRoom({ opponent: "bot", bot: "whatever", deckMethod: "mirror" });
    delete harness.rooms[roomCode].bot; // simulate a stale runtime record
    harness.joinRoom(roomCode, "Alice");

    const alice = await harness.connectPlayer({ username: "Alice", roomCode });
    await harness.waitFor(
      () => alice.lastPayloadOf(EVENTS.GAME_ERROR) !== null,
      "the connection was never refused."
    );
    expect(alice.lastPayloadOf(EVENTS.GAME_ERROR).message).toContain("bot configuration is invalid");
    expect(harness.registry.get(roomCode)).toBeNull();
  });

  test("a dev-room restart moves the bot seat into the replacement session and it plays again", async () => {
    await bootHarness();
    const roomCode = harness.createRoom({ roomCode: "TESTROOM01", opponent: "bot", bot: "whatever", deckMethod: "mirror" });
    harness.joinRoom(roomCode, "Alice");
    const alice = await harness.connectPlayer({ username: "Alice", roomCode });
    const deck = await harness.createDeck("Alice", "Alice's deck", harness.legalDeckSlugs());
    harness.selectDeck(alice, deck.id);
    await harness.waitFor(
      () => alice.lastPayloadOf(EVENTS.GAME_INIT) !== null,
      "the first game never started."
    );
    const previous = harness.registry.get(roomCode);

    alice.emit(EVENTS.GAME_DEBUG_RESTART);
    await harness.waitFor(
      () => harness.registry.get(roomCode) !== previous,
      "the restart never replaced the session."
    );

    // The bot seat moved with the connections: still present, still a bot.
    await harness.waitFor(
      () => {
        const seats = alice.lastPayloadOf(EVENTS.GAME_DECK_STATUS)?.seats ?? [];
        const bot = seats.find((seat) => seat.username === BOT_WHATEVER);
        return Boolean(bot?.bot && bot.connected);
      },
      "the replacement session never reported the bot seat."
    );

    harness.selectDeck(alice, deck.id);
    await harness.waitFor(
      () => alice.payloadsOf(EVENTS.GAME_INIT).length >= 2,
      "the restarted game never started."
    );

    const pass = alicePasses(alice);
    await harness.waitFor(
      () => {
        pass();
        const update = alice.lastPayloadOf(EVENTS.GAME_UPDATE);
        return update !== null && update.round >= 2;
      },
      "the bot never passed after the restart."
    );
    expect(alice.payloadsOf(EVENTS.GAME_ERROR)).toHaveLength(0);
  });
});
