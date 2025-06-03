import positions from "../data/positions.json" assert { type: "json" };
import cards from "../data/cards.json" assert { type: "json" };
import EventBus from "./EventBus.js";
import Logger from "./Logger.js";

// mockup effect classes
import TestConsoleLogOnTurnEnd from "./effects/triggered/TestConsoleLogOnTurnEnd.js";
import TestConsoleLogOnTurnEndUntilRoundEnd from "./effects/continuous/TestConsoleLogOnTurnEndUntilRoundEnd.js";

export default class GameState {
  // all of the valid actions the user can take and their required fields
  VALID_USER_ACTIONS = {
    "deploy-unit": ["handId", "placedPositionCode", "username"],
    "pass-turn": ["username"],
  };
  // game settings
  INIT_HAND_SIZE = 4;
  INIT_DECK_SIZE = 30;
  INIT_LIGHTHOUSE_AMOUNT = 20;
  PER_ROUND_DRAW_AMOUNT = 1;
  MAX_NORMAL_SHINSU = 10;
  MAX_RECHARGED_SHINSU = 2;

  constructor(roomCode, config) {
    if (!roomCode || !config || !config.usernames || config.usernames.length !== 2) {
      throw new Error(
        "Invalid game configuration: roomCode and usernames are required and must have exactly 2 usernames."
      );
    }

    this.eventBus = new EventBus();
    this.logger = new Logger(this.eventBus);
    this.activeEffects = [];
    this.roomCode = roomCode;
    this.usernames = config.usernames;
    this.round = 1;
    this.currentTurn = this.usernames[Math.floor(Math.random() * 2)]; // randomly select the first player
    this.roundEndOnTurnEnd = false; // whether the last user action was a pass and it was on the current round

    // initialize game state
    this.playerStates = {
      [this.usernames[0]]: this.#initializePlayerState(this.usernames[0]),
      [this.usernames[1]]: this.#initializePlayerState(this.usernames[1]),
    };
    this.#draw(this.usernames, this.INIT_HAND_SIZE);
    this.#resetShinsu(this.usernames);

    // add mockup effects
    // this.#addEffect(new TestConsoleLogOnTurnEnd(this));
    // this.#addEffect(new TestConsoleLogOnTurnEndUntilRoundEnd(this));

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

  #initializePlayerState(username) {
    // default values
    return {
      combatIndicatorCodes: ["fisherman", "lightbearer", "scout", "spearbearer", "wavecontroller"],
      deck: this.#generateRandomDeck(), // generate a random deck for now
      lighthouses: { amount: this.INIT_LIGHTHOUSE_AMOUNT },
      field: { frontline: [], backline: [] },
      hand: [],
      shinsu: {},
      username: username,
    };
  }

