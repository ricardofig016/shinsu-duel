import DeployUnitAction from "./actions/DeployUnitAction.js";
import PassTurnAction from "./actions/PassTurnAction.js";

export default function createActionRegistry(gameState) {
  return {
    "deploy-unit-action": new DeployUnitAction(gameState),
    "pass-turn-action": new PassTurnAction(gameState),
  };
}
