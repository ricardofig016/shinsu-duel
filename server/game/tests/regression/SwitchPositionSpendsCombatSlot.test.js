/**
 * Regression: switching a unit's position spends the combat slot of the
 * position it leaves, and a switch out of a position whose slot is already
 * spent is refused (RULES.md §Combat Slots 6). The destination's slot is
 * deliberately irrelevant — a spent destination is still reachable — and a
 * switch never spends the destination's slot.
 *
 * Bug: neither `SwitchPositionAction` nor `LifecycleEngine.switchPosition` read
 * or spent a combat slot, so a unit printing two positions could be switched
 * back and forth for the whole round. Because the per-position ability limit
 * (RULES.md §Combat Slots 5) is keyed to the position the unit occupies, each
 * hop also handed the unit a fresh slot to use, dodging that limit.
 *
 * Every move here is otherwise legal — the unit prints both positions, the
 * seat holds the turn, and the destinations are real positions — so the only
 * thing that can refuse a hop is the departure slot. That is what makes the
 * refusals below attributable to the rule rather than to an unrelated
 * illegality, and what makes them fail against the pre-fix engine (which
 * accepted every hop).
 */

import { setupGameWithHands, deployUnit } from "../utils.js";
import CombatSlotService from "../../services/CombatSlotService.js";

const SEAT = "Alice";
const UNIT_NAME = "Test Multi Position";
const FROM = "fisherman";
const TO = "spear-bearer";

describe("switch position spends the departure combat slot", () => {
  /** Deploy the two-position unit at FROM with the seat holding the turn. */
  function board() {
    const game = setupGameWithHands({ [SEAT]: [UNIT_NAME] });
    const unit = deployUnit(game, SEAT, UNIT_NAME, FROM);
    game.currentTurn = SEAT;
    return { game, unit };
  }

  /**
   * Submit a switch, giving the seat the turn first so that a refusal can
   * never be explained by turn order.
   */
  function switchTo(game, unit, positionCode) {
    game.currentTurn = SEAT;
    return game.processAction({
      type: "switch-position-action",
      data: { source: "player", username: SEAT, unitId: unit.id, positionCode },
    });
  }

  const slot = (game, positionCode) => CombatSlotService.isAvailable(game.playerStates[SEAT], positionCode);

  test("a first switch is accepted, spends the departure slot, and leaves the destination slot available", () => {
    const { game, unit } = board();
    expect(slot(game, FROM)).toBe(true);

    switchTo(game, unit, TO);

    expect(unit.placedPositionCode).toBe(TO);
    expect(game.playerStates[SEAT].field.backline).toContain(unit);
    expect(slot(game, FROM)).toBe(false);
    expect(slot(game, TO)).toBe(true);
  });

  test("a switch into a position whose slot is already spent is still accepted", () => {
    const { game, unit } = board();
    switchTo(game, unit, TO);

    // FROM's slot is spent at this point: the rule says that does not block
    // arriving there, and arriving does not spend the destination's slot.
    expect(slot(game, FROM)).toBe(false);
    switchTo(game, unit, FROM);

    expect(unit.placedPositionCode).toBe(FROM);
    expect(slot(game, FROM)).toBe(false);
    expect(slot(game, TO)).toBe(false);
  });

  test("a further switch out of the spent position is refused and mutates nothing", () => {
    const { game, unit } = board();
    switchTo(game, unit, TO);
    switchTo(game, unit, FROM);
    const unitLineBefore = game.playerStates[SEAT].field.frontline;

    expect(() => switchTo(game, unit, TO)).toThrow(/combat slot/i);

    // Validation is side-effect free: the refused attempt moved nothing, spent
    // no slot, and did not end the turn (execute never ran).
    expect(unit.placedPositionCode).toBe(FROM);
    expect(game.playerStates[SEAT].field.frontline).toBe(unitLineBefore);
    expect(game.playerStates[SEAT].field.frontline).toContain(unit);
    expect(game.currentTurn).toBe(SEAT);
    expect(slot(game, FROM)).toBe(false);
    expect(slot(game, TO)).toBe(false);
  });

  test("the identical switch is accepted while the departure slot is available", () => {
    // The control for the refusal above: the same unit, same destination, same
    // seat, same turn — only the departure slot differs. A refusal therefore
    // reads the slot, not the move.
    const { game, unit } = board();
    switchTo(game, unit, TO);
    expect(slot(game, FROM)).toBe(false);

    const fresh = board();
    switchTo(fresh.game, fresh.unit, TO);
    expect(fresh.unit.placedPositionCode).toBe(TO);

    // And a slot spent by an ability, not by a switch, refuses the switch too:
    // the slot belongs to the position, so whatever spent it, it is spent.
    const spent = board();
    CombatSlotService.consume(spent.game.playerStates[SEAT], FROM);
    expect(() => switchTo(spent.game, spent.unit, TO)).toThrow(/combat slot/i);
    expect(spent.unit.placedPositionCode).toBe(FROM);
  });
});
