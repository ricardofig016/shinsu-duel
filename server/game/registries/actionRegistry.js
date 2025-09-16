import DeployUnitAction from "../actions/DeployUnitAction.js";
import PassTurnAction from "../actions/PassTurnAction.js";
import UseAbilityAction from "../actions/UseAbilityAction.js";
import AddLighthousesAction from "../actions/AddLighthousesAction.js";

export default function createActionRegistry() {
  return {
    "deploy-unit-action": new DeployUnitAction(),
    "pass-turn-action": new PassTurnAction(),
    "use-ability-action": new UseAbilityAction(),
    "add-lighthouses-action": new AddLighthousesAction(),
  };
}
