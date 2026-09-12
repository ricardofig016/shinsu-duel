/**
 * One live game session for a room: two seats, the players' current
 * connections, the authoritative `GameState` (once started), and the
 * monotonic revision counter tagged onto every outbound snapshot.
 *
 * A connection is anything that can receive outbound events through
 * `send(event, payload)`. The socket gateway wraps sockets into connections;
 * a bot controller implements the same interface to occupy a seat without a
 * socket. Connections are never addressed by transport specifics here, so
 * delivery works identically for every occupant of a seat.
 */

const REQUIRED_GAME_METHODS = ["processAction", "resolveDecision"];

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
}

function assertConnection(connection) {
  if (!connection || typeof connection.send !== "function") {
    throw new TypeError(
      "A connection must be an object with a send(event, payload) function."
    );
  }
}

/**
 * One player's place in a session. Holds that player's live connections;
 * the seat persists while individual connections come and go.
 */
class Seat {
  #username;
  #connections = new Set();

  constructor(username) {
    assertNonEmptyString(username, "Seat username");
    this.#username = username;
  }

  get username() {
    return this.#username;
  }

  get size() {
    return this.#connections.size;
  }

  add(connection) {
    assertConnection(connection);
    this.#connections.add(connection);
  }

  remove(connection) {
    this.#connections.delete(connection);
  }

  forEach(fn) {
    for (const connection of this.#connections) fn(connection);
  }
}

export default class GameSession {
  #roomCode;
  #usernames;
  #seed;
  #createGame;
  #seats;
  #game = null;
  #revision = 0;
  /** username → pending pre-game deck pick, cleared at game start */
  #deckPicks = new Map();

  /**
   * @param {object} args
   * @param {string} args.roomCode unique room code this session serves
   * @param {Array<string>} args.usernames exactly 2 distinct seat usernames
   * @param {number} args.seed seed handed to the game factory on start
   * @param {Function} args.createGame `({ roomCode, usernames, seed, decks, enforceDeckRules }) => GameState`
   */
  constructor({ roomCode, usernames, seed, createGame }) {
    assertNonEmptyString(roomCode, "roomCode");
    if (!Array.isArray(usernames) || usernames.length !== 2) {
      throw new TypeError("A session needs exactly 2 seat usernames.");
    }
    for (const username of usernames) assertNonEmptyString(username, "Seat username");
    if (usernames[0] === usernames[1]) {
      throw new TypeError("Seat usernames must be distinct.");
    }
    if (typeof seed !== "number" || !Number.isFinite(seed)) {
      throw new TypeError("seed must be a finite number.");
    }
    if (typeof createGame !== "function") {
      throw new TypeError("createGame must be a function.");
    }

    this.#roomCode = roomCode;
    this.#usernames = [...usernames];
    this.#seed = seed;
    this.#createGame = createGame;
    this.#seats = new Map(usernames.map((username) => [username, new Seat(username)]));
  }

  get roomCode() {
    return this.#roomCode;
  }

  get usernames() {
    return [...this.#usernames];
  }

  get seed() {
    return this.#seed;
  }

  get game() {
    return this.#game;
  }

  get isStarted() {
    return this.#game !== null;
  }

  get revision() {
    return this.#revision;
  }

  hasSeat(username) {
    return this.#seats.has(username);
  }

  /**
   * Register a connection on its player's seat.
   */
  attach(username, connection) {
    this.#seat(username).add(connection);
  }

  /**
   * Remove a connection from its seat. Idempotent: detaching an unknown or
   * already-detached connection is a no-op, so repeated disconnects are safe.
   */
  detach(username, connection) {
    if (!this.hasSeat(username)) return;
    this.#seats.get(username).remove(connection);
  }

  connectionCount(username) {
    return this.hasSeat(username) ? this.#seats.get(username).size : 0;
  }

  /** Every seat holds at least one live connection. */
  isFull() {
    return this.#usernames.every((username) => this.#seats.get(username).size > 0);
  }

  /** No seat holds any connection. */
  isEmpty() {
    return this.#usernames.every((username) => this.#seats.get(username).size === 0);
  }

  /**
   * Create the session's game exactly once and count its creation as the
   * first state change. Later calls return the existing game. The start
   * arguments (dealt decks and the deck-rule enforcement mode) come from the
   * resolved pre-game deck selections.
   *
   * @param {object} [startArgs]
   * @param {object|null} [startArgs.decks] username → dealt cardIds; a seat
   *   without an entry receives the factory's default deck
   * @param {boolean} [startArgs.enforceDeckRules] whether the engine enforces
   *   the RULES.md deck rules on the dealt decks (default true)
   */
  ensureGame({ decks = null, enforceDeckRules = true } = {}) {
    if (this.#game) return this.#game;

    const game = this.#createGame({
      roomCode: this.#roomCode,
      usernames: this.#usernames,
      seed: this.#seed,
      decks,
      enforceDeckRules,
    });
    const missingMethod = game
      ? REQUIRED_GAME_METHODS.find((method) => typeof game[method] !== "function")
      : "a game object";
    if (missingMethod || !game.eventBus) {
      throw new TypeError(
        `createGame must produce a game exposing processAction, resolveDecision, and eventBus (missing: ${missingMethod}).`
      );
    }

    this.#game = game;
    this.#revision += 1;
    return game;
  }

