import PassiveAbility from "../PassiveAbility.js";

export default class RoundEndTakeOneDamage extends PassiveAbility {
  constructor() {
    super("round-end-take-one-damage", "Round End: I take 1 Damage", { damageAmount: 1 });
  }

  registerListeners(unit, gameState) {
    // Subscribe to round end events
    this.registerEvent(unit.bus, "OnRoundEnd", () => {
      // Apply damage to self
      const damageAmount = this.params.damageAmount;
      unit.takeDamage(damageAmount);

      // Publish event for UI/logging
      unit.bus.publish("OnPassiveTriggered", {
        unitId: unit.id,
        passiveCode: this.code,
        message: `${unit.card.name} will take ${damageAmount} damage from passive ability ${this.code}`,
      });

      // If the unit died from this damage, handle it
      if (!unit.isAlive()) {
        unit.bus.publish("OnUnitDeath", {
          unitId: unit.id,
          causeType: "passive",
          causeId: this.code,
          message: `${unit.card.name} took fatal damage from passive ability ${this.code}`,
        });
      }
    });

    // Log that passive is active when unit is summoned
    unit.bus.publish("OnPassiveActivated", {
      unitId: unit.id,
      passiveCode: this.code,
      message: `${unit.card.name} will take ${this.params.damageAmount} damage at the end of each round`,
    });
  }
}
