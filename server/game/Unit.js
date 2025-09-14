import abilityRegistry from "./registries/abilityRegistry.js";

export default class Unit {
  constructor(gameState, cardId, cardData, owner, placedPositionCode, bus) {
    this.id = Math.random().toString(36).substring(2, 9); // unique instance id

    this.cardId = cardId;
    this.name = cardData.name;
    this.sobriquet = cardData.sobriquet || null;
    this.rarity = cardData.rarity;
    this.maxHp = cardData.hp;
    this.currentHp = cardData.hp;
    this.cost = cardData.cost;
    this.placedPositionCode = placedPositionCode;

    this.abilityCodes = [...cardData.abilityCodes]; // array of ability ids
    this.traitCodes = [...cardData.traitCodes];
    this.affiliationCodes = [...cardData.affiliationCodes];
    this.passiveCodes = [...cardData.passiveCodes];

    this.gameState = gameState;
    this.owner = owner; // player username
    this.bus = bus;

    this.#initializeAbilities();
  }

  #initializeAbilities() {
    this.abilities = this.abilityCodes.map((code) => {
      const AbilityClass = abilityRegistry[code];

      if (!AbilityClass) return; // TODO: remove this line after testing
      if (!AbilityClass) throw new Error(`Ability with code ${code} not found in registry`);

      return new AbilityClass(this.gameState);
    });
  }

  isAlive() {
    return this.currentHp > 0;
  }

  useAbility(abilityCode, targetInfo = null) {
    const ability = this.abilities.find((a) => a.code === abilityCode);
    if (!ability)
      throw new Error(
        `Unit ${this.cardId} - ${
          this.name
        } does not have ability ${abilityCode}\nAbilities: ${this.abilityCodes.join(", ")}`
      );

    const context = { unit: this, target: targetInfo };

    // Validate context
    if (!ability.validate(context)) {
      throw new Error(`Ability "${ability.name}" cannot be used in the current context`);
    }

    // Create intent
    const intent = ability.toIntent(context);
    this.bus.publish("UseAbilityIntent", intent);

    // Resolve effects
    const action = ability.execute(context);
    this.bus.publish("UseAbilityResolved", { ...intent, action });

    // Apply effects
    ability.apply(action);
    this.bus.publish("UseAbilityApplied", { ...intent, action, finalState: "applied" });
  }
}
