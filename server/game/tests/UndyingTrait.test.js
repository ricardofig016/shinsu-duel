import EVT from "../EventCatalog.js";
import DealDamageHandler from "../handlers/DealDamageHandler.js";
import { setupGameWithCardsInHand, advanceToRound } from "./utils.js";

function swing(game, targetId) {
  const ctx = { emitChild: (name, payload) => game.eventBus.emit(name, payload) };
  return new DealDamageHandler().execute({ sourceId: "test", targetId, amount: 200 }, ctx, game);
}

describe("Undying trait", () => {
  test("Undying absorbed by Barrier first, second hit saves at 1 HP", () => {
    const game = setupGameWithCardsInHand(["_Test Unit"]);
    advanceToRound(game, 2);
    game.processAction({ type: "deploy-unit-action", data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "scout" } });
    game.processAction({ type: "pass-turn-action", data: { source: "player", username: "Bob" } });
    const unit = game.playerStates.Alice.field.frontline[0];

    swing(game, unit.id); // Barrier absorbs
    expect(unit.currentHp).toBe(100);

    const r2 = swing(game, unit.id); // Undying saves
    expect(r2.killed).toBe(false);
    expect(r2.undyingSaved).toBe(true);
    expect(unit.currentHp).toBe(1);
    expect(game.modifierStack.has(unit.id, "trait", "undying")).toBe(false);

    const r3 = swing(game, unit.id); // Kills
    expect(r3.killed).toBe(true);
  });

  test("no-undying unit dies normally", () => {
    const game = setupGameWithCardsInHand(["Hong Chunhwa"]);
    advanceToRound(game, 3);
    game.processAction({ type: "deploy-unit-action", data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "fisherman" } });
    game.processAction({ type: "pass-turn-action", data: { source: "player", username: "Bob" } });
    const unit = game.playerStates.Alice.field.frontline[0];
    expect(swing(game, unit.id).killed).toBe(true);
  });

  test("undying:saved event fires", () => {
    const game = setupGameWithCardsInHand(["_Test Unit"]);
    advanceToRound(game, 2);
    game.processAction({ type: "deploy-unit-action", data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "fisherman" } });
    game.processAction({ type: "pass-turn-action", data: { source: "player", username: "Bob" } });
    const unit = game.playerStates.Alice.field.frontline[0];

    let e = null;
    game.eventBus.on(EVT.UNIT_UNDYING_TRIGGERED, (p) => { e = p; }, { phase: "post" });
    swing(game, unit.id); // Barrier
    swing(game, unit.id); // Undying
    expect(e).not.toBeNull();
    expect(e.unitId).toBe(unit.id);
  });

  test("killed event does NOT fire on undying save", () => {
    const game = setupGameWithCardsInHand(["_Test Unit"]);
    advanceToRound(game, 2);
    game.processAction({ type: "deploy-unit-action", data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "fisherman" } });
    game.processAction({ type: "pass-turn-action", data: { source: "player", username: "Bob" } });
    const unit = game.playerStates.Alice.field.frontline[0];

    let killed = false;
    game.eventBus.on(EVT.UNIT_KILLED, () => { killed = true; }, { phase: "post" });
    swing(game, unit.id); // Barrier
    swing(game, unit.id); // Undying
    expect(killed).toBe(false);
    expect(unit.currentHp).toBe(1);
  });

  test("granted undying consumed", () => {
    const game = setupGameWithCardsInHand(["Monkeyman"]);
    advanceToRound(game, 3);
    game.processAction({ type: "deploy-unit-action", data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "fisherman" } });
    game.processAction({ type: "pass-turn-action", data: { source: "player", username: "Bob" } });
    const unit = game.playerStates.Alice.field.frontline[0];
    game.modifierStack.apply({ sourceId: "s", sourceType: "equipment", targetId: unit.id, type: "trait", key: "undying", value: 1 });
    expect(game.modifierStack.has(unit.id, "trait", "undying")).toBe(true);
    const r = swing(game, unit.id);
    expect(r.killed).toBe(false);
    expect(unit.currentHp).toBe(1);
    expect(game.modifierStack.has(unit.id, "trait", "undying")).toBe(false);
  });
});
