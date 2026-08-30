import ShinsuService from "./services/ShinsuService.js";
import ZoneService from "./services/ZoneService.js";
import LifecycleEngine from "./services/LifecycleEngine.js";
import TriggerManager from "./services/TriggerManager.js";
import PassiveManager from "./services/PassiveManager.js";
import GlobalRuleRegistry from "./services/GlobalRuleRegistry.js";
import LighthouseService from "./services/LighthouseService.js";
import CombatSlotService from "./services/CombatSlotService.js";
import UnitService from "./services/UnitService.js";
import AttributeRegistry from "./attributes/AttributeRegistry.js";
import AnimaEngine from "./attributes/AnimaEngine.js";
import HwayeomsaEngine from "./attributes/HwayeomsaEngine.js";
import JeonsulsaEngine from "./attributes/JeonsulsaEngine.js";
import AbilityRegistry from "./registries/abilityRegistry.js";
import * as IdFactory from "./IdFactory.js";
import EVT from "./EventCatalog.js";
import cards from "../data/cards.json" with { type: "json" };
import positions from "../data/positions.json" with { type: "json" };
import GameClock from "./GameClock.js";
import EventBus from "./EventBus.js";
import ModifierStack, { getModifierCounter } from "./ModifierStack.js";
import createActionRegistry from "./registries/actionRegistry.js";
import Logger from "./Logger.js";
import Card from "./Card.js";

/**
 * Explicit lifecycle state for the game engine.
 *
 * IDLE       — no pending decisions; accepting player actions and normal
 *              event flow.
 * RESOLVING  — one or more pending decisions exist; player actions are
 *              blocked; the game is waiting for a human choice before
 *              continuing resolution.
 */
export const ResolutionState = Object.freeze({
  IDLE: "idle",
  RESOLVING: "resolving",
});

/** Maximum nested pending decision depth before the engine rejects
 *  re-entrancy as a probable infinite loop. */
const MAX_RESOLUTION_DEPTH = 16;

/** Sentinel key for a repeat_play with no card name — "the next card you
 *  play" applies to any card. Card names are never `*`. */
const WILDCARD_REPEAT_KEY = "*";

export default class GameState {
  // game settings
  static INIT_HAND_SIZE = 5;
  static INIT_DECK_SIZE = 30;
  static INIT_LIGHTHOUSE_AMOUNT = 20;
  static PER_ROUND_DRAW_AMOUNT = 1;
  static MAX_NORMAL_SHINSU = 10;
  static MAX_RECHARGED_SHINSU = 2;

  // data
  static cards = cards;
  static positions = positions;

