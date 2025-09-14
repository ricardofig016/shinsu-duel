export default class Ability {
  /**
   * Represents an ability that a unit can use
   * @param {string} code - unique identifier
   * @param {string} name - name of the ability
   * @param {object} params - additional parameters
   */
  constructor(gameState, code, name, params = {}) {
    this.gameState = gameState;
    this.code = code;
    this.name = name;
    this.params = params;
  }

  validate(context) {
    // Default behavior: always valid
    return true;
  }

  toIntent(context) {
    return {
      type: "UseAbilityIntent",
      abilityId: this.code,
      abilityName: this.name,
      params: this.params,
      unitId: context.unit?.id,
      owner: context.unit?.owner,
      target: context.target ?? null,
    };
  }

  execute(context) {
    // Default behavior: no-op
    return { action: "noop" };
  }

  apply(effect) {
    // Default behavior: no-op
    return;
  }
}