  /**
   * Store a seat's pre-game deck pick, replacing any earlier pick. The pick
   * holds the deck-library record the seat selected; it survives
   * disconnects and is cleared when the game starts.
   *
   * @param {string} username seat owner
   * @param {{ deckId: string, name: string, cards: string[], illegal: boolean }} pick
   */
  setDeckPick(username, pick) {
    this.#seat(username);
    if (!pick || typeof pick !== "object") {
      throw new TypeError("A deck pick must be an object.");
    }
    assertNonEmptyString(pick.deckId, "pick.deckId");
    assertNonEmptyString(pick.name, "pick.name");
    if (!Array.isArray(pick.cards) || pick.cards.some((slug) => typeof slug !== "string")) {
      throw new TypeError("pick.cards must be an array of card slugs.");
    }
    if (typeof pick.illegal !== "boolean") {
      throw new TypeError("pick.illegal must be a boolean.");
    }

    this.#deckPicks.set(username, {
      deckId: pick.deckId,
      name: pick.name,
      cards: [...pick.cards],
      illegal: pick.illegal,
    });
  }

  /** @returns {object|null} the seat's pending pick, or null */
  getDeckPick(username) {
    return this.#deckPicks.get(username) ?? null;
  }

  /** Drop one seat's pick (its deck became invalid before the start). */
  clearDeckPick(username) {
    this.#deckPicks.delete(username);
  }

  /** Drop every pending pick; called when the game starts. */
  clearDeckPicks() {
    this.#deckPicks.clear();
  }

  /**
   * Run a validated player action through the engine. Bumps the revision on
   * success; a rejected action leaves the revision untouched.
   */
  applyAction(action) {
    this.#requireStarted();
    this.#game.processAction(action);
    this.#revision += 1;
    return this.#revision;
  }

  /**
   * Resolve the pending player decision through the engine. Bumps the
   * revision on success; a rejected decision leaves the revision untouched.
   */
  applyDecision(decision) {
    this.#requireStarted();
    this.#game.resolveDecision(decision);
    this.#revision += 1;
    return this.#revision;
  }

  /**
   * Send an event to every live connection. The payload is built once per
   * seat: `buildPayload(username)` returns that seat's view of the event.
   */
  broadcast(event, buildPayload) {
    if (typeof buildPayload !== "function") {
      throw new TypeError("broadcast needs a buildPayload(username) function.");
    }
    for (const username of this.#usernames) {
      const payload = buildPayload(username);
      this.#seats.get(username).forEach((connection) => connection.send(event, payload));
    }
  }

  /**
   * Send an event to one seat's connections only.
   * `buildPayload(username)` returns that seat's view of the event.
   */
  sendTo(username, event, buildPayload) {
    const seat = this.#seats.get(username);
    if (!seat) throw new Error(`Session ${this.#roomCode} has no seat for ${username}.`);
    if (typeof buildPayload !== "function") {
      throw new TypeError("sendTo needs a buildPayload(username) function.");
    }
    const payload = buildPayload(username);
    seat.forEach((connection) => connection.send(event, payload));
  }

  #seat(username) {
    const seat = this.#seats.get(username);
    if (!seat) throw new Error(`Session ${this.#roomCode} has no seat for ${username}.`);
    return seat;
  }

  #requireStarted() {
    if (!this.#game) throw new Error("The session's game has not started yet.");
  }
}