  /**
   *
   * @param {string} roomCode unique room code for this game
   * @param {Array<string>} usernames array of exactly 2 usernames
   * @param {Object} decks (optional) dictionary mapping each username to an array of cardIds to use as that player's deck. If omitted, a deterministic default deck is generated.
   * @param {string} firstPlayer (optional) username of the player to take the first turn. If omitted, the first username is chosen deterministically.
   * @param {Object} options (optional) additional configuration options.
   * @param {SeededRng} options.rng required seeded RNG (implementing next() and getState()) for deterministic random events (Blinded targeting, etc.). There is no Math.random fallback.
   */
  constructor(roomCode, usernames, decks = {}, firstPlayer = null, options = {}) {
    if (!roomCode || !usernames || usernames.length !== 2)
      throw new Error(
        "Invalid arguments: roomCode and usernames are required and must have exactly 2 usernames."
      );
    if (firstPlayer && !usernames.includes(firstPlayer))
      throw new Error("firstPlayer must be one of the usernames in the game");

    // Capture the ID counters BEFORE this game generates any entities, so a
    // replay can restore the exact starting position and reproduce identical ids.
    this._startingCounters = IdFactory.getCounters();
    this._startingModifierCounter = getModifierCounter();

    this._clock = new GameClock();
    this.eventBus = new EventBus(this._clock);
    this.modifierStack = new ModifierStack(this.eventBus, this._clock);

    // Injectable card catalog: tests supply a stable fixture set; production
    // falls back to the compiled static catalog.
    this.cards = options.cards ?? GameState.cards;

    // Trigger and passive managers own event subscriptions for field units.
    this._triggerManager = new TriggerManager(this.eventBus);
    this._passiveManager = new PassiveManager(this.eventBus);
    this._globalRuleRegistry = new GlobalRuleRegistry();

    // Ability Registry for runtime-granted abilities
    this._abilityRegistry = new AbilityRegistry();

    // Cross-system cleanup: when an ability modifier is revoked,
    // remove the corresponding AbilityRegistry entry; when an HP stat
    // modifier is revoked (equipment detach), restore the raised max/current HP.
    this.modifierStack.onRevoke((mod) => {
      if (mod.type === "ability" && this._abilityRegistry) {
        this._abilityRegistry.revokeBySource(mod.targetId, mod.sourceId);
      }
      if (mod.type === "stat" && mod.key === "hp" && typeof mod.value === "number") {
        const unit = this._findUnit(mod.targetId);
        if (unit && unit.card) {
          unit.card.maxHp = Math.max(0, unit.card.maxHp - mod.value);
          unit.currentHp = Math.max(1, Math.min(unit.currentHp, unit.card.maxHp));
        }
      }
      // A trait change (e.g. Immune revoked) can change which units a
      // landmark's global grant/cap should affect.
      if (mod.type === "trait" && mod.sourceType !== "landmark") {
        this._globalRuleRegistry?.reconcile(this);
      }
    });

    // Symmetric to onRevoke: a trait grant (e.g. Immune) can also change
    // which units a landmark's global grant/cap should affect.
    this.modifierStack.onApply((mod) => {
      if (mod.type === "trait" && mod.sourceType !== "landmark") {
        this._globalRuleRegistry?.reconcile(this);
      }
    });

    this.actionRegistry = createActionRegistry();
    this.logger = new Logger(this.eventBus, {
      snapshotFn: () => this._createSnapshot(),
      serializeFn: () => this.toSerializedState(),
    });

    // Attribute Registry
    this._attributeRegistry = new AttributeRegistry();
    this._attributeRegistry.register("anima", new AnimaEngine(this.eventBus));
    this._attributeRegistry.register("hwayeomsa", new HwayeomsaEngine(this.eventBus, this.cards));
    // `cards` is passed so the engine can look up the Conduit card data to
    // summon; the injectable catalog keeps production and tests aligned.
    this._attributeRegistry.register("jeonsulsa", new JeonsulsaEngine(this.eventBus, this.cards));

    // Barrier tracking (reset on round start)
    this._barrierUsedThisRound = new Set();

    // Units that have used an ability this round (for `modify_keyword` `first`).
    this._abilitiesUsedThisRound = new Set();

    // Equipment-scoped triggered-effect subscriptions (equipmentId → unsubscribe).
    this._equipmentTriggerSubscriptions = new Map();

    // Unit lookup index (O(1) by id)
    this._unitIndex = new Map();

    // Track cards played per player per round for "first card" requirements
    this._cardsPlayedThisRound = new Map();

    // Pending repeat_play queues: username → Map<cardName, remaining plays>.
    // "The next time you play X, play it N more times" (turn-scoped).
    this._repeatPlays = new Map();

    // Injectable RNG for deterministic random behavior (Blinded, etc.)
    if (!options.rng || typeof options.rng.next !== "function" || typeof options.rng.getState !== "function") {
      throw new Error(
        "GameState requires a seeded RNG (options.rng) implementing next() and getState(); " +
          "construct one with `new SeededRng(seed)`."
      );
    }
    this._rng = options.rng;

    // Deterministic first player
    this.roomCode = roomCode;
    this.usernames = usernames;
    this.round = 1;
    this.currentTurn = firstPlayer || this.usernames[0];
    this.roundEndOnTurnEnd = false;
    this.gameOver = null; // { winner, reason }

    // ── Pending decision lifecycle ──────────────────────────────────────
    this._resolutionState = ResolutionState.IDLE;
    this._resolutionDepth = 0;
    this._isExecutingResolution = false;
    this.pendingDecision = null;
    this._pendingDecisions = []; // LIFO stack for nested pending decisions

    // initialize game state
    this.playerStates = {
      [this.usernames[0]]: this.#initializePlayerState(this.usernames[0], decks[this.usernames[0]]),
      [this.usernames[1]]: this.#initializePlayerState(this.usernames[1], decks[this.usernames[1]]),
    };

    // Capture the FULL deck before the initial draw so a replay
    // can reconstruct the identical starting deck.
    const decksMeta = {};
    for (const username of this.usernames) {
      decksMeta[username] = this.playerStates[username].deck.map((c) => c.cardId);
    }

    for (const username of this.usernames) {
      ZoneService.draw(this.playerStates[username], GameState.INIT_HAND_SIZE, this);
    }
    this.#resetShinsu(this.usernames);

    this.#wireLifecycleEvents();

    // Record the initial state for replay before any event fires.
    const rngSeed = typeof this._rng?.getState === "function" ? this._rng.getState().seed : null;
    this.logger.recordInitialState({
      roomCode,
      usernames: [...this.usernames],
      decks: decksMeta,
      firstPlayer: this.currentTurn,
      rngSeed,
      startingCounters: this._startingCounters,
      startingModifierCounter: this._startingModifierCounter,
    });

    // Emit initial game events using canonical names
    this.eventBus.emit(EVT.GAME_STARTED, this.playerStates);
    this.eventBus.emit(EVT.ROUND_START, {
      username: this.currentTurn,
      round: this.round,
      playerStates: this.playerStates,
    });
    this.eventBus.emit(EVT.TURN_START, {
      username: this.currentTurn,
      round: this.round,
    });
  }

  /**
   * Wire authoritative lifecycle event handlers.
   *
   * Centralised here so every rule backed by a lifecycle phase
   * is clearly visible and testable by emitting the matching event.
   */
  #wireLifecycleEvents() {
    // Undying: intercept lethal damage, restore to 1 HP, consume trait.
    this.eventBus.on(EVT.UNIT_DEATH_INTENT, (payload, context) => {
      const { targetId } = payload;
      const unit = this._findUnit(targetId);
      if (!unit || !this.modifierStack.has(targetId, "trait", "undying")) return;
      UnitService.setHp(unit, 1);
      this.modifierStack.removeWhere(
        (m) => m.targetId === targetId && m.type === "trait" && m.key === "undying"
      );
      this.eventBus.emit(EVT.UNIT_UNDYING_TRIGGERED, { unitId: targetId, unit });
      context.cancel("undying");
    }, { phase: "pre" });