  /**
   * Generate a random deck.
   * @returns {Object} { cards: Array of card objects, size: number of cards in the deck }
   */
  #generateRandomDeck() {
    const maxCardId = Object.keys(cards).length - 1;
    const deckCards = Array.from({ length: this.INIT_DECK_SIZE }, () => {
      const cardId = Math.floor(Math.random() * (maxCardId + 1));
      const cardData = cards[cardId];
      return {
        id: cardId,
        traitCodes: cardData.traitCodes,
        visible: false,
      };
    });
    return { cards: deckCards, size: this.INIT_DECK_SIZE };
  }

  #draw(usernames, amount) {
    if (!Array.isArray(usernames)) {
      usernames = [usernames]; // ensure usernames is an array
    }
    usernames.forEach((username) => {
      const player = this.playerStates[username];
      if (!player || !player.deck) throw new Error(`Player ${username} does not have a valid deck.`);
      for (let i = 0; i < amount; i++) {
        if (player.deck.size === 0) return;
        player.hand.push(player.deck.cards.pop());
        player.deck.size--;
      }
    });
  }

  #mapUnits(units) {
    return units.map((unit) => ({
      id: unit.id,
      traitCodes: unit.traitCodes,
      placedPositionCode: unit.placedPositionCode,
    }));
  }

  #filterYouState(username) {
    const player = this.playerStates[username];
    if (!player) {
      console.error(`Player state for ${username} not found.`);
      console.error("Available players:", this.usernames);
      return null;
    }

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
      combatIndicatorCodes: player.combatIndicatorCodes,
      deck: { size: player.deck.size },
      lighthouses: player.lighthouses,
      field: {
        frontline: this.#mapUnits(player.field.frontline),
        backline: this.#mapUnits(player.field.backline),
      },
      hand: player.hand.map((card) => ({
        id: card.id,
        traitCodes: card.traitCodes,
      })),
      shinsu: player.shinsu,
      username: player.username,
      passButton: {
        isEnabled: username === this.currentTurn, // pass button is enabled is it's the player's turn
        text: passButtonText, // text to display on the pass button
      },
    };
  }

  #getOpponentUsername(username) {
    const opponent = this.usernames.find((u) => u !== username);
    if (!opponent) {
      throw new Error(`Opponent for ${username} not found.`);
    }
    return opponent;
  }

  #filterOpponentState(username) {
    const opponent = this.playerStates[this.#getOpponentUsername(username)];
    const hand = opponent.hand.map((card) => {
      if (card.visible) return { id: card.id, traitCodes: card.traitCodes };
      else return {};
    });
    return {
      combatIndicatorCodes: opponent.combatIndicatorCodes,
      deck: { size: opponent.deck.size },
      lighthouses: opponent.lighthouses,
      field: {
        frontline: this.#mapUnits(opponent.field.frontline),
        backline: this.#mapUnits(opponent.field.backline),
      },
      hand: hand,
      shinsu: opponent.shinsu,
      username: opponent.username,
      passButton: {
        isEnabled: false, // opponent's pass button is always disabled
        text: opponent.username, // always displays the opponent's username
      },
    };
  }

  #endTurn(isUserAction = false) {
    this.eventBus.publish("OnTurnEnd", {
      username: this.currentTurn,
      round: this.round,
    });
    if (isUserAction) {
      // end the round if both players passed their turn consecutively
      if (this.roundEndOnTurnEnd) this.#endRound();
      else this.roundEndOnTurnEnd = true; // set the flag to true for the next turn
    }
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
    this.#draw(this.usernames, this.PER_ROUND_DRAW_AMOUNT);
    this.roundEndOnTurnEnd = false; // reset the flag for the next round
    this.eventBus.publish("OnRoundStart", {
      username: this.currentTurn,
      round: this.round,
      playerStates: this.playerStates,
    });
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
          normalAvailable: Math.min(this.MAX_NORMAL_SHINSU, this.round),
          recharged: Math.min(this.MAX_RECHARGED_SHINSU, unspentShinsu),
        };
      }
    });
  }

  /**
   * Validate the action data.
   * @param {*} data
   * @returns true if action data is valid, throws an error otherwise.
   */
  #validateAction(data) {
    // general checks
    if (!data || !data.type || !this.VALID_USER_ACTIONS[data.type]) {
      throw new Error("Invalid action type: " + JSON.stringify(data));
    }
    if (!data.username || !this.playerStates[data.username]) {
      throw new Error("Invalid username in action data: " + JSON.stringify(data));
    }
    if (!this.VALID_USER_ACTIONS[data.type].every((field) => field in data)) {
      throw new Error("Missing fields in action data: " + JSON.stringify(data));
    }
    if (data.username !== this.currentTurn) {
      throw new Error("It's not your turn: " + data.username);
    }

    // specific checks
    if (data.type === "deploy-unit") {
      this.#validateDeployUnitAction(data);
    }
    return true;
  }

  /**
   * Validate the deploy-unit action data.
   * to pass validation, all of the following must happen:
   * - unit is in the player's hand
   * - unit is placed in one of the valid positions
   * - the player must have enough shinsu
   * @param {*} data
   * @returns true if action data is valid, throws an error otherwise.
   */
  #validateDeployUnitAction(data) {
    const player = this.playerStates[data.username];
    if (data.handId < 0 || data.handId >= player.hand.length) {
      throw new Error("Invalid handId: " + data.handId);
    }
    if (!positions[data.placedPositionCode]) {
      throw new Error(
        `Invalid placedPositionCode ${data.placedPositionCode}. Must be one of ${JSON.stringify(
          Object.keys(positions)
        )}`
      );
    }
    const card = player.hand[data.handId];
    if (!card || card.id === undefined || !cards[card.id]) {
      throw new Error(`Card with id ${data.handId} not found in hand.`);
    }
    if (!cards[card.id].positionCodes.includes(data.placedPositionCode)) {
      throw new Error(
        `Card cannot be placed in position ${data.placedPositionCode}. Must be one of ${JSON.stringify(
          cards[card.id].positionCodes
        )}`
      );
    }
    const totalShinsu = player.shinsu.normalAvailable + player.shinsu.recharged;
    if (cards[card.id].cost > totalShinsu) {
      throw new Error(
        `Not enough shinsu to deploy ${cards[card.id].name}. You need ${
          cards[card.id].cost
        } shinsu, but only have ${totalShinsu}.`
      );
    }
    return true;
  }

  /**
   * First, deduct from recharged shinsu, then deduct the rest from normal shinsu
   * @param {string} username
   * @param {number} cost - the cost to deduct (int)
   */
  #spendShinsu(username, cost) {
    const player = this.playerStates[username];
    if (!Number.isInteger(cost) || cost < 0) return;
    const deductedRechargedShinsu = Math.min(player.shinsu.recharged, cost);
    player.shinsu.recharged -= deductedRechargedShinsu;
    player.shinsu.normalAvailable -= cost - deductedRechargedShinsu;
    player.shinsu.normalSpent += cost - deductedRechargedShinsu;
  }

  #addEffect(effectInstance) {
    this.activeEffects.push(effectInstance);
  }

  #deployUnit(username, handId, placedPositionCode) {
    const player = this.playerStates[username];
    const [card] = player.hand.splice(handId, 1); // remove card from hand
    card.placedPositionCode = placedPositionCode; // set position
    const line = player.field[positions[card.placedPositionCode].line];
    line.push(card); // add card to the field
    this.#spendShinsu(username, cards[card.id].cost); // update shinsu
    this.eventBus.publish("OnDeployUnit", {
      username,
      card,
    });
    this.eventBus.publish("OnSummonUnit", {
      username,
      card,
    });
    this.#endTurn();
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

  getClientState(username) {
    return {
      you: this.#filterYouState(username),
      opponent: this.#filterOpponentState(username),
      currentTurn: this.currentTurn,
    };
  }

  processAction(data) {
    this.#validateAction(data); // if the action is invalid, this method will throw an error
    this.logger.logAction(data);
    console.log(this.logger.getLastLog());
    // reset the flag if the user did not pass their turn
    if (data.type !== "pass-turn") this.roundEndOnTurnEnd = false;
    switch (data.type) {
      case "deploy-unit":
        this.#deployUnit(data.username, data.handId, data.placedPositionCode);
        break;
      case "pass-turn":
        this.#endTurn(true);
        break;
      default:
        throw new Error("Invalid action type: " + data.type);
    }
  }
}
