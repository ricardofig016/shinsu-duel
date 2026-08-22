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
    const game = setupGameWithHands({ Alice: ["Lo Po Bia Ren"], Bob: ["Bull"] });
    const ren = deployUnit(game, "Alice", "Lo Po Bia Ren", "wave-controller");
    deployUnit(game, "Bob", "Bull", "frontline-shinheuh");

    useAbility(game, "Alice", ren.id, "1");

    const aliceUnits = [
      ...game.playerStates.Alice.field.frontline,
      ...game.playerStates.Alice.field.backline,
    ];
    expect(aliceUnits.some((u) => u.card.name === "Bull")).toBe(true);
  });

  test("Lo Po Bia Ren's summon resolves as a no-op when no 2-cost Shinheuh exists", () => {
    const game = setupGameWithHands({ Alice: ["Lo Po Bia Ren"] });
    const ren = deployUnit(game, "Alice", "Lo Po Bia Ren", "wave-controller");

    expect(() => useAbility(game, "Alice", ren.id, "0")).not.toThrow();

    const aliceUnits = [
      ...game.playerStates.Alice.field.frontline,
      ...game.playerStates.Alice.field.backline,
    ];
    expect(aliceUnits.map((u) => u.card.name)).toEqual(["Lo Po Bia Ren"]);
  });

  test("Jyu Viole Grace copies an enemy ability", () => {
    const game = setupGameWithHands({ Alice: ["Jyu Viole Grace"], Bob: ["Bull"] });
    const grace = deployUnit(game, "Alice", "Jyu Viole Grace", "wave-controller");
    const bull = deployUnit(game, "Bob", "Bull", "frontline-shinheuh");

    useAbility(game, "Alice", grace.id, "1");

    // The copied "deal 3 to an enemy" targets Bob's Bull, killing it.
    expect(game._findUnit(bull.id)).toBeNull();
  });

  test("Monkeyman's peek ability reveals a card from the opponent's hand", () => {
    const game = setupGameWithHands({ Alice: ["Monkeyman"], Bob: ["Bull", "Bull"] });
    const monkeyman = deployUnit(game, "Alice", "Monkeyman", "scout");
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
    const game = setupGameWithHands({ Alice: ["Evan Edrok"], Bob: ["Khun Ran - Evolved"] });
    const evan = deployUnit(game, "Alice", "Evan Edrok", "scout");
    const khunRan = deployUnit(game, "Bob", "Khun Ran - Evolved", "fisherman");

    useAbility(game, "Alice", evan.id, "1");

    expect(khunRan.placedPositionCode).toBe("spear-bearer");
  });
});
