import EVT from "../../EventCatalog.js";
import { setupGameWithHands, deployUnit } from "../utils.js";

/**
 * Card-level integration: effect primitives exercised through their real
 * cards and the authoritative `use-ability-action` path (rather than calling
 * handlers directly).
 */

function useAbility(game, username, unitId, abilityCode) {
  game.currentTurn = username;
  game.processAction({
    type: "use-ability-action",
    data: { source: "player", username, unitId, abilityCode },
  });
}

describe("effect primitives via real cards", () => {
  test("Lo Po Bia Ren steals the enemy's cheapest Shinheuh", () => {
    const game = setupGameWithHands({ Alice: ["Test Anima Unit"], Bob: ["Test Shinheuh"] });
    const ren = deployUnit(game, "Alice", "Test Anima Unit", "wave-controller");
    deployUnit(game, "Bob", "Test Shinheuh", "frontline");

    useAbility(game, "Alice", ren.id, "1");

    const aliceUnits = [
      ...game.playerStates.Alice.field.frontline,
      ...game.playerStates.Alice.field.backline,
    ];
    expect(aliceUnits.some((u) => u.card.name === "Test Shinheuh")).toBe(true);
  });

  test("Lo Po Bia Ren's summon resolves as a no-op when no 2-cost Shinheuh exists", () => {
    const game = setupGameWithHands({ Alice: ["Test Anima Unit"] });
    const ren = deployUnit(game, "Alice", "Test Anima Unit", "wave-controller");

    expect(() => useAbility(game, "Alice", ren.id, "0")).not.toThrow();

    const aliceUnits = [
      ...game.playerStates.Alice.field.frontline,
      ...game.playerStates.Alice.field.backline,
    ];
    expect(aliceUnits.map((u) => u.card.name)).toEqual(["Test Anima Unit"]);
  });

  test("Jyu Viole Grace copies an enemy ability", () => {
    const game = setupGameWithHands({ Alice: ["Test Copy Ability Unit"], Bob: ["Test Shinheuh"] });
    const grace = deployUnit(game, "Alice", "Test Copy Ability Unit", "wave-controller");
    const bull = deployUnit(game, "Bob", "Test Shinheuh", "frontline");

    useAbility(game, "Alice", grace.id, "1");

    // The copied "deal 3 to an enemy" targets Bob's Bull, killing it.
    expect(game._findUnit(bull.id)).toBeNull();
  });

  test("Monkeyman's peek ability reveals a card from the opponent's hand", () => {
    const game = setupGameWithHands({ Alice: ["Test Scout"], Bob: ["Test Shinheuh", "Test Shinheuh"] });
    const monkeyman = deployUnit(game, "Alice", "Test Scout", "scout");
    const handSize = game.playerStates.Bob.hand.length;
    const peeked = [];
    game.eventBus.on(EVT.HAND_PEEKED, (p) => peeked.push(p), { phase: "post" });

    useAbility(game, "Alice", monkeyman.id, "0");

    expect(peeked).toHaveLength(1);
    expect(peeked[0].owner).toBe("Bob");
    expect(peeked[0].observer).toBe("Alice");
    expect(game.playerStates.Bob.hand).toHaveLength(handSize);
  });

  test("Evan Edrok forces an enemy to switch position", () => {
    const game = setupGameWithHands({ Alice: ["Test Switch Position Unit"], Bob: ["Test Multi Position - Evolved"] });
    const evan = deployUnit(game, "Alice", "Test Switch Position Unit", "scout");
    const khunRan = deployUnit(game, "Bob", "Test Multi Position - Evolved", "fisherman");

    useAbility(game, "Alice", evan.id, "1");

    expect(khunRan.placedPositionCode).toBe("spear-bearer");
  });
});
