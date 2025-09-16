import Ability from "../Ability.js";

export default class CreateOneLighthouse extends Ability {
  constructor() {
    super("create-one-lighthouse", "Create One Lighthouse", { amount: 1 });
  }

  validate(context, gameState) {
    return context.unit.owner in gameState.playerStates;
  }

  execute(context, gameState) {
    return {
      type: "add-lighthouses-action",
      data: { source: "system", username: context.unit.owner, amount: this.params.amount },
    };
  }

  apply(action, gameState) {
    gameState.processAction(action);
    gameState.endTurn();
  }
}
