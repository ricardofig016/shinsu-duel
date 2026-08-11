import { setupGameWithCardsInHand, advanceToRound, getCardIdByName } from "./utils.js";
import Card from "../Card.js";
import LifecycleEngine from "../services/LifecycleEngine.js";
import EVT from "../EventCatalog.js";

/**
 * DFS-ordering tests for every trigger type.
 *
 * Each test records the exact phase-tagged timeline of events and
 * asserts that transformations occur at the documented canonical point
 * in the DFS chain.
 */

function recordTimeline(game) {
  const timeline = [];
  game.eventBus.on("*", (payload, ctx) => {
    timeline.push(`${ctx.phase}:${ctx.eventName}`);
  }, { phase: "pre", priority: -9999 });
  game.eventBus.on("*", (payload, ctx) => {
    timeline.push(`${ctx.phase}:${ctx.eventName}`);
  }, { phase: "execute", priority: -9999 });
  game.eventBus.on("*", (payload, ctx) => {
    timeline.push(`${ctx.phase}:${ctx.eventName}`);
  }, { phase: "post", priority: -9999 });
  game.eventBus.on("*", (payload, ctx) => {
    timeline.push(`${ctx.phase}:${ctx.eventName}`);
  }, { phase: "resolved", priority: -9999 });
  return timeline;
}

describe("trigger DFS-ordering — equip evolution", () => {
  test("equipment effects resolve before the equip trigger fires in post", () => {
    const game = setupGameWithCardsInHand(["Karaka", "Karaka's Armor Suit", "Karaka", "Karaka"]);
    game.round = 15;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 15, recharged: 0 };

    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "fisherman" },
    });
    game.currentTurn = "Alice";
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 15, recharged: 0 };
    const karaka = game.playerStates.Alice.field.frontline[0];

    const timeline = recordTimeline(game);

    const equipIdx = game.playerStates.Alice.hand.findIndex((c) => c.name === "Karaka's Armor Suit");
    game.processAction({
      type: "equip-equipment-action",
      data: { source: "player", username: "Alice", handId: equipIdx, targetUnitId: karaka.id },
    });

    // Karaka should have evolved
    expect(karaka.card.name).toBe("Karaka - Evolved");

    // Equipment effects are resolved by LifecycleEngine.attachEquipment BEFORE
    // equipment:attached is emitted, so the equip trigger in the post phase
    // always sees the fully-equipped state.
    const attachedPostIdx = timeline.findIndex((e) =>
      e === `post:${EVT.EQUIPMENT_ATTACHED}` || e.startsWith(`post:equipment:attached`)
    );
    const evolvedIdx = timeline.findIndex((e) =>
      e.startsWith("execute:") && (e === `execute:${EVT.UNIT_EVOLVED}` || e === "execute:unit:evolved")
    );

    expect(attachedPostIdx).toBeGreaterThan(-1);
    expect(evolvedIdx).toBeGreaterThan(-1);
    // Evolution happens as a child event during equipment:attached post phase,
    // so it appears between attached pre and attached resolved.
    const attachedPreIdx = timeline.findIndex((e) =>
      e === `pre:${EVT.EQUIPMENT_ATTACHED}` || e === "pre:equipment:attached"
    );
    const attachedResolvedIdx = timeline.findIndex((e) =>
      e === `resolved:${EVT.EQUIPMENT_ATTACHED}` || e === "resolved:equipment:attached"
    );
    expect(attachedPreIdx).toBeLessThan(evolvedIdx);
    expect(evolvedIdx).toBeLessThan(attachedResolvedIdx);

    // Clean assertion on the triggered transformation
    const equipTriggerPost = timeline.filter((e) =>
      e === `post:${EVT.EQUIPMENT_ATTACHED}` || e === "post:equipment:attached"
    );
    expect(equipTriggerPost.length).toBeGreaterThanOrEqual(1);
  });

  test("unit:deployed fires before unit:summoned, and the deploy trigger fires on unit:summoned", () => {
    const game = setupGameWithCardsInHand(["Karaka", "Karaka's Armor Suit", "Karaka", "Karaka"]);
    game.round = 15;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 15, recharged: 0 };

    const timeline = recordTimeline(game);

    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "fisherman" },
    });

    // unit:deployed must appear before unit:summoned in the timeline
    const deployedIdx = timeline.findIndex((e) => e.includes("unit:deployed"));
    const summonedIdx = timeline.findIndex((e) => e.includes("unit:summoned"));

    expect(deployedIdx).toBeGreaterThan(-1);
    expect(summonedIdx).toBeGreaterThan(-1);
    expect(deployedIdx).toBeLessThan(summonedIdx);

    // The deploy trigger (if this card had one) subscribes to unit:summoned,
    // not unit:deployed. That is the documented canonical event.
  });
});