    // Game-over: deck exhausted
    this.eventBus.on(EVT.GAME_DECK_EMPTY, ({ username, owner }) => {
      const loser = username || owner;
      if (!loser || this.gameOver) return;
      this.gameOver = { winner: this.#getOpponentUsername(loser), reason: "deck exhausted" };
      this.eventBus.emit(EVT.GAME_OVER, this.gameOver);
    }, { phase: "execute" });

    // Game-over: lighthouses depleted
    this.eventBus.on(EVT.GAME_LIGHTHOUSES_DEPLETED, ({ owner, loser }) => {
      const defeatedPlayer = owner || loser;
      if (!defeatedPlayer || this.gameOver) return;
      this.gameOver = { winner: this.#getOpponentUsername(defeatedPlayer), reason: "lighthouses depleted" };
      this.eventBus.emit(EVT.GAME_OVER, this.gameOver);
    }, { phase: "execute" });

    // Round start: reset barriers, card-play tracking, combat slots
    this.eventBus.on(EVT.ROUND_START, () => {
      this._barrierUsedThisRound.clear();
      this._cardsPlayedThisRound.clear();
      this._abilitiesUsedThisRound.clear();
      for (const username of this.usernames) {
        CombatSlotService.resetAll(this.playerStates[username]);
      }
    }, { phase: "execute" });

    // Round end: remove conditions, reset Shinheuh slot
    this.eventBus.on(EVT.ROUND_END, () => {
      for (const username of this.usernames) {
        const field = this.playerStates[username]?.field;
        if (!field) continue;
        const allUnits = [...(field.frontline || []), ...(field.backline || [])];
        for (const unit of allUnits) {
          this.modifierStack.removeWhere(
            (m) => m.targetId === unit.id && m.type === "condition"
          );
        }
        CombatSlotService.resetShinheuhSlot(this.playerStates[username]);
      }
      // A continuous grant_global_condition (e.g. Name Hunt Station's Rooted)
      // is a condition, so the wipe above just removed it too — reapply it
      // for every unit that still matches an active grant.
      this._globalRuleRegistry?.reconcile(this);
    }, { phase: "execute" });

    // Turn end: clear pending repeat_play queues (they are turn-scoped).
    this.eventBus.on(EVT.TURN_END, () => {
      this._repeatPlays.clear();
    }, { phase: "execute" });
  }

  #initializePlayerState(username, deck = null) {
    if (!deck) deck = this.#defaultDeckOfCardIds();

    // Codes for the five main positions (special kinds carry no combat slot).
    const combatSlotCodes = Object.keys(GameState.positions);

    const builtDeck = this.#buildDeckFromCardIds(deck, username);

    return {
      combatSlotCodes: combatSlotCodes,
      combatSlots: Object.fromEntries(combatSlotCodes.map((code) => [code, { available: true }])),
      deck: builtDeck,
      // Immutable record of the starting deck composition, used by the
      // `started_with_card` predicate. Card names suffice: deck construction
      // already forbids repeated cards, so presence equals copy count.
      startingDeck: builtDeck.map((card) => card.name),
      discard: [],
      lighthouses: { amount: GameState.INIT_LIGHTHOUSE_AMOUNT, max: 40 },
      field: { frontline: [], backline: [] },
      hand: [],
      shinsu: {},
      shinheuhSlot: { available: false, used: false },
      fireCharges: 0,
      username: username,
    };
  }

  /**
   * Build a deck from an array of card ids.
   * @param {Array<number>} cardIds array of card ids
   * @returns {Array<Card>} Array of Card objects
   */
  #buildDeckFromCardIds(cardIds, username) {
    if (!Array.isArray(cardIds) || cardIds.length !== GameState.INIT_DECK_SIZE)
      throw new Error(`deck must be an array of ${GameState.INIT_DECK_SIZE} cardIds.`);

