import * as IdFactory from "./IdFactory.js";
import affiliations from "../data/affiliations.json" with { type: "json" };
import { getAttributes, getPositions, getTraits } from "./displayCatalogs.js";

// Guide attributes carry their category in the tooltip title (RULES.md §Guide).
const GUIDE_ATTRIBUTES = new Set(["silver-dwarf", "red-witch"]);

const attributeTitle = (code, data) => (GUIDE_ATTRIBUTES.has(code) ? `Guide - ${data.name}` : data.name);

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
    this.positions = this.#mapCodesToDictionary(cardData.positions || [], getPositions());
    this.#addArtworkPathToDictionary(this.positions, "positions");
    this.traits = this.#mapTraitCodesToDictionary(cardData.traits || [], getTraits());
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
    // The persistent card identifier, stamped by the compiler; the runtime
    // cardId is a compile-time index that shifts when the catalog changes.
    this.slug = cardData.slug ?? null;
    // The compiler's related-card stamp (see docs/COMPILED_CARD_DSL.md);
    // entries are { cardId, kind } resolved client-side against the catalog.
    this.relatedCards = cardData.relatedCards ?? null;
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

  #textSegments(entries) {
    return (entries || [])
      .filter((entry) => Array.isArray(entry.text) && entry.text.length > 0)
      .map((entry) => entry.text);
  }

  /**
   * Attribute views in canonical catalog order. Name and prose come from the
   * shared catalog projection, where prose fields carry compiled display
   * segments (see `docs/COMPILED_CARD_DSL.md`), so an attribute tooltip keeps
   * its inline links.
   */
  #attributeViews() {
    const catalog = getAttributes();
    const catalogOrder = new Map(Object.keys(catalog).map((code, index) => [code, index]));
    const views = Object.fromEntries(
      this.attributes
        .filter((code) => catalog[code] !== undefined)
        .sort((a, b) => catalogOrder.get(a) - catalogOrder.get(b))
        .map((code) => [code, { ...catalog[code], title: attributeTitle(code, catalog[code]) }])
    );
    return this.#addArtworkPathToDictionary(views, "attributes");
  }

  /**
   * Printed trait views: the shared catalog projection, which carries compiled
   * display segments for the trait's prose plus its icon path and numeric
   * flag, with the value this card prints for the trait. A card face shows a
   * numeric trait's number before the card is ever deployed, and a trait
   * authored without a value falls back to the same default the engine applies
   * when it wires the unit's modifiers. A non-numeric trait carries no value.
   */
  #traitViews() {
    return Object.fromEntries(
      Object.entries(this.traits).map(([code, entry]) => [
        code,
        { ...entry, value: entry.numeric === true ? this.traitValues?.[code] ?? 1 : null },
      ])
    );
  }

  /**
   * Client-facing card view. Printed information a player reads off the card
   * (rank, requirements, effect/rule texts, evolve/ignition triggers) is
   * projected as compiled display segments — the client renders and links
   * them, it never re-parses authored text; looked-up metadata (attributes,
   * traits, positions) is stamped from the shared catalog projection, which
   * carries compiled display segments for its prose plus the icon paths, so
   * link markup in shared copy reaches the client too. Hidden cards never
   * reach the opponent because the state projection replaces them with empty
   * views.
   */
  toSanitizedObject() {
    return {
      id: this.id,
      cardId: this.cardId,
      slug: this.slug,
      type: this.type,
      kind: this.kind,
      line: this.line,
      name: this.name,
      series: this.series,
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
      traits: this.#traitViews(),
      attributes: this.#attributeViews(),
      abilities: this.abilities,
      passiveAbilities: this.passiveAbilities,
      requirements: this.#textSegments(this.requirements),
      effects: this.#textSegments(this.effects),
      rules: this.#textSegments(this.rules),
      evolveTriggers: this.evolveInto ? this.#textSegments(this.evolveInto.triggers) : null,
      igniteTriggers: this.igniteInto ? this.#textSegments(this.igniteInto.triggers) : null,
      relatedCards: this.relatedCards,
      owner: this.owner,
      artworkPath: this.artworkPath,
    };
  }
}
