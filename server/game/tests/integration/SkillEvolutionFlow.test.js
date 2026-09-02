import LifecycleEngine from "../../services/LifecycleEngine.js";
import Card from "../../Card.js";
import { setupGameWithHands, deployUnit, getCardIdByName, cards } from "../utils.js";

// deckWith dedupes names, so extra skill copies are pushed into the hand
// directly to fuel repeated plays.
function addSkillCopies(game, username, cardName, count) {
  const data = cards[getCardIdByName(cardName)];
  for (let i = 0; i < count; i++) {
    game.playerStates[username].hand.push(new Card(data.cardId, data, username, game.eventBus));
  }
}

function playSkillFromHand(game, username, cardName) {
  game.currentTurn = username;
  game.round = 15;
  game.playerStates[username].shinsu = { normalSpent: 0, normalAvailable: 15, recharged: 0 };
  const handId = game.playerStates[username].hand.findIndex((c) => c.name === cardName);
  if (handId < 0) throw new Error(`Card "${cardName}" not in ${username}'s hand`);
  game.processAction({ type: "play-skill-action", data: { source: "player", username, handId } });
}

function playSkills(game, username, cardName, times) {
  for (let i = 0; i < times; i++) playSkillFromHand(game, username, cardName);
}

const bloodthirstyOf = (game, unit) =>
  game.modifierStack.getEffective(unit.id, "trait", "bloodthirsty");

describe("skills-played evolution flow", () => {
  test("the unit evolves when its owner has played the authored number of skills", () => {
    const game = setupGameWithHands({
      Alice: ["Test Skill Evo Unit"],
      Bob: [],
    });
    const unit = deployUnit(game, "Alice", "Test Skill Evo Unit", "fisherman");
    addSkillCopies(game, "Alice", "Test Heal", 6);

    playSkills(game, "Alice", "Test Heal", 2);
    expect(unit.card.name).toBe("Test Skill Evo Unit");
    expect(game.getSkillsPlayedThisGame("Alice")).toBe(2);

    playSkillFromHand(game, "Alice", "Test Heal");
    expect(unit.card.name).toBe("Test Skill Evo Unit II");
    expect(unit.currentHp).toBe(unit.card.maxHp);
    expect(game.getSkillsPlayedThisGame("Alice")).toBe(3);
  });

  test("the other player's skills do not count", () => {
    const game = setupGameWithHands({
      Alice: ["Test Skill Evo Unit"],
      Bob: [],
    });
    const unit = deployUnit(game, "Alice", "Test Skill Evo Unit", "fisherman");
    addSkillCopies(game, "Bob", "Test Damage Skill", 3);

    playSkills(game, "Bob", "Test Damage Skill", 3);
    expect(unit.card.name).toBe("Test Skill Evo Unit");
    expect(game.getSkillsPlayedThisGame("Bob")).toBe(3);
    expect(game.getSkillsPlayedThisGame("Alice")).toBe(0);
  });

  test("skills played before the unit was deployed count toward the trigger", () => {
    const game = setupGameWithHands({
      Alice: ["Test Skill Evo Unit"],
      Bob: [],
    });
    addSkillCopies(game, "Alice", "Test Heal", 6);

    playSkills(game, "Alice", "Test Heal", 2);
    const unit = deployUnit(game, "Alice", "Test Skill Evo Unit", "fisherman");
    expect(unit.card.name).toBe("Test Skill Evo Unit");

    playSkillFromHand(game, "Alice", "Test Heal");
    expect(unit.card.name).toBe("Test Skill Evo Unit II");
  });

  test("the counter is cumulative across stages and on-evolve Bloodthirsty stacks", () => {
    const game = setupGameWithHands({
      Alice: ["Test Skill Evo Unit"],
      Bob: [],
    });
    const unit = deployUnit(game, "Alice", "Test Skill Evo Unit", "fisherman");
    addSkillCopies(game, "Alice", "Test Heal", 6);

    playSkills(game, "Alice", "Test Heal", 3);
    expect(unit.card.name).toBe("Test Skill Evo Unit II");
    expect(bloodthirstyOf(game, unit)).toBe(1);

    playSkills(game, "Alice", "Test Heal", 2);
    expect(unit.card.name).toBe("Test Skill Evo Unit II");

    playSkillFromHand(game, "Alice", "Test Heal");
    expect(unit.card.name).toBe("Test Skill Evo Unit III");
    expect(bloodthirstyOf(game, unit)).toBe(2);
    expect(unit.currentHp).toBe(unit.card.maxHp);
  });

  test("the Bloodthirsty accumulated through evolution restores HP on a kill", () => {
    const game = setupGameWithHands({
      Alice: ["Test Skill Evo Unit"],
      Bob: ["Test Filler 1"],
    });
    const unit = deployUnit(game, "Alice", "Test Skill Evo Unit", "fisherman");
    addSkillCopies(game, "Alice", "Test Heal", 3);
    playSkills(game, "Alice", "Test Heal", 3);
    expect(unit.card.name).toBe("Test Skill Evo Unit II");

    const filler = deployUnit(game, "Bob", "Test Filler 1", "fisherman");
    unit.currentHp = 1;
    LifecycleEngine.killUnit(game, filler, { sourceId: unit.id, sourceOwner: "Alice" });

    expect(unit.currentHp).toBe(2);
  });
});
