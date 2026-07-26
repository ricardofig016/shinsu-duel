import GameState from "../GameState.js";
import cardsData from "../../data/cards.json" with { type: "json" };

const ROOM_CODE = "TEST";
const USERNAMES = ["Alice", "Bob"];

// Build name → cardId lookup from compiled cards.json
const cardNameToId = {};
for (const [id, card] of Object.entries(cardsData)) {
  cardNameToId[card.name.toLowerCase()] = parseInt(id, 10);
}

export function getCardIdByName(name) {
  const id = cardNameToId[name.toLowerCase()];
  if (id === undefined) {
    throw new Error(`Card not found in cards.json: "${name}"`);
  }
  return id;
}

export function advanceToRound(game, round) {
  const firstPlayer = game.currentTurn;
  const secondPlayer = firstPlayer === "Alice" ? "Bob" : "Alice";
  let safety = 0;
  while (game.round < round) {
    if (++safety > 1000) throw new Error("advanceToRound safety limit hit");
    game.processAction({ type: "pass-turn-action", data: { source: "player", username: firstPlayer } });
    game.processAction({ type: "pass-turn-action", data: { source: "player", username: secondPlayer } });
  }
  expect(game.round).toBe(round);
}

export function expectShinsuState(playerState, normalSpent, normalAvailable, recharged) {
  expect(playerState.shinsu.normalSpent).toBe(normalSpent);
  expect(playerState.shinsu.normalAvailable).toBe(normalAvailable);
  expect(playerState.shinsu.recharged).toBe(recharged);
}

// Helper to create a game with specific cards in hand
// Accepts card names (strings) for readability
export function setupGameWithCardsInHand(cardsInHand) {
  // Convert names to card IDs if strings are provided
  const cardIds = cardsInHand.map((c) =>
    typeof c === "string" ? getCardIdByName(c) : c
  );

  const deckCards = Array(26).fill(0);
  const fullDeck = [...deckCards, ...cardIds];
  const decks = {
    Alice: fullDeck,
    Bob: Array(30).fill(0),
  };

  const newGame = new GameState(ROOM_CODE, USERNAMES, decks, USERNAMES[0]);
  return newGame;
}
