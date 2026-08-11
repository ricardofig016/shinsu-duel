import DeployUnitAction from "../actions/DeployUnitAction.js";
import PassTurnAction from "../actions/PassTurnAction.js";
import UseAbilityAction from "../actions/UseAbilityAction.js";
import GenerateFireChargeAction from "../actions/GenerateFireChargeAction.js";
import PlaySkillAction from "../actions/PlaySkillAction.js";
import EquipEquipmentAction from "../actions/EquipEquipmentAction.js";
import SwitchPositionAction from "../actions/SwitchPositionAction.js";

export default function createActionRegistry() {
  return {
    "deploy-unit-action": new DeployUnitAction(),
    "pass-turn-action": new PassTurnAction(),
    "use-ability-action": new UseAbilityAction(),
    "generate-fire-charge-action": new GenerateFireChargeAction(),
    "play-skill-action": new PlaySkillAction(),
    "equip-equipment-action": new EquipEquipmentAction(),
    "switch-position-action": new SwitchPositionAction(),
  };
}
