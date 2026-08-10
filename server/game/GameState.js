import ShinsuService from "./services/ShinsuService.js";
import ZoneService from "./services/ZoneService.js";
import LifecycleEngine from "./services/LifecycleEngine.js";
import TriggerManager from "./services/TriggerManager.js";
import PassiveManager from "./services/PassiveManager.js";
import LighthouseService from "./services/LighthouseService.js";
import CombatSlotService from "./services/CombatSlotService.js";
import AttributeRegistry from "./attributes/AttributeRegistry.js";
import AnimaEngine from "./attributes/AnimaEngine.js";
import HwayeomsaEngine from "./attributes/HwayeomsaEngine.js";
import AbilityRegistry from "./registries/abilityRegistry.js";
import * as IdFactory from "./IdFactory.js";
import EVT from "./EventCatalog.js";
import cards from "../data/cards.json" with { type: "json" };
import positions from "../data/positions.json" with { type: "json" };
import GameClock from "./GameClock.js";
import EventBus from "./EventBus.js";
import ModifierStack from "./ModifierStack.js";
import createActionRegistry from "./registries/actionRegistry.js";
import Logger from "./Logger.js";
import Card from "./Card.js";

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
   * @param {Object} decks (optional) dictionary mapping each username to an array of cardIds to use as that player's deck. If null, a random deck will be generated.
   * @param {string} firstPlayer (optional) username of the player to take the first turn. If null, a random player will be chosen.
   * @param {Object} options (optional) additional configuration options.
   * @param {Function} options.rng optional seeded RNG for deterministic random events (Blinded targeting, etc.). Defaults to Math.random.
   */
  constructor(roomCode, usernames, decks = {}, firstPlayer = null, options = {}) {
    if (!roomCode || !usernames || usernames.length !== 2)
      throw new Error(
        "Invalid arguments: roomCode and usernames are required and must have exactly 2 usernames."
      );
    if (firstPlayer && !usernames.includes(firstPlayer))
      throw new Error("firstPlayer must be one of the usernames in the game");

    this._clock = new GameClock();
    this.eventBus = new EventBus(this._clock);
    this.modifierStack = new ModifierStack(this.eventBus, this._clock);
    this.actionRegistry = createActionRegistry();
    this.logger = new Logger(this.eventBus, {
      snapshotFn: () => this._createSnapshot(),
    });

    // Trigger and passive managers own event subscriptions for field units.
    this._triggerManager = new TriggerManager(this.eventBus);
    this._passiveManager = new PassiveManager(this.eventBus);

    // Ability Registry for runtime-granted abilities
    this._abilityRegistry = new AbilityRegistry();

    // Attribute Registry
    this._attributeRegistry = new AttributeRegistry();
    this._attributeRegistry.register("anima", new AnimaEngine(this.eventBus));
    this._attributeRegistry.register("hwayeomsa", new HwayeomsaEngine(this.eventBus, GameState.cards));

    // Barrier tracking (reset on round start)
    this._barrierUsedThisRound = new Set();

    // Unit lookup index (O(1) by id)
    this._unitIndex = new Map();

    // Track cards played per player per round for "first card" requirements
    this._cardsPlayedThisRound = new Map();

    // Injectable RNG for deterministic random behavior (Blinded, etc.)
    this._rng = options.rng || Math.random;

    // Deterministic first player
    this.roomCode = roomCode;
    this.usernames = usernames;
    this.round = 1;
    this.currentTurn = firstPlayer || this.usernames[0];
    this.roundEndOnTurnEnd = false;
    this.gameOver = null; // { winner, reason }
    this.pendingDecision = null;
    this._pendingDecisions = []; // stack for nested pending decisions

    // initialize game state
    this.playerStates = {
      [this.usernames[0]]: this.#initializePlayerState(this.usernames[0], decks[this.usernames[0]]),
      [this.usernames[1]]: this.#initializePlayerState(this.usernames[1], decks[this.usernames[1]]),
    };
    for (const username of this.usernames) {
      ZoneService.draw(this.playerStates[username], GameState.INIT_HAND_SIZE, this);
    }
    this.#resetShinsu(this.usernames);

    // Undying interception: restore to 1 HP and consume the trait on lethal hit.
    this.eventBus.on(EVT.UNIT_DEATH_INTENT, (payload, context) => {
      const { targetId } = payload;
      const unit = this._findUnit(targetId);
      if (!unit || !this.modifierStack.has(targetId, "trait", "undying")) return;

      // Restore to 1 HP and consume the Undying trait (single-use per RULES.md).
      unit.currentHp = 1;
      this.modifierStack.removeWhere(
        (m) => m.targetId === targetId && m.type === "trait" && m.key === "undying"
      );
      this.eventBus.emit(EVT.UNIT_UNDYING_TRIGGERED, { unitId: targetId, unit });
      context.cancel("undying");
    }, { phase: "pre" });

    // Wire Barrier reset and condition cleanup lifecycle events
    this.eventBus.on(EVT.GAME_DECK_EMPTY, ({ username, owner }) => {
      const loser = username || owner;
      if (!loser || this.gameOver) return;
      this.gameOver = {
        winner: this.#getOpponentUsername(loser),
        reason: "deck exhausted",
      };
      this.eventBus.emit(EVT.GAME_OVER, this.gameOver);
    }, { phase: "execute" });

    this.eventBus.on(EVT.GAME_LIGHTHOUSES_DEPLETED, ({ owner, loser }) => {
      const defeatedPlayer = owner || loser;
      if (!defeatedPlayer || this.gameOver) return;
      this.gameOver = {
        winner: this.#getOpponentUsername(defeatedPlayer),
        reason: "lighthouses depleted",
      };
      this.eventBus.emit(EVT.GAME_OVER, this.gameOver);
    }, { phase: "execute" });

    this.eventBus.on(EVT.ROUND_START, () => {
      this._barrierUsedThisRound.clear();
      this._cardsPlayedThisRound.clear();
      for (const username of this.usernames) {
        CombatSlotService.resetAll(this.playerStates[username]);
      }
    }, { phase: "execute" });

    this.eventBus.on(EVT.ROUND_END, () => {
      // Conditions last "until end of round" per RULES.md
      for (const username of this.usernames) {
        const field = this.playerStates[username]?.field;
        if (!field) continue;
        const allUnits = [...(field.frontline || []), ...(field.backline || [])];
        for (const unit of allUnits) {
          this.modifierStack.removeWhere(
            (m) => m.targetId === unit.id && m.type === "condition"
          );
        }
        // Reset Anima Shinheuh slot; combat slots reset at round start.
        CombatSlotService.resetShinheuhSlot(this.playerStates[username]);
      }
    }, { phase: "execute" });

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

  #initializePlayerState(username, deck = null) {
    if (!deck) deck = this.#generateRandomDeckOfCardIds();

    // codes for all non special positions
    const combatSlotCodes = Object.keys(GameState.positions)
      .filter((code) => !GameState.positions[code].special)
      .map((code) => code);

    return {
      combatSlotCodes: combatSlotCodes,
      combatSlots: Object.fromEntries(combatSlotCodes.map((code) => [code, { available: true }])),
      deck: this.#buildDeckFromCardIds(deck, username),
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
      const cardData = GameState.cards[cardId];
      if (cardData === undefined) throw new Error(`Card with cardId ${cardId} does not exist`);
      if ((cardData.deckConstraints || []).some((constraint) => constraint.type === "unreachable")) {
        throw new Error(`Card "${cardData.name}" is unreachable and cannot be included in a deck.`);
      }
      deck.push(new Card(cardId, cardData, username, this.eventBus));
    });
    return deck;
  }

  /**
   * Generate a random array of valid cardIds.
   * @returns {Array<number>} Array of cardIds
   */
  #generateRandomDeckOfCardIds() {
    const eligible = Object.values(GameState.cards)
      .filter((card) => !(card.deckConstraints || []).some((constraint) => constraint.type === "unreachable"))
      .map((card) => card.cardId);
    if (eligible.length < GameState.INIT_DECK_SIZE) {
      throw new Error("Not enough eligible cards to generate a legal deck.");
    }

    // Deterministic default deck; caller-provided decks define actual gameplay setup.
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
          }
        : null,
      field: {
        frontline: playerState.field.frontline.map((unit) => ({
          ...unit.toSanitizedObject(),
          equipmentAttachments: (unit.equipmentAttachments || []).map((card) => card.name),
          conditions: [...this.modifierStack.getActiveKeys(unit.id, "condition")],
          traits: [...this.modifierStack.getActiveKeys(unit.id, "trait")],
          grantedAbilities: this.#getGrantedAbilities(unit.id),
        })),
        backline: playerState.field.backline.map((unit) => ({
          ...unit.toSanitizedObject(),
          equipmentAttachments: (unit.equipmentAttachments || []).map((card) => card.name),
          conditions: [...this.modifierStack.getActiveKeys(unit.id, "condition")],
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
          conditions: [...this.modifierStack.getActiveKeys(unit.id, "condition")],
          traits: [...this.modifierStack.getActiveKeys(unit.id, "trait")],
        })),
        backline: opponentState.field.backline.map((unit) => ({
          ...unit.toSanitizedObject(),
          equipmentAttachments: (unit.equipmentAttachments || []).map((card) => card.name),
          conditions: [...this.modifierStack.getActiveKeys(unit.id, "condition")],
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
      you: this.#filterYouState(username),
      opponent: this.#filterOpponentState(username),
      currentTurn: this.currentTurn,
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
    ZoneService.draw(this.playerStates[this.usernames[0]], GameState.PER_ROUND_DRAW_AMOUNT, this);
    ZoneService.draw(this.playerStates[this.usernames[1]], GameState.PER_ROUND_DRAW_AMOUNT, this);
    this.roundEndOnTurnEnd = false; // reset the flag for the next round
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
   * Shinsu is now fully managed by ShinsuService.
   */

  processAction(action) {
    if (this.gameOver) throw new Error("The game is over.");
    if (this.pendingDecision || this._pendingDecisions.length > 0) {
      throw new Error("A player decision must be resolved before another action.");
    }

    const { type, data } = action;
    const handler = this.actionRegistry[type];
    if (!handler)
      throw new Error(
        `${type} is an invalid action type\nAvailable types: ${Object.keys(this.actionRegistry).join(", ")}`
      );

    handler.validate(data, this);
    handler.execute(data, this);
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
    const previous = this.pendingDecision.onResolved;
    this.pendingDecision.onResolved = () => {
      previous?.();
      continuation();
    };
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
          equipmentAttachments: (u.equipmentAttachments || []).map((card) => card.name),
          conditions: [...this.modifierStack.getActiveKeys(u.id, "condition")],
          traits: [...this.modifierStack.getActiveKeys(u.id, "trait")],
        })) ?? [],
        backline: p.field?.backline?.map((u) => ({
          id: u.id,
          name: u.card?.name,
          hp: u.currentHp,
          maxHp: u.card?.maxHp,
          position: u.placedPositionCode,
          equipmentAttachments: (u.equipmentAttachments || []).map((card) => card.name),
          conditions: [...this.modifierStack.getActiveKeys(u.id, "condition")],
          traits: [...this.modifierStack.getActiveKeys(u.id, "trait")],
        })) ?? [],
      };
    }
    return snap;
  }

  /**
   * Reset shinsu for both players at game start.
   */
  #resetShinsu(usernames) {
    usernames.forEach((username) => {
      const player = this.playerStates[username];
      if (player) {
        player.shinsu = {
          normalSpent: 0,
          normalAvailable: Math.min(GameState.MAX_NORMAL_SHINSU, this.round),
          recharged: 0,
        };
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
   * Modify player's Fire Charges. Used by HwayeomsaEngine.
   * All fire charge mutations must go through this method.
   */
  _modifyFireCharges(username, delta) {
    const player = this.playerStates[username];
    if (!player) return;
    player.fireCharges = Math.max(0, (player.fireCharges || 0) + delta);
    return player.fireCharges;
  }

  /** Create and publish a pending decision. If a decision is already active, push onto the stack. */
  createPendingDecision({ owner, type, candidates, minChoices = 1, maxChoices = minChoices, resolve }) {
    if (!this.usernames.includes(owner)) throw new Error("Decision owner must be a game player.");
    if (!Array.isArray(candidates) || candidates.length < minChoices) {
      throw new Error("Not enough valid candidates for the requested decision.");
    }

    const decision = {
      decisionId: IdFactory.decisionId(),
      owner,
      type,
      candidates: candidates.map(({ id, name, hp }) => ({ id, name, hp })),
      minChoices,
      maxChoices,
      resolve,
      onResolved: null,
    };

    // If a decision is already pending, push current to stack
    if (this.pendingDecision) {
      this._pendingDecisions.push(this.pendingDecision);
    }
    this.pendingDecision = decision;

    this.eventBus.emit(EVT.DECISION_PENDING, {
      decisionId: decision.decisionId,
      owner,
      type,
      candidates: decision.candidates,
      minChoices,
      maxChoices,
    });
    return decision.decisionId;
  }

  /** Resolve the currently pending, server-validated player decision. */
  resolveDecision({ decisionId, choices, username } = {}) {
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

    // Resolve the selected state first, then clear this decision before running
    // continuations so a later effect may legitimately create its own choice.
    pending.resolve?.(choices);
    this.pendingDecision = this._pendingDecisions.pop() || null;
    pending.onResolved?.();
    this.eventBus.emit(EVT.DECISION_RESOLVED, { decisionId, owner: pending.owner, type: pending.type, choices });
    // If a stacked decision is now active, notify the client
    if (this.pendingDecision) {
      this.eventBus.emit(EVT.DECISION_PENDING, {
        decisionId: this.pendingDecision.decisionId,
        owner: this.pendingDecision.owner,
        type: this.pendingDecision.type,
        candidates: this.pendingDecision.candidates,
        minChoices: this.pendingDecision.minChoices,
        maxChoices: this.pendingDecision.maxChoices,
      });
    }
  }
}
