import { setupGameWithHands, deployUnit } from "../utils.js";
import EVT from "../../EventCatalog.js";

/**
 * The `silenced` trigger: "when you silence an enemy, give me its traits".
 *
 * The trigger carries two side descriptors — `target` (who was silenced) and
 * `source` (whose action caused it), both relative to the passive owner — and
 * the silenced unit is threaded into the effect as the copy source.
 */

function playSkillFromHand(game, username, cardName) {
  game.currentTurn = username;
  game.round = 15;
  game.playerStates[username].shinsu = { normalSpent: 0, normalAvailable: 15, recharged: 0 };
  const handId = game.playerStates[username].hand.findIndex((c) => c.name === cardName);
  game.processAction({ type: "play-skill-action", data: { source: "player", username, handId } });
}

function silencedEvent(targetId, sourceOwner) {
  const payload = { targetId, removed: [{ trait: "strong", sourceId: targetId }] };
  if (sourceOwner !== undefined) payload.sourceOwner = sourceOwner;
  return payload;
}

describe("silenced trigger (PassiveManager)", () => {
  test("an own-side silence of an enemy copies its traits with values, stacking on native ones", () => {
    const game = setupGameWithHands({ Alice: ["Test Trait Thief", "Test Silence Skill"], Bob: ["Test Trait Unit"] });
    const thief = deployUnit(game, "Alice", "Test Trait Thief", "fisherman");
    deployUnit(game, "Bob", "Test Trait Unit", "fisherman");

    // Native strong 2 only, before the silence.
    expect(game.modifierStack.getEffective(thief.id, "trait", "strong")).toBe(2);

    playSkillFromHand(game, "Alice", "Test Silence Skill");

    // strong 10 copied onto the native strong 2; non-numeric traits copied too.
    expect(game.modifierStack.getEffective(thief.id, "trait", "strong")).toBe(12);
    expect(game.modifierStack.has(thief.id, "trait", "taunt")).toBe(true);
    expect(game.modifierStack.has(thief.id, "trait", "pierce")).toBe(true);
  });

  test("a mass silence copies every silenced enemy", () => {
    const game = setupGameWithHands({
      Alice: ["Test Trait Thief", "Test Mass Silence Skill"],
      Bob: ["Test Trait Unit", "Test Trait Dummy"],
    });
    const thief = deployUnit(game, "Alice", "Test Trait Thief", "fisherman");
    deployUnit(game, "Bob", "Test Trait Unit", "fisherman");
    deployUnit(game, "Bob", "Test Trait Dummy", "fisherman");

    playSkillFromHand(game, "Alice", "Test Mass Silence Skill");

    // strong 2 native + strong 10 from the Trait Unit; pierce 10 (Trait Unit)
    // + pierce 3 (Trait Dummy); taunt from the Trait Dummy.
    expect(game.modifierStack.getEffective(thief.id, "trait", "strong")).toBe(12);
    expect(game.modifierStack.getEffective(thief.id, "trait", "pierce")).toBe(13);
    expect(game.modifierStack.has(thief.id, "trait", "taunt")).toBe(true);
  });

  test("an opponent-caused silence does not feed the thief", () => {
    const game = setupGameWithHands({ Alice: ["Test Trait Thief"], Bob: ["Test Trait Unit"] });
    const thief = deployUnit(game, "Alice", "Test Trait Thief", "fisherman");
    const enemy = deployUnit(game, "Bob", "Test Trait Unit", "fisherman");

    // Bob silences his own unit: the target side matches but the cause is
    // not Alice's.
    game.eventBus.emit(EVT.UNIT_SILENCED, silencedEvent(enemy.id, "Bob"));

    expect(game.modifierStack.getEffective(thief.id, "trait", "strong")).toBe(2);
  });

  test("an unattributed silence does not feed the thief", () => {
    const game = setupGameWithHands({ Alice: ["Test Trait Thief"], Bob: ["Test Trait Unit"] });
    const thief = deployUnit(game, "Alice", "Test Trait Thief", "fisherman");
    const enemy = deployUnit(game, "Bob", "Test Trait Unit", "fisherman");

    game.eventBus.emit(EVT.UNIT_SILENCED, silencedEvent(enemy.id));

    expect(game.modifierStack.getEffective(thief.id, "trait", "strong")).toBe(2);
  });

  test("a silence of an own-side unit does not feed the thief", () => {
    const game = setupGameWithHands({ Alice: ["Test Trait Thief"], Bob: ["Test Trait Unit"] });
    const thief = deployUnit(game, "Alice", "Test Trait Thief", "fisherman");
    deployUnit(game, "Bob", "Test Trait Unit", "fisherman");

    // Alice's side silencing Alice's own unit: the silenced unit is not an
    // enemy, so the target descriptor fails.
    game.eventBus.emit(EVT.UNIT_SILENCED, silencedEvent(thief.id, "Alice"));

    expect(game.modifierStack.getEffective(thief.id, "trait", "strong")).toBe(2);
  });
});
