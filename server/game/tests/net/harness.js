import { io as createClient } from "socket.io-client";
import fs from "fs";
import os from "os";
import path from "path";
import { createGameServer } from "../../../../server/createGameServer.js";
import { createDeckLibrary } from "../../../../server/decks/deckLibrary.js";
import { EVENTS } from "../../net/protocol.js";
import { createTestGame, setupGameWithHands, createLegalDeck } from "../utils.js";
import { cards } from "../fixtures/cards.js";

/**
 * Real-transport test harness for the game net layer.
 *
 * Boots the express app and Socket.IO from `createGameServer` on an ephemeral
 * port, with an in-memory room store, a temp-file deck library, and the
 * test-owned fixture catalog. Players authenticate through the real
 * `/auth/login` endpoint and connect with `socket.io-client`, so the tests
 * exercise the same path as the browser: session cookie → socket handshake →
 * gateway.
 *
 * Seats are always Alice and Bob (the fixture helpers' usernames). Room
 * records support a `hands` spec `{ Alice: [...], Bob: [...] }` that seeds
 * the players' opening hands with named fixture cards; without it both
 * players draw from legal fixture decks.
 *
 * A game starts only once both seats selected a deck (the pre-game
 * deck-selection phase). `seatPlayers` selects an auto-created legal deck
 * per seat; tests that need specific decks create them through the harness
 * deck helpers and select them explicitly.
 */

const SEAT_USERNAMES = ["Alice", "Bob"];
const CONNECT_TIMEOUT_MS = 4000;
const EVENT_TIMEOUT_MS = 2000;
const POLL_INTERVAL_MS = 10;

/** Wrap a raw client socket with event capture and awaiting helpers. */
function wrapSocket(socket) {
  const received = [];
  socket.onAny((event, payload) => received.push({ event, payload }));

  return {
    socket,
    payloadsOf(event) {
      return received.filter((entry) => entry.event === event).map((entry) => entry.payload);
    },
    lastPayloadOf(event) {
      const payloads = this.payloadsOf(event);
      return payloads[payloads.length - 1] ?? null;
    },
    /**
     * Resolve with the next payload of `event`, rejecting if it does not
     * arrive within the timeout.
     */
    next(event, timeoutMs = EVENT_TIMEOUT_MS) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          socket.off(event, onEvent);
          reject(new Error(`Timed out after ${timeoutMs}ms waiting for "${event}".`));
        }, timeoutMs);
        const onEvent = (payload) => {
          clearTimeout(timer);
          resolve(payload);
        };
        socket.once(event, onEvent);
      });
    },
    emit(event, payload) {
      socket.emit(event, payload);
    },
    disconnect() {
      socket.disconnect();
    },
  };
}

