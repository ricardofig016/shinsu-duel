/**
 * Represents a unit placed on the battlefield.
 *
 * Ability and passive resolution is owned by the event/handler pipeline;
 * Unit only emits lifecycle intents and stores instance state.
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
    this.bus.emit("OnUnitSummoned", { unitId: this.id });
  }

  onRemove(gameState) {
    this.bus.emit("OnUnitRemoved", { unitId: this.id });
  }

  isAlive() {
    return this.currentHp > 0;
  }

  takeDamage(amount) {
    const damageAmount = Math.max(0, parseInt(amount) || 0);

    // Emit event before damage is applied (allows for damage modification)
    this.bus.emit("OnDealDamageIntent", {
      source: this.toSanitizedObject(),
      target: this.toSanitizedObject(),
      damageAmount: damageAmount,
      message: `${this.card.name} is about to take ${damageAmount} damage from itself`,
    });

    // Apply damage
    this.currentHp = Math.max(0, this.currentHp - damageAmount);

    // Emit event after damage is applied
    this.bus.emit("OnDealDamageApplied", {
      unit: this.toSanitizedObject(),
      damageAmount: damageAmount,
      message: `${this.card.name} took ${damageAmount} damage from itself and is now at ${this.currentHp} HP`,
    });

    return this.currentHp;
  }

  useAbility(abilityCode, targetInfo = null, gameState) {
    this.bus.emit("unit:ability:intent", {
      unitId: this.id,
      abilityCode,
      targetInfo,
      gameState,
    });
    this.bus.emit("unit:ability:resolved", {
      unitId: this.id,
      abilityCode,
      targetInfo,
    });
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
