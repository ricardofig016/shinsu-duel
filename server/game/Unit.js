import abilityRegistry from "./registries/abilityRegistry.js";

/**
 * Represents a unit placed on the battlefield.
 */
export default class Unit {
  constructor(card, placedPositionCode) {
    if (!card) throw new Error("Card instance is required to create a Unit");
    if (card.type !== "unit") throw new Error(`Invalid card type: expected 'unit', got '${card.type}'`);

    this.id = card.id; // unique instance id
    this.card = card;
    this.currentHp = card.maxHp;
    this.placedPositionCode = placedPositionCode;

    this.owner = card.owner; // player username
    this.bus = card.bus;
  }

  isAlive() {
    return this.currentHp > 0;
  }

  useAbility(abilityCode, targetInfo = null, gameState) {
    const ability = this.card.abilities.find((a) => a.code === abilityCode);
    if (!ability) {
      const abilityCodes = this.card.abilities.map((a) => a.code);
      throw new Error(
        `Unit ${this.card.cardId} - ${
          this.card.name
        } does not have ability ${abilityCode}\nAbilities: ${abilityCodes.join(", ")}`
      );
    }

    const context = { unit: this, target: targetInfo };

    // Validate context
    if (!ability.validate(context, gameState)) {
      throw new Error(`Ability "${ability.name}" cannot be used in the current context`);
    }

    // Create intent
    const intent = ability.toIntent(context, gameState);
    this.bus.publish("UseAbilityIntent", intent);

    // Resolve effects
    const action = ability.execute(context, gameState);
    this.bus.publish("UseAbilityResolved", { ...intent, action });

    // Apply effects
    ability.apply(action, gameState);
    this.bus.publish("UseAbilityApplied", { ...intent, action, finalState: "applied" });
  }

  toSanitizedObject() {
    return {
      id: this.id,
      card: this.card.toSanitizedObject(),
      currentHp: this.currentHp,
      placedPositionCode: this.placedPositionCode,
      owner: this.owner,
    };
  }
}