export async function createNetHarness({ createGame: customCreateGame, gameLogDirectory } = {}) {
  const rooms = {};
  let createGameCalls = 0;
  const clients = [];

  const handsGameFactory = ({ roomCode }) => {
    createGameCalls += 1;
    const hands = rooms[roomCode]?.hands;
    return hands ? setupGameWithHands({ Alice: hands.Alice ?? [], Bob: hands.Bob ?? [] }) : createTestGame();
  };

  // A harness either injects its own game factory, or — by supplying a
  // gameLogDirectory without a factory — boots the production default
  // factory from createGameServer (used by the dev-room logging tests).
  const createGame =
    customCreateGame !== undefined
      ? (...args) => {
          createGameCalls += 1;
          return customCreateGame(...args);
        }
      : gameLogDirectory !== undefined
        ? undefined
        : handsGameFactory;

  const decksFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dsh-net-decks-")), "decks.json");
  const deckLibrary = createDeckLibrary({ filePath: decksFile });

  const { server, io, registry } = createGameServer({
    loadRoom: async (roomCode) => rooms[roomCode] ?? null,
    deckLibrary,
    catalog: cards,
    ...(createGame !== undefined ? { createGame } : {}),
    ...(gameLogDirectory !== undefined ? { gameLogDirectory } : {}),
    logToFile: false,
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const slugByCardId = new Map(Object.values(cards).map((card) => [card.cardId, card.slug]));

  /** A legal 30-card deck as card slugs, from the fixture catalog. */
  const legalDeckSlugs = () => createLegalDeck().map((cardId) => slugByCardId.get(cardId));

  /** Add a room to the store and return its code. */
  const createRoom = ({ hands } = {}) => {
    const roomCode = `R${Object.keys(rooms).length + 1}`.padEnd(6, "0");
    rooms[roomCode] = { players: [], opponent: "friend", difficulty: null, seed: 1, ...(hands ? { hands } : {}) };
    return roomCode;
  };

  /** Add a seat username to a room's players. */
  const joinRoom = (roomCode, username) => {
    const room = rooms[roomCode];
    if (!room) throw new Error(`Unknown room: ${roomCode}`);
    if (!SEAT_USERNAMES.includes(username)) {
      throw new Error(`The harness only supports seats ${SEAT_USERNAMES.join(" and ")}.`);
    }
    if (!room.players.includes(username)) room.players.push(username);
  };

  /** Authenticate through the real login endpoint; returns the session cookie. */
  const login = async (username) => {
    const response = await fetch(`${baseUrl}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username }),
    });
    if (!response.ok) throw new Error(`Login failed for ${username}: ${response.status}.`);
    const cookies = response.headers.getSetCookie();
    const sessionCookie = cookies.find((cookie) => cookie.startsWith("connect.sid="));
    if (!sessionCookie) throw new Error(`Login for ${username} did not set a session cookie.`);
    return sessionCookie.split(";")[0];
  };

  /** Open a socket for one player, mirroring the browser connection options. */
  const connectPlayer = async ({ username, roomCode }) => {
    const cookie = await login(username);
    const socket = createClient(`${baseUrl}/game`, {
      extraHeaders: { cookie },
      query: { roomCode },
      transports: ["websocket"],
      reconnection: false,
    });

    const client = wrapSocket(socket);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error(`Timed out connecting ${username} to room ${roomCode}.`));
      }, CONNECT_TIMEOUT_MS);
      socket.once("connect", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once("connect_error", (error) => {
        clearTimeout(timer);
        socket.close();
        reject(new Error(`${username} failed to connect to room ${roomCode}: ${error.message}`));
      });
    });
    clients.push(client);
    return client;
  };

  /**
   * Create a deck in the harness library; returns the deck record. Creations
   * are serialized: the library does read-modify-write on its JSON file, so
   * concurrent creates would clobber each other.
   */
  let deckQueue = Promise.resolve();
  const createDeck = (username, name, cardSlugs) => {
    const created = deckQueue.then(() => deckLibrary.createDeck({ owner: username, name, cards: cardSlugs }));
    deckQueue = created.catch(() => {});
    return created;
  };

  /** Each seat's auto-created legal deck, for tests that don't care which. */
  const seatDeckIds = new Map();
  const defaultSeatDeckId = async (username) => {
    if (!seatDeckIds.has(username)) {
      const deck = await createDeck(username, `${username}'s deck`, legalDeckSlugs());
      seatDeckIds.set(username, deck.id);
    }
    return seatDeckIds.get(username);
  };

  /** Emit the deck-selection message for one seat. */
  const selectDeck = (client, deckId) => client.emit(EVENTS.GAME_DECK_SELECT, { deckId });

  /** Emit deck selections for both seats without waiting for the start. */
  const pickDecks = async ({ alice, bob }, deckIds = {}) => {
    const [aliceDeckId, bobDeckId] = await Promise.all([
      deckIds.Alice ?? defaultSeatDeckId("Alice"),
      deckIds.Bob ?? defaultSeatDeckId("Bob"),
    ]);
    selectDeck(alice, aliceDeckId);
    selectDeck(bob, bobDeckId);
  };

  /** Select decks for both seats and await the game-init broadcast. */
  const selectDecks = async ({ alice, bob }, deckIds = {}) => {
    await pickDecks({ alice, bob }, deckIds);
    await waitFor(
      () => alice.lastPayloadOf(EVENTS.GAME_INIT) !== null && bob.lastPayloadOf(EVENTS.GAME_INIT) !== null,
      "game-init never arrived for both seats."
    );
  };

  /** Create a full two-player room, connect both seats, and select decks. */
  const seatPlayers = async ({ hands } = {}) => {
    const roomCode = createRoom({ hands });
    joinRoom(roomCode, "Alice");
    joinRoom(roomCode, "Bob");
    const alice = await connectPlayer({ username: "Alice", roomCode });
    const bob = await connectPlayer({ username: "Bob", roomCode });
    await selectDecks({ alice, bob });
    return { roomCode, alice, bob };
  };

  /** Poll until `predicate` is true; rejects with `message` on timeout. */
  const waitFor = async (predicate, message, timeoutMs = EVENT_TIMEOUT_MS) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    throw new Error(message);
  };

  /** Disconnect every client and stop the server. */
  const close = async () => {
    for (const client of clients) client.disconnect();
    await new Promise((resolve) => io.close(resolve));
    server.closeAllConnections?.();
    fs.rmSync(path.dirname(decksFile), { recursive: true, force: true });
  };

  return {
    baseUrl,
    rooms,
    registry,
    io,
    deckLibrary,
    legalDeckSlugs,
    get createGameCalls() {
      return createGameCalls;
    },
    createRoom,
    joinRoom,
    login,
    connectPlayer,
    createDeck,
    selectDeck,
    pickDecks,
    selectDecks,
    seatPlayers,
    waitFor,
    close,
  };
}
