import EVT from "../../../EventCatalog.js";
import { createTestGame, debugAction, getCardIdByName } from "../../utils.js";

const spawn = (game, data) => game.processAction(debugAction("debug-spawn-unit-action", data));
const scout = () => getCardIdByName("Test Scout");

const fieldUnits = (game, username) => [
  ...game.playerStates[username].field.frontline,
  ...game.playerStates[username].field.backline,
];

describe("DebugSpawnUnitAction", () => {
  test("puts a unit on the target seat's field for free", () => {
    const game = createTestGame();
    const summon = [];
    game.eventBus.on(EVT.UNIT_SUMMONED, (payload) => summon.push(payload), { phase: "post" });
    const shinsuBefore = { ...game.playerStates.Bob.shinsu };

    spawn(game, { username: "Bob", cardId: scout(), positionCode: "scout" });

    const [unit] = fieldUnits(game, "Bob");
    expect(unit.card.name).toBe("Test Scout");
    expect(unit.owner).toBe("Bob");
    expect(unit.placedPositionCode).toBe("scout");
    expect(unit.line).toBe("frontline");
    expect(game.playerStates.Bob.shinsu).toEqual(shinsuBefore);
    expect(game.playerStates.Bob.combatSlots.scout.available).toBe(true);
    expect(game.currentTurn).toBe("Alice");
    expect(summon).toHaveLength(1);
    expect(game._findUnit(unit.id)).toBe(unit);
  });

  test("resolves the line from the position code", () => {
    const game = createTestGame();

    spawn(game, { username: "Alice", cardId: scout(), positionCode: "fisherman" });

    expect(game.playerStates.Alice.field.frontline).toHaveLength(1);
    expect(game.playerStates.Alice.field.backline).toHaveLength(0);
  });

  test("discards a same-name duplicate instead of deploying it", () => {
    const game = createTestGame();

    spawn(game, { username: "Alice", cardId: scout(), positionCode: "scout" });
    spawn(game, { username: "Alice", cardId: scout(), positionCode: "scout" });

    expect(fieldUnits(game, "Alice")).toHaveLength(1);
    expect(game.playerStates.Alice.discard.map((card) => card.name)).toEqual(["Test Scout"]);
  });

  test("rejects a non-unit card, an unknown card, an invalid position, and a player source", () => {
    const game = createTestGame();
    const skill = getCardIdByName("Test Damage Skill");

    expect(() => spawn(game, { username: "Alice", cardId: skill, positionCode: "scout" })).toThrow(
      "is not a unit."
    );
    expect(() => spawn(game, { username: "Alice", cardId: 999999, positionCode: "scout" })).toThrow(
      "Card 999999 does not exist."
    );
    expect(() => spawn(game, { username: "Alice", cardId: scout(), positionCode: "not-a-position" })).toThrow(
      "Invalid position: not-a-position"
    );
    expect(() =>
      game.processAction({
        type: "debug-spawn-unit-action",
        data: {
          source: "player",
          requestedBy: "Bob",
          username: "Alice",
          cardId: scout(),
          positionCode: "scout",
        },
      })
    ).toThrow("Source player is not allowed to perform this action.");
  });

  test("a full line defers to the line-overflow decision", () => {
    const game = createTestGame();
    const fillers = Array.from({ length: 5 }, (_, index) => getCardIdByName(`Test Filler ${index + 1}`));

    for (const cardId of fillers) {
      game.processAction(debugAction("debug-spawn-unit-action", {
        username: "Alice",
        cardId,
        positionCode: "fisherman",
      }));
    }
    expect(game.playerStates.Alice.field.frontline).toHaveLength(5);

    spawn(game, { username: "Alice", cardId: scout(), positionCode: "scout" });

    expect(game.pendingDecision.type).toBe("line_overflow");
    expect(game.hasUnresolvedDecisions()).toBe(true);
    expect(game.playerStates.Alice.field.frontline).toHaveLength(5);
  });
});