    const deck = [];
    const seenCardIds = new Set();
    cardIds.forEach((cardId) => {
      if (seenCardIds.has(cardId)) {
        throw new Error(`Card with cardId ${cardId} appears more than once; decks cannot contain repeated cards.`);
      }
      seenCardIds.add(cardId);
      const cardData = this.cards[cardId];
      if (cardData === undefined) throw new Error(`Card with cardId ${cardId} does not exist`);
      if ((cardData.deckConstraints || []).some((constraint) => constraint.type === "unreachable")) {
        throw new Error(`Card "${cardData.name}" is unreachable and cannot be included in a deck.`);
      }
      deck.push(new Card(cardId, cardData, username, this.eventBus));
    });
    return deck;
  }

  /**
   * Card ids eligible for deck construction (excludes `unreachable` cards).
   * Single source of truth shared by the default-deck fallback and gameFactory.
   * @returns {Array<number>}
   */
  static getEligibleCardIds(cards = GameState.cards) {
    return Object.values(cards)
      .filter((card) => !(card.deckConstraints || []).some((constraint) => constraint.type === "unreachable"))
      .map((card) => card.cardId);
  }

  /**
   * Deterministic fallback deck used only when a caller omits `decks`.
   * Randomized deck generation (shuffling) is handled by `gameFactory` so the
   * engine's constructor never consumes RNG — keeping replay construction
   * RNG-neutral.
   * @returns {Array<number>} Array of cardIds
   */
  #defaultDeckOfCardIds() {
    const eligible = GameState.getEligibleCardIds(this.cards);
    if (eligible.length < GameState.INIT_DECK_SIZE) {
      throw new Error("Not enough eligible cards to generate a legal deck.");
    }
    return eligible.slice(0, GameState.INIT_DECK_SIZE);
  }

  #filterYouState(username) {
    const playerState = this.playerStates[username];
    if (!playerState)
      throw new Error(`Player ${username} not found\nAvailable players: ${this.usernames.join(", ")}`);

    let passButtonText = username;
    if (username === this.currentTurn) {
      const previousUserAction = this.logger
        .getLogs()
        .reverse()
        .find((log) => log.type === "UserAction");
      // if the previous opponent passed in the current round, passing will end the round
      // we inform the player of this
      passButtonText = this.roundEndOnTurnEnd ? "End Round" : "Pass Turn";
    }

    return {
      combatSlotCodes: playerState.combatSlotCodes,
      combatSlots: playerState.combatSlots,
      deckSize: playerState.deck.length,
      discardSize: playerState.discard?.length ?? 0,
      lighthouses: playerState.lighthouses,
      shinheuhSlot: playerState.shinheuhSlot ? { ...playerState.shinheuhSlot } : null,
      fireCharges: playerState.fireCharges ?? 0,
      pendingDecision: this.pendingDecision && this.pendingDecision.owner === username
        ? {
            decisionId: this.pendingDecision.decisionId,
            type: this.pendingDecision.type,
            candidates: this.pendingDecision.candidates,
            minChoices: this.pendingDecision.minChoices,
            maxChoices: this.pendingDecision.maxChoices,
            lockedIds: this.pendingDecision.lockedIds,
          }
        : null,
      field: {
        frontline: playerState.field.frontline.map((unit) => ({
          ...unit.toSanitizedObject(),
          equipmentAttachments: (unit.equipmentAttachments || []).map((card) => card.name),
          conditions: this.#getConditionViews(unit.id),
          traits: [...this.modifierStack.getActiveKeys(unit.id, "trait")],
          grantedAbilities: this.#getGrantedAbilities(unit.id),
        })),
        backline: playerState.field.backline.map((unit) => ({
          ...unit.toSanitizedObject(),
          equipmentAttachments: (unit.equipmentAttachments || []).map((card) => card.name),
          conditions: this.#getConditionViews(unit.id),
          traits: [...this.modifierStack.getActiveKeys(unit.id, "trait")],
          grantedAbilities: this.#getGrantedAbilities(unit.id),
        })),
      },
      hand: playerState.hand.map((card) => card.toSanitizedObject()),
      shinsu: playerState.shinsu,
      username: playerState.username,
      passButton: {
        isEnabled: username === this.currentTurn,
        text: passButtonText,
      },
    };
  }

  /**
   * Project a unit's runtime-granted abilities (e.g. from equipment via
   * `grant_ability`) into client-addressable objects. Each entry uses the
   * ability's canonical code from the AbilityRegistry.
   */
  #getGrantedAbilities(unitId) {
    return this._abilityRegistry.getGranted(unitId)
      .map((entry) => ({ abilityCode: entry.code, ability: entry.ability, sourceId: entry.sourceId }));
  }

  /**
   * Project the conditions active on a unit with their effective magnitude
   * from the ModifierStack, so clients can render stacks (e.g. "Poisoned 3").
   */
  #getConditionViews(unitId) {
    return [...this.modifierStack.getActiveKeys(unitId, "condition")].map((key) => ({
      key,
      magnitude: this.modifierStack.getEffective(unitId, "condition", key),
    }));
  }

  #getOpponentUsername(username) {
    const opponent = this.usernames.find((u) => u !== username);
    if (!opponent) throw new Error(`Opponent for ${username} not found.`);
    return opponent;
  }

  #filterOpponentState(username) {
    const opponentState = this.playerStates[this.#getOpponentUsername(username)];
    const hand = opponentState.hand.map((card) => {
      if (card.visible) return card.toSanitizedObject();
      else return {};
    });

    return {
      combatSlotCodes: opponentState.combatSlotCodes,
      deckSize: opponentState.deck.length,
      lighthouses: opponentState.lighthouses,
      field: {
        frontline: opponentState.field.frontline.map((unit) => ({
          ...unit.toSanitizedObject(),
          equipmentAttachments: (unit.equipmentAttachments || []).map((card) => card.name),
          conditions: this.#getConditionViews(unit.id),
          traits: [...this.modifierStack.getActiveKeys(unit.id, "trait")],
        })),
        backline: opponentState.field.backline.map((unit) => ({
          ...unit.toSanitizedObject(),
          equipmentAttachments: (unit.equipmentAttachments || []).map((card) => card.name),
          conditions: this.#getConditionViews(unit.id),
          traits: [...this.modifierStack.getActiveKeys(unit.id, "trait")],
        })),
      },
      hand: hand,
      shinsu: opponentState.shinsu,
      username: opponentState.username,
      passButton: {
        isEnabled: false, // opponent's pass button is always disabled
        text: opponentState.username, // always displays the opponent's username
      },
    };
  }

  getClientState(username) {
    return {
      round: this.round,
      currentTurn: this.currentTurn,
      gameOver: this.gameOver ? { ...this.gameOver } : null,
      you: this.#filterYouState(username),
      opponent: this.#filterOpponentState(username),
    };
  }

  endTurn(isPassAction = false) {
    this.eventBus.emit(EVT.TURN_END, {
      username: this.currentTurn,
      round: this.round,
    });

    if (isPassAction) {
      if (this.roundEndOnTurnEnd) this.#endRound();
      else this.roundEndOnTurnEnd = true; // set the flag to true for the next turn
    } else this.roundEndOnTurnEnd = false; // reset the flag if the action was not a pass

    // flip turn to the next player
    this.currentTurn = this.usernames.find((p) => p !== this.currentTurn);
    this.eventBus.emit(EVT.TURN_START, {
      username: this.currentTurn,
      round: this.round,
    });
  }

  /**
   * End the current round. This method does not flip the turn.
   */
  #endRound() {
    this.eventBus.emit(EVT.ROUND_END, {
      username: this.currentTurn,
      round: this.round,
    });
    this.round++;
    ShinsuService.reset(this.playerStates[this.usernames[0]], this.round);
    ShinsuService.reset(this.playerStates[this.usernames[1]], this.round);
    this.roundEndOnTurnEnd = false; // reset the flag for the next round
    for (const username of this.usernames) {
      // The per-round draw is a draw like any other: announce each card so
      // `draw` passives observe it. The opening-hand deal stays silent
      // because no unit exists to observe it.
      const { cards: drawn } = ZoneService.draw(this.playerStates[username], GameState.PER_ROUND_DRAW_AMOUNT, this);
      for (const card of drawn) {
        this.eventBus.emit(EVT.CARD_DRAWN, {
          owner: username,
          cardId: card.cardId,
          cardName: card.name,
          card,
          handSize: this.playerStates[username].hand.length,
          deckSize: this.playerStates[username].deck.length,
        });
      }
    }
    this.eventBus.emit(EVT.ROUND_START, {
      username: this.currentTurn,
      round: this.round,
      playerStates: this.playerStates,
    });
  }

  getTotalShinsu(username) {
    const player = this.playerStates[username];
    if (!player) throw new Error(`Player ${username} not found.`);
    return ShinsuService.getTotal(player);
  }

  /**
   * Whether the game is currently waiting for one or more player decisions
   * and must not accept new actions or modify the board outside the
   * resolution pipeline.
   */
  hasUnresolvedDecisions() {
    return this._resolutionState === ResolutionState.RESOLVING;
  }

  processAction(action) {
    if (this.gameOver) throw new Error("The game is over.");
    if (this._resolutionState !== ResolutionState.IDLE) {
      throw new Error("A player decision must be resolved before another action.");
    }

    const { type, data } = action;
    const handler = this.actionRegistry[type];
    if (!handler)
      throw new Error(
        `${type} is an invalid action type\nAvailable types: ${Object.keys(this.actionRegistry).join(", ")}`
      );

    this.logger.beginUserInput({ kind: "action", payload: action });
    try {
      handler.validate(data, this);
      handler.execute(data, this);
      this.logger.endUserInput({ ok: true });
    } catch (error) {
      this.logger.endUserInput({ ok: false, error });
      throw error;
    }
  }

  /**
   * End a player action now, or defer it until an active decision has resolved.
   * Actions that produce a choice must not advance the turn before that choice
   * has changed the authoritative state.
   */
  completeActionAfterDecision(completion) {
    if (this.pendingDecision) {
      this.appendPendingDecisionContinuation(completion);
      return { pending: true };
    }
    completion();
    return { pending: false };
  }

  /** Add FIFO work that must run after the current decision resolves. */
  appendPendingDecisionContinuation(continuation) {
    if (!this.pendingDecision) {
      continuation();
      return;
    }
    this.pendingDecision.continuations.push(continuation);
  }

  /**
   * Run a decision's continuation queue in FIFO order. A continuation that
   * creates a new pending decision (e.g. a deferred sequence step that itself
   * needs a target choice) suspends the queue: the remaining continuations are
   * moved onto the new decision and run only once it resolves, so an action's
   * completion never runs ahead of a nested choice.
   */
  _runContinuations(decision) {
    while (decision.continuations.length > 0) {
      const next = decision.continuations.shift();
      next();
      if (this.pendingDecision && this.pendingDecision !== decision) {
        this.pendingDecision.continuations.push(...decision.continuations);
        decision.continuations.length = 0;
        return;
      }
    }
  }

  /**
   * Find a unit by its instance ID — O(1) via index, with linear fallback
   * for test-created unit stubs that bypass the LifecycleEngine.
   */
  _findUnit(unitId) {
    const indexed = this._unitIndex.get(unitId);
    if (indexed) return indexed;
    // Fallback linear scan (test harnesses that push raw objects)
    for (const username of this.usernames) {
      const field = this.playerStates[username]?.field;
      if (!field) continue;
      for (const unit of [...(field.frontline || []), ...(field.backline || [])]) {
        if (unit.id === unitId) return unit;
      }
    }
    return null;
  }

  /** Index a newly deployed unit for O(1) lookup. */
  _indexUnit(unit) {
    if (unit?.id) this._unitIndex.set(unit.id, unit);
  }

  /** Remove a unit from the index. */
  _unindexUnit(unitId) {
    this._unitIndex.delete(unitId);
  }

  /**
   * Create a lightweight state snapshot for the Logger.
   */
  _createSnapshot() {
    const snap = { round: this.round, currentTurn: this.currentTurn, gameOver: this.gameOver };
    for (const username of this.usernames) {
      const p = this.playerStates[username];
      if (!p) continue;
      snap[username] = {
        lighthouses: p.lighthouses?.amount,
        shinsu: { ...p.shinsu },
        handSize: p.hand?.length ?? 0,
        deckSize: p.deck?.length ?? 0,
        discardSize: p.discard?.length ?? 0,
        combatSlots: { ...p.combatSlots },
        shinheuhSlot: p.shinheuhSlot ? { ...p.shinheuhSlot } : null,
        fireCharges: p.fireCharges ?? 0,
        frontline: p.field?.frontline?.map((u) => ({
          id: u.id,
          name: u.card?.name,
          hp: u.currentHp,
          maxHp: u.card?.maxHp,
          position: u.placedPositionCode,
          chosenPositionCode: u.chosenPositionCode,
          equipmentAttachments: (u.equipmentAttachments || []).map((card) => card.name),
          conditions: [...this.modifierStack.getActiveKeys(u.id, "condition")],
          traits: [...this.modifierStack.getActiveKeys(u.id, "trait")],
          grantedAbilities: this._abilityRegistry.getGranted(u.id).map((e) => e.code),
        })) ?? [],
        backline: p.field?.backline?.map((u) => ({
          id: u.id,
          name: u.card?.name,
          hp: u.currentHp,
          maxHp: u.card?.maxHp,
          position: u.placedPositionCode,
          chosenPositionCode: u.chosenPositionCode,
          equipmentAttachments: (u.equipmentAttachments || []).map((card) => card.name),
          conditions: [...this.modifierStack.getActiveKeys(u.id, "condition")],
          traits: [...this.modifierStack.getActiveKeys(u.id, "trait")],
          grantedAbilities: this._abilityRegistry.getGranted(u.id).map((e) => e.code),
        })) ?? [],
      };
    }
    return snap;
  }

  /**
   * Complete, deterministic serialization of the authoritative game state.
   *
   * Unlike `_createSnapshot()` (a flat, cheap diff view), this captures every
   * piece of state required to replay a game: ordered zone contents, full
   * modifier and granted-ability dumps, pending-decision metadata, ID/RNG/clock
   * counters, and round-tracking sets. All Map/Set iterations are sorted so
   * identical states serialize to identical JSON.
   *
   * @returns {object} JSON-safe deterministic state.
   */
  toSerializedState() {
    const serializeCard = (card) => ({
      cardId: card.cardId,
      id: card.id,
      costReduction: card.costReduction ?? 0,
      visible: card.visible ?? false,
    });

    // Hand cards carry the equipment a `retain_equipment` bearer kept from its
    // last deployment, so replay assertions observe the attachments while the
    // card waits in hand.
    const serializeHandCard = (card) => ({
      ...serializeCard(card),
      retainedEquipment: (card.retainedEquipment || [])
        .map((c) => ({ cardId: c.cardId, id: c.id }))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    });

    const serializeUnit = (unit) => ({
      id: unit.id,
      cardId: unit.card?.cardId,
      currentHp: unit.currentHp,
      placedPositionCode: unit.placedPositionCode,
      chosenPositionCode: unit.chosenPositionCode,
      owner: unit.owner,
      equipmentAttachments: (unit.equipmentAttachments || [])
        .map((c) => ({ cardId: c.cardId, id: c.id }))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    });

    const players = {};
    for (const username of this.usernames) {
      const p = this.playerStates[username];
      if (!p) continue;
      const combatSlots = {};
      for (const code of Object.keys(p.combatSlots || {}).sort()) {
        combatSlots[code] = { ...p.combatSlots[code] };
      }
      players[username] = {
        deck: (p.deck || []).map(serializeCard),
        hand: (p.hand || []).map(serializeHandCard),
        discard: (p.discard || []).map(serializeCard),
        startingDeck: p.startingDeck || [],
        lighthouses: p.lighthouses ? { amount: p.lighthouses.amount, max: p.lighthouses.max } : null,
        shinsu: p.shinsu ? { normalSpent: p.shinsu.normalSpent, normalAvailable: p.shinsu.normalAvailable, recharged: p.shinsu.recharged } : null,
        combatSlots,
        shinheuhSlot: p.shinheuhSlot ? { available: p.shinheuhSlot.available, used: p.shinheuhSlot.used } : null,
        fireCharges: p.fireCharges ?? 0,
        frontline: (p.field?.frontline || []).map(serializeUnit),
        backline: (p.field?.backline || []).map(serializeUnit),
      };
    }

    const pending = this.pendingDecision
      ? {
          decisionId: this.pendingDecision.decisionId,
          owner: this.pendingDecision.owner,
          type: this.pendingDecision.type,
          candidates: this.pendingDecision.candidates.map(({ id, name, hp }) => ({ id, name, hp })),
          minChoices: this.pendingDecision.minChoices,
          maxChoices: this.pendingDecision.maxChoices,
          lockedIds: this.pendingDecision.lockedIds,
        }
      : null;

    const cardsPlayed = {};
    for (const [username, count] of [...this._cardsPlayedThisRound.entries()].sort()) {
      cardsPlayed[username] = count;
    }

    const repeatPlays = {};
    for (const username of [...this._repeatPlays.keys()].sort()) {
      const entries = {};
      for (const [cardName, count] of [...this._repeatPlays.get(username).entries()].sort()) {
        entries[cardName] = count;
      }
      repeatPlays[username] = entries;
    }

    return {
      roomCode: this.roomCode,
      usernames: [...this.usernames],
      round: this.round,
      currentTurn: this.currentTurn,
      roundEndOnTurnEnd: this.roundEndOnTurnEnd,
      gameOver: this.gameOver,
      resolutionState: this._resolutionState,
      resolutionDepth: this._resolutionDepth,
      isExecutingResolution: this._isExecutingResolution,
      players,
      modifiers: this.modifierStack.toSerializedState(),
      grantedAbilities: this._abilityRegistry.toSerializedState(),
      pendingDecision: pending,
      pendingDecisionStackDepth: this._pendingDecisions.length,
      counters: IdFactory.getCounters(),
      modifierCounter: getModifierCounter(),
      clock: this._clock.peek(),
      rng: typeof this._rng?.getState === "function" ? this._rng.getState() : null,
      barrierUsedThisRound: [...this._barrierUsedThisRound].sort(),
      abilitiesUsedThisRound: [...this._abilitiesUsedThisRound].sort(),
      cardsPlayedThisRound: cardsPlayed,
      repeatPlays,
    };
  }

  /**
   * Reset shinsu for both players at game start.
   */
  #resetShinsu(usernames) {
    usernames.forEach((username) => {
      const player = this.playerStates[username];
      if (player) {
        ShinsuService.reset(player, this.round);
      }
    });
  }
  modifyLighthouses(username, amount) {
    return LighthouseService.modify(this, username, amount);
  }

  /**
   * Record a card play for "first card this round" requirement tracking.
   */
  recordCardPlayed(username) {
    const count = this._cardsPlayedThisRound.get(username) || 0;
    this._cardsPlayedThisRound.set(username, count + 1);
  }

  /**
   * Mark that `unitId` used an ability this round (for `modify_keyword` `first`).
   */
  markAbilityUsed(unitId) {
    this._abilitiesUsedThisRound.add(unitId);
  }

  /** Whether `unitId` has already used an ability this round. */
  hasUsedAbilityThisRound(unitId) {
    return this._abilitiesUsedThisRound.has(unitId);
  }

  /**
   * Subscribe an equipment-scoped triggered effect (e.g. "the bearer's
   * damage-dealing abilities give Exhausted 1"). Removed on detach via
   * `unregisterEquipmentTriggers`.
   */
  registerEquipmentTriggeredEffect(equipmentId, eventName, matches, resolveFn) {
    const unsubscribe = this.eventBus.on(eventName, (payload, context) => {
      if (matches(payload)) resolveFn(payload, context);
    }, { phase: "execute", priority: -100 });
    this._equipmentTriggerSubscriptions.set(equipmentId, unsubscribe);
  }

  /** Remove a single equipment's triggered-effect subscription. */
  unregisterEquipmentTriggers(equipmentId) {
    const unsubscribe = this._equipmentTriggerSubscriptions.get(equipmentId);
    if (unsubscribe) {
      unsubscribe();
      this._equipmentTriggerSubscriptions.delete(equipmentId);
    }
  }

  /**
   * Queue `amount` extra plays of `cardName` for `username` ("the next time
   * you play X, play it N more times"). When `cardName` is omitted the
   * repeat is a wildcard — the next card the player plays is replayed.
   * Turn-scoped; cleared on turn end.
   */
  queueRepeatPlay(username, cardName, amount) {
    if (!this._repeatPlays.has(username)) this._repeatPlays.set(username, new Map());
    const byName = this._repeatPlays.get(username);
    const key = cardName ? String(cardName).toLowerCase() : WILDCARD_REPEAT_KEY;
    byName.set(key, (byName.get(key) || 0) + amount);
  }

  /**
   * Consume and clear the pending repeat count for `cardName` for `username`.
   * A wildcard repeat ("the next card you play") also applies, so the total
   * is the named count plus any wildcard count.
   * @returns {number} the number of extra plays queued (0 if none).
   */
  consumeRepeatPlays(username, cardName) {
    const byName = this._repeatPlays.get(username);
    if (!byName) return 0;
    const key = String(cardName).toLowerCase();
    const named = byName.get(key) || 0;
    const wildcard = byName.get(WILDCARD_REPEAT_KEY) || 0;
    byName.delete(key);
    byName.delete(WILDCARD_REPEAT_KEY);
    return named + wildcard;
  }

  /**
   * Whether a player's starting deck contained a card with the given name.
   * Backs the `started_with_card` predicate. The starting deck is captured at
   * construction (before the initial draw) and never changes.
   */
  startedWithCard(username, cardName) {
    const startingDeck = this.playerStates[username]?.startingDeck || [];
    const expected = String(cardName).toLowerCase();
    return startingDeck.some((name) => String(name).toLowerCase() === expected);
  }

  /**
   * Modify player's Fire Charges. Used by HwayeomsaEngine.
   * All fire charge mutations must go through this method.
   */
  _modifyFireCharges(username, delta) {
    const player = this.playerStates[username];
    if (!player) return;
    player.fireCharges = Math.max(0, (player.fireCharges || 0) + delta);
    return player.fireCharges;
  }

  /**
   * Create and publish a pending decision, transitioning the game into
   * RESOLVING state. Nested decisions (a decision created while another
   * is already pending) are stacked LIFO — the newest is always resolved
   * first.
   *
   * Re-entrancy is capped at MAX_RESOLUTION_DEPTH to prevent infinite
   * decision loops.
   */
  createPendingDecision({ owner, type, candidates, minChoices = 1, maxChoices = minChoices, resolve, lockedIds = [], unitId = null }) {
    if (this._resolutionDepth >= MAX_RESOLUTION_DEPTH) {
      throw new Error(
        `Maximum nested pending decision depth (${MAX_RESOLUTION_DEPTH}) exceeded. ` +
        "Check for infinite decision loops in resolution callbacks."
      );
    }
    if (!this.usernames.includes(owner)) throw new Error("Decision owner must be a game player.");
    if (!Array.isArray(candidates) || candidates.length < minChoices) {
      throw new Error("Not enough valid candidates for the requested decision.");
    }

    const decision = {
      decisionId: IdFactory.decisionId(),
      owner,
      type,
      candidates: candidates.map((candidate) => {
        const { id, name, hp, ...extra } = candidate;
        // Track whether each candidate is a real game unit so we can
        // reject choices for units destroyed while the decision was pending.
        // Non-unit candidates (e.g. card selections) carry `_isUnit: false`.
        const isUnit = Boolean(this._findUnit(id));
        return { id, name, hp, ...extra, _isUnit: isUnit };
      }),
      minChoices,
      maxChoices,
      lockedIds: [...lockedIds],
      // Internal lifecycle binding: which unit's choice this is, so a unit
      // leaving play can cancel its own pending decisions. Never serialized.
      unitId,
      resolve,
      continuations: [],
    };

    // If a decision is already pending, push current to stack (LIFO).
    // When called from within a resolve callback (_isExecutingResolution),
    // the current decision is being resolved and will be cleaned up by the
    // resolveDecision finally block — don't double-stack it.
    if (this.pendingDecision && !this._isExecutingResolution) {
      this._pendingDecisions.push(this.pendingDecision);
    }
    this.pendingDecision = decision;
    this._resolutionState = ResolutionState.RESOLVING;
    this._resolutionDepth++;

    this.eventBus.emit(EVT.DECISION_PENDING, {
      decisionId: decision.decisionId,
      owner,
      type,
      candidates: decision.candidates,
      minChoices,
      maxChoices,
      lockedIds: decision.lockedIds,
    });
    return decision.decisionId;
  }

  /**
   * Resolve the currently pending player decision.
   *
   * This method is NOT re-entrant: calling resolveDecision from within
   * a decision's resolve callback or continuation is rejected. Nested
   * decisions must use createPendingDecision instead.
   */
  resolveDecision({ decisionId, choices, username } = {}) {
    if (this._isExecutingResolution) {
      throw new Error(
        "Cannot resolve a decision from within a resolution callback. " +
        "Use createPendingDecision for nested decisions."
      );
    }
    const pending = this.pendingDecision;
    if (!pending) throw new Error("There is no pending decision.");
    if (username && username !== pending.owner) throw new Error("Only the decision owner may resolve it.");
    if (decisionId !== pending.decisionId) throw new Error("Decision ID does not match the pending decision.");
    if (!Array.isArray(choices)) throw new Error("Decision choices must be an array.");
    if (choices.length < pending.minChoices || choices.length > pending.maxChoices) {
      throw new Error("Invalid number of selected choices.");
    }
    if (new Set(choices).size !== choices.length) throw new Error("Decision choices must be unique.");

    const candidateIds = new Set(pending.candidates.map((candidate) => candidate.id));
    if (choices.some((choice) => !candidateIds.has(choice))) {
      throw new Error("Decision contains an invalid candidate.");
    }

    // Reject choices referencing units that were destroyed while the
    // decision was pending. Only enforced for candidates that were real
    // game units at decision-creation time.
    const stale = choices.filter((id) => {
      const candidate = pending.candidates.find((c) => c.id === id);
      return candidate?._isUnit && !this._findUnit(id);
    });
    if (stale.length > 0) {
      throw new Error(`Cannot select destroyed unit(s): ${stale.join(", ")}.`);
    }

    // Resolve the selected state first, then clear this decision before running
    // continuations so a later effect may legitimately create its own choice.
    this.logger.beginUserInput({ kind: "decision", payload: { decisionId, choices, username } });
    try {
      this._isExecutingResolution = true;
      try {
        pending.resolve?.(choices);
      } finally {
        this._isExecutingResolution = false;
        // Only pop from the stack if the current decision is still the one
        // being resolved (the resolve callback may have created a nested
        // decision, which is now the active one).
        if (this.pendingDecision === pending) {
          this.pendingDecision = this._pendingDecisions.pop() || null;
        }
        this._resolutionDepth = Math.max(0, this._resolutionDepth - 1);
        if (!this.pendingDecision) {
          this._resolutionState = ResolutionState.IDLE;
        }
      }

      // Run continuations while NOT in the execution guard so continuations
      // that produce new pending decisions (via createPendingDecision) work.
      this._runContinuations(pending);

      this.eventBus.emit(EVT.DECISION_RESOLVED, { decisionId, owner: pending.owner, type: pending.type, choices });

      // If a stacked decision is now active, re-notify the client.
      if (this.pendingDecision) {
        this.eventBus.emit(EVT.DECISION_PENDING, {
          decisionId: this.pendingDecision.decisionId,
          owner: this.pendingDecision.owner,
          type: this.pendingDecision.type,
          candidates: this.pendingDecision.candidates,
          minChoices: this.pendingDecision.minChoices,
          maxChoices: this.pendingDecision.maxChoices,
          lockedIds: this.pendingDecision.lockedIds,
        });
      }

      this.logger.endUserInput({ ok: true });
    } catch (error) {
      this.logger.endUserInput({ ok: false, error });
      throw error;
    }
  }

  /**
   * Cancel pending decisions matching `predicate` without running their
   * resolve callbacks or continuations. Used when the source of a decision
   * leaves play — e.g. a landmark destroyed while its `position_selection`
   * choice is still pending must not keep the game blocked on a choice whose
   * source is gone, and resolving it later must not resurrect the landmark's
   * rules.
   *
   * The active decision is popped first, then matching stacked decisions are
   * dropped; the next stacked decision (if any) becomes active again.
   *
   * @param {(decision: object) => boolean} predicate
   * @returns {number} the number of decisions cancelled
   */
  cancelPendingDecisions(predicate) {
    if (typeof predicate !== "function") return 0;
    let removed = 0;
    // Pop every matching decision from the top of the stack — the active
    // decision first, then any stacked one that matches.
    while (this.pendingDecision && predicate(this.pendingDecision)) {
      this.pendingDecision = this._pendingDecisions.pop() || null;
      removed++;
    }
    const kept = this._pendingDecisions.filter((d) => !predicate(d));
    removed += this._pendingDecisions.length - kept.length;
    this._pendingDecisions = kept;
    if (removed > 0) {
      this._resolutionDepth = Math.max(0, this._resolutionDepth - removed);
      if (!this.pendingDecision) this._resolutionState = ResolutionState.IDLE;
    }
    return removed;
  }
}
