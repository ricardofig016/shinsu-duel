/**
 * Regression: the sanitized card view must carry the card's attribute
 * details.
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

test("the sanitized card view carries the stamped attribute details", () => {
  const game = createGame();
  const unit = deployUnit(game, "Alice", "Test Hwayeomsa", "fisherman");

  const view = unit.card.toSanitizedObject();
  expect(Object.keys(view.attributes)).toEqual(["hwayeomsa"]);
  expect(view.attributes.hwayeomsa.iconPath).toBe("/assets/icons/attributes/hwayeomsa.png");
  expect(view.attributes.hwayeomsa.name).toBeTruthy();

  view.attributes.hwayeomsa.name = "mutated";
  expect(unit.card.toSanitizedObject().attributes.hwayeomsa.name).not.toBe("mutated");
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
    expect(Object.keys(deployed.card.attributes)).toEqual(["hwayeomsa"]);
  }
});
