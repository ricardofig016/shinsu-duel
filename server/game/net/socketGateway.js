import EventBridge from "./eventBridge.js";
import {
  EVENTS,
  TRANSPORT_EVENTS,
  buildStateView,
  buildError,
  buildGameOverResult,
  buildWaitingPayload,
  buildDeckStatus,
} from "./protocol.js";
import { isDevRoomCode } from "../devRooms.js";
import { validateDeckCards } from "../../decks/deckValidation.js";
import { buildSlugIndex } from "../../utils/card-catalog.js";

const GAME_NAMESPACE = "/game";
const WAITING_ROOM_MESSAGE = "Game has not started yet.";
const NOT_A_PARTICIPANT_MESSAGE = "Room not found or you are not a participant.";
const ALREADY_STARTED_MESSAGE = "The game has already started.";

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
 * username must be a participant of the room it connects to), then attached to
 * its player's seat. Seats hold many connections, so one player can play from
 * several tabs. Connecting both seats opens the pre-game deck-selection phase:
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
 */
export default class SocketGateway {
  #registry;
  #loadRoom;
  #createGame;
  #deckLibrary;
  #catalog;
  #logger;
  /** roomCode → unsubscribe function of the event bridge for its started game */
  #bridgeUnsubscribes = new Map();
  /** roomCode → connections parked while the room's second player has not joined */
  #waitingRoom = new Map();

  constructor({ registry, loadRoom, createGame, deckLibrary, catalog, logger = null }) {
    if (!registry || typeof registry.ensureSession !== "function" || typeof registry.get !== "function") {
      throw new TypeError("SocketGateway needs a registry exposing ensureSession and get.");
    }
    if (typeof loadRoom !== "function") throw new TypeError("loadRoom must be a function.");
    if (typeof createGame !== "function") throw new TypeError("createGame must be a function.");
    if (!deckLibrary || typeof deckLibrary.getOwnedDeck !== "function") {
      throw new TypeError("SocketGateway needs a deck library exposing getOwnedDeck.");
    }
    if (!isPlainObject(catalog)) throw new TypeError("SocketGateway needs a compiled card catalog.");
    if (logger !== null && typeof logger !== "object") throw new TypeError("logger must be an object or null.");

    this.#registry = registry;
    this.#loadRoom = loadRoom;
    this.#createGame = createGame;
    this.#deckLibrary = deckLibrary;
    this.#catalog = catalog;
    this.#logger = logger;
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
      if (!isNonEmptyString(roomCode) || !isNonEmptyString(username)) {
        connection.send(EVENTS.GAME_ERROR, buildError("A game connection needs a room code and an authenticated username."));
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
      session.attach(username, connection);

      if (!session.isStarted) {
        if (session.isFull()) this.#tryStartGame(session);
        else connection.send(EVENTS.GAME_DECK_STATUS, this.#deckStatusPayload(session));
      } else {
        this.#sendStateView(session, username, connection);
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
    socket.on(TRANSPORT_EVENTS.DISCONNECT, () => {
      this.#registry.get(roomCode)?.detach(username, connection);
      const parked = this.#waitingRoom.get(roomCode);
      if (parked) this.#waitingRoom.set(roomCode, parked.filter((entry) => entry.connection !== connection));
    });
  }

  #isPlaying(session, username, connection) {
    // A validated connection without a session is parked in a room whose
    // second player has not joined yet.
    if (!session) {
      connection.send(EVENTS.GAME_ERROR, buildError(WAITING_ROOM_MESSAGE));
      return false;
    }
    if (!session.hasSeat(username)) {
      connection.send(EVENTS.GAME_ERROR, buildError(NOT_A_PARTICIPANT_MESSAGE));
      return false;
    }
    return true;
  }

  #sendStateView(session, username, connection) {
    if (!session) {
      connection.send(EVENTS.GAME_WAITING, buildWaitingPayload());
      return;
    }
    if (!session.isStarted) {
      connection.send(EVENTS.GAME_DECK_STATUS, this.#deckStatusPayload(session));
      return;
    }

    const game = session.game;
    connection.send(EVENTS.GAME_INIT, buildStateView({ game, revision: session.revision, username }));
    if (game.gameOver) connection.send(EVENTS.GAME_OVER, buildGameOverResult(game.gameOver));
  }

  /** The per-seat selection progress payload for one session. */
  #deckStatusPayload(session) {
    return buildDeckStatus({
      dev: isDevRoomCode(session.roomCode),
      seats: session.usernames.map((username) => {
        const pick = session.getDeckPick(username);
        return {
          username,
          deckChosen: pick !== null,
          deckId: pick?.deckId ?? null,
          deckName: pick?.name ?? null,
          illegal: pick?.illegal ?? false,
        };
      }),
    });
  }

  #broadcastDeckStatus(session) {
    session.broadcast(EVENTS.GAME_DECK_STATUS, () => this.#deckStatusPayload(session));
  }

  /**
   * Attempt to create the game: both seats must hold a selection that is
   * still valid at start time. A seat whose deck was deleted, became
   * unbuildable, or (in a normal room) became illegal between pick and start
   * has its pick cleared and the room stays in the selection phase.
   */
  #tryStartGame(session) {
    void this.#tryStartGameAsync(session);
  }

  /**
   * Async body of `#tryStartGame`: pick validation reads the deck library.
   * Two picks resolving close together both enter here, so every exit
   * re-checks the session: a started session is never re-started, and a
   * started session never receives a deck-status broadcast.
   */
  async #tryStartGameAsync(session) {
    const start = await this.#resolveStart(session);
    if (!start) {
      if (!session.isStarted) this.#broadcastDeckStatus(session);
      return;
    }
    this.#startGame(session, start);
  }

  /**
   * Re-validate every pending pick against the live deck library and resolve
   * the stored slugs to the engine's cardIds. Returns the start arguments,
   * or null when a seat has no valid pick.
   */
  async #resolveStart(session) {
    const dev = isDevRoomCode(session.roomCode);
    const bySlug = buildSlugIndex(this.#catalog);
    const decks = {};
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
      if (!validation.legal) enforceDeckRules = false;
    }

    return { decks, enforceDeckRules };
  }

  #broadcastState(session, game) {
    if (game.gameOver) session.broadcast(EVENTS.GAME_OVER, () => buildGameOverResult(game.gameOver));
    session.broadcast(EVENTS.GAME_UPDATE, (username) =>
      buildStateView({ game, revision: session.revision, username })
    );
  }

  #startGame(session, { decks, enforceDeckRules }) {
    if (session.isStarted) return;
    try {
      const game = session.ensureGame({ decks, enforceDeckRules });
      session.clearDeckPicks();
      if (!this.#bridgeUnsubscribes.has(session.roomCode)) {
        this.#bridgeUnsubscribes.set(session.roomCode, new EventBridge({ session }).subscribe());
      }
      session.broadcast(EVENTS.GAME_INIT, (username) =>
        buildStateView({ game, revision: session.revision, username })
      );
    } catch (error) {
      this.#log("error", `SocketGateway: game creation for room ${session.roomCode} failed`, { error: error.message });
      session.broadcast(EVENTS.GAME_ERROR, () => buildError(error.message));
    }
  }

  /** Move parked connections into the freshly created session. */
  #absorbWaiting(session) {
    const parked = this.#waitingRoom.get(session.roomCode);
    if (!parked) return;
    this.#waitingRoom.delete(session.roomCode);

    for (const { username, connection } of parked) {
      if (session.hasSeat(username)) session.attach(username, connection);
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
