export default class Ability {
  /**
   * Represents an ability that a unit can use
   * @param {string} code - unique identifier
   * @param {string} text - text to display on the card
   * @param {object} params - additional parameters
   */
  constructor(code, text, params = {}) {
    this.code = code;
    this.text = text;
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
      abilityText: this.text,
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
