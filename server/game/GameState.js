import cards from "../data/cards.json" assert { type: "json" };
import positions from "../data/positions.json" assert { type: "json" };
import EventBus from "./EventBus.js";
import effectRegistry from "./registries/effectRegistry.js";
import createActionRegistry from "./registries/actionRegistry.js";
import Logger from "./Logger.js";
import Card from "./Card.js";

export default class GameState {
  // game settings
  static INIT_HAND_SIZE = 4;
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

    this.eventBus = new EventBus();
    this.actionRegistry = createActionRegistry();
    this.logger = new Logger(this.eventBus);

    this.activeEffects = [];
    this.roomCode = roomCode;
    this.usernames = usernames;
    this.round = 1;
    this.currentTurn = firstPlayer ? firstPlayer : this.usernames[Math.floor(Math.random() * 2)]; // randomly select the first player
    this.roundEndOnTurnEnd = false; // whether the last user action was a pass and it was on the current round

    // initialize game state
    this.playerStates = {
      [this.usernames[0]]: this.#initializePlayerState(this.usernames[0], decks[this.usernames[0]]),
      [this.usernames[1]]: this.#initializePlayerState(this.usernames[1], decks[this.usernames[1]]),
    };
    this.#draw(this.usernames, GameState.INIT_HAND_SIZE);
    this.#resetShinsu(this.usernames);

    // add mockup effects
    // this.#addEffect("test-console-log-on-turn-end");
    // this.#addEffect("test-console-log-on-turn-end-until-round-end");

    // publish initial game events
    this.eventBus.publish("OnGameStart", this.playerStates);
    this.eventBus.publish("OnRoundStart", {
      username: this.currentTurn,
      round: this.round,
      playerStates: this.playerStates,
    });
    this.eventBus.publish("OnTurnStart", {
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
      deck: this.#buildDeckFromCardIds(deck, username),
      lighthouses: { amount: GameState.INIT_LIGHTHOUSE_AMOUNT },
      field: { frontline: [], backline: [] },
      hand: [],
      shinsu: {},
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
      deckSize: playerState.deck.length,
      lighthouses: playerState.lighthouses,
      field: {
        frontline: playerState.field.frontline.map((unit) => unit.toSanitizedObject()),
        backline: playerState.field.backline.map((unit) => unit.toSanitizedObject()),
      },
      hand: playerState.hand.map((card) => card.toSanitizedObject()), // send full card info for own hand
      shinsu: playerState.shinsu,
      username: playerState.username,
      passButton: {
        isEnabled: username === this.currentTurn, // pass button is enabled is it's the player's turn
        text: passButtonText, // text to display on the pass button
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
        frontline: opponentState.field.frontline.map((unit) => unit.toSanitizedObject()),
        backline: opponentState.field.backline.map((unit) => unit.toSanitizedObject()),
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
    this.eventBus.publish("OnTurnEnd", {
      username: this.currentTurn,
      round: this.round,
    });

    if (isPassAction) {
      // end the round if both players passed their turn consecutively
      if (this.roundEndOnTurnEnd) this.#endRound();
      else this.roundEndOnTurnEnd = true; // set the flag to true for the next turn
    } else this.roundEndOnTurnEnd = false; // reset the flag if the action was not a pass

    // flip turn to the next player
    this.currentTurn = this.usernames.find((p) => p !== this.currentTurn);
    this.eventBus.publish("OnTurnStart", {
      username: this.currentTurn,
      round: this.round,
    });
  }

  /**
   * End the current round. This method does not flip the turn.
   */
  #endRound() {
    this.eventBus.publish("OnRoundEnd", {
      username: this.currentTurn,
      round: this.round,
    });
    this.round++;
    this.#resetShinsu(this.usernames);
    this.#draw(this.usernames, GameState.PER_ROUND_DRAW_AMOUNT);
    this.roundEndOnTurnEnd = false; // reset the flag for the next round
    this.eventBus.publish("OnRoundStart", {
      username: this.currentTurn,
      round: this.round,
      playerStates: this.playerStates,
    });
  }

  getTotalShinsu(username) {
    const player = this.playerStates[username];
    if (!player) throw new Error(`Player ${username} not found.`);
    return player.shinsu.normalAvailable + player.shinsu.recharged;
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
    const deductedRechargedShinsu = Math.min(player.shinsu.recharged, cost);
    player.shinsu.recharged -= deductedRechargedShinsu;
    player.shinsu.normalAvailable -= cost - deductedRechargedShinsu;
    player.shinsu.normalSpent += cost - deductedRechargedShinsu;
  }

  #addEffect(effectId) {
    const EffectClass = effectRegistry[effectId];
    if (!EffectClass) throw new Error(`No effect found for id ${effectId}`);
    const instance = new EffectClass(this); // TODO: add more info here in the future (like source, owner, etc)
    this.activeEffects.push(instance);
  }

  removeEffect(effectInstance) {
    // remove from active effects
    const idx = this.activeEffects.indexOf(effectInstance);
    if (idx !== -1) {
      this.activeEffects.splice(idx, 1);
    }
    // unsubscribe from all events
    if (typeof effectInstance.unsubscribeAll === "function") {
      effectInstance.unsubscribeAll();
    }
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
    this.logger.logAction(action);
  }
}
