import GameState from "../GameState.js";
import SeededRng from "../utils/SeededRng.js";
import { cards, byName } from "./fixtures/cards.js";

export { cards };

const ROOM_CODE = "TEST";
const USERNAMES = ["Alice", "Bob"];

// Test-owned fixture catalog; see fixtures/cards.js.
const TEST_OPTIONS = () => ({ rng: new SeededRng(1), cards });

export function getCardIdByName(name) {
  const id = byName[name.toLowerCase()];
  if (id === undefined) {
    throw new Error(`Card not found in fixture catalog: "${name}"`);
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
  const eligible = Object.values(cards)
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
  return new GameState(ROOM_CODE, USERNAMES, decks, USERNAMES[0], TEST_OPTIONS());
}

// Helper to create a basic test game
export function createTestGame() {
  return new GameState(ROOM_CODE, USERNAMES, { Alice: createLegalDeck(), Bob: createLegalDeck() }, USERNAMES[0], TEST_OPTIONS());
}

// Build a legal deck whose initial draw (top of deck) contains the requested
// card names, so both players can be seeded with specific cards in hand.
function deckWith(names) {
  const cardIds = (names || []).map((c) => (typeof c === "string" ? getCardIdByName(c) : c));
  const preferred = [...new Set(cardIds)];
  const base = createLegalDeck(preferred);
  const requestedInDrawOrder = [...preferred].reverse();
  const remaining = base.filter((id) => !preferred.includes(id));
  return [...remaining, ...requestedInDrawOrder];
}

// Helper to create a game with specific cards in each player's hand.
// `handsByPlayer` maps "Alice"/"Bob" to arrays of card names.
export function setupGameWithHands(handsByPlayer) {
  return new GameState(ROOM_CODE, USERNAMES, {
    Alice: deckWith(handsByPlayer.Alice || []),
    Bob: deckWith(handsByPlayer.Bob || []),
  }, USERNAMES[0], TEST_OPTIONS());
}

// Deploy a unit from a player's hand to the battlefield (by card name) and
// return the deployed unit. Grants enough shinsu for any cost.
export function deployUnit(game, username, cardName, positionCode) {
  game.currentTurn = username;
  game.round = 15;
  game.playerStates[username].shinsu = { normalSpent: 0, normalAvailable: 15, recharged: 0 };
  const handId = game.playerStates[username].hand.findIndex((c) => c.name === cardName);
  if (handId < 0) throw new Error(`Card "${cardName}" not found in ${username}'s hand`);
  game.processAction({ type: "deploy-unit-action", data: { source: "player", username, handId, placedPositionCode: positionCode } });
  return [...game.playerStates[username].field.frontline, ...game.playerStates[username].field.backline]
    .find((u) => u.card.name === cardName);
}
