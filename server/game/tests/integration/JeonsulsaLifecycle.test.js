import EVT from "../../EventCatalog.js";
import LifecycleEngine from "../../services/LifecycleEngine.js";
import { advanceToRound, deployUnit, setupGameWithHands } from "../utils.js";

const BAANG_CONDITIONS = {
  "Test Lightning Baang": "burned",
  "Test Thunder Baang": "exhausted",
  "Test Static Baang": "weak",
};

function useAbility(game, username, unitId, abilityCode) {
  game.currentTurn = username;
  game.processAction({
    type: "use-ability-action",
    data: { source: "player", username, unitId, abilityCode },
  });
}

describe("Jeonsulsa Conduit lifecycle", () => {
  test("deploying a Jeonsulsa when the enemy backline is full fizzles the Conduit summon", () => {
    const game = setupGameWithHands({
      Alice: ["Test Khun Ran"],
      Bob: ["Test Light Bearer", "Test Light Bearer Only", "Test Yeo Goseng", "Test Trait Unit", "Test Switch Position Unit"],
    });
    const fizzles = [];
    game.eventBus.on(EVT.UNIT_SUMMON_FIZZLED, (p) => fizzles.push(p), { phase: "pre" });

    // Bob fills his backline to the five-unit cap before the Jeonsulsa deploy.
    for (const name of ["Test Light Bearer", "Test Light Bearer Only", "Test Yeo Goseng", "Test Trait Unit", "Test Switch Position Unit"]) {
      deployUnit(game, "Bob", name, "light-bearer");
    }
    expect(game.playerStates.Bob.field.backline).toHaveLength(5);

    deployUnit(game, "Alice", "Test Khun Ran", "fisherman");

    // The summon fizzles: no Conduit, the card is discarded into the
    // Conduit-owner's discard pile, and no substitution decision opens.
    const bobField = [...game.playerStates.Bob.field.frontline, ...game.playerStates.Bob.field.backline];
    expect(bobField.some((u) => u.card.name === "Conduit")).toBe(false);
    expect(bobField).toHaveLength(5);
    expect(game.pendingDecision).toBeNull();
    expect(fizzles).toHaveLength(1);
    expect(fizzles[0]).toMatchObject({ owner: "Bob", cardName: "Conduit", line: "backline" });
    expect(game.playerStates.Bob.discard.some((c) => c.name === "Conduit")).toBe(true);

    // The Conduit never existed, so the next round start plays no Baangs.
    const bearer = game.playerStates.Bob.field.backline.find((u) => u.card.name === "Test Light Bearer");
    const conditions = [];
    game.eventBus.on(EVT.CONDITION_APPLIED, (p) => conditions.push(p), { phase: "pre" });
    advanceToRound(game, game.round + 1);
    expect(conditions).toHaveLength(0);
  });

  test("deploy summons the Conduit re-entrantly, round start plays one Baang, activation replays them, and the self-slay fires once the Jeonsulsa falls", () => {
    const game = setupGameWithHands({ Alice: ["Test Khun Ran"], Bob: ["Test Light Bearer"] });
    const events = [];
    game.eventBus.on(EVT.UNIT_DEPLOYED, (p) => events.push({ kind: "deployed", name: p.unit.card.name }), { phase: "pre" });
    game.eventBus.on(EVT.UNIT_SUMMONED, (p) => events.push({ kind: "summoned", name: p.unit.card.name }), { phase: "pre" });
    game.eventBus.on(EVT.SKILL_APPLIED, (p) => events.push({ kind: "skill", cardName: p.cardName, owner: p.owner }), { phase: "pre" });
    game.eventBus.on(EVT.CONDITION_APPLIED, (p) => events.push({ kind: "condition", condition: p.condition, targetId: p.targetId }), { phase: "pre" });
    game.eventBus.on(EVT.ACTIVATION, (p) => events.push({ kind: "activation", unitId: p.unitId }), { phase: "pre" });
    game.eventBus.on(EVT.DAMAGE_APPLIED, (p) => events.push({ kind: "damage", targetId: p.targetId }), { phase: "pre" });

    const ran = deployUnit(game, "Alice", "Test Khun Ran", "fisherman");

    // The Conduit is summoned re-entrantly inside the Jeonsulsa unit's
    // attribute wiring: its full event chain completes before the deploying
    // unit's own deploy event fires.
    expect(events).toEqual([
      { kind: "deployed", name: "Conduit" },
      { kind: "summoned", name: "Conduit" },
      { kind: "deployed", name: "Test Khun Ran" },
      { kind: "summoned", name: "Test Khun Ran" },
    ]);
    const conduit = game.playerStates.Bob.field.backline.find((u) => u.card.name === "Conduit");
    expect(conduit).toBeDefined();
    expect(conduit.owner).toBe("Bob");
    expect(conduit.placedPositionCode).toBeNull();
    expect(conduit.card.entryHp).toBe(2);
    expect(conduit.card.maxHp).toBe(8);
    expect(conduit.currentHp).toBe(2); // created at 2 via the card's entryHp
    // Entry is initialization, not damage: the summon emits no DAMAGE_APPLIED.
    expect(events.filter((e) => e.kind === "damage")).toHaveLength(0);

    // Entry HP applied once at creation; later summons leave the Conduit
    // untouched. The Light Bearer is Bob's Baang target and shares his
    // backline, so the enemy frontline stays empty and the Conduit remains
    // targetable by Khun Ran's ability (RULES.md §Battlefield 4).
    const bearer = deployUnit(game, "Bob", "Test Light Bearer", "light-bearer");
    expect(game._findUnit(conduit.id)).toBe(conduit);
    expect(conduit.card.maxHp).toBe(8);
    expect(conduit.currentHp).toBe(2);

    // Round start: Ghost lands, the self-slay is suppressed by the enemy
    // Jeonsulsa, and exactly one Baang (floor(2/2) = 1) hits Bob's other unit.
    advanceToRound(game, game.round + 1);
    expect(game.modifierStack.has(conduit.id, "condition", "ghost")).toBe(true);
    expect(game._findUnit(conduit.id)).toBe(conduit);
    let skills = events.filter((e) => e.kind === "skill");
    expect(skills).toHaveLength(1);
    expect(skills[0].owner).toBe("Bob");
    let conditions = events.filter((e) => e.kind === "condition" && e.targetId === bearer.id);
    expect(conditions).toHaveLength(1);
    expect(conditions[0].condition).toBe(BAANG_CONDITIONS[skills[0].cardName]);

    // Khun Ran's ability heals the Conduit 2 HP and activates it: the Baang
    // passive replays with floor(4/2) = 2 plays, each announced once.
    useAbility(game, "Alice", ran.id, "1");
    expect(conduit.currentHp).toBe(4);
    expect(events.filter((e) => e.kind === "activation")).toEqual([
      { kind: "activation", unitId: conduit.id },
    ]);
    skills = events.filter((e) => e.kind === "skill");
    expect(skills).toHaveLength(3);
    conditions = events.filter((e) => e.kind === "condition" && e.targetId === bearer.id);
    expect(conditions).toHaveLength(3);
    for (let i = 1; i < events.length; i++) {
      if (events[i].kind === "condition" && events[i].targetId === bearer.id) {
        const announcement = events.slice(0, i).reverse().find((e) => e.kind === "skill");
        expect(announcement).toBeDefined();
        expect(events[i].condition).toBe(BAANG_CONDITIONS[announcement.cardName]);
      }
    }

    // Without an enemy Jeonsulsa the Conduit slays itself at round start. The
    // self-slay passive is registered before the Baang passive, so the kill
    // happens first and no further Baang plays.
    LifecycleEngine.destroyUnit(game, ran);
    advanceToRound(game, game.round + 1);
    expect(game._findUnit(conduit.id)).toBeNull();
    expect(game.playerStates.Bob.field.backline.map((u) => u.card.name)).toEqual(["Test Light Bearer"]);
    expect(events.filter((e) => e.kind === "skill")).toHaveLength(3);
  });
});
