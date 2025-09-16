export default class Ability {
  /**
   * Represents an ability that a unit can use
   * @param {string} code - unique identifier
   * @param {string} name - name of the ability
   * @param {object} params - additional parameters
   */
  constructor(code, name, params = {}) {
    this.code = code;
    this.name = name;
    this.params = params;
  }

  validate(context, gameState) {
    // Default behavior: always valid
    return true;
  }

  toIntent(context, gameState) {
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

  execute(context, gameState) {
    // Default behavior: no-op
    return { action: "noop" };
  }

  apply(effect, gameState) {
    // Default behavior: no-op
    return;
  }
}
