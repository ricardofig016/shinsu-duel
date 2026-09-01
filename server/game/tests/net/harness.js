import { io as createClient } from "socket.io-client";
import { createGameServer } from "../../../../server/createGameServer.js";
import { EVENTS } from "../../net/protocol.js";
import { createTestGame, setupGameWithHands } from "../utils.js";

/**
 * Real-transport test harness for the game net layer.
 *
 * Boots the express app and Socket.IO from `createGameServer` on an ephemeral
 * port, with an in-memory room store and the test-owned fixture catalog.
 * Players authenticate through the real `/auth/login` endpoint and connect
 * with `socket.io-client`, so the tests exercise the same path as the
 * browser: session cookie → socket handshake → gateway.
 *
 * Seats are always Alice and Bob (the fixture helpers' usernames). Room
 * records support a `hands` spec `{ Alice: [...], Bob: [...] }` that seeds
 * the players' opening hands with named fixture cards; without it both
 * players draw from legal fixture decks.
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

  const { server, io, registry } = createGameServer({
    loadRoom: async (roomCode) => rooms[roomCode] ?? null,
    ...(createGame !== undefined ? { createGame } : {}),
    ...(gameLogDirectory !== undefined ? { gameLogDirectory } : {}),
    logToFile: false,
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

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

  /** Create a full two-player room and connect both authenticated seats. */
  const seatPlayers = async ({ hands } = {}) => {
    const roomCode = createRoom({ hands });
    joinRoom(roomCode, "Alice");
    joinRoom(roomCode, "Bob");
    const alice = await connectPlayer({ username: "Alice", roomCode });
    const bob = await connectPlayer({ username: "Bob", roomCode });
    await waitFor(
      () => alice.lastPayloadOf(EVENTS.GAME_INIT) !== null && bob.lastPayloadOf(EVENTS.GAME_INIT) !== null,
      "game-init never arrived for both seats."
    );
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
  };

  return {
    baseUrl,
    rooms,
    registry,
    io,
    get createGameCalls() {
      return createGameCalls;
    },
    createRoom,
    joinRoom,
    login,
    connectPlayer,
    seatPlayers,
    waitFor,
    close,
  };
}
