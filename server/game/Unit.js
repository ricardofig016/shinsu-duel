/**
 * Represents a unit placed on the battlefield.
 * Phase 0: plain data container. Ability execution comes in Phase 3/4.
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

  // Stub — Phase 3/4 will implement ability/passive activation
  onSummon(gameState) {
    this.bus.publish("OnUnitSummoned", { unitId: this.id });
  }

  // Stub — Phase 3/4 will implement ability/passive deactivation
  onRemove(gameState) {
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

  // Stub — Phase 3/4 will implement ability dispatching from DSL objects
  useAbility(abilityCode, targetInfo = null, gameState) {
    // Placeholder: ability execution pipeline rebuilt in Phase 3/4
    this.bus.publish("OnUseAbilityIntent", { unitId: this.id, abilityCode, targetInfo });
    this.bus.publish("OnUseAbilityResolved", { unitId: this.id, abilityCode, targetInfo });
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
