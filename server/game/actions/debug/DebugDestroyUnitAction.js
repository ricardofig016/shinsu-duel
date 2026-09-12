import DebugAction from "./DebugAction.js";
import LifecycleEngine from "../../services/LifecycleEngine.js";

/**
 * Destroy a deployed unit through the lifecycle engine: destroy intent,
 * equipment return, modifier cleanup, and the canonical destruction events.
 */
export default class DebugDestroyUnitAction extends DebugAction {
  static schema = {
    ...DebugAction.schema,
    unitId: "string",
  };

  validate(data, gameState) {
    super.validate(data, gameState);
    this.targetUnit(data, gameState);
  }

  execute(data, gameState) {
    LifecycleEngine.destroyUnit(gameState, this.targetUnit(data, gameState));
  }
}
