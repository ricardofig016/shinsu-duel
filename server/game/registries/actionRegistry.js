import DeployUnitAction from "../actions/DeployUnitAction.js";
import PassTurnAction from "../actions/PassTurnAction.js";
import UseAbilityAction from "../actions/UseAbilityAction.js";
import AddLighthousesAction from "../actions/AddLighthousesAction.js";

export default function createActionRegistry(gameState) {
  return {
    "deploy-unit-action": new DeployUnitAction(gameState),
    "pass-turn-action": new PassTurnAction(gameState),
    "use-ability-action": new UseAbilityAction(gameState),
    "add-lighthouses-action": new AddLighthousesAction(gameState),
  };
}
