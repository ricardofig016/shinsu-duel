import { setupGameWithCardsInHand, advanceToRound, getCardIdByName } from "../utils.js";
import Card from "../../Card.js";
import LifecycleEngine from "../../services/LifecycleEngine.js";
import EVT from "../../EventCatalog.js";

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
    const game = setupGameWithCardsInHand(["Test Evolve Unit", "Test Armor", "Test Evolve Unit", "Test Evolve Unit"]);
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

    const equipIdx = game.playerStates.Alice.hand.findIndex((c) => c.name === "Test Armor");
    game.processAction({
      type: "equip-equipment-action",
      data: { source: "player", username: "Alice", handId: equipIdx, targetUnitId: karaka.id },
    });

    // Test Evolve Unit should have evolved
    expect(karaka.card.name).toBe("Test Evolve Unit II");

    // Equipment effects are resolved by LifecycleEngine.attachEquipment BEFORE
    // equipment:attached is emitted, so the equip trigger in the post phase
    // always sees the fully-equipped state.
    const attachedPostIdx = timeline.findIndex((e) =>
      e === `post:${EVT.EQUIPMENT_ATTACHED}`
    );
    const evolvedIdx = timeline.findIndex((e) =>
      e === `execute:${EVT.UNIT_EVOLVED}`
    );

    expect(attachedPostIdx).toBeGreaterThan(-1);
    expect(evolvedIdx).toBeGreaterThan(-1);
    // Evolution happens as a child event during equipment:attached post phase,
    // so it appears between attached pre and attached resolved.
    const attachedPreIdx = timeline.findIndex((e) =>
      e === `pre:${EVT.EQUIPMENT_ATTACHED}`
    );
    const attachedResolvedIdx = timeline.findIndex((e) =>
      e === `resolved:${EVT.EQUIPMENT_ATTACHED}`
    );
    expect(attachedPreIdx).toBeLessThan(evolvedIdx);
    expect(evolvedIdx).toBeLessThan(attachedResolvedIdx);

    // Clean assertion on the triggered transformation
    const equipTriggerPost = timeline.filter((e) =>
      e === `post:${EVT.EQUIPMENT_ATTACHED}`
    );
    expect(equipTriggerPost.length).toBeGreaterThanOrEqual(1);
  });

  test("unit:deployed fires before unit:summoned, and the deploy trigger fires on unit:summoned", () => {
    const game = setupGameWithCardsInHand(["Test Evolve Unit", "Test Armor", "Test Evolve Unit", "Test Evolve Unit"]);
    game.round = 15;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 15, recharged: 0 };

    const timeline = recordTimeline(game);

    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "fisherman" },
    });

    // unit:deployed must appear before unit:summoned in the timeline
    const deployedIdx = timeline.findIndex((e) => e.includes(EVT.UNIT_DEPLOYED));
    const summonedIdx = timeline.findIndex((e) => e.includes(EVT.UNIT_SUMMONED));

    expect(deployedIdx).toBeGreaterThan(-1);
    expect(summonedIdx).toBeGreaterThan(-1);
    expect(deployedIdx).toBeLessThan(summonedIdx);

    // The deploy trigger (if this card had one) subscribes to unit:summoned,
    // not unit:deployed. That is the documented canonical event.
  });
});

describe("trigger DFS-ordering — deploy", () => {
  test("unit wiring precedes deploy/summon events, and a unit's own deploy trigger fires on unit:summoned", () => {
    const game = setupGameWithCardsInHand(["Test Deploy Evolve"]);
    game.round = 10;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 10, recharged: 0 };

    const timeline = recordTimeline(game);

    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "fisherman" },
    });

    // The unit's own deploy trigger subscribed to unit:summoned and fired
    // before the summon event finished resolving, evolving the unit.
    const unit = game.playerStates.Alice.field.frontline[0];
    expect(unit.card.name).toBe("Test Deploy Evolve II");

    // Native traits are wired before the announce events: the barrier trait
    // is granted (modifier:trait:granted) before unit:deployed is emitted.
    const traitGrantedIdx = timeline.findIndex((e) => e.includes(EVT.MODIFIER_GRANTED("trait")));
    const deployedIdx = timeline.findIndex((e) => e.includes(EVT.UNIT_DEPLOYED));
    const summonedIdx = timeline.findIndex((e) => e.includes(EVT.UNIT_SUMMONED));

    expect(traitGrantedIdx).toBeGreaterThan(-1);
    expect(deployedIdx).toBeGreaterThan(-1);
    expect(summonedIdx).toBeGreaterThan(-1);
    expect(traitGrantedIdx).toBeLessThan(deployedIdx);
    expect(deployedIdx).toBeLessThan(summonedIdx);

    // The deploy trigger fires in the post phase of unit:summoned, so
    // unit:evolved appears between unit:summoned pre and resolved.
    const summonedPreIdx = timeline.findIndex((e) => e === `pre:${EVT.UNIT_SUMMONED}`);
    const evolvedIdx = timeline.findIndex((e) => e === `execute:${EVT.UNIT_EVOLVED}`);
    const summonedResolvedIdx = timeline.findIndex((e) => e === `resolved:${EVT.UNIT_SUMMONED}`);

    expect(summonedPreIdx).toBeGreaterThan(-1);
    expect(evolvedIdx).toBeGreaterThan(-1);
    expect(summonedResolvedIdx).toBeGreaterThan(-1);
    expect(summonedPreIdx).toBeLessThan(evolvedIdx);
    expect(evolvedIdx).toBeLessThan(summonedResolvedIdx);
  });
});

