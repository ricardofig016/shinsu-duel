import { setupGameWithHands, deployUnit, getCardIdByName, cards } from "../utils.js";
import SkillPlayService from "../../services/SkillPlayService.js";
import Card from "../../Card.js";
import EVT from "../../EventCatalog.js";

const context = (game) => ({ emitChild: (eventName, payload) => game.eventBus.emit(eventName, payload) });

const poisonSkillData = () => cards[getCardIdByName("Test Poison Skill")];
const compressSkillData = () => cards[getCardIdByName("Test Compress Skill")];

describe("SkillPlayService", () => {
  test("announces SKILL_APPLIED with { owner, cardName, card } before the first resolved effect", () => {
    const game = setupGameWithHands({ Alice: ["Test Scout Ranker"] });
    const ally = deployUnit(game, "Alice", "Test Scout Ranker", "scout");
    const data = poisonSkillData();
    const card = new Card(data.cardId, data, "Alice", game.eventBus);

    const order = [];
    let announce = null;
    game.eventBus.on(EVT.SKILL_APPLIED, (payload) => {
      order.push("announce");
      announce = payload;
    }, { phase: "post" });
    game.eventBus.on(EVT.CONDITION_APPLIED, () => order.push("effect"), { phase: "post" });

    SkillPlayService.play(game, context(game), {
      card,
      owner: "Alice",
      extra: {
        owner: "Alice",
        sourceId: card.id,
        sourceOwner: "Alice",
        targetOwner: "Bob",
        targetId: ally.id,
      },
    });

    expect(order).toEqual(["announce", "effect"]);
    expect(announce.owner).toBe("Alice");
    expect(announce.cardName).toBe("Test Poison Skill");
    expect(announce.card).toBe(card);
    expect(announce.card).toBeInstanceOf(Card);
  });

  test("the card's own effects resolve by default, reaching the caller's extra", () => {
    const game = setupGameWithHands({ Alice: ["Test Scout Ranker"] });
    const ally = deployUnit(game, "Alice", "Test Scout Ranker", "scout");
    const data = poisonSkillData();
    const card = new Card(data.cardId, data, "Alice", game.eventBus);

    const applied = [];
    game.eventBus.on(EVT.CONDITION_APPLIED, (payload) => applied.push(payload), { phase: "post" });

    SkillPlayService.play(game, context(game), {
      card,
      owner: "Alice",
      extra: {
        owner: "Alice",
        sourceId: card.id,
        sourceOwner: "Alice",
        targetId: ally.id,
      },
    });

    expect(applied).toHaveLength(1);
    expect(applied[0].targetId).toBe(ally.id);
    expect(applied[0].condition).toBe("poisoned");
    expect(game.modifierStack.has(ally.id, "condition", "poisoned")).toBe(true);
  });

  test("a custom effects list overrides card.effects", () => {
    const game = setupGameWithHands({ Alice: ["Test Scout Ranker"], Bob: ["Test Shinheuh"] });
    const ally = deployUnit(game, "Alice", "Test Scout Ranker", "scout");
    const enemy = deployUnit(game, "Bob", "Test Shinheuh", "frontline");
    const data = poisonSkillData();
    const card = new Card(data.cardId, data, "Alice", game.eventBus);
    // The Compress skill's Burned effect, resolved instead of the card's own
    // Poisoned effect.
    const effects = compressSkillData().effects.filter((effect) => effect.type === "give_condition");

    SkillPlayService.play(game, context(game), {
      card,
      effects,
      owner: "Alice",
      extra: {
        owner: "Alice",
        sourceId: card.id,
        sourceOwner: "Alice",
        targetId: enemy.id,
      },
    });

    expect(game.modifierStack.has(enemy.id, "condition", "burned")).toBe(true);
    expect(game.modifierStack.has(ally.id, "condition", "poisoned")).toBe(false);
  });

  test("fails fast when card is not a Card instance", () => {
    const game = setupGameWithHands({});
    expect(() =>
      SkillPlayService.play(game, context(game), { card: { name: "Not a card" }, owner: "Alice" })
    ).toThrow("Card instance");
  });

  test("fails fast without an owner", () => {
    const game = setupGameWithHands({});
    const data = poisonSkillData();
    const card = new Card(data.cardId, data, "Alice", game.eventBus);
    expect(() => SkillPlayService.play(game, context(game), { card })).toThrow("owner");
  });
});
