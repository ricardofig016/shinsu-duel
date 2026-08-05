import ShinsuService from "./services/ShinsuService.js";
import ZoneService from "./services/ZoneService.js";
import LifecycleEngine from "./services/LifecycleEngine.js";
import TriggerManager from "./services/TriggerManager.js";
import AttributeRegistry from "./attributes/AttributeRegistry.js";
import AnimaEngine from "./attributes/AnimaEngine.js";
import HwayeomsaEngine from "./attributes/HwayeomsaEngine.js";
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
   */
  constructor(roomCode, usernames, decks = {}, firstPlayer = null) {
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

    // Trigger Manager
    this._triggerManager = new TriggerManager(this.eventBus);

    // Attribute Registry
    this._attributeRegistry = new AttributeRegistry();
    this._attributeRegistry.register("anima", new AnimaEngine(this.eventBus));
    this._attributeRegistry.register("hwayeomsa", new HwayeomsaEngine(this.eventBus, GameState.cards));

    // Barrier tracking (reset on round start)
    this._barrierUsedThisRound = new Set();

    // Deterministic first player (use index 0 as default instead of Math.random)
    this.roomCode = roomCode;
    this.usernames = usernames;
    this.round = 1;
    this.currentTurn = firstPlayer || this.usernames[0];
    this.roundEndOnTurnEnd = false;
    this.gameOver = null; // { winner, reason }

    // initialize game state
    this.playerStates = {
      [this.usernames[0]]: this.#initializePlayerState(this.usernames[0], decks[this.usernames[0]]),
      [this.usernames[1]]: this.#initializePlayerState(this.usernames[1], decks[this.usernames[1]]),
    };
    this.#draw(this.usernames, GameState.INIT_HAND_SIZE);
    this.#resetShinsu(this.usernames);

    // Wire Barrier reset and condition cleanup lifecycle events
    this.eventBus.on(EVT.ROUND_START, () => {
      this._barrierUsedThisRound.clear();
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
        // Reset Anima Shinheuh slot
        AnimaEngine.resetSlot(username, this);
        // Reset combat slots
        this.#resetCombatSlots(username);
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
      combatSlots: this.#initCombatSlots(combatSlotCodes),
      deck: this.#buildDeckFromCardIds(deck, username),
      discard: [],
      lighthouses: { amount: GameState.INIT_LIGHTHOUSE_AMOUNT, max: 40 },
      field: { frontline: [], backline: [] },
      hand: [],
      shinsu: {},
      shinheuhSlot: { available: false, used: false },
      compressAmount: 0,
      fireCharges: 0,
      username: username,
    };
  }

  #initCombatSlots(codes) {
    const slots = {};
    for (const code of codes) {
      slots[code] = { available: true };
    }
    return slots;
  }

  #resetCombatSlots(username) {
    const player = this.playerStates[username];
    if (!player?.combatSlots) return;
    for (const code of Object.keys(player.combatSlots)) {
      player.combatSlots[code].available = true;
    }
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
    cardIds.forEach((cardId) => {
      const cardData = GameState.cards[cardId];
      if (cardData === undefined) throw new Error(`Card with cardId ${cardId} does not exist`);
      deck.push(new Card(cardId, cardData, username, this.eventBus));
    });
    return deck;
  }

  /**
   * Generate a random array of valid cardIds.
   * @returns {Array<number>} Array of cardIds
   */
  #generateRandomDeckOfCardIds() {
    const deck = Array.from({ length: GameState.INIT_DECK_SIZE }, () => {
      // return 2; // for testing purposes, use only cardId 2 (khun)
      return this.#getRandomCardId();
    });
    return deck;
  }

  #getRandomCardId() {
    const maxCardId = Object.keys(GameState.cards).length - 1;
    return Math.floor(Math.random() * (maxCardId + 1));
  }

  #draw(usernames, amount) {
    // ensure usernames is an array
    if (!Array.isArray(usernames)) usernames = [usernames];
    usernames.forEach((username) => {
      const player = this.playerStates[username];
      if (!player || !player.deck) throw new Error(`Player ${username} does not have a valid deck.`);
      for (let i = 0; i < amount; i++) {
        if (player.deck.length === 0) return;
        player.hand.push(player.deck.pop());
      }
    });
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
      compressAmount: playerState.compressAmount ?? 0,
      fireCharges: playerState.fireCharges ?? 0,
      field: {
        frontline: playerState.field.frontline.map((unit) => ({
          ...unit.toSanitizedObject(),
          equipment: unit.equipment?.name || null,
          conditions: [...this.modifierStack.getActiveKeys(unit.id, "condition")],
          traits: [...this.modifierStack.getActiveKeys(unit.id, "trait")],
        })),
        backline: playerState.field.backline.map((unit) => ({
          ...unit.toSanitizedObject(),
          equipment: unit.equipment?.name || null,
          conditions: [...this.modifierStack.getActiveKeys(unit.id, "condition")],
          traits: [...this.modifierStack.getActiveKeys(unit.id, "trait")],
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
          equipment: unit.equipment?.name || null,
          conditions: [...this.modifierStack.getActiveKeys(unit.id, "condition")],
          traits: [...this.modifierStack.getActiveKeys(unit.id, "trait")],
        })),
        backline: opponentState.field.backline.map((unit) => ({
          ...unit.toSanitizedObject(),
          equipment: unit.equipment?.name || null,
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
    // Clear compress amount at turn end
    const player = this.playerStates[this.currentTurn];
    if (player) player.compressAmount = 0;

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
   * Reset shinsu for the given usernames. This is called primarily at the end of a round.
   * @param {*} usernames - array of strings, with each username to reset
   */
  #resetShinsu(usernames) {
    usernames.forEach((username) => {
      const player = this.playerStates[username];
      if (player) {
        const unspentShinsu = player.shinsu.recharged + player.shinsu.normalAvailable || 0;
        player.shinsu = {
          normalSpent: 0,
          normalAvailable: Math.min(GameState.MAX_NORMAL_SHINSU, this.round),
          recharged: Math.min(GameState.MAX_RECHARGED_SHINSU, unspentShinsu),
        };
      }
    });
  }

  /**
   * First, deduct from recharged shinsu, then deduct the rest from normal shinsu
   * @param {string} username
   * @param {number} cost - the cost to deduct (int)
   */
  spendShinsu(username, cost) {
    const player = this.playerStates[username];
    if (!player) throw new Error(`Player ${username} not found.`);
    if (!Number.isInteger(cost) || cost < 0) return;
    ShinsuService.spend(player, cost);
  }

  processAction(action) {
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
   * Find a unit by its instance ID across both players' fields.
   * Used by handlers that need to modify unit state.
   */
  _findUnit(unitId) {
    for (const username of this.usernames) {
      const field = this.playerStates[username]?.field;
      if (!field) continue;
      for (const unit of [...(field.frontline || []), ...(field.backline || [])]) {
        if (unit.id === unitId) return unit;
      }
    }
    return null;
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
        compressAmount: p.compressAmount ?? 0,
        fireCharges: p.fireCharges ?? 0,
        frontline: p.field?.frontline?.map((u) => ({
          id: u.id,
          name: u.card?.name,
          hp: u.currentHp,
          maxHp: u.card?.maxHp,
          position: u.placedPositionCode,
          equipment: u.equipment?.name || null,
          conditions: [...this.modifierStack.getActiveKeys(u.id, "condition")],
          traits: [...this.modifierStack.getActiveKeys(u.id, "trait")],
        })) ?? [],
        backline: p.field?.backline?.map((u) => ({
          id: u.id,
          name: u.card?.name,
          hp: u.currentHp,
          maxHp: u.card?.maxHp,
          position: u.placedPositionCode,
          equipment: u.equipment?.name || null,
          conditions: [...this.modifierStack.getActiveKeys(u.id, "condition")],
          traits: [...this.modifierStack.getActiveKeys(u.id, "trait")],
        })) ?? [],
      };
    }
    return snap;
  }

  // Check and set lighthouses (with game-over detection)
  modifyLighthouses(username, amount) {
    const player = this.playerStates[username];
    if (!player) throw new Error(`Player ${username} not found.`);
    player.lighthouses.amount = Math.max(0, Math.min(40, player.lighthouses.amount + amount));
    if (player.lighthouses.amount <= 0) {
      this.gameOver = { winner: this.#getOpponentUsername(username), reason: "lighthouses depleted" };
      this.eventBus.emit(EVT.GAME_LIGHTHOUSES_DEPLETED, { loser: username, winner: this.gameOver.winner });
      this.eventBus.emit(EVT.GAME_OVER, this.gameOver);
    }
    return player.lighthouses.amount;
  }

  // Pending-decision protocol
  /**
   * @param {{ decisionId: string, type: string, choices: any[] }} decision
   */
  resolveDecision(decision) {
    // Placeholder — Phase 3+ will implement full decision resolution
    // For now, just validate the decision exists
    if (!decision || !decision.decisionId) {
      throw new Error("Invalid decision payload");
    }
    // Future: look up pending decision by ID, validate choices, resume event chain
  }
}
