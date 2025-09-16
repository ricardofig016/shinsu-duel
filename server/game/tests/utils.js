import GameState from "../GameState.js";

const ROOM_CODE = "TEST";
const USERNAMES = ["Alice", "Bob"];

export function advanceToRound(game, round) {
  const firstPlayer = game.currentTurn;
  const secondPlayer = firstPlayer === "Alice" ? "Bob" : "Alice";
  let safety = 0;
  while (game.round < round) {
    if (++safety > 1000) throw new Error("advanceToRound safety limit hit");
    game.processAction({ type: "pass-turn-action", data: { source: "player", username: firstPlayer } });
    game.processAction({ type: "pass-turn-action", data: { source: "player", username: secondPlayer } });
  }
}

export function expectShinsuState(playerState, normalSpent, normalAvailable, recharged) {
  expect(playerState.shinsu.normalSpent).toBe(normalSpent);
  expect(playerState.shinsu.normalAvailable).toBe(normalAvailable);
  expect(playerState.shinsu.recharged).toBe(recharged);
}

// Helper to create a game with specific cards in hand
export function setupGameWithCardsInHand(cardsInHand) {
  // Create decks with specific cards at the end for drawing into hand
  const deckCards = Array(26).fill(0);
  const fullDeck = [...deckCards, ...cardsInHand];
  const decks = {
    Alice: fullDeck,
    Bob: Array(30).fill(0),
  };

  const newGame = new GameState(ROOM_CODE, USERNAMES, decks, USERNAMES[0]);
  return newGame;
}
