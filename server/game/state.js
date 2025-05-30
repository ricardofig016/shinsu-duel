import positions from "../data/positions.json" assert { type: "json" };
import cards from "../data/cards.json" assert { type: "json" };

export default class GameState {
  VALID_ACTIONS = { "deploy-unit": ["handId", "placedPositionCode", "username"], "pass-turn": [] };

  constructor(roomCode, config) {
    if (!roomCode || !config || !config.players || config.players.length !== 2) {
      throw new Error(
        "Invalid game configuration: roomCode and players are required and must have exactly 2 players."
      );
    }

    this.roomCode = roomCode;
    this.players = config.players;
    this.roundTurn = config.players[Math.floor(Math.random() * 2)];
    this.currentTurn = this.roundTurn;
    this.actions = [];

    // Initialize game state
    this.state = {
      players: {
        [config.players[0]]: this.#initializePlayer(config.players[0]),
        [config.players[1]]: this.#initializePlayer(config.players[1]),
      },
    };
  }

  #initializePlayer(username) {
    // default values
    const player = {
      combatIndicatorCodes: ["fisherman", "lightbearer", "scout", "spearbearer", "wavecontroller"],
      deck: this.#generateDeck(),
      lighthouses: { amount: 20 },
      field: { frontline: [], backline: [] },
      hand: [],
      shinsu: { normalSpent: 0, normalAvailable: 1, recharged: 0 },
      username: username,
    };
    // draw 4 cards
    this.#draw(player, 4);

    return player;
  }

  #generateDeck() {
    // random deck with 30 cards
    const cards = Array.from({ length: 30 }, () => ({
      id: Math.floor(Math.random() * 7),
      traitCodes: [],
      visible: false,
    }));
    return { cards: cards, size: 30 };
  }

  #draw(player, amount) {
    for (let i = 0; i < amount; i++) {
      if (player.deck.size === 0) return;
      player.hand.push(player.deck.cards.pop());
      player.deck.size--;
    }
  }

  #mapUnits(units) {
    return units.map((unit) => ({
      id: unit.id,
      traitCodes: unit.traitCodes,
      placedPositionCode: unit.placedPositionCode,
    }));
  }

  #filterYouState(username) {
    const playerState = this.state.players[username];
    if (!playerState) {
      console.error(`Player state for ${username} not found.`);
      console.error("Available players:", Object.keys(this.state.players));
      return null;
    }
    return {
      combatIndicatorCodes: playerState.combatIndicatorCodes,
      deck: { size: playerState.deck.size },
      lighthouses: playerState.lighthouses,
      field: {
        frontline: this.#mapUnits(playerState.field.frontline),
        backline: this.#mapUnits(playerState.field.backline),
      },
      hand: playerState.hand.map((card) => ({
        id: card.id,
        traitCodes: card.traitCodes,
      })),
      shinsu: playerState.shinsu,
      username: playerState.username,
    };
  }

  #filterOpponentState(username) {
    const opponent = Object.keys(this.state.players).find((p) => p !== username);
    const opponentState = this.state.players[opponent];
    const hand = opponentState.hand.map((card) => {
      if (card.visible) return { id: card.id, traitCodes: card.traitCodes };
      else return {};
    });
    return {
      combatIndicatorCodes: opponentState.combatIndicatorCodes,
      deck: { size: opponentState.deck.size },
      lighthouses: opponentState.lighthouses,
      field: {
        frontline: this.#mapUnits(opponentState.field.frontline),
        backline: this.#mapUnits(opponentState.field.backline),
      },
      hand: hand,
      shinsu: opponentState.shinsu,
      username: opponentState.username,
    };
  }

  #flipCurrentTurn() {
    this.currentTurn = this.players.find((p) => p !== this.currentTurn);
  }

  #flipRoundTurn() {
    this.roundTurn = this.players.find((p) => p !== this.roundTurn);
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

  #validateDeployUnitAction(data) {
    if (data.handId < 0 || data.handId >= this.state.players[data.username].hand.length) {
      throw new Error("Invalid handId: " + data.handId);
    }
    if (!positions[data.placedPositionCode]) {
      throw new Error("Invalid placedPositionCode: " + data.placedPositionCode);
    }
    const card = this.state.players[data.username].hand[data.handId];
    console.log("Card: " + JSON.stringify(card));
    if (!card || card.id === undefined || !cards[card.id]) {
      throw new Error("Card not found in hand: " + JSON.stringify(card));
    }
    if (!cards[card.id].positionCodes.includes(data.placedPositionCode)) {
      throw new Error("Card cannot be placed in this position: " + data.placedPositionCode);
    }

    return true;
  }

  getClientState(username) {
    return {
      you: this.#filterYouState(username),
      opponent: this.#filterOpponentState(username),
      currentTurn: this.currentTurn,
    };
  }

  processAction(data) {
    if (!this.#validateAction(data)) return;

    const player = this.state.players[data.username];

    const deployUnit = () => {
      const [card] = player.hand.splice(data.handId, 1);
      card.placedPositionCode = data.placedPositionCode;
      const line = player.field[positions[card.placedPositionCode].line];
      line.push(card);
      endTurn();
    };

    const endTurn = () => {
      this.#flipCurrentTurn();
    };

    const endRound = () => {
      this.#flipRoundTurn();
      this.currentTurn = this.roundTurn;
    };

    const passTurn = () => {
      endTurn();
      if (this.actions.length > 0 && this.actions[this.actions.length - 1].type === "pass-turn") endRound();
    };

    switch (data.type) {
      case "deploy-unit":
        deployUnit();
        break;
      case "pass-turn":
        passTurn();
        break;
      default:
        console.log("Invalid action type: " + data.type);
    }

    this.actions.push(data);
  }
}
