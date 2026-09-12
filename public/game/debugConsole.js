import { EVENTS } from "/game/protocol.js";
import {
  DEBUG_ACTION_TYPES,
  DEBUG_QUERY_KINDS,
  buildDebugAction,
  buildDebugFirehose,
  buildDebugQuery,
  buildDebugRestart,
} from "/game/actions.js";
import {
  buildCardIndex,
  findCard,
  formatCardList,
  formatDebugEvent,
  formatHelp,
  formatUnitAbilities,
} from "/game/debugOutput.js";

/**
 * The dev console: `window.debug` on the game page.
 *
 * Every command travels over this module's own socket connection on the
 * current seat, so the page's own wiring is untouched and its store keeps
 * rendering the game normally. The server is the authority: all of this is
 * refused with `game-error` outside a dev room (see `docs/DEV_CONSOLE.md`).
 *
 * Commands that act on a seat default to this connection's own seat, which the
 * page learns from `/auth/status` and from the state views the server sends
 * this connection. Mutations are fire-and-forget: the engine's own broadcasts
 * and the event firehose show what they did. Queries resolve with their result.
 */

const SEAT_TIMEOUT_MS = 5000;
const QUERY_TIMEOUT_MS = 10000;

const roomCode = window.location.pathname.split("/").pop();
const socket = io("/game", { query: { roomCode } });

let cardIndex = buildCardIndex([]);
let seat = null;
let firehoseEnabled = true;
let queryCounter = 0;

/** requestId → { resolve, reject, timer } for queries in flight */
const inFlight = new Map();
const seatWaiters = [];

/* ── connection ─────────────────────────────────────────────────────────── */

const setSeat = (username) => {
  if (typeof username !== "string" || username.trim() === "") return;
  seat = username;
  for (const resolve of seatWaiters.splice(0)) resolve(seat);
};

/** Resolve the connection's own seat, waiting for the page to learn it. */
const ownSeat = () => {
  if (seat) return Promise.resolve(seat);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("This connection's seat is unknown; pass the seat explicitly."));
    }, SEAT_TIMEOUT_MS);
    seatWaiters.push((username) => {
      clearTimeout(timer);
      resolve(username);
    });
  });
};

const targetSeat = async (username) => {
  if (username !== undefined && username !== null && username !== "") {
    if (typeof username !== "string") throw new TypeError("The seat argument must be a username.");
    return username;
  }
  return ownSeat();
};

const sendMutation = (type, data) => {
  socket.emit(EVENTS.GAME_DEBUG_ACTION, buildDebugAction(type, data));
};

/**
 * Send one query and resolve with its result. A query settles exactly once:
 * with the matching `debug-result`, when the server refuses, or on its own
 * timeout, so a lost message can never leave a promise pending forever.
 */
const ask = (kind, args) => {
  queryCounter += 1;
  const requestId = `q${queryCounter}`;

  return new Promise((resolve, reject) => {
    const settle = (fn, value) => {
      clearTimeout(inFlight.get(requestId)?.timer);
      inFlight.delete(requestId);
      fn(value);
    };
    const timer = setTimeout(
      () => settle(reject, new Error(`Query ${requestId} (${kind}) was never answered.`)),
      QUERY_TIMEOUT_MS
    );

    inFlight.set(requestId, {
      timer,
      resolve: (data) => settle(resolve, data),
      reject: (error) => settle(reject, error),
    });
    socket.emit(EVENTS.GAME_DEBUG_QUERY, buildDebugQuery(kind, requestId, args));
  });
};

/** A rejection answers the sender only and never names a query, so it fails
 *  every request in flight: the console issues commands one at a time. */
const failInFlight = (message) => {
  for (const { reject } of [...inFlight.values()]) reject(new Error(message));
  inFlight.clear();
};

socket.on(EVENTS.GAME_DEBUG_RESULT, (result) => {
  inFlight.get(result.requestId)?.resolve(result.data);
});

socket.on(EVENTS.GAME_DEBUG_EVENT, (line) => console.log(formatDebugEvent(line)));

socket.on(EVENTS.GAME_ERROR, (payload) => {
  const message = payload?.message ?? "The dev console command was refused.";
  console.error(`[dev] ${message}`);
  failInFlight(message);
});

socket.on(EVENTS.GAME_INIT, (payload) => setSeat(payload?.you?.username));
socket.on(EVENTS.GAME_UPDATE, (payload) => setSeat(payload?.you?.username));

// A restart puts the room back in the deck-selection phase. The page renders
// that step itself; the game-over overlay is the one panel it never clears, so
// the console clears it here to leave the selection visible.
socket.on(EVENTS.GAME_DECK_STATUS, () => {
  document.querySelector("#game-over-overlay")?.classList.add("hidden");
});

