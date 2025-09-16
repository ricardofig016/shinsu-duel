import abilityRegistry from "./registries/abilityRegistry.js";

export default class Card {
  constructor(cardId, cardData, owner, bus) {
    this.id = Math.random().toString(36).substring(2, 9); // unique instance id

    this.cardId = cardId;
    this.name = cardData.name;
    this.sobriquet = cardData.sobriquet || null;
    this.rarity = cardData.rarity;
    this.maxHp = cardData.hp;
    this.cost = cardData.cost;
    this.visible = false; // whether the card is visible to the opponent

    this.positionCodes = [...cardData.positionCodes];
    this.abilityCodes = [...cardData.abilityCodes]; // array of ability ids
    this.traitCodes = [...cardData.traitCodes];
    this.affiliationCodes = [...cardData.affiliationCodes];
    this.passiveCodes = [...cardData.passiveCodes];

    this.owner = owner; // player username
    this.bus = bus;

    this.#initializeAbilities();
  }

  #initializeAbilities() {
    this.abilities = this.abilityCodes.map((code) => {
      const AbilityClass = abilityRegistry[code];

      if (!AbilityClass) return; // TODO: remove this line after testing
      if (!AbilityClass) throw new Error(`Ability with code ${code} not found in registry`);

      return new AbilityClass();
    });
  }

  toSanitizedObject() {
    return {
      id: this.id,
      cardId: this.cardId,
      name: this.name,
      sobriquet: this.sobriquet,
      rarity: this.rarity,
      maxHp: this.maxHp,
      cost: this.cost,
      visible: this.visible,
      positionCodes: this.positionCodes,
      abilities: this.abilities,
      traitCodes: this.traitCodes,
      affiliationCodes: this.affiliationCodes,
      passiveCodes: this.passiveCodes,
      owner: this.owner,
    };
  }
}
