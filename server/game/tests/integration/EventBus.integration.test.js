import { jest } from "@jest/globals";
import EventBus from "../../EventBus.js";
import GameClock from "../../GameClock.js";
import ModifierStack from "../../ModifierStack.js";
import EVT from "../../EventCatalog.js";

/**
 * Integration tests that wire EventBus + ModifierStack together
 * to simulate real game scenarios.
 */
describe("EventBus + ModifierStack integration", () => {
  let clock, bus, stack;

  beforeEach(() => {
    clock = new GameClock();
    bus = new EventBus(clock);
    stack = new ModifierStack(bus, clock);
  });

  // -----------------------------------------------------------------------
  // Equipment lifecycle
  // -----------------------------------------------------------------------

  describe("equipment lifecycle", () => {
    test("attach equipment → trait granted → detach → trait revoked", () => {
      const timeline = [];

      bus.on(EVT.EQUIPMENT_ATTACHED, (p, ctx) => {
        timeline.push("attach");
        // Equipment gives Barrier to bearer
        stack.apply({
          sourceId: p.equipmentId,
          sourceType: "equipment",
          targetId: p.targetId,
          type: "trait",
          key: "barrier",
          value: 1,
        });
        ctx.emitChild(EVT.TRAIT_GRANTED, {
          targetId: p.targetId,
          trait: "barrier",
          sourceId: p.equipmentId,
        });
      }, { phase: "execute" });

      bus.on(EVT.EQUIPMENT_DETACHED, (p, ctx) => {
        timeline.push("detach");
        stack.removeBySource(p.equipmentId);
        ctx.emitChild("state:trait:revoked", {
          targetId: p.targetId,
          trait: "barrier",
          sourceId: p.equipmentId,
        });
      }, { phase: "execute" });

      bus.on(EVT.TRAIT_GRANTED, () => timeline.push("trait-granted"), { phase: "post" });
      bus.on("state:trait:revoked", () => timeline.push("trait-revoked"), { phase: "post" });

      // Attach
      bus.emit(EVT.EQUIPMENT_ATTACHED, { equipmentId: "Equip#17", targetId: "Unit#8" });
      expect(stack.getEffective("Unit#8", "trait", "barrier")).toBe(1);

      // Detach
      bus.emit(EVT.EQUIPMENT_DETACHED, { equipmentId: "Equip#17", targetId: "Unit#8" });
      expect(stack.getEffective("Unit#8", "trait", "barrier")).toBe(0);

      expect(timeline).toEqual([
        "attach", "trait-granted",
        "detach", "trait-revoked",
      ]);
    });

    test("equipment → silence → unequip → unsilence yields no trait (no negative)", () => {
      // Attach equipment giving Barrier
      bus.on(EVT.EQUIPMENT_ATTACHED, (p) => {
        stack.apply({
          sourceId: p.equipmentId, sourceType: "equipment",
          targetId: p.targetId, type: "trait", key: "barrier", value: 1,
        });
      }, { phase: "execute" });

      bus.emit(EVT.EQUIPMENT_ATTACHED, { equipmentId: "Equip#17", targetId: "Unit#8" });
      expect(stack.getEffective("Unit#8", "trait", "barrier")).toBe(1);

      // Silence the bearer
      bus.on(EVT.UNIT_SILENCED, (p) => {
        stack.disableByTarget(p.targetId, "trait");
      }, { phase: "execute" });

      bus.emit(EVT.UNIT_SILENCED, { targetId: "Unit#8" });
      expect(stack.getEffective("Unit#8", "trait", "barrier")).toBe(0);

      // Unequip while silenced
      bus.on(EVT.EQUIPMENT_DETACHED, (p) => {
        stack.removeBySource(p.equipmentId);
      }, { phase: "execute" });

      bus.emit(EVT.EQUIPMENT_DETACHED, { equipmentId: "Equip#17", targetId: "Unit#8" });
      expect(stack.getSources("Unit#8")).toEqual([]);

      // Unsilence
      bus.on("unit:unsilence", (p) => {
        stack.enableByTarget(p.targetId, "trait");
      }, { phase: "execute" });

      bus.emit("unit:unsilence", { targetId: "Unit#8" });
      // Barrier should NOT return — the source was removed
      expect(stack.getEffective("Unit#8", "trait", "barrier")).toBe(0);

      // No negative value
      expect(stack.getModifiers("Unit#8", "trait").length).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Damage cascade
  // -----------------------------------------------------------------------

  describe("damage cascade", () => {
    test("damage → kill → slay → draw card (full DFS chain)", () => {
      const timeline = [];

      // Set up: unit has 3 HP
      const unitState = { currentHp: 3, maxHp: 5, isAlive: () => unitState.currentHp > 0 };

      bus.on(EVT.DAMAGE_INTENT, (p) => {
        timeline.push("damage-intent");
      }, { phase: "execute" });

      bus.on(EVT.DAMAGE_INTENT, (p, ctx) => {
        timeline.push("apply-damage");
        unitState.currentHp -= p.amount;
        ctx.emitChild(EVT.DAMAGE_APPLIED, {
          targetId: p.targetId,
          amount: p.amount,
          remainingHp: unitState.currentHp,
        });
      }, { phase: "post" });

      bus.on(EVT.DAMAGE_APPLIED, (p, ctx) => {
        timeline.push("damage-applied");
        if (unitState.currentHp <= 0) {
          ctx.emitChild(EVT.UNIT_KILLED, {
            targetId: p.targetId,
            killerId: "Unit#Attacker",
          });
        }
      }, { phase: "post" });

      bus.on(EVT.UNIT_KILLED, (p, ctx) => {
        timeline.push("killed");
        ctx.emitChild("unit:slay", { killerId: p.killerId, targetId: p.targetId });
      }, { phase: "post" });

      bus.on("unit:slay", (p, ctx) => {
        timeline.push("slay");
        ctx.emitChild(EVT.CARD_DRAWN, { owner: "Alice", amount: 1 });
      }, { phase: "post" });

      bus.on(EVT.CARD_DRAWN, () => {
        timeline.push("draw-card");
      }, { phase: "execute" });

      bus.emit(EVT.DAMAGE_INTENT, { targetId: "Unit#1", amount: 5 });

      expect(timeline).toEqual([
        "damage-intent",
        "apply-damage",
        "damage-applied",
        "killed",
        "slay",
        "draw-card",
      ]);
      expect(unitState.currentHp).toBe(-2);
    });
  });

  // -----------------------------------------------------------------------
  // Round end passives
  // -----------------------------------------------------------------------

  describe("round end passives", () => {
    test("multiple round-end handlers order by source age", () => {
      const timeline = [];

      // Unit A deployed round 1 (older)
      const ageUnitA = clock.now();
      bus.on(EVT.ROUND_END, (p, ctx) => {
        timeline.push("unit-A");
      }, { phase: "execute", sourceAge: ageUnitA });

      // Unit B deployed round 3 (newer)
      const ageUnitB = clock.now();
      bus.on(EVT.ROUND_END, (p, ctx) => {
        timeline.push("unit-B");
      }, { phase: "execute", sourceAge: ageUnitB });

      bus.emit(EVT.ROUND_END, { round: 5 });
      expect(timeline).toEqual(["unit-A", "unit-B"]);
    });
  });

  // -----------------------------------------------------------------------
  // Cleanse
  // -----------------------------------------------------------------------

  describe("cleanse", () => {
    test("removes conditions but leaves traits intact", () => {
      stack.apply({
        sourceId: "Card#1", sourceType: "unit",
        targetId: "Unit#1", type: "trait", key: "strong", value: 2,
      });
      stack.apply({
        sourceId: "Unit#2", sourceType: "unit",
        targetId: "Unit#1", type: "condition", key: "poisoned", value: 3,
      });
      stack.apply({
        sourceId: "Unit#3", sourceType: "unit",
        targetId: "Unit#1", type: "condition", key: "burned", value: 1,
      });

      bus.on("unit:cleanse", (p) => {
        stack.removeWhere(
          (m) => m.targetId === p.targetId && m.type === "condition"
        );
      }, { phase: "execute" });

      bus.emit("unit:cleanse", { targetId: "Unit#1" });

      expect(stack.getEffective("Unit#1", "trait", "strong")).toBe(2); // preserved
      expect(stack.getEffective("Unit#1", "condition", "poisoned")).toBe(0); // removed
      expect(stack.getEffective("Unit#1", "condition", "burned")).toBe(0); // removed
    });
  });

  // -----------------------------------------------------------------------
  // Immune blocks conditions
  // -----------------------------------------------------------------------

  describe("immune trait", () => {
    test("immune unit does not receive conditions", () => {
      stack.apply({
        sourceId: "Card#1", sourceType: "unit",
        targetId: "Unit#1", type: "trait", key: "immune", value: 1,
      });

      bus.on(EVT.CONDITION_APPLIED, (p, ctx) => {
        if (stack.has(p.targetId, "trait", "immune")) {
          ctx.cancel("immune");
          return;
        }
      }, { phase: "pre" });

      bus.on(EVT.CONDITION_APPLIED, (p) => {
        stack.apply({
          sourceId: p.sourceId, sourceType: "unit",
          targetId: p.targetId, type: "condition", key: p.condition, value: p.amount,
        });
      }, { phase: "execute" });

      const result = bus.emit(EVT.CONDITION_APPLIED, {
        sourceId: "Unit#Enemy",
        targetId: "Unit#1",
        condition: "poisoned",
        amount: 2,
      });

      expect(result.cancelled).toBe(true);
      expect(result.reason).toBe("immune");
      expect(stack.getEffective("Unit#1", "condition", "poisoned")).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // Determinism: same events produce same DFS tree
  // -----------------------------------------------------------------------

  describe("determinism", () => {
    test("same event sequence produces identical causation tree", () => {
      const run = () => {
        const c = new GameClock();
        const b = new EventBus(c);
        const s = new ModifierStack(b, c);
        const log = [];

        b.on("*", (p, ctx) => {
          if (ctx.depth === 0) log.push(ctx.eventName);
        }, { phase: "resolved", priority: 9999 });

        b.on(EVT.ROUND_START, (p, ctx) => {
          ctx.emitChild("unit:passive:round-start", { unitId: "Unit#A" });
          ctx.emitChild("unit:passive:round-start", { unitId: "Unit#B" });
        }, { phase: "execute" });

        b.on("unit:passive:round-start", (p, ctx) => {
          ctx.emitChild(EVT.SHINSU_CHANGED, { unitId: p.unitId });
        }, { phase: "execute" });

        b.emit(EVT.ROUND_START, { round: 3 });
        return log;
      };

      const first = run();
      for (let i = 0; i < 10; i++) {
        expect(run()).toEqual(first);
      }
    });
  });
});
