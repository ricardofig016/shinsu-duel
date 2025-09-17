import abilityRegistry from "./registries/abilityRegistry.js";

export default class Card {
  constructor(cardId, cardData, owner, bus) {
    this.id = Math.random().toString(36).substring(2, 9); // unique instance id

    this.cardId = cardId;
    this.type = cardData.type;
    this.name = cardData.name;
    this.sobriquet = cardData.sobriquet || null;
    this.rarity = cardData.rarity;
    this.maxHp = cardData.hp;
    this.cost = cardData.cost;
    this.visible = false; // whether the card is visible to the opponent

    this.affiliationCodes = [...cardData.affiliationCodes];
    this.positionCodes = [...cardData.positionCodes];
    this.traitCodes = [...cardData.traitCodes];

    this.abilities = this.#initializeAbilities(cardData.abilityCodes);
    this.passiveCodes = [...cardData.passiveCodes];

    this.owner = owner; // player username
    this.bus = bus;
  }

  #initializeAbilities(abilityCodes) {
    return abilityCodes.map((code) => {
      const AbilityClass = abilityRegistry[code];
      if (!AbilityClass) throw new Error(`Ability with code ${code} not found in registry`);
      return new AbilityClass();
    });
  }

  toSanitizedObject() {
    return {
      id: this.id,
      cardId: this.cardId,
      type: this.type,
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