/** The card catalog behind `debug.card`, fetched once and cached. */
const loadCards = async () => {
  try {
    const response = await fetch("/cards/data?dev=true");
    if (!response.ok) throw new Error(`/cards/data responded ${response.status}`);
    const payload = await response.json();
    // The dev variant carries the test cards too, so every id a dev room can
    // deal has a name in the console's output.
    cardIndex = buildCardIndex([...(payload.cards ?? []), ...(payload.testCards ?? [])]);
  } catch (error) {
    console.error(`[dev] card catalog unavailable: ${error.message}`);
  }
};

const loadSeat = async () => {
  try {
    const response = await fetch("/auth/status");
    const payload = await response.json();
    if (payload?.isAuthenticated) setSeat(payload.username);
  } catch {
    // The state views the server sends this connection set the seat too.
  }
};

/* ── the command surface ────────────────────────────────────────────────── */

window.debug = {
  help() {
    const text = formatHelp();
    console.log(text);
    return text;
  },

  async draw(amount = 1, username) {
    await sendMutation(DEBUG_ACTION_TYPES.DRAW, { username: await targetSeat(username), amount });
  },

  async mulligan(amount = 5, username) {
    await sendMutation(DEBUG_ACTION_TYPES.MULLIGAN, { username: await targetSeat(username), amount });
  },

  async addToHand(cardId, username) {
    await sendMutation(DEBUG_ACTION_TYPES.ADD_TO_HAND, { username: await targetSeat(username), cardId });
  },

  async addToDeck(cardId, placement = "top", username) {
    await sendMutation(DEBUG_ACTION_TYPES.ADD_TO_DECK, {
      username: await targetSeat(username),
      cardId,
      placement,
    });
  },

  async shuffleDeck(username) {
    await sendMutation(DEBUG_ACTION_TYPES.SHUFFLE_DECK, { username: await targetSeat(username) });
  },

  async grantShinsu(amount, username) {
    await sendMutation(DEBUG_ACTION_TYPES.GRANT_SHINSU, { username: await targetSeat(username), amount });
  },

  async endRound() {
    await sendMutation(DEBUG_ACTION_TYPES.END_ROUND, {});
  },

  async forceTurn() {
    await sendMutation(DEBUG_ACTION_TYPES.FORCE_TURN, {});
  },

  async setRound(round) {
    await sendMutation(DEBUG_ACTION_TYPES.SET_ROUND, { round });
  },

  async spawn(cardId, positionCode, username) {
    await sendMutation(DEBUG_ACTION_TYPES.SPAWN_UNIT, {
      username: await targetSeat(username),
      cardId,
      positionCode,
    });
  },

  async setUnitHp(unitId, value) {
    await sendMutation(DEBUG_ACTION_TYPES.UNIT_HP, { unitId, value });
  },

  async destroyUnit(unitId) {
    await sendMutation(DEBUG_ACTION_TYPES.DESTROY_UNIT, { unitId });
  },

  async modifyLighthouses(amount, username) {
    await sendMutation(DEBUG_ACTION_TYPES.LIGHTHOUSES, { username: await targetSeat(username), amount });
  },

  async hand(username) {
    const result = await ask(DEBUG_QUERY_KINDS.HAND, { username: await targetSeat(username) });
    console.log(formatCardList("hand", result, cardIndex));
    return result;
  },

  async deck(username) {
    const result = await ask(DEBUG_QUERY_KINDS.DECK, { username: await targetSeat(username) });
    console.log(formatCardList("deck", result, cardIndex));
    return result;
  },

  async abilities(unitId) {
    const result = await ask(DEBUG_QUERY_KINDS.UNIT_ABILITIES, { unitId });
    console.log(formatUnitAbilities(result));
    return result;
  },

  async state() {
    const state = await ask(DEBUG_QUERY_KINDS.STATE, {});
    console.log(state);
    return state;
  },

  async logs() {
    const result = await ask(DEBUG_QUERY_KINDS.LOGS, {});
    console.log(result.entries);
    return result.entries;
  },

  async firehose(enabled = !firehoseEnabled) {
    if (typeof enabled !== "boolean") throw new TypeError("firehose(enabled) takes a boolean.");
    firehoseEnabled = enabled;
    socket.emit(EVENTS.GAME_DEBUG_FIREHOSE, buildDebugFirehose(enabled));
    console.log(`[dev] event firehose ${enabled ? "on" : "off"}`);
    return enabled;
  },

  restart() {
    socket.emit(EVENTS.GAME_DEBUG_RESTART, buildDebugRestart());
    console.log("[dev] restarting: both seats return to the deck-selection step");
  },

  card(reference) {
    const card = findCard(cardIndex, reference);
    if (!card) {
      console.error(`[dev] no card matches ${reference}`);
      return null;
    }
    console.log(card);
    return card;
  },
};

void loadCards();
void loadSeat();
console.log("[dev] console ready. Run debug.help() for the command list.");
