import EventBridge from "./eventBridge.js";
import EventFirehose from "./eventFirehose.js";
import { resolveDebugQuery } from "./debugQueries.js";
import {
  EVENTS,
  TRANSPORT_EVENTS,
  ERROR_CODES,
  buildStateView,
  buildError,
  buildGameOverResult,
  buildWaitingPayload,
  buildDeckStatus,
  buildDeckReveal,
  buildDebugResult,
} from "./protocol.js";
import { isDevRoomCode } from "../devRooms.js";
import { validateDeckCards } from "../../decks/deckValidation.js";
import { buildDeckFanSlugs } from "../../decks/deckFan.js";
import { buildSlugIndex } from "../../utils/card-catalog.js";

const GAME_NAMESPACE = "/game";
const WAITING_ROOM_MESSAGE = "Game has not started yet.";
const NOT_A_PARTICIPANT_MESSAGE = "Room not found or you are not a participant.";
const ALREADY_STARTED_MESSAGE = "The game has already started.";
const NOT_A_DEV_ROOM_MESSAGE = "The dev console is only available in dev rooms (TESTROOMxx).";
const DEFAULT_PRESENCE_GRACE_MS = 3000;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Binds the Socket.IO transport to the session layer.
 *
 * Every connection is validated against the room registry (the express-session
 * username must have an account and be a participant of the room it connects
 * to), then attached to its player's seat. Seats hold many connections, so one
 * player can play from several tabs. Connecting both seats opens the pre-game
 * deck-selection phase:
 * each seat picks a deck from its own collection through `submitDeckSelect`,
 * and the game is created — with those decks — once both seats hold a valid
 * selection. The session — game and revision included — outlives every
 * disconnect, so a rejoining player resumes the exact state, open decision
 * included.
 *
 * Inbound `game-deck-select`, `game-action`, and `game-decision` messages
 * funnel through `submitDeckSelect` / `submitAction` / `submitDecision`,
 * which validate the payload shape and stamp the authenticated identity
 * before anything reaches the deck library or the engine. A bot controller
 * occupies a seat through the same connection interface and calls the same
 * entry points, without a socket.
 *
 * Dev rooms (see `isDevRoomCode`) additionally accept the console paths —
 * `debug-action`, `debug-query`, `debug-firehose`, and `debug-restart` — all
 * gated on the room code and refused everywhere else. Mutations flow through
 * the engine like player actions; queries only read; the restart replaces the
 * session.
 */
export default class SocketGateway {
  #registry;
  #loadRoom;
  #createGame;
  #deckLibrary;
  #catalog;
  #isAccountActive;
  #logger;
  /**
   * roomCode → the net-layer subscriptions attached to its started game (the
   * event bridge, and in a dev room the event firehose with the streamer that
   * produced it, so a connection joining later can be caught up). Their
   * unsubscribes let a dropped session leave nothing behind on the game it
   * abandons.
   */
  #subscriptions = new Map();

  /**
   * roomCode → the session whose start resolution is in flight, so one start
   * runs per room. Keyed by room code rather than by session object: a dev-room
   * restart replaces the session, and the replacement must be able to start.
   */
  #starting = new Map();

  /** roomCode → connections parked while the room's second player has not joined */
  #waitingRoom = new Map();

  /**
   * How long a seat holding no connections still counts as present. Every step
   * of the pre-game pages detaches and re-attaches a socket, so reporting a
   * departure the moment a socket closes would report one on every step change.
   */
  #presenceGraceMs;

  /** roomCode → username → pending presence-expiry timer */
  #presenceTimers = new Map();

