import abilityRegistry from "./registries/abilityRegistry.js";
import passiveAbilityRegisttry from "./registries/passiveAbilityRegisttry.js";
import affiliations from "../data/affiliations.json" assert { type: "json" };
import positions from "../data/positions.json" assert { type: "json" };
import traits from "../data/traits.json" assert { type: "json" };

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

    this.affiliations = this.#mapCodesToDictionary(cardData.affiliationCodes, affiliations);
    this.positions = this.#mapCodesToDictionary(cardData.positionCodes, positions);
    this.traits = this.#mapCodesToDictionary(cardData.traitCodes, traits);

    this.abilities = this.#initializeAbilities(cardData.abilityCodes, abilityRegistry);
    this.passiveAbilities = this.#initializeAbilities(cardData.passiveCodes, passiveAbilityRegisttry);

    this.owner = owner; // player username
    this.bus = bus;
  }

  #mapCodesToDictionary(codes, source) {
    return Object.fromEntries(codes.map((code) => [code, source[code]]));
  }

  /**
   * Can be used to initialize abilities or passive abilities
   * @param {*} codes array of ability codes / passive ability codes
   * @param {*} registry ability registry to use
   * @returns
   */
  #initializeAbilities(codes, registry) {
    return codes.map((code) => {
      const AbilityClass = registry[code];
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
      affiliations: this.affiliations,
      positions: this.positions,
      traits: this.traits,
      abilities: this.abilities,
      passiveAbilities: this.passiveAbilities,
      owner: this.owner,
    };
  }
}
