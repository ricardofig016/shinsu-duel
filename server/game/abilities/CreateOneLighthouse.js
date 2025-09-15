import Ability from "../Ability.js";

export default class CreateOneLighthouse extends Ability {
  constructor(gameState) {
    super(gameState, "create-one-lighthouse", "Create One Lighthouse", { amount: 1 });
  }

  validate(context) {
    return context.unit.owner in this.gameState.playerStates;
  }

  execute(context) {
    return {
      type: "add-lighthouses-action",
      data: { source: "system", username: context.unit.owner, amount: this.params.amount },
    };
  }

  apply(action) {
    this.gameState.processAction(action);
  }
}