  constructor({
    registry,
    loadRoom,
    createGame,
    deckLibrary,
    catalog,
    isAccountActive,
    logger = null,
    presenceGraceMs = DEFAULT_PRESENCE_GRACE_MS,
  }) {
    if (!registry || typeof registry.ensureSession !== "function" || typeof registry.get !== "function") {
      throw new TypeError("SocketGateway needs a registry exposing ensureSession and get.");
    }
    if (typeof loadRoom !== "function") throw new TypeError("loadRoom must be a function.");
    if (typeof createGame !== "function") throw new TypeError("createGame must be a function.");
    if (!deckLibrary || typeof deckLibrary.getOwnedDeck !== "function") {
      throw new TypeError("SocketGateway needs a deck library exposing getOwnedDeck.");
    }
    if (!isPlainObject(catalog)) throw new TypeError("SocketGateway needs a compiled card catalog.");
    if (typeof isAccountActive !== "function") {
      throw new TypeError("SocketGateway needs an isAccountActive predicate.");
    }
    if (logger !== null && typeof logger !== "object") throw new TypeError("logger must be an object or null.");
    if (typeof presenceGraceMs !== "number" || !Number.isFinite(presenceGraceMs) || presenceGraceMs < 0) {
      throw new TypeError("presenceGraceMs must be a non-negative number.");
    }

    this.#registry = registry;
    this.#loadRoom = loadRoom;
    this.#createGame = createGame;
    this.#deckLibrary = deckLibrary;
    this.#catalog = catalog;
    this.#isAccountActive = isAccountActive;
    this.#logger = logger;
    this.#presenceGraceMs = presenceGraceMs;
  }

  attach(io) {
    io.of(GAME_NAMESPACE).on(TRANSPORT_EVENTS.CONNECT, (socket) => {
      void this.#onConnection(socket);
    });
  }

  async #onConnection(socket) {
    const roomCode = socket.handshake?.query?.roomCode;
    const username = socket.request?.session?.username;
    const connection = {
      send: (event, payload) => socket.emit(event, payload),
      close: () => socket.disconnect(true),
    };

    try {
      if (!isNonEmptyString(roomCode)) {
        connection.send(EVENTS.GAME_ERROR, buildError("A game connection needs a room code."));
        connection.close();
        return;
      }
      if (!isNonEmptyString(username) || !(await this.#isAccountActive(username))) {
        connection.send(
          EVENTS.GAME_ERROR,
          buildError("A game connection needs an account that still exists.", ERROR_CODES.UNAUTHENTICATED)
        );
        connection.close();
        return;
      }

      const room = await this.#loadRoom(roomCode);
      if (!isPlainObject(room) || !Array.isArray(room.players) || !room.players.includes(username)) {
        connection.send(EVENTS.GAME_ERROR, buildError(NOT_A_PARTICIPANT_MESSAGE));
        connection.close();
        return;
      }

      this.#registerInboundHandlers(socket, roomCode, username, connection);

      if (room.players.length !== 2) {
        // The room's second player has not joined yet, so no session can
        // exist. Park the connection; it joins the session when the room is
        // completed by a later connection.
        this.#waitingEntries(roomCode).push({ username, connection });
        connection.send(EVENTS.GAME_WAITING, buildWaitingPayload());
        return;
      }

      const session = this.#registry.ensureSession({
        roomCode,
        usernames: room.players,
        seed: room.seed,
        createGame: this.#createGame,
      });
      if (!session.hasSeat(username)) {
        connection.send(EVENTS.GAME_ERROR, buildError(NOT_A_PARTICIPANT_MESSAGE));
        connection.close();
        return;
      }

      this.#absorbWaiting(session);
      this.#attachConnection(session, username, connection);

