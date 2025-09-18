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

  // Called when the unit is placed on the field
  onSummon(gameState) {
    // Activate all passive abilities
    this.card.passiveAbilities.forEach((passive) => {
      passive.activate(this, gameState);
    });

    this.bus.publish("OnUnitSummoned", { unitId: this.id });
  }

  // Called when the unit is removed from the field
  onRemove(gameState) {
    // Deactivate all passive abilities
    this.card.passiveAbilities.forEach((passive) => {
      passive.deactivate(this, gameState);
    });

    this.bus.publish("OnUnitRemoved", { unitId: this.id });
  }

  isAlive() {
    return this.currentHp > 0;
  }

  takeDamage(amount) {
    const damageAmount = Math.max(0, parseInt(amount) || 0);

    // Publish event before damage is applied (allows for damage modification)
    this.bus.publish("OnDealDamageIntent", {
      source: this.toSanitizedObject(),
      target: this.toSanitizedObject(),
      damageAmount: damageAmount,
      message: `${this.card.name} is about to take ${damageAmount} damage from itself`,
    });

    // Apply damage
    this.currentHp = Math.max(0, this.currentHp - damageAmount);

    // Publish event after damage is applied
    this.bus.publish("OnDealDamageApplied", {
      unit: this.toSanitizedObject(),
      damageAmount: damageAmount,
      message: `${this.card.name} took ${damageAmount} damage from itself and is now at ${this.currentHp} HP`,
    });

    return this.currentHp;
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
      throw new Error(`Ability "${ability.text}" cannot be used in the current context`);
    }

    // Create intent
    const intent = ability.toIntent(context, gameState);
    this.bus.publish("OnUseAbilityIntent", intent);

    // Resolve effects
    const action = ability.execute(context, gameState);
    ability.apply(action, gameState);
    this.bus.publish("OnUseAbilityResolved", { ...intent, action });
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
