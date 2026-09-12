import { debugAction, deployUnit, getCardIdByName, setupGameWithHands } from "../../utils.js";

const setUnitHp = (game, data) => game.processAction(debugAction("debug-unit-hp-action", data));

const scoutGame = () => setupGameWithHands({ Alice: ["Test Scout"], Bob: ["Test Scout"] });
const deployedScout = (game, username = "Alice") => deployUnit(game, username, "Test Scout", "scout");

describe("DebugUnitHpAction", () => {
  test("sets a deployed unit's HP, for either seat", () => {
    const game = scoutGame();
    const scout = deployedScout(game);

    setUnitHp(game, { unitId: scout.id, value: 1 });

    expect(scout.currentHp).toBe(1);
    expect(game.playerStates.Alice.field.frontline[0].currentHp).toBe(1);
  });

  test("raises HP above the printed maximum without touching maxHp", () => {
    const game = scoutGame();
    const scout = deployedScout(game);

    setUnitHp(game, { unitId: scout.id, value: 9 });

    expect(scout.currentHp).toBe(9);
    expect(scout.card.maxHp).toBe(2);
  });

  test("rejects an unknown unit, a negative value, and a player source", () => {
    const game = scoutGame();
    const scout = deployedScout(game);

    expect(() => setUnitHp(game, { unitId: "unit-missing", value: 1 })).toThrow(
      "Unit unit-missing is not on the field."
    );
    expect(() => setUnitHp(game, { unitId: scout.id, value: -1 })).toThrow("value must be an integer");
    expect(() =>
      game.processAction({
        type: "debug-unit-hp-action",
        data: { source: "player", requestedBy: "Bob", unitId: scout.id, value: 1 },
      })
    ).toThrow("Source player is not allowed to perform this action.");
  });

  test("a unit deployed from hand keeps its id after the HP write", () => {
    const game = scoutGame();
    const scout = deployedScout(game, "Bob");

    setUnitHp(game, { unitId: scout.id, value: 1 });

    expect(game._findUnit(scout.id)).toBe(scout);
    expect(getCardIdByName("Test Scout")).toBe(scout.card.cardId);
  });
});
