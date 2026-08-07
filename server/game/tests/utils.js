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

export function createLegalDeck(preferredCardIds = []) {
  const eligible = Object.values(cardsData)
    .filter((card) => !(card.deckConstraints || []).some((constraint) => constraint.type === "unreachable"))
    .map((card) => card.cardId);
  const preferred = [...new Set(preferredCardIds)];
  const fillers = eligible.filter((id) => !preferred.includes(id));
  return [...fillers.slice(0, 30 - preferred.length), ...preferred];
}

// Helper to create a game with specific cards in hand.
// Deck construction remains legal even when tests request repeated display cards.
export function setupGameWithCardsInHand(cardsInHand) {
  const cardIds = cardsInHand.map((c) => typeof c === "string" ? getCardIdByName(c) : c);
  const preferred = [...new Set(cardIds)];
  const base = createLegalDeck(preferred);
  const requestedInDrawOrder = [...preferred].reverse();
  const remaining = base.filter((id) => !preferred.includes(id));
  const decks = {
    Alice: [...remaining, ...requestedInDrawOrder],
    Bob: createLegalDeck(),
  };
  return new GameState(ROOM_CODE, USERNAMES, decks, USERNAMES[0]);
}

// Helper to create a basic test game
export function createTestGame() {
  return new GameState(ROOM_CODE, USERNAMES, { Alice: createLegalDeck(), Bob: createLegalDeck() }, USERNAMES[0]);
}
