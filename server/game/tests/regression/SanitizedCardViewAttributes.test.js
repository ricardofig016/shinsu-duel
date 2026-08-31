/**
 * Regression: the sanitized card view must carry the card's attribute codes.
 *
 * Bug: `Card.toSanitizedObject()` omitted `attributes`, so no client could
 * tell which field units carry `hwayeomsa`; the generate-fire-charge core
 * mechanic was unreachable from the browser because nothing revealed the
 * qualifying units.
 */

import GameState from "../../GameState.js";
import SeededRng from "../../utils/SeededRng.js";
import { createLegalDeck, cards, deployUnit, getCardIdByName } from "../utils.js";

const players = ["Alice", "Bob"];

function createGame() {
  return new GameState("TEST", players, {
    Alice: createLegalDeck([getCardIdByName("Test Hwayeomsa")]),
    Bob: createLegalDeck(),
  }, null, { rng: new SeededRng(1), cards });
}

test("the sanitized card view carries a copy of the attribute codes", () => {
  const game = createGame();
  const unit = deployUnit(game, "Alice", "Test Hwayeomsa", "fisherman");

  const view = unit.card.toSanitizedObject();
  expect(view.attributes).toEqual(["hwayeomsa"]);

  view.attributes.push("anima");
  expect(unit.card.attributes).toEqual(["hwayeomsa"]);
});

test("both seat projections expose the attributes of field units", () => {
  const game = createGame();
  const unit = deployUnit(game, "Alice", "Test Hwayeomsa", "fisherman");

  for (const username of players) {
    const state = game.getClientState(username);
    const own = username === "Alice" ? state.you : state.opponent;
    const deployed = [...own.field.frontline, ...own.field.backline].find(
      (candidate) => candidate.id === unit.id
    );
    expect(deployed).toBeDefined();
    expect(deployed.card.attributes).toEqual(["hwayeomsa"]);
  }
});