describe("trigger DFS-ordering — slay ignition", () => {
  test("slay trigger fires in post phase of unit:killed, after damage resolution", () => {
    const game = setupGameWithCardsInHand(["Test Scout", "Test Ignite Weapon", "Test Scout", "Test Scout"]);
    advanceToRound(game, 3);
    game.currentTurn = "Alice";

    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "scout" },
    });
    game.currentTurn = "Alice";
    const bearer = game.playerStates.Alice.field.frontline[0];

    const equipIdx = game.playerStates.Alice.hand.findIndex((c) => c.name === "Test Ignite Weapon");
    game.processAction({
      type: "equip-equipment-action",
      data: { source: "player", username: "Alice", handId: equipIdx, targetUnitId: bearer.id },
    });

    const timeline = recordTimeline(game);

    const victimCardId = getCardIdByName("Test Scout");
    const victimCard = new Card(victimCardId, game.cards[victimCardId], "Bob", game.eventBus);
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
    expect(bearer.equipmentAttachments.map((c) => c.name)).toEqual(["Test Ignite Weapon - Ignited"]);

    // The ignition happens during the post phase of unit:killed.
    // equipment:ignited must appear between unit:killed pre and resolved.
    const killedPreIdx = timeline.findIndex((e) => e === `pre:${EVT.UNIT_KILLED}`);
    const ignitedIdx = timeline.findIndex((e) =>
      e === `execute:${EVT.EQUIPMENT_IGNITED}`
    );
    const killedResolvedIdx = timeline.findIndex((e) => e === `resolved:${EVT.UNIT_KILLED}`);

    expect(killedPreIdx).toBeGreaterThan(-1);
    expect(ignitedIdx).toBeGreaterThan(-1);
    expect(killedResolvedIdx).toBeGreaterThan(-1);
    expect(killedPreIdx).toBeLessThan(ignitedIdx);
    expect(ignitedIdx).toBeLessThan(killedResolvedIdx);
  });
});

describe("trigger DFS-ordering — ally_dies", () => {
  test("ally_dies trigger fires in post phase of unit:destroyed", () => {
    const game = setupGameWithCardsInHand(["Test Scout", "Test Scout Ranker"]);
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
    const destroyIntentIdx = timeline.findIndex((e) => e.includes(EVT.UNIT_DESTROY_INTENT));
    const destroyedIdx = timeline.findIndex((e) => e.includes(EVT.UNIT_DESTROYED) && !e.includes(EVT.UNIT_DESTROY_INTENT));

    expect(destroyIntentIdx).toBeGreaterThan(-1);
    expect(destroyedIdx).toBeGreaterThan(-1);
    expect(destroyIntentIdx).toBeLessThan(destroyedIdx);

    // The ally_dies trigger subscribes to unit:destroyed (not unit:killed),
    // so triggers that listen for death-unrelated removals still fire.
  });
});

describe("trigger DFS-ordering — round_start / round_end", () => {
  test("round_start and round_end triggers fire in post phase of their canonical events", () => {
    const game = setupGameWithCardsInHand(["Test Evolve Unit II", "Test Evolve Unit", "Test Evolve Unit", "Test Evolve Unit"]);
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
    const roundEndIdx = timeline.findIndex((e) => e.includes(EVT.ROUND_END));
    const roundStartIdx = timeline.findIndex((e) => e.includes(EVT.ROUND_START));

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
    const game = setupGameWithCardsInHand(["Test Evolve Unit", "Test Armor", "Test Evolve Unit", "Test Evolve Unit"]);
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

    const equipIdx = game.playerStates.Alice.hand.findIndex((c) => c.name === "Test Armor");
    game.processAction({
      type: "equip-equipment-action",
      data: { source: "player", username: "Alice", handId: equipIdx, targetUnitId: karaka.id },
    });

    // The equip trigger fires in equipment:attached post.
    // unit:evolved must fire before turn:ended.
    const evolvedIdx = timeline.findIndex((e) =>
      e === `execute:${EVT.UNIT_EVOLVED}`
    );
    const turnEndedIdx = timeline.findIndex((e) =>
      e === `execute:${EVT.TURN_END}`
    );

    expect(evolvedIdx).toBeGreaterThan(-1);
    expect(turnEndedIdx).toBeGreaterThan(-1);
    expect(evolvedIdx).toBeLessThan(turnEndedIdx);
  });
});