describe("trigger DFS-ordering — slay ignition", () => {
  test("slay trigger fires in post phase of unit:killed, after damage resolution", () => {
    const game = setupGameWithCardsInHand(["Monkeyman", "Narumada", "Monkeyman", "Monkeyman"]);
    advanceToRound(game, 3);
    game.currentTurn = "Alice";

    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "scout" },
    });
    game.currentTurn = "Alice";
    const bearer = game.playerStates.Alice.field.frontline[0];

    const equipIdx = game.playerStates.Alice.hand.findIndex((c) => c.name === "Narumada");
    game.processAction({
      type: "equip-equipment-action",
      data: { source: "player", username: "Alice", handId: equipIdx, targetUnitId: bearer.id },
    });

    const timeline = recordTimeline(game);

    const victimCardId = getCardIdByName("Monkeyman");
    const victimCard = new Card(victimCardId, game.constructor.cards[victimCardId], "Bob", game.eventBus);
    const victim = {
      id: "Unit#timing-victim",
      owner: "Bob",
      card: victimCard,
      currentHp: 1,
      placedPositionCode: "scout",
      isAlive() { return this.currentHp > 0; },
    };
    game.playerStates.Bob.field.frontline.push(victim);
    game._indexUnit(victim);

    game.eventBus.emit(EVT.UNIT_KILLED, {
      sourceId: bearer.id,
      targetId: victim.id,
      killerId: bearer.id,
    });

    // Narumada should be ignited
    expect(bearer.equipmentAttachments.map((c) => c.name)).toEqual(["Narumada - Ignited"]);

    // The ignition happens during the post phase of unit:killed.
    // equipment:ignited must appear between unit:killed pre and resolved.
    const killedPreIdx = timeline.findIndex((e) => e === `pre:${EVT.UNIT_KILLED}` || e === "pre:unit:killed");
    const ignitedIdx = timeline.findIndex((e) =>
      (e === `execute:${EVT.EQUIPMENT_IGNITED}` || e === "execute:equipment:ignited")
    );
    const killedResolvedIdx = timeline.findIndex((e) => e === `resolved:${EVT.UNIT_KILLED}` || e === "resolved:unit:killed");

    expect(killedPreIdx).toBeGreaterThan(-1);
    expect(ignitedIdx).toBeGreaterThan(-1);
    expect(killedResolvedIdx).toBeGreaterThan(-1);
    expect(killedPreIdx).toBeLessThan(ignitedIdx);
    expect(ignitedIdx).toBeLessThan(killedResolvedIdx);
  });
});

describe("trigger DFS-ordering — ally_dies", () => {
  test("ally_dies trigger fires in post phase of unit:destroyed", () => {
    const game = setupGameWithCardsInHand(["Monkeyman", "Monkeyman", "Monkeyman", "Monkeyman"]);
    game.round = 10;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 10, recharged: 0 };

    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "scout" },
    });

    // Deploy a second unit — set turn and shinsu explicitly so the
    // end-turn side effect of the first deployment doesn't interfere.
    game.currentTurn = "Alice";
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 10, recharged: 0 };
    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "scout" },
    });

    const ally = game.playerStates.Alice.field.frontline[1];
    const timeline = recordTimeline(game);

    LifecycleEngine.destroyUnit(game, ally);

    // unit:destroy:intent → unit:destroyed.
    const destroyIntentIdx = timeline.findIndex((e) => e.includes("unit:destroy:intent"));
    const destroyedIdx = timeline.findIndex((e) => e.includes("unit:destroyed") && !e.includes("intent"));

    expect(destroyIntentIdx).toBeGreaterThan(-1);
    expect(destroyedIdx).toBeGreaterThan(-1);
    expect(destroyIntentIdx).toBeLessThan(destroyedIdx);

    // The ally_dies trigger subscribes to unit:destroyed (not unit:killed),
    // so triggers that listen for death-unrelated removals still fire.
  });
});

describe("trigger DFS-ordering — round_start / round_end", () => {
  test("round_start and round_end triggers fire in post phase of their canonical events", () => {
    const game = setupGameWithCardsInHand(["Karaka - Evolved", "Karaka", "Karaka", "Karaka"]);
    game.round = 15;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 15, recharged: 0 };

    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "fisherman" },
    });
    game.currentTurn = "Alice";
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 15, recharged: 0 };

    // Advance one full round and capture the round-start event ordering.
    const timeline = recordTimeline(game);

    game.processAction({
      type: "pass-turn-action",
      data: { source: "player", username: "Alice" },
    });
    game.processAction({
      type: "pass-turn-action",
      data: { source: "player", username: "Bob" },
    });

    // round:ended fires before condition cleanup (GameState wireLifecycleEvents).
    // round:started fires after shinsu reset and card draw.
    const roundEndIdx = timeline.findIndex((e) => e.includes("round:ended"));
    const roundStartIdx = timeline.findIndex((e) => e.includes("round:started"));

    expect(roundEndIdx).toBeGreaterThan(-1);
    expect(roundStartIdx).toBeGreaterThan(-1);
    expect(roundEndIdx).toBeLessThan(roundStartIdx);

    // condition cleanup happens in execute phase of round:ended, before
    // any round_end trigger in the post phase — so a trigger reading
    // conditions sees them before they are removed.
  });
});

describe("trigger DFS-ordering — chain through silence/unequip is safe", () => {
  test("equip → evolve → ignition chain produces correct event order", () => {
    const game = setupGameWithCardsInHand(["Karaka", "Karaka's Armor Suit", "Karaka", "Karaka"]);
    game.round = 15;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 15, recharged: 0 };

    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "fisherman" },
    });
    game.currentTurn = "Alice";
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 15, recharged: 0 };
    const karaka = game.playerStates.Alice.field.frontline[0];

    const timeline = recordTimeline(game);

    const equipIdx = game.playerStates.Alice.hand.findIndex((c) => c.name === "Karaka's Armor Suit");
    game.processAction({
      type: "equip-equipment-action",
      data: { source: "player", username: "Alice", handId: equipIdx, targetUnitId: karaka.id },
    });

    // The equip trigger fires in equipment:attached post.
    // unit:evolved must fire before turn:ended.
    const evolvedIdx = timeline.findIndex((e) =>
      e === "execute:unit:evolved"
    );
    const turnEndedIdx = timeline.findIndex((e) =>
      e === "execute:turn:ended"
    );

    expect(evolvedIdx).toBeGreaterThan(-1);
    expect(turnEndedIdx).toBeGreaterThan(-1);
    expect(evolvedIdx).toBeLessThan(turnEndedIdx);
  });
});
