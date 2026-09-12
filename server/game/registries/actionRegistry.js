import DeployUnitAction from "../actions/DeployUnitAction.js";
import PassTurnAction from "../actions/PassTurnAction.js";
import UseAbilityAction from "../actions/UseAbilityAction.js";
import GenerateFireChargeAction from "../actions/GenerateFireChargeAction.js";
import PlaySkillAction from "../actions/PlaySkillAction.js";
import EquipEquipmentAction from "../actions/EquipEquipmentAction.js";
import SwitchPositionAction from "../actions/SwitchPositionAction.js";
import DebugDrawAction from "../actions/debug/DebugDrawAction.js";
import DebugAddToHandAction from "../actions/debug/DebugAddToHandAction.js";
import DebugAddToDeckAction from "../actions/debug/DebugAddToDeckAction.js";
import DebugShuffleDeckAction from "../actions/debug/DebugShuffleDeckAction.js";
import DebugMulliganAction from "../actions/debug/DebugMulliganAction.js";
import DebugGrantShinsuAction from "../actions/debug/DebugGrantShinsuAction.js";
import DebugEndRoundAction from "../actions/debug/DebugEndRoundAction.js";
import DebugForceTurnAction from "../actions/debug/DebugForceTurnAction.js";
import DebugSetRoundAction from "../actions/debug/DebugSetRoundAction.js";
import DebugSpawnUnitAction from "../actions/debug/DebugSpawnUnitAction.js";
import DebugUnitHpAction from "../actions/debug/DebugUnitHpAction.js";
import DebugDestroyUnitAction from "../actions/debug/DebugDestroyUnitAction.js";
import DebugLighthousesAction from "../actions/debug/DebugLighthousesAction.js";

/**
 * Wire type → action handler. Player actions admit `source: "player"` only,
 * debug actions admit `source: "debug"` only, so the two vocabularies stay
 * isolated in both directions (see `ActionHandler.sourceAccess`).
 */
export default function createActionRegistry() {
  return {
    "deploy-unit-action": new DeployUnitAction(),
    "pass-turn-action": new PassTurnAction(),
    "use-ability-action": new UseAbilityAction(),
    "generate-fire-charge-action": new GenerateFireChargeAction(),
    "play-skill-action": new PlaySkillAction(),
    "equip-equipment-action": new EquipEquipmentAction(),
    "switch-position-action": new SwitchPositionAction(),

    "debug-draw-action": new DebugDrawAction(),
    "debug-add-to-hand-action": new DebugAddToHandAction(),
    "debug-add-to-deck-action": new DebugAddToDeckAction(),
    "debug-shuffle-deck-action": new DebugShuffleDeckAction(),
    "debug-mulligan-action": new DebugMulliganAction(),
    "debug-grant-shinsu-action": new DebugGrantShinsuAction(),
    "debug-end-round-action": new DebugEndRoundAction(),
    "debug-force-turn-action": new DebugForceTurnAction(),
    "debug-set-round-action": new DebugSetRoundAction(),
    "debug-spawn-unit-action": new DebugSpawnUnitAction(),
    "debug-unit-hp-action": new DebugUnitHpAction(),
    "debug-destroy-unit-action": new DebugDestroyUnitAction(),
    "debug-lighthouses-action": new DebugLighthousesAction(),
  };
}