      if (!session.isStarted) {
        if (session.isFull()) this.#tryStartGame(session);
        else connection.send(EVENTS.GAME_DECK_STATUS, this.#deckStatusPayload(session, username));
      } else {
        this.#sendStateView(session, username, connection);
        // The stream belongs to the game rather than to this connection, so a
        // dev-room console that attaches mid-game is caught up with the events
        // the game already produced, after its state view and before the live
        // lines that follow.
        this.#subscriptions.get(session.roomCode)?.streamer?.catchUp(connection);
      }
    } catch (error) {
      this.#log("error", `SocketGateway: connection to room ${roomCode} failed`, { error: error.message });
      connection.send(EVENTS.GAME_ERROR, buildError("The game connection failed."));
      connection.close();
    }
  }

  /**
   * Validated inbound path for the pre-game deck selection. Selectability is
   * enforced here: a normal room accepts only decks the live validation
   * calls legal, a dev room (`isDevRoomCode`) accepts anything buildable.
   * The accepted pick is stored on the session and broadcast to both seats
   * as the per-seat selection progress.
   */
  submitDeckSelect({ session, username, connection, payload }) {
    if (!isPlainObject(payload) || !isNonEmptyString(payload.deckId)) {
      connection.send(EVENTS.GAME_ERROR, buildError("Malformed deck selection payload."));
      return;
    }
    if (!this.#isPlaying(session, username, connection)) return;
    if (session.isStarted) {
      connection.send(EVENTS.GAME_ERROR, buildError(ALREADY_STARTED_MESSAGE));
      return;
    }

    void this.#selectDeck({ session, username, connection, deckId: payload.deckId });
  }

  /**
   * Async body of `submitDeckSelect`: the deck lookup reads the library's
   * storage, so it is awaited here while the entry point stays synchronous.
   */
  async #selectDeck({ session, username, connection, deckId }) {
    const deck = await this.#deckLibrary.getOwnedDeck(deckId, username);
    if (!deck) {
      connection.send(EVENTS.GAME_ERROR, buildError("Deck not found."));
      return;
    }

    const validation = validateDeckCards(deck.cards, this.#catalog);
    if (!validation.buildable) {
      connection.send(EVENTS.GAME_ERROR, buildError(`Deck contains unknown cards: ${validation.problems.join(" ")}`));
      return;
    }
    const dev = isDevRoomCode(session.roomCode);
    if (!validation.legal && !dev) {
      connection.send(EVENTS.GAME_ERROR, buildError(`This deck is not legal: ${validation.problems.join(" ")}`));
      return;
    }

    session.setDeckPick(username, {
      deckId: deck.id,
      name: deck.name,
      cards: deck.cards,
      illegal: !validation.legal,
    });
    if (session.isFull()) this.#tryStartGame(session);
    else this.#broadcastDeckStatus(session);
  }

  /**
   * Validated inbound path for player actions. The connection is the reply
   * channel: rejections go back to the sender only, accepted state changes
   * are broadcast to every seat.
   */
  submitAction({ session, username, connection, action }) {
    if (!isPlainObject(action) || !isNonEmptyString(action.type) || !isPlainObject(action.data)) {
      connection.send(EVENTS.GAME_ERROR, buildError("Malformed action payload."));
      return;
    }
    if (!this.#isPlaying(session, username, connection)) return;
    if (!session.isStarted) {
      connection.send(EVENTS.GAME_ERROR, buildError(WAITING_ROOM_MESSAGE));
      return;
    }

    const game = session.game;
    if (game.gameOver) {
      connection.send(EVENTS.GAME_OVER, buildGameOverResult(game.gameOver));
      return;
    }

    // Identity is authoritative: the connection's player, never the payload's.
    action.data.username = username;
    action.data.source = "player";

    try {
      session.applyAction(action);
    } catch (error) {
      connection.send(EVENTS.GAME_ERROR, buildError(error.message));
      return;
    }

    this.#broadcastState(session, game);
  }

  /**
   * Validated inbound path for pending-decision resolutions. Same contract
   * as `submitAction`; the decision is rebuilt from validated fields so no
   * foreign payload reaches the engine.
   */
  submitDecision({ session, username, connection, decision }) {
    if (!isPlainObject(decision) || !isNonEmptyString(decision.decisionId) || !Array.isArray(decision.choices)) {
      connection.send(EVENTS.GAME_ERROR, buildError("Malformed decision payload."));
      return;
    }
    if (!this.#isPlaying(session, username, connection)) return;
    if (!session.isStarted) {
      connection.send(EVENTS.GAME_ERROR, buildError(WAITING_ROOM_MESSAGE));
      return;
    }

    const game = session.game;
    if (game.gameOver) {
      connection.send(EVENTS.GAME_OVER, buildGameOverResult(game.gameOver));
      return;
    }

    try {
      session.applyDecision({ decisionId: decision.decisionId, choices: decision.choices, username });
    } catch (error) {
      connection.send(EVENTS.GAME_ERROR, buildError(error.message));
      return;
    }

    this.#broadcastState(session, game);
  }

  /**
   * Validated inbound path for dev-console mutations. Same contract as
   * `submitAction` — the payload's identity is never trusted, the engine
   * decides — with two additions:
   *
   *  - the room must be a dev room, checked before the session is touched;
   *  - the message is stamped `source: "debug"` and `requestedBy`, so only
   *    debug actions accept it and the replay artifact records who issued it.
   */
  submitDebugAction({ session, username, connection, action }) {
    if (!isPlainObject(action) || !isNonEmptyString(action.type) || !isPlainObject(action.data)) {
      connection.send(EVENTS.GAME_ERROR, buildError("Malformed debug action payload."));
      return;
    }
    if (!this.#isDevRoom(session, connection)) return;
    if (!this.#isPlaying(session, username, connection)) return;
    if (!session.isStarted) {
      connection.send(EVENTS.GAME_ERROR, buildError(WAITING_ROOM_MESSAGE));
      return;
    }

    const game = session.game;
    if (game.gameOver) {
      connection.send(EVENTS.GAME_OVER, buildGameOverResult(game.gameOver));
      return;
    }

    // The seat a command acts on is part of the payload and is validated
    // against the session; the identity of the player issuing it is not.
    if (action.data.username !== undefined && !session.hasSeat(action.data.username)) {
      connection.send(EVENTS.GAME_ERROR, buildError(NOT_A_PARTICIPANT_MESSAGE));
      return;
    }
    action.data.requestedBy = username;
    action.data.source = "debug";

    try {
      session.applyAction(action);
    } catch (error) {
      connection.send(EVENTS.GAME_ERROR, buildError(error.message));
      return;
    }

    this.#broadcastState(session, game);
  }

  /**
   * Validated inbound path for dev-console queries. A query only reads: it
   * never touches the revision counter and never reaches the Logger, so the
   * replay artifact stays exactly as long as the mutations actually applied.
   * The answer is targeted at the sender, and `requestId` is echoed so the
   * console can resolve the matching promise.
   *
   * Every refusal of a query echoes the request id it refuses, so the console
   * settles exactly the query being answered. A refusal that names no request
   * (a rejected action, for instance) is never a query's answer, and the
   * console leaves its queries in flight when it sees one.
   */
  submitDebugQuery({ session, username, connection, query }) {
    const requestId = isNonEmptyString(query?.requestId) ? query.requestId : null;

    if (!isPlainObject(query) || requestId === null || !isNonEmptyString(query.kind)) {
      connection.send(EVENTS.GAME_ERROR, buildError("Malformed debug query payload.", null, requestId));
      return;
    }
    if (!this.#isDevRoom(session, connection, requestId)) return;
    if (!this.#isPlaying(session, username, connection, requestId)) return;
    if (!session.isStarted) {
      connection.send(EVENTS.GAME_ERROR, buildError(WAITING_ROOM_MESSAGE, null, requestId));
      return;
    }

    const target = query.username === undefined ? username : query.username;
    if (!session.hasSeat(target)) {
      connection.send(EVENTS.GAME_ERROR, buildError(NOT_A_PARTICIPANT_MESSAGE, null, requestId));
      return;
    }

    let data;
    try {
      data = resolveDebugQuery({
        game: session.game,
        kind: query.kind,
        username: target,
        unitId: query.unitId ?? null,
      });
    } catch (error) {
      connection.send(EVENTS.GAME_ERROR, buildError(error.message, null, requestId));
      return;
    }

    connection.send(
      EVENTS.GAME_DEBUG_RESULT,
      buildDebugResult({ requestId, kind: query.kind, data })
    );
  }

  /**
   * Toggle the dev-room event firehose for this session. The firehose carries
   * no game state: the switch lives on the session, the toggle is never
   * recorded, and only dev rooms ever have a firehose to toggle.
   */
  submitDebugFirehose({ session, username, connection, payload }) {
    if (!isPlainObject(payload) || typeof payload.enabled !== "boolean") {
      connection.send(EVENTS.GAME_ERROR, buildError("Malformed firehose payload."));
      return;
    }
    if (!this.#isDevRoom(session, connection)) return;
    if (!this.#isPlaying(session, username, connection)) return;

    session.setFirehoseEnabled(payload.enabled);
  }

  /**
   * Restart a dev room: drop the session and hand every connection to a fresh
   * one, which puts both seats back in the pre-game deck-selection phase. A
   * restart is deliberately not an engine action — it replaces the game rather
   * than mutating it — so the dropped session's replay artifact ends where it
   * ended and the new game records its own.
   */
  submitDebugRestart({ session, username, connection }) {
    if (!this.#isDevRoom(session, connection)) return;
    if (!this.#isPlaying(session, username, connection)) return;

    const { roomCode, usernames, seed } = session;
    const seats = session.connections();

    this.#dropSession(session);

    const restarted = this.#registry.ensureSession({
      roomCode,
      usernames,
      seed,
      createGame: this.#createGame,
    });
    for (const { username: seat, connection: attached } of seats) this.#attachConnection(restarted, seat, attached);

    this.#broadcastDeckStatus(restarted);
  }

  #registerInboundHandlers(socket, roomCode, username, connection) {
    socket.on(EVENTS.GAME_DECK_SELECT, (payload) =>
      this.submitDeckSelect({ session: this.#registry.get(roomCode), username, connection, payload })
    );
    socket.on(EVENTS.GAME_ACTION, (action) =>
      this.submitAction({ session: this.#registry.get(roomCode), username, connection, action })
    );
    socket.on(EVENTS.GAME_DECISION, (decision) =>
      this.submitDecision({ session: this.#registry.get(roomCode), username, connection, decision })
    );
    socket.on(EVENTS.GAME_STATE_REQUEST, () =>
      this.#sendStateView(this.#registry.get(roomCode), username, connection)
    );
    socket.on(EVENTS.GAME_DEBUG_ACTION, (action) =>
      this.submitDebugAction({ session: this.#registry.get(roomCode), username, connection, action })
    );
    socket.on(EVENTS.GAME_DEBUG_QUERY, (query) =>
      this.submitDebugQuery({ session: this.#registry.get(roomCode), username, connection, query })
    );
    socket.on(EVENTS.GAME_DEBUG_FIREHOSE, (payload) =>
      this.submitDebugFirehose({ session: this.#registry.get(roomCode), username, connection, payload })
    );
    socket.on(EVENTS.GAME_DEBUG_RESTART, () =>
      this.submitDebugRestart({ session: this.#registry.get(roomCode), username, connection })
    );
    socket.on(TRANSPORT_EVENTS.DISCONNECT, () => {
      const session = this.#registry.get(roomCode);
      session?.detach(username, connection);
      if (session && session.connectionCount(username) === 0) this.#markSeatGone(session, username);
      const parked = this.#waitingRoom.get(roomCode);
      if (parked) this.#waitingRoom.set(roomCode, parked.filter((entry) => entry.connection !== connection));
    });
  }

  /**
   * Seat and session guard for player input and dev-console paths. A validated
   * connection without a session is parked in a room whose second player has
   * not joined yet. `requestId` names the dev-console query a refusal answers,
   * when the caller is one.
   */
  #isPlaying(session, username, connection, requestId = null) {
    if (!session) {
      connection.send(EVENTS.GAME_ERROR, buildError(WAITING_ROOM_MESSAGE, null, requestId));
      return false;
    }
    if (!session.hasSeat(username)) {
      connection.send(EVENTS.GAME_ERROR, buildError(NOT_A_PARTICIPANT_MESSAGE, null, requestId));
      return false;
    }
    return true;
  }

  /**
   * Gate for every dev-console path. A normal room is refused before its
   * session is read: the console is a dev-room tool and the room code is the
   * only thing that decides it (see `isDevRoomCode`). `requestId` names the
   * query a refusal answers, when the path is a query.
   */
  #isDevRoom(session, connection, requestId = null) {
    if (session && isDevRoomCode(session.roomCode)) return true;
    connection.send(EVENTS.GAME_ERROR, buildError(NOT_A_DEV_ROOM_MESSAGE, null, requestId));
    return false;
  }

  #sendStateView(session, username, connection) {
    if (!session) {
      connection.send(EVENTS.GAME_WAITING, buildWaitingPayload());
      return;
    }
    if (!session.isStarted) {
      connection.send(EVENTS.GAME_DECK_STATUS, this.#deckStatusPayload(session, username));
      return;
    }

    const game = session.game;
    connection.send(EVENTS.GAME_INIT, buildStateView({ game, revision: session.revision, username }));
    if (game.gameOver) connection.send(EVENTS.GAME_OVER, buildGameOverResult(game.gameOver));
  }

  /**
   * The selection progress payload for one viewer. It carries every seat's
   * progress, but the protocol builder is what keeps the other seat's deck
   * identity out of it (see `buildDeckStatus`).
   */
  #deckStatusPayload(session, viewer) {
    return buildDeckStatus({
      dev: isDevRoomCode(session.roomCode),
      viewer,
      seats: session.usernames.map((username) => {
        const pick = session.getDeckPick(username);
        return {
          username,
          deckChosen: pick !== null,
          connected: this.#seatPresent(session, username),
          deckId: pick?.deckId ?? null,
          deckName: pick?.name ?? null,
          illegal: pick?.illegal ?? false,
        };
      }),
    });
  }

  #broadcastDeckStatus(session) {
    session.broadcast(EVENTS.GAME_DECK_STATUS, (username) => this.#deckStatusPayload(session, username));
  }

  /**
   * Whether a seat counts as present: it holds a connection, or it is inside
   * the grace window that absorbs a step change or a reload.
   */
  #seatPresent(session, username) {
    return session.connectionCount(username) > 0 || this.#presenceTimers.get(session.roomCode)?.has(username) === true;
  }

  /** Cancel a seat's pending absence: a connection came back. */
  #markSeatPresent(session, username) {
    const timers = this.#presenceTimers.get(session.roomCode);
    const timer = timers?.get(username);
    if (timer === undefined) return;
    clearTimeout(timer);
    timers.delete(username);
  }

  /**
   * Start a seat's grace window. When it expires without a connection, the
   * selection progress is broadcast again and the seat reads as gone.
   */
  #markSeatGone(session, username) {
    if (session.isStarted) return;
    const timers = this.#presenceTimers.get(session.roomCode) ?? new Map();
    this.#presenceTimers.set(session.roomCode, timers);
    if (timers.has(username)) return;

    const timer = setTimeout(() => {
      timers.delete(username);
      const current = this.#registry.get(session.roomCode);
      if (!current || current.isStarted || current.connectionCount(username) > 0) return;
      this.#broadcastDeckStatus(current);
    }, this.#presenceGraceMs);
    timer.unref?.();
    timers.set(username, timer);
  }

  /** Drop a room's presence windows; the room they describe is gone. */
  #clearPresence(roomCode) {
    const timers = this.#presenceTimers.get(roomCode);
    if (!timers) return;
    for (const timer of timers.values()) clearTimeout(timer);
    this.#presenceTimers.delete(roomCode);
  }

  /** Attach a connection to its seat and cancel that seat's absence window. */
  #attachConnection(session, username, connection) {
    this.#markSeatPresent(session, username);
    session.attach(username, connection);
  }

  /**
   * Attempt to create the game: both seats must hold a selection that is
   * still valid at start time. A seat whose deck was deleted, became
   * unbuildable, or (in a normal room) became illegal between pick and start
   * has its pick cleared and the room stays in the selection phase.
   *
   * Two picks landing together, and a pick racing the second connection, can
   * both ask to start the same session. Starting resolves picks
   * asynchronously, so the started flag is not yet visible when the second
   * caller enters: the in-flight guard keeps one resolution per room.
   */
  #tryStartGame(session) {
    if (this.#starting.has(session.roomCode) || session.isStarted) return;
    this.#starting.set(session.roomCode, session);
    void this.#tryStartGameAsync(session);
  }

  /**
   * Async body of `#tryStartGame`: pick validation reads the deck library.
   * Two picks resolving close together both enter here, so every exit
   * re-checks the session: a started session is never re-started, and a
   * started session never receives a deck-status broadcast.
   */
  async #tryStartGameAsync(session) {
    try {
      const start = await this.#resolveStart(session);
      // The registry may have replaced this session while its picks were being
      // resolved: a dev-room restart cancels the room's start and moves the
      // connections to a fresh session, so the dropped one must neither create
      // a game, nor claim the room's subscriptions, nor broadcast to sockets it
      // no longer owns.
      if (!this.#isCurrentSession(session)) return;
      if (!start) {
        if (!session.isStarted) this.#broadcastDeckStatus(session);
        return;
      }
      this.#startGame(session, start);
    } finally {
      // Only the session that registered the guard clears it: a restart may
      // already have handed the room to a successor that is resolving its own
      // start under the same room code.
      if (this.#starting.get(session.roomCode) === session) this.#starting.delete(session.roomCode);
    }
  }

  /** Whether the session is still the registry's session for its room. */
  #isCurrentSession(session) {
    return this.#registry.get(session.roomCode) === session;
  }

  /**
   * Re-validate every pending pick against the live deck library, resolve the
   * stored slugs to the engine's cardIds, and build the versus reveal. Returns
   * the start arguments, or null when a seat has no valid pick.
   */
  async #resolveStart(session) {
    const dev = isDevRoomCode(session.roomCode);
    const bySlug = buildSlugIndex(this.#catalog);
    const decks = {};
    const reveal = [];
    let enforceDeckRules = true;

    for (const username of session.usernames) {
      const pick = session.getDeckPick(username);
      if (!pick) return null;

      const deck = await this.#deckLibrary.getOwnedDeck(pick.deckId, username);
      const validation = deck ? validateDeckCards(deck.cards, this.#catalog) : null;
      if (!validation || !validation.buildable || (!validation.legal && !dev)) {
        session.clearDeckPick(username);
        return null;
      }

      const cardIds = deck.cards.map((slug) => bySlug.get(slug)?.cardId);
      if (cardIds.some((cardId) => cardId === undefined)) {
        session.clearDeckPick(username);
        return null;
      }
      decks[username] = cardIds;
      // The reveal describes the deck that is dealt, which is the re-read
      // record, not the snapshot the seat picked: a seat that edited the deck
      // in another tab between picking and the start plays the edited deck.
      reveal.push({ username, deckName: deck.name, fan: buildDeckFanSlugs(deck.cards, this.#catalog) });
      if (!validation.legal) enforceDeckRules = false;
    }

    return { decks, enforceDeckRules, reveal };
  }

  #broadcastState(session, game) {
    if (game.gameOver) session.broadcast(EVENTS.GAME_OVER, () => buildGameOverResult(game.gameOver));
    session.broadcast(EVENTS.GAME_UPDATE, (username) =>
      buildStateView({ game, revision: session.revision, username })
    );
  }

  #startGame(session, { decks, enforceDeckRules, reveal }) {
    // A session the registry no longer serves is abandoned: its connections
    // belong to its replacement, so creating a game on it would broadcast a
    // state view into a room that has moved on.
    if (session.isStarted || !this.#isCurrentSession(session)) return;
    try {
      const game = session.ensureGame({ decks, enforceDeckRules });
      session.clearDeckPicks();
      this.#clearPresence(session.roomCode);
      this.#subscribeSession(session);
      // Both picks are locked at this point, so the decks stop being secret:
      // the versus reveal goes out before the board it introduces.
      session.broadcast(EVENTS.GAME_DECK_REVEAL, () => buildDeckReveal({ seats: reveal }));
      session.broadcast(EVENTS.GAME_INIT, (username) =>
        buildStateView({ game, revision: session.revision, username })
      );
    } catch (error) {
      this.#log("error", `SocketGateway: game creation for room ${session.roomCode} failed`, { error: error.message });
      session.broadcast(EVENTS.GAME_ERROR, () => buildError(error.message));
    }
  }

  /**
   * Attach the net layer's observers to a session's freshly created game: the
   * event bridge always, and in a dev room the event firehose too. Their
   * unsubscribes are kept so a dropped session leaves nothing subscribed to
   * the game it abandons, and the streamer itself is kept so a connection that
   * joins the running game can be caught up with the stream it missed.
   */
  #subscribeSession(session) {
    if (this.#subscriptions.has(session.roomCode)) return;

    const streamer = isDevRoomCode(session.roomCode) ? new EventFirehose({ session }) : null;
    this.#subscriptions.set(session.roomCode, {
      bridge: new EventBridge({ session }).subscribe(),
      firehose: streamer?.subscribe() ?? null,
      streamer,
    });
  }

  /**
   * Drop a room's session: detach the net layer's subscriptions from the game
   * it is leaving behind, cancel a start still resolving for it, take its
   * connections away, and remove it from the registry. The next
   * `ensureSession` for the room builds a fresh one.
   */
  #dropSession(session) {
    const { roomCode } = session;

    const subscriptions = this.#subscriptions.get(roomCode);
    if (subscriptions) {
      subscriptions.bridge();
      subscriptions.firehose?.();
      this.#subscriptions.delete(roomCode);
    }

    // A start awaiting the deck library for the dropped session is cancelled:
    // it may not create a game on it, and the room's replacement must be free
    // to resolve its own picks.
    if (this.#starting.get(roomCode) === session) this.#starting.delete(roomCode);

    this.#clearPresence(roomCode);

    // An abandoned session keeps no connections: without this it could still
    // broadcast into live sockets.
    for (const { username, connection } of session.connections()) {
      session.detach(username, connection);
    }

    this.#registry.remove(roomCode);
  }

  /** Move parked connections into the freshly created session. */
  #absorbWaiting(session) {
    const parked = this.#waitingRoom.get(session.roomCode);
    if (!parked) return;
    this.#waitingRoom.delete(session.roomCode);

    for (const { username, connection } of parked) {
      if (session.hasSeat(username)) this.#attachConnection(session, username, connection);
    }
  }

  #waitingEntries(roomCode) {
    if (!this.#waitingRoom.has(roomCode)) this.#waitingRoom.set(roomCode, []);
    return this.#waitingRoom.get(roomCode);
  }

  #log(level, message, meta) {
    if (this.#logger && typeof this.#logger[level] === "function") {
      this.#logger[level](message, meta);
    }
  }
}
