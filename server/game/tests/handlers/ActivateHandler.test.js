import { jest } from "@jest/globals";
import ActivateHandler from "../../handlers/ActivateHandler.js";
import EVT from "../../EventCatalog.js";

function makeUnit(id, { owner = "Bob", alive = true } = {}) {
  return { id, owner, isAlive: () => alive };
}

describe("ActivateHandler", () => {
  let handler, gameState, emitChild;

  beforeEach(() => {
    handler = new ActivateHandler();
    emitChild = jest.fn();
    gameState = { _findUnit: jest.fn(() => null) };
  });

  test("emits one ACTIVATION for a live target with amount defaulting to 1", () => {
    const unit = makeUnit("Unit#conduit");
    gameState._findUnit.mockImplementation((id) => (id === unit.id ? unit : null));

    const result = handler.execute({ targetId: unit.id }, { emitChild }, gameState);

    expect(result).toEqual({ activated: true, amount: 1 });
    expect(emitChild).toHaveBeenCalledTimes(1);
    expect(emitChild).toHaveBeenCalledWith(EVT.ACTIVATION, {
      unitId: unit.id,
      unit,
      username: unit.owner,
    });
  });

  test("amount 2 emits ACTIVATION twice for the same target", () => {
    const unit = makeUnit("Unit#conduit");
    gameState._findUnit.mockImplementation((id) => (id === unit.id ? unit : null));

    const result = handler.execute({ targetId: unit.id, amount: 2 }, { emitChild }, gameState);

    expect(result).toEqual({ activated: true, amount: 2 });
    expect(emitChild).toHaveBeenCalledTimes(2);
    expect(emitChild).toHaveBeenNthCalledWith(1, EVT.ACTIVATION, {
      unitId: unit.id,
      unit,
      username: unit.owner,
    });
    expect(emitChild).toHaveBeenNthCalledWith(2, EVT.ACTIVATION, {
      unitId: unit.id,
      unit,
      username: unit.owner,
    });
  });

  test("a target that is not on the field returns activated false and emits nothing", () => {
    gameState._findUnit.mockImplementation(() => null);

    const result = handler.execute({ targetId: "Unit#missing" }, { emitChild }, gameState);

    expect(result).toEqual({ activated: false });
    expect(emitChild).not.toHaveBeenCalled();
  });

  test("a dead target returns activated false and emits nothing", () => {
    const dead = makeUnit("Unit#dead", { alive: false });
    gameState._findUnit.mockImplementation((id) => (id === dead.id ? dead : null));

    const result = handler.execute({ targetId: dead.id }, { emitChild }, gameState);

    expect(result).toEqual({ activated: false });
    expect(emitChild).not.toHaveBeenCalled();
  });

  test("targetIds activates each target once per amount", () => {
    const a = makeUnit("Unit#a");
    const b = makeUnit("Unit#b", { owner: "Alice" });
    gameState._findUnit.mockImplementation((id) => (id === a.id ? a : id === b.id ? b : null));

    const result = handler.execute({ targetIds: [a.id, b.id], amount: 2 }, { emitChild }, gameState);

    expect(result).toEqual({ activated: true, activatedCount: 2, amount: 2 });
    expect(emitChild).toHaveBeenCalledTimes(4);
    expect(emitChild).toHaveBeenNthCalledWith(1, EVT.ACTIVATION, { unitId: a.id, unit: a, username: a.owner });
    expect(emitChild).toHaveBeenNthCalledWith(4, EVT.ACTIVATION, { unitId: b.id, unit: b, username: b.owner });
  });

  test("targetIds counts only live targets in the result", () => {
    const alive = makeUnit("Unit#alive");
    const dead = makeUnit("Unit#dead", { alive: false });
    gameState._findUnit.mockImplementation((id) => (id === alive.id ? alive : id === dead.id ? dead : null));

    const result = handler.execute({ targetIds: [alive.id, dead.id] }, { emitChild }, gameState);

    expect(result).toEqual({ activated: true, activatedCount: 1, amount: 1 });
    expect(emitChild).toHaveBeenCalledTimes(1);
  });

  test("validate requires a target id or a non-empty targetIds array", () => {
    expect(() => handler.validate({})).toThrow("targetId");
    expect(() => handler.validate({ targetIds: [] })).toThrow("targetIds");
    expect(() => handler.validate({ targetIds: [null] })).toThrow("targetIds[0]");
    expect(() => handler.validate({ targetId: "Unit#1" })).not.toThrow();
    expect(() => handler.validate({ targetIds: ["Unit#1", "Unit#2"] })).not.toThrow();
  });

  test("validate requires a positive integer amount when present", () => {
    expect(() => handler.validate({ targetId: "Unit#1", amount: 0 })).toThrow("amount");
    expect(() => handler.validate({ targetId: "Unit#1", amount: -1 })).toThrow("amount");
    expect(() => handler.validate({ targetId: "Unit#1", amount: 1.5 })).toThrow("amount");
    expect(() => handler.validate({ targetId: "Unit#1", amount: 4 })).not.toThrow();
  });
});
