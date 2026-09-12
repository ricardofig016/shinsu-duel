import DebugAction from "./DebugAction.js";
import UnitService from "../../services/UnitService.js";

/**
 * Set a deployed unit's HP to an absolute value.
 *
 * This is a raw authoritative write through `UnitService`, not damage or
 * healing, so no damage/heal triggers fire: the console sets the number and
 * every other unit rule keeps observing the unit as it now is. Setting 0
 * leaves a unit on the field at 0 HP; destroying it goes through
 * `debug-destroy-unit-action` so the destruction pipeline runs.
 */
export default class DebugUnitHpAction extends DebugAction {
  static schema = {
    ...DebugAction.schema,
    unitId: "string",
    value: "number",
  };

  validate(data, gameState) {
    super.validate(data, gameState);
    this.targetUnit(data, gameState);
    DebugAction.requireInteger(data.value, "value");
  }

  execute(data, gameState) {
    UnitService.setHp(this.targetUnit(data, gameState), data.value);
  }
}
