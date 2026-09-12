import { jest } from "@jest/globals";
import SocketGateway from "../../net/socketGateway.js";
import SessionRegistry from "../../net/SessionRegistry.js";
import { EVENTS } from "../../net/protocol.js";
import { createTestGame, createLegalDeck } from "../utils.js";
import { cards } from "../fixtures/cards.js";
import { buildSlugIndex } from "../../../../server/utils/card-catalog.js";

/**
 * Fake-socket harness for the socket gateway's unit suites.
 *
 * Boots a gateway over a registry, an in-memory room map, an in-memory deck
 * library, and the test-owned fixture catalog — no port is opened. Inbound
 * messages are triggered through the registered socket handlers, and the
 * gateway's asynchronous deck lookups are flushed before the caller inspects
 * the socket, so a test sees the effects of one inbound message immediately.
 *
 * Rooms are named by the suite: `fullRoom`/`devRoom` build a two-player room
 * under the given code, and `makeStartedHarness` drives both seats through the
 * pre-game deck selection so the game is running.
 */

export const ROOM = "ROOM1";
export const DEV_ROOM = "TESTROOM01";
export const SEED = 42;

const slugByCardId = new Map(Object.values(cards).map((card) => [card.cardId, card.slug]));
export const legalSlugs = () => createLegalDeck().map((cardId) => slugByCardId.get(cardId));
export const slugToCardId = (slugs) => slugs.map((slug) => buildSlugIndex(cards).get(slug).cardId);
export const unreachableSlug = () =>
  Object.values(cards).find((card) =>
    (card.deckConstraints || []).some((constraint) => constraint.type === "unreachable")
  ).slug;

export const makeSocket = ({ roomCode, username }) => {
  const socket = {
    handshake: { query: { roomCode } },
    request: { session: { username } },
    emitted: [],
    handlers: new Map(),
    closed: false,
    emit(event, payload) {
      socket.emitted.push({ event, payload });
    },
    on(event, handler) {
      socket.handlers.set(event, handler);
    },
    disconnect() {
      socket.closed = true;
    },
    async trigger(event, payload) {
      const result = socket.handlers.get(event)?.(payload);
      // Gateway inbound paths resolve deck lookups asynchronously; flush the
      // microtask queue so the effects are observable right after the call.
      await new Promise((resolve) => setImmediate(resolve));
      return result;
    },
    payloadsOf(event) {
      return socket.emitted.filter((entry) => entry.event === event).map((entry) => entry.payload);
    },
    lastPayloadOf(event) {
      const payloads = socket.payloadsOf(event);
      return payloads[payloads.length - 1] ?? null;
    },
  };
  return socket;
};

export const makeDeckLibrary = () => {
  const decks = new Map();
  let nextId = 1;
  return {
    decks,
    createDeck({ owner, name, cards: cardSlugs }) {
      const deck = { id: `deck-${nextId++}`, owner, name, cards: cardSlugs };
      decks.set(deck.id, deck);
      return deck;
    },
    getOwnedDeck(id, owner) {
      const deck = decks.get(id);
      return deck && deck.owner === owner ? deck : null;
    },
  };
};

export const makeHarness = ({ rooms, logger = null, isAccountActive = async () => true } = {}) => {
  const registry = new SessionRegistry();
  const createdGames = [];
  const createGame = jest.fn(() => {
    const game = createTestGame();
    createdGames.push(game);
    return game;
  });
  const deckLibrary = makeDeckLibrary();
  const gateway = new SocketGateway({
    registry,
    loadRoom: async (roomCode) => rooms[roomCode] ?? null,
    createGame,
    deckLibrary,
    catalog: cards,
    isAccountActive,
    logger,
  });

  let connectionHandler = null;
  const io = { of: () => ({ on: (event, handler) => (connectionHandler = handler) }) };
  gateway.attach(io);
  const connect = async ({ roomCode, username }) => {
    const socket = makeSocket({ roomCode, username });
    await connectionHandler(socket);
    // The gateway resolves its account and room lookups asynchronously, so
    // flush the microtask queue before the caller inspects the socket.
    await new Promise((resolve) => setImmediate(resolve));
    return socket;
  };

  return { registry, createdGames, createGame, deckLibrary, gateway, connect };
};

export const fullRoom = () => ({ [ROOM]: { players: ["Alice", "Bob"], seed: SEED } });
export const devRoom = () => ({ [DEV_ROOM]: { players: ["Alice", "Bob"], seed: SEED } });
export const loneRoom = () => ({ [ROOM]: { players: ["Alice"], seed: SEED } });

/** Connect both seats of a full room and select fresh legal decks for them. */
export const makeStartedHarness = async ({ rooms = fullRoom() } = {}) => {
  const harness = makeHarness({ rooms });
  const roomCode = Object.keys(rooms)[0];
  const alice = await harness.connect({ roomCode, username: "Alice" });
  const bob = await harness.connect({ roomCode, username: "Bob" });
  const aliceDeck = harness.deckLibrary.createDeck({ owner: "Alice", name: "Alice's deck", cards: legalSlugs() });
  const bobDeck = harness.deckLibrary.createDeck({ owner: "Bob", name: "Bob's deck", cards: legalSlugs() });
  await alice.trigger(EVENTS.GAME_DECK_SELECT, { deckId: aliceDeck.id });
  await bob.trigger(EVENTS.GAME_DECK_SELECT, { deckId: bobDeck.id });
  return { ...harness, roomCode, alice, bob, aliceDeck, bobDeck };
};

export const passTurn = { type: "pass-turn-action", data: {} };
