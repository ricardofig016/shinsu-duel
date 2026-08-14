import { jest } from "@jest/globals";
import EventBus from "../EventBus.js";
import GameClock from "../GameClock.js";
import ModifierStack from "../ModifierStack.js";
import EVT from "../EventCatalog.js";

describe("ModifierStack", () => {
  let bus, clock, stack;

  beforeEach(() => {
    clock = new GameClock();
    bus = new EventBus(clock);
    stack = new ModifierStack(bus, clock);
  });

  // -----------------------------------------------------------------------
  // Basic apply / query
  // -----------------------------------------------------------------------

  describe("apply and query", () => {
    test("applies a single modifier and retrieves effective value", () => {
      stack.apply({
        sourceId: "Equip#1", sourceType: "equipment",
        targetId: "Unit#1", type: "trait", key: "strong", value: 2,
      });
      expect(stack.getEffective("Unit#1", "trait", "strong")).toBe(2);
    });

    test("getEffective returns 0 for non-existent modifier", () => {
      expect(stack.getEffective("Unit#1", "trait", "barrier")).toBe(0);
    });

    test("getActiveKeys returns set of enabled trait keys", () => {
      stack.apply({
        sourceId: "Card#1", sourceType: "unit",
        targetId: "Unit#1", type: "trait", key: "barrier", value: 1,
      });
      stack.apply({
        sourceId: "Card#1", sourceType: "unit",
        targetId: "Unit#1", type: "trait", key: "strong", value: 3,
      });
      const keys = stack.getActiveKeys("Unit#1", "trait");
      expect(keys.has("barrier")).toBe(true);
      expect(keys.has("strong")).toBe(true);
      expect(keys.size).toBe(2);
    });

    test("has() checks for enabled modifier key", () => {
      stack.apply({
        sourceId: "Card#1", sourceType: "unit",
        targetId: "Unit#1", type: "trait", key: "immune", value: 1,
      });
      expect(stack.has("Unit#1", "trait", "immune")).toBe(true);
      expect(stack.has("Unit#1", "trait", "barrier")).toBe(false);
    });

    test("getSources returns unique source IDs", () => {
      stack.apply({
        sourceId: "Equip#A", sourceType: "equipment",
        targetId: "Unit#1", type: "trait", key: "strong", value: 1,
      });
      stack.apply({
        sourceId: "Equip#A", sourceType: "equipment",
        targetId: "Unit#1", type: "trait", key: "barrier", value: 1,
      });
      stack.apply({
        sourceId: "Equip#B", sourceType: "equipment",
        targetId: "Unit#1", type: "trait", key: "pierce", value: 1,
      });
      const sources = stack.getSources("Unit#1");
      expect(sources).toContain("Equip#A");
      expect(sources).toContain("Equip#B");
      expect(sources.length).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // Stacking
  // -----------------------------------------------------------------------

  describe("stacking", () => {
    test("multiple add modifiers stack additively", () => {
      stack.apply({
        sourceId: "Passive#1", sourceType: "passive",
        targetId: "Unit#1", type: "trait", key: "strong", value: 1,
      });
      stack.apply({
        sourceId: "Equip#1", sourceType: "equipment",
        targetId: "Unit#1", type: "trait", key: "strong", value: 2,
      });
      expect(stack.getEffective("Unit#1", "trait", "strong")).toBe(3);
    });

    test("set operation overrides rather than adding", () => {
      stack.apply({
        sourceId: "Passive#1", sourceType: "passive",
        targetId: "Unit#1", type: "trait", key: "strong", value: 1,
      });
      stack.apply({
        sourceId: "Equip#1", sourceType: "equipment",
        targetId: "Unit#1", type: "trait", key: "strong",
        value: 5, operation: "set",
      });
      // "set" returns that value immediately, ignoring add modifiers
      expect(stack.getEffective("Unit#1", "trait", "strong")).toBe(5);
    });
  });

  // -----------------------------------------------------------------------
  // Removal
  // -----------------------------------------------------------------------

  describe("removal", () => {
    test("removeBySource removes only that source's modifiers", () => {
      stack.apply({
        sourceId: "Equip#A", sourceType: "equipment",
        targetId: "Unit#1", type: "trait", key: "strong", value: 1,
      });
      stack.apply({
        sourceId: "Equip#B", sourceType: "equipment",
        targetId: "Unit#1", type: "trait", key: "strong", value: 2,
      });

      stack.removeBySource("Equip#A");

      expect(stack.getEffective("Unit#1", "trait", "strong")).toBe(2);
      expect(stack.getSources("Unit#1")).toEqual(["Equip#B"]);
    });

    test("removeBySource emits revocation events", () => {
      const listener = jest.fn();
      bus.on(EVT.MODIFIER_REVOKED("trait"), listener, { phase: "post" });

      stack.apply({
        sourceId: "Equip#1", sourceType: "equipment",
        targetId: "Unit#1", type: "trait", key: "strong", value: 1,
      });

      stack.removeBySource("Equip#1");

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].key).toBe("strong");
    });

    test("removeByTarget removes all modifiers on a target", () => {
      stack.apply({
        sourceId: "EqA", sourceType: "equipment",
        targetId: "Unit#1", type: "trait", key: "strong", value: 1,
      });
      stack.apply({
        sourceId: "EqB", sourceType: "equipment",
        targetId: "Unit#1", type: "condition", key: "burned", value: 2,
      });

      stack.removeByTarget("Unit#1");

      expect(stack.getEffective("Unit#1", "trait", "strong")).toBe(0);
      expect(stack.getEffective("Unit#1", "condition", "burned")).toBe(0);
      expect(stack.getSources("Unit#1")).toEqual([]);
    });

    test("removeWhere with predicate removes matching modifiers", () => {
      stack.apply({
        sourceId: "A", sourceType: "equipment",
        targetId: "Unit#1", type: "condition", key: "burned", value: 1,
      });
      stack.apply({
        sourceId: "B", sourceType: "equipment",
        targetId: "Unit#1", type: "condition", key: "poisoned", value: 2,
      });
      stack.apply({
        sourceId: "C", sourceType: "unit",
        targetId: "Unit#1", type: "trait", key: "strong", value: 1,
      });

      stack.removeWhere((m) => m.type === "condition");

      expect(stack.getEffective("Unit#1", "condition", "burned")).toBe(0);
      expect(stack.getEffective("Unit#1", "condition", "poisoned")).toBe(0);
      expect(stack.getEffective("Unit#1", "trait", "strong")).toBe(1); // not removed
    });
  });

  // -----------------------------------------------------------------------
  // Enable / Disable (Silence)
  // -----------------------------------------------------------------------

  describe("silence (disable/enable)", () => {
    test("disableByTarget makes getEffective return 0 for that type", () => {
      stack.apply({
        sourceId: "Card#1", sourceType: "unit",
        targetId: "Unit#1", type: "trait", key: "barrier", value: 1,
      });
      stack.apply({
        sourceId: "Equip#1", sourceType: "equipment",
        targetId: "Unit#1", type: "trait", key: "strong", value: 3,
      });

      stack.disableByTarget("Unit#1", "trait");

      expect(stack.getEffective("Unit#1", "trait", "barrier")).toBe(0);
      expect(stack.getEffective("Unit#1", "trait", "strong")).toBe(0);
    });

    test("disableByTarget does NOT delete modifiers — they still exist", () => {
      stack.apply({
        sourceId: "Equip#1", sourceType: "equipment",
        targetId: "Unit#1", type: "trait", key: "strong", value: 2,
      });

      stack.disableByTarget("Unit#1", "trait");

      // Modifier still indexed by source
      expect(stack.getSources("Unit#1")).toContain("Equip#1");

      // getModifiers still returns it (caller can check disabledCount prop)
      const mods = stack.getModifiers("Unit#1", "trait");
      expect(mods.length).toBe(1);
      expect(mods[0].disabledCount).toBe(1);
    });

    test("enableByTarget restores disabled modifiers", () => {
      stack.apply({
        sourceId: "Equip#1", sourceType: "equipment",
        targetId: "Unit#1", type: "trait", key: "strong", value: 2,
      });

      stack.disableByTarget("Unit#1", "trait");
      expect(stack.getEffective("Unit#1", "trait", "strong")).toBe(0);

      stack.enableByTarget("Unit#1", "trait");
      expect(stack.getEffective("Unit#1", "trait", "strong")).toBe(2);
    });

    test("equipment removed while silenced: no residual negative trait", () => {
      // This is THE key scenario from the design doc.
      // Equip Frog Fisher (Barrier) → Silence bearer → Unequip → Unsilence → No Barrier ✓
      stack.apply({
        sourceId: "Equip#FrogFisher", sourceType: "equipment",
        targetId: "Unit#1", type: "trait", key: "barrier", value: 1,
      });
      expect(stack.getEffective("Unit#1", "trait", "barrier")).toBe(1);

      // Silence: disable traits
      stack.disableByTarget("Unit#1", "trait");
      expect(stack.getEffective("Unit#1", "trait", "barrier")).toBe(0);

      // Unequip while silenced: remove modifier from source
      stack.removeBySource("Equip#FrogFisher");
      expect(stack.getSources("Unit#1")).toEqual([]);

      // Unsilence: nothing to re-enable
      stack.enableByTarget("Unit#1", "trait");
      expect(stack.getEffective("Unit#1", "trait", "barrier")).toBe(0);

      // Verify no "negative Barrier" — getEffective is 0, not -1
      expect(stack.getModifiers("Unit#1", "trait").length).toBe(0);
    });

    test("equipment NOT removed while silenced: Barrier returns on unsilence", () => {
      stack.apply({
        sourceId: "Equip#FrogFisher", sourceType: "equipment",
        targetId: "Unit#1", type: "trait", key: "barrier", value: 1,
      });

      stack.disableByTarget("Unit#1", "trait");
      expect(stack.getEffective("Unit#1", "trait", "barrier")).toBe(0);

      // Unsilence (without unequip)
      stack.enableByTarget("Unit#1", "trait");
      expect(stack.getEffective("Unit#1", "trait", "barrier")).toBe(1);
    });

    test("disableByTarget only affects specified types", () => {
      stack.apply({
        sourceId: "A", sourceType: "equipment",
        targetId: "Unit#1", type: "trait", key: "strong", value: 1,
      });
      stack.apply({
        sourceId: "B", sourceType: "unit",
        targetId: "Unit#1", type: "condition", key: "burned", value: 1,
      });

      stack.disableByTarget("Unit#1", "trait");

      expect(stack.getEffective("Unit#1", "trait", "strong")).toBe(0);
      expect(stack.getEffective("Unit#1", "condition", "burned")).toBe(1); // unaffected
    });

    test("disableByTarget accepts array of types", () => {
      stack.apply({
        sourceId: "A", sourceType: "equipment",
        targetId: "Unit#1", type: "trait", key: "strong", value: 1,
      });
      stack.apply({
        sourceId: "A", sourceType: "equipment",
        targetId: "Unit#1", type: "condition", key: "burned", value: 1,
      });

      stack.disableByTarget("Unit#1", ["trait", "condition"]);

      expect(stack.getEffective("Unit#1", "trait", "strong")).toBe(0);
      expect(stack.getEffective("Unit#1", "condition", "burned")).toBe(0);
    });

    // ── Overlapping silence ────────────────────────────────────────────────
    // Two silence effects applied → traits suppressed. One silence removed
    // → traits still suppressed. Both removed → traits active again.

    test("overlapping silence: two disables require two enables to restore", () => {
      stack.apply({
        sourceId: "A", sourceType: "unit",
        targetId: "Unit#1", type: "trait", key: "strong", value: 2,
      });

      stack.disableByTarget("Unit#1", "trait");
      stack.disableByTarget("Unit#1", "trait");
      expect(stack.getEffective("Unit#1", "trait", "strong")).toBe(0);

      stack.enableByTarget("Unit#1", "trait");
      expect(stack.getEffective("Unit#1", "trait", "strong")).toBe(0);

      stack.enableByTarget("Unit#1", "trait");
      expect(stack.getEffective("Unit#1", "trait", "strong")).toBe(2);
    });

    test("overlapping silence: enableByTarget never goes below disabledCount 0", () => {
      stack.apply({
        sourceId: "A", sourceType: "unit",
        targetId: "Unit#1", type: "trait", key: "strong", value: 1,
      });

      stack.disableByTarget("Unit#1", "trait");
      stack.enableByTarget("Unit#1", "trait");
      // Extra enable — should not cause negative count
      stack.enableByTarget("Unit#1", "trait");
      expect(stack.getEffective("Unit#1", "trait", "strong")).toBe(1);
    });

    test("unequip while double-silenced: removed source leaves no residue", () => {
      stack.apply({
        sourceId: "Equip#DoubleSilence", sourceType: "equipment",
        targetId: "Unit#1", type: "trait", key: "barrier", value: 1,
      });

      stack.disableByTarget("Unit#1", "trait");
      stack.disableByTarget("Unit#1", "trait");
      stack.removeBySource("Equip#DoubleSilence");
      expect(stack.getSources("Unit#1")).toEqual([]);

      stack.enableByTarget("Unit#1", "trait");
      stack.enableByTarget("Unit#1", "trait");
      expect(stack.getEffective("Unit#1", "trait", "barrier")).toBe(0);
    });

    // ── Operation precedence ───────────────────────────────────────────────

    test("override trumps set which trumps add in getEffective", () => {
      // add below a set
      stack.apply({
        sourceId: "A", sourceType: "unit",
        targetId: "Unit#1", type: "stat", key: "hp", value: 2,
      });
      stack.apply({
        sourceId: "B", sourceType: "equipment",
        targetId: "Unit#1", type: "stat", key: "hp",
        value: 5, operation: "set",
      });
      expect(stack.getEffective("Unit#1", "stat", "hp")).toBe(5);

      // override above the set
      stack.apply({
        sourceId: "C", sourceType: "system",
        targetId: "Unit#1", type: "stat", key: "hp",
        value: 10, operation: "override",
      });
      expect(stack.getEffective("Unit#1", "stat", "hp")).toBe(10);
    });

    test("disabled override is ignored — falls back to set", () => {
      stack.apply({
        sourceId: "A", sourceType: "equipment",
        targetId: "Unit#1", type: "stat", key: "hp",
        value: 5, operation: "set",
      });
      stack.apply({
        sourceId: "B", sourceType: "system",
        targetId: "Unit#1", type: "stat", key: "hp",
        value: 10, operation: "override",
      });

      // Silence the override modifier's type
      stack.disableByTarget("Unit#1", "stat");
      expect(stack.getEffective("Unit#1", "stat", "hp")).toBe(0);

      // Unsilence — override should win again
      stack.enableByTarget("Unit#1", "stat");
      expect(stack.getEffective("Unit#1", "stat", "hp")).toBe(10);
    });

    test("two overrides: highest priority wins, createdAt breaks ties", () => {
      const clock = new GameClock();
      const localBus = new EventBus(clock);
      const localStack = new ModifierStack(localBus, clock);

      localStack.apply({
        sourceId: "low", sourceType: "system",
        targetId: "U", type: "stat", key: "hp",
        value: 3, operation: "override", priority: 1,
      });
      localStack.apply({
        sourceId: "high", sourceType: "system",
        targetId: "U", type: "stat", key: "hp",
        value: 7, operation: "override", priority: 2,
      });
      expect(localStack.getEffective("U", "stat", "hp")).toBe(7);
    });
  });

  // -----------------------------------------------------------------------
  // Event emission
  // -----------------------------------------------------------------------

  describe("event emission", () => {
    test("apply emits modifier:<type>:granted event", () => {
      const listener = jest.fn();
      bus.on(EVT.MODIFIER_GRANTED("trait"), listener, { phase: "post" });

      stack.apply({
        sourceId: "Card#1", sourceType: "unit",
        targetId: "Unit#1", type: "trait", key: "lethal", value: 1,
      });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].key).toBe("lethal");
    });

    test("apply emits modifier:condition:granted for conditions", () => {
      const listener = jest.fn();
      bus.on(EVT.MODIFIER_GRANTED("condition"), listener, { phase: "post" });

      stack.apply({
        sourceId: "Unit#2", sourceType: "unit",
        targetId: "Unit#1", type: "condition", key: "poisoned", value: 3,
      });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].key).toBe("poisoned");
    });

    test("removing a modifier emits revocation event", () => {
      const granted = jest.fn();
      const revoked = jest.fn();
      bus.on(EVT.MODIFIER_GRANTED("trait"), granted, { phase: "post" });
      bus.on(EVT.MODIFIER_REVOKED("trait"), revoked, { phase: "post" });

      stack.apply({
        sourceId: "Card#1", sourceType: "unit",
        targetId: "Unit#1", type: "trait", key: "strong", value: 1,
      });
      stack.removeBySource("Card#1");

      expect(granted).toHaveBeenCalledTimes(1);
      expect(revoked).toHaveBeenCalledTimes(1);
    });

    test("auto-cleans up on unit:destroyed event", () => {
      stack.apply({
        sourceId: "Equip#1", sourceType: "equipment",
        targetId: "Unit#1", type: "trait", key: "strong", value: 3,
      });

      bus.emit(EVT.UNIT_DESTROYED, { unitId: "Unit#1" });

      expect(stack.getEffective("Unit#1", "trait", "strong")).toBe(0);
      expect(stack.getSources("Unit#1")).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe("edge cases", () => {
    test("getEffective for unknown target returns 0", () => {
      expect(stack.getEffective("GhostUnit", "trait", "strong")).toBe(0);
    });

    test("getModifiers for unknown target returns empty array", () => {
      expect(stack.getModifiers("Ghost", "trait")).toEqual([]);
    });

    test("removeBySource for unknown source does nothing", () => {
      expect(() => stack.removeBySource("Ghost")).not.toThrow();
    });

    test("removeByTarget for unknown target does nothing", () => {
      expect(() => stack.removeByTarget("Ghost")).not.toThrow();
    });

    test("clear() removes everything", () => {
      stack.apply({
        sourceId: "A", sourceType: "equipment",
        targetId: "Unit#1", type: "trait", key: "strong", value: 1,
      });
      stack.apply({
        sourceId: "B", sourceType: "equipment",
        targetId: "Unit#2", type: "condition", key: "burned", value: 1,
      });

      stack.clear();

      expect(stack.getEffective("Unit#1", "trait", "strong")).toBe(0);
      expect(stack.getEffective("Unit#2", "condition", "burned")).toBe(0);
    });
  });
});
