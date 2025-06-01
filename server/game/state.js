import positions from "../data/positions.json" assert { type: "json" };
import cards from "../data/cards.json" assert { type: "json" };

export default class GameState {
  // all of the valid user actions and their required fields
  VALID_ACTIONS = { "deploy-unit": ["handId", "placedPositionCode", "username"], "pass-turn": ["username"] };
  // game settings
  INIT_HAND_SIZE = 4;
  INIT_DECK_SIZE = 30;
  INIT_LIGHTHOUSE_AMOUNT = 20;
  PER_ROUND_DRAW_AMOUNT = 1;
  MAX_NORMAL_SHINSU = 10;
  MAX_RECHARGED_SHINSU = 2;

  constructor(roomCode, config) {
    if (!roomCode || !config || !config.players || config.players.length !== 2) {
      throw new Error(
        "Invalid game configuration: roomCode and players are required and must have exactly 2 players."
      );
    }

    this.roomCode = roomCode;
    this.players = config.players;
    this.round = 1;
    this.roundTurn = config.players[Math.floor(Math.random() * 2)];
    this.currentTurn = this.roundTurn;
    this.actionLog = [];

    // initialize game state
    this.state = {
      players: {
        [config.players[0]]: this.#initializePlayer(config.players[0]),
        [config.players[1]]: this.#initializePlayer(config.players[1]),
      },
    };

    // draw initial hand for each player
    this.#draw(config.players, this.INIT_HAND_SIZE);
  }

  #initializePlayer(username) {
    // default values
    return {
      combatIndicatorCodes: ["fisherman", "lightbearer", "scout", "spearbearer", "wavecontroller"],
      deck: this.#generateRandomDeck(), // generate a random deck for now
      lighthouses: { amount: this.INIT_LIGHTHOUSE_AMOUNT },
      field: { frontline: [], backline: [] },
      hand: [],
      shinsu: { normalSpent: 0, normalAvailable: this.round, recharged: 0 },
      username: username,
    };
  }

  /**
   * Generate a random deck.
   * @returns {Object} { cards: Array of card objects, size: number of cards in the deck }
   */
  #generateRandomDeck() {
    const maxCardId = Object.keys(cards).length - 1;
    const deckCards = Array.from({ length: this.INIT_DECK_SIZE }, () => ({
      id: Math.floor(Math.random() * (maxCardId + 1)),
      traitCodes: [],
      visible: false,
    }));
    return { cards: deckCards, size: this.INIT_DECK_SIZE };
  }

  #draw(usernames, amount) {
    if (!Array.isArray(usernames)) {
      usernames = [usernames]; // ensure usernames is an array
    }
    usernames.forEach((username) => {
      const player = this.state.players[username];
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
    const player = this.state.players[username];
    if (!player) {
      console.error(`Player state for ${username} not found.`);
      console.error("Available players:", Object.keys(this.state.players));
      return null;
    }

    let passButtonText = player.username;
    if (username === this.currentTurn)
      passButtonText =
        this.actionLog.length > 0 && this.actionLog[this.actionLog.length - 1].type === "pass-turn"
          ? "End Round" // if the previous opponent passed, passing will end the round. we inform the player about this
          : "Pass Turn";

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
    const opponent = Object.keys(this.state.players).find((p) => p !== username);
    if (!opponent) {
      throw new Error(`Opponent for ${username} not found.`);
    }
    return opponent;
  }

  #filterOpponentState(username) {
    const opponent = this.state.players[this.#getOpponentUsername(username)];
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

  #endTurn() {
    this.currentTurn = this.players.find((p) => p !== this.currentTurn);
  }

  #endRound() {
    this.roundTurn = this.players.find((p) => p !== this.roundTurn);
    this.currentTurn = this.roundTurn;
    this.round++;
    this.#resetShinsu(this.players);
    this.#draw(this.players, this.PER_ROUND_DRAW_AMOUNT);
    this.#logAction({ type: "end-round", round: this.round }); // TODO: THERE IS A BUG AROUND HERE
    console.log(`action: Round ${this.round} ended.`);
  }

  /**
   * Reset shinsu for the given usernames. This is called primarily at the end of a round.
   * @param {*} usernames - array of strings, with each username to reset
   */
  #resetShinsu(usernames) {
    usernames.forEach((username) => {
      const player = this.state.players[username];
      if (player) {
        const unspentShinsu = player.shinsu.recharged + player.shinsu.normalAvailable;
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
    if (!data || !data.type || !this.VALID_ACTIONS[data.type]) {
      throw new Error("Invalid action type: " + JSON.stringify(data));
    }
    if (!data.username || !this.state.players[data.username]) {
      throw new Error("Invalid username in action data: " + JSON.stringify(data));
    }
    if (!this.VALID_ACTIONS[data.type].every((field) => field in data)) {
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
    const player = this.state.players[data.username];
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
    const player = this.state.players[username];
    if (!Number.isInteger(cost) || cost < 0) return;
    const deductedRechargedShinsu = Math.min(player.shinsu.recharged, cost);
    player.shinsu.recharged -= deductedRechargedShinsu;
    player.shinsu.normalAvailable -= cost - deductedRechargedShinsu;
    player.shinsu.normalSpent += cost - deductedRechargedShinsu;
  }

  #logAction(action) {
    this.actionLog.push(action);
  }

  getClientState(username) {
    return {
      you: this.#filterYouState(username),
      opponent: this.#filterOpponentState(username),
      currentTurn: this.currentTurn,
    };
  }

  processAction(data) {
    const deployUnit = () => {
      const player = this.state.players[data.username];
      const [card] = player.hand.splice(data.handId, 1); // remove card from hand
      card.placedPositionCode = data.placedPositionCode; // set position
      const line = player.field[positions[card.placedPositionCode].line];
      line.push(card); // add card to the field
      this.#spendShinsu(data.username, cards[card.id].cost); // update shinsu
      this.#endTurn(); // end turn
    };

    const passTurn = () => {
      // console.log(`${data.username} passed their turn.`);
      this.#endTurn();
      const previousAction = this.actionLog[this.actionLog.length - 2];
      if (this.actionLog.length >= 2 && previousAction.type === "pass-turn") this.#endRound(); // if both players passed their turn consecutively, end the round
    };

    if (!this.#validateAction(data)) return; // if the action is invalid, this method will throw an error
    this.#logAction(data);
    if (data.type === "pass-turn") {
      console.log("action: " + data.username + " passed their turn.");
    }
    switch (data.type) {
      case "deploy-unit":
        deployUnit();
        break;
      case "pass-turn":
        passTurn();
        break;
      default:
        throw new Error("Invalid action type: " + data.type);
    }
  }
}
