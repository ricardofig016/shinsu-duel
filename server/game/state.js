import positions from "../data/positions.json" assert { type: "json" };

export default class GameState {
  constructor(roomCode, config) {
    this.roomCode = roomCode;
    this.players = config.players;
    this.currentTurn = config.players[Math.floor(Math.random() * 2)];
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

  getClientState(username) {
    return {
      you: this.#filterYouState(username),
      opponent: this.#filterOpponentState(username),
      currentTurn: this.currentTurn,
    };
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

  validateAction(actionData) {
    // TODO
    return true;
  }

  processAction(actionData) {
    const player = this.state.players[actionData.username];

    const deployUnit = () => {
      const [card] = player.hand.splice(actionData.handId, 1);
      card.placedPositionCode = actionData.placedPositionCode;
      const line = player.field[positions[card.placedPositionCode].line];
      line.push(card);
      // console.log("Deployed unit", card);
    };

    switch (actionData.type) {
      case "deploy-unit":
        deployUnit();
        break;
      case "end-turn":
        endTurn();
        break;
      default:
        console.log("Invalid action type");
    }

    this.actions.push(actionData);
  }
}
