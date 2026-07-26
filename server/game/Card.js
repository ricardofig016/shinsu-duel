import affiliations from "../data/affiliations.json" with { type: "json" };
import positions from "../data/positions.json" with { type: "json" };
import traits from "../data/traits.json" with { type: "json" };

export default class Card {
  constructor(cardId, cardData, owner, bus) {
    this.id = Math.random().toString(36).substring(2, 9); // unique instance id

    this.cardId = cardId;
    this.type = cardData.type;
    this.name = cardData.name;
    this.sobriquet = cardData.sobriquet || null;
    this.rarity = cardData.rarity;
    this.maxHp = cardData.hp ?? null;
    this.cost = cardData.cost;
    this.visible = false; // whether the card is visible to the opponent

    this.affiliations = this.#mapCodesToDictionary(cardData.affiliationCodes || [], affiliations);
    this.positions = this.#mapCodesToDictionary(cardData.positionCodes || [], positions);
    this.#addArtworkPathToDictionary(this.positions, "positions");
    this.traits = this.#mapTraitCodesToDictionary(cardData.traitCodes || [], traits);
    this.#addArtworkPathToDictionary(this.traits, "traits");
    this.traitValues = this.#extractTraitValues(cardData.traitCodes || []); // numeric trait values

    this.abilities = cardData.abilityCodes || [];   // unified DSL objects
    this.passiveAbilities = cardData.passiveCodes || []; // unified DSL objects

    this.owner = owner; // player username
    this.artworkPath = `/assets/images/artworks/${this.cardId}.png`;
    this.bus = bus;
  }

  #mapCodesToDictionary(codes, source) {
    return Object.fromEntries(
      codes
        .filter((code) => source[code] !== undefined)
        .map((code) => [code, source[code]])
    );
  }

  // Trait codes are { code, value? }; extract code for traits.json lookup
  #mapTraitCodesToDictionary(traitCodes, source) {
    return Object.fromEntries(
      traitCodes
        .filter((t) => {
          const code = typeof t === "string" ? t : t.code;
          return source[code] !== undefined;
        })
        .map((t) => {
          const code = typeof t === "string" ? t : t.code;
          return [code, source[code]];
        })
    );
  }

  // Extract numeric values from trait objects (e.g. "last-one-standing" has value 4)
  #extractTraitValues(traitCodes) {
    const values = {};
    for (const t of traitCodes) {
      if (typeof t === "object" && t.value !== undefined && t.value !== null) {
        values[t.code] = t.value;
      }
    }
    return values;
  }

  #addArtworkPathToDictionary(dict, type) {
    for (const key in dict) {
      if (dict[key] && typeof dict[key] === "object") {
        dict[key].iconPath = `/assets/icons/${type}/${key}.png`;
      }
    }
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
      artworkPath: this.artworkPath,
    };
  }
}
