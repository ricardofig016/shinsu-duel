import { setupGameWithHands, deployUnit } from "../utils.js";
import StealHandler from "../../handlers/StealHandler.js";
import EVT from "../../EventCatalog.js";

const context = (game) => ({ emitChild: (eventName, payload) => game.eventBus.emit(eventName, payload) });

function onField(game, username) {
  return [...game.playerStates[username].field.frontline, ...game.playerStates[username].field.backline];
}

describe("StealHandler", () => {
  let handler;

  beforeEach(() => {
    handler = new StealHandler();
  });

  test("steals the enemy's cheapest Shinheuh onto the acting player's field", () => {
    const game = setupGameWithHands({ Bob: ["Bull"] });
    // Bob controls a Bull (cost 3) as a Shinheuh.
    const bull = deployUnit(game, "Bob", "Bull", "frontline-shinheuh");

    const result = handler.execute(
      { owner: "Alice", card: { position: ["frontline-shinheuh", "backline-shinheuh"], cost: "cheapest" }, sourceId: "Unit#Src" },
      context(game),
      game
    );

    expect(result.stolen).toBe(true);
    expect(onField(game, "Bob").some((u) => u.id === bull.id)).toBe(false);
    expect(onField(game, "Alice").some((u) => u.id === bull.id)).toBe(true);
    expect(bull.owner).toBe("Alice");
  });

  test("no-op when no enemy matches the descriptor", () => {
    const game = setupGameWithHands({ Bob: ["Bull"] });
    const result = handler.execute(
      { owner: "Alice", card: { position: ["frontline-shinheuh"], cost: 2 }, sourceId: "Unit#Src" },
      context(game),
      game
    );
    expect(result.stolen).toBe(false);
  });

  test("steal with choose defers to a target_selection decision", () => {
    const game = setupGameWithHands({ Bob: ["Bull", "Monkeyman"] });
    deployUnit(game, "Bob", "Bull", "frontline-shinheuh");
    deployUnit(game, "Bob", "Monkeyman", "fisherman");

    const result = handler.execute(
      { owner: "Alice", card: { choose: true }, sourceId: "Unit#Src" },
      context(game),
      game
    );

    expect(result).toEqual({ stolen: true, pending: true });
    expect(game.pendingDecision.type).toBe("target_selection");
  });

  test("steal with random deterministically picks one matching unit", () => {
    const run = () => {
      const game = setupGameWithHands({ Bob: ["Bull", "Monkeyman"] });
      deployUnit(game, "Bob", "Bull", "frontline-shinheuh");
      deployUnit(game, "Bob", "Monkeyman", "fisherman");
      const result = handler.execute(
        { owner: "Alice", card: { random: true }, sourceId: "Unit#Src" },
        context(game),
        game
      );
      return { stolen: result.stolen, names: onField(game, "Alice").map((u) => u.card.name) };
    };

    const first = run();
    const second = run();
    expect(first.stolen).toBe(true);
    expect(first.names).toEqual(second.names);
  });

  test("steal into a full line defers to a line_overflow decision", () => {
    const game = setupGameWithHands({ Bob: ["Bull"] });
    deployUnit(game, "Bob", "Bull", "frontline-shinheuh");
    game.playerStates.Alice.field.frontline = [
      { id: "A1", card: { name: "A", maxHp: 1 }, currentHp: 1 },
      { id: "A2", card: { name: "B", maxHp: 1 }, currentHp: 1 },
      { id: "A3", card: { name: "C", maxHp: 1 }, currentHp: 1 },
      { id: "A4", card: { name: "D", maxHp: 1 }, currentHp: 1 },
      { id: "A5", card: { name: "E", maxHp: 1 }, currentHp: 1 },
    ];

    const result = handler.execute(
      { owner: "Alice", card: { position: ["frontline-shinheuh"], cost: "cheapest" }, sourceId: "Unit#Src" },
      context(game),
      game
    );

    expect(result.pending).toBe(true);
    expect(game.pendingDecision.type).toBe("line_overflow");
  });

  test("emits UNIT_STOLEN when a unit is stolen", () => {
    const game = setupGameWithHands({ Bob: ["Bull"] });
    const bull = deployUnit(game, "Bob", "Bull", "frontline-shinheuh");
    const stolen = [];
    game.eventBus.on(EVT.UNIT_STOLEN, (p) => stolen.push(p), { phase: "post" });

    handler.execute(
      { owner: "Alice", card: { position: ["frontline-shinheuh"], cost: "cheapest" }, sourceId: "Unit#Src" },
      context(game),
      game
    );

    expect(stolen).toHaveLength(1);
    expect(stolen[0].unitId).toBe(bull.id);
  });

  test("validate throws without owner or card", () => {
    expect(() => handler.validate({})).toThrow("owner");
    expect(() => handler.validate({ owner: "Alice" })).toThrow("card");
  });
});
