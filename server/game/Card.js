import * as IdFactory from "./IdFactory.js";
import affiliations from "../data/affiliations.json" with { type: "json" };
import attributes from "../data/attributes.json" with { type: "json" };
import positions from "../data/positions.json" with { type: "json" };
import traits from "../data/traits.json" with { type: "json" };

export default class Card {
  constructor(cardId, cardData, owner, bus) {
    this.id = IdFactory.cardInstance(cardId); // deterministic instance id

    this.cardId = cardId;
    this.type = cardData.type;
    this.name = cardData.name;
    this.series = cardData.series ?? null;
    this.sobriquet = cardData.sobriquet || null;
    this.maxHp = cardData.hp ?? null;
    this.entryHp = cardData.entryHp ?? null; // unit creation HP; null = enter at maxHp
    this.cost = cardData.cost;
    this.rank = cardData.rank ?? null;
    this.kind = cardData.kind ?? "standard"; // unit archetype: standard | shinheuh | landmark | conduit
    this.line = cardData.line ?? null; // authored field line (shinheuh only)
    this.costReduction = 0;
    this.visible = false; // whether the card is visible to the opponent
    // Equipment instances kept through a return-to-hand; restored on redeploy.
    this.retainedEquipment = [];

    this.affiliations = this.#mapCodesToDictionary(cardData.affiliations || [], affiliations);
    this.positions = this.#mapCodesToDictionary(cardData.positions || [], positions);
    this.#addArtworkPathToDictionary(this.positions, "positions");
    this.traits = this.#mapTraitCodesToDictionary(cardData.traits || [], traits);
    this.#addArtworkPathToDictionary(this.traits, "traits");
    this.traitValues = this.#extractTraitValues(cardData.traits || []); // numeric trait values

    this.abilities = cardData.abilities || [];   // unified DSL objects
    this.passiveAbilities = cardData.passives || []; // unified DSL objects
    this.rules = cardData.rules || []; // landmark-only always-on battlefield rules
    this.attributes = cardData.attributes || [];
    this.keywords = cardData.keywords || [];
    this.requirements = cardData.requirements || [];
    this.effects = cardData.effects || [];
    this.deckConstraints = cardData.deckConstraints || [];
    this.evolveInto = cardData.evolveInto || null;
    this.evolvedFrom = cardData.evolvedFrom ?? null;
    this.igniteInto = cardData.igniteInto || null;
    this.ignitedFrom = cardData.ignitedFrom ?? null;

    this.owner = owner; // player username
    // Resolved by the compiler from the card slug (`<normalizeName(name)>.png`);
    // null for cards without artwork, which the frontend renders as placeholder.
    this.artworkPath = cardData.artworkPath ?? null;
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
    return dict;
  }

  #displayTexts(entries) {
    return (entries || [])
      .map((entry) => entry.raw ?? entry.text ?? "")
      .filter((text) => text !== "");
  }

  #attributeViews() {
    const catalogOrder = new Map(Object.keys(attributes).map((code, index) => [code, index]));
    const views = Object.fromEntries(
      this.attributes
        .filter((code) => attributes[code] !== undefined)
        .sort((a, b) => catalogOrder.get(a) - catalogOrder.get(b))
        .map((code) => [code, { ...attributes[code] }])
    );
    return this.#addArtworkPathToDictionary(views, "attributes");
  }

  /**
   * Client-facing card view. Printed information a player reads off the card
   * (rank, requirements, effect/rule texts, evolve/ignition triggers) is
   * projected into display-ready strings; looked-up metadata (attributes)
   * is stamped with names, descriptions, and icon paths like the other
   * code dictionaries. Hidden cards never reach the opponent because the
   * state projection replaces them with empty views.
   */
  toSanitizedObject() {
    return {
      id: this.id,
      cardId: this.cardId,
      type: this.type,
      kind: this.kind,
      line: this.line,
      name: this.name,
      sobriquet: this.sobriquet,
      maxHp: this.maxHp,
      entryHp: this.entryHp,
      cost: this.cost,
      costReduction: this.costReduction,
      effectiveCost: Math.max(0, this.cost - this.costReduction),
      rank: this.rank,
      visible: this.visible,
      affiliations: this.affiliations,
      positions: this.positions,
      traits: this.traits,
      attributes: this.#attributeViews(),
      abilities: this.abilities,
      passiveAbilities: this.passiveAbilities,
      requirements: [...this.requirements],
      effects: this.#displayTexts(this.effects),
      rules: this.#displayTexts(this.rules),
      evolveTriggers: this.evolveInto ? this.#displayTexts(this.evolveInto.triggers) : null,
      igniteTriggers: this.igniteInto ? this.#displayTexts(this.igniteInto.triggers) : null,
      owner: this.owner,
      artworkPath: this.artworkPath,
    };
  }
}
