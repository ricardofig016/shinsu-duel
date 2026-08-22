/**
 * Stable, test-owned card catalog.
 *
 * These cards are the ONLY card definitions unit/integration tests resolve
 * against. They are deliberately independent of `server/data/cards.json` and
 * the `data/cards/**` YAML sources, so balance patches and card-content edits
 * never break implementation tests. A fixture changes only when the compiled
 * card *contract* (see `schemas/compiled-cards.schema.json`) changes.
 *
 * Fixture cards use a dedicated id range (1000+) and a `Test` naming prefix so
 * they can never collide with, or be confused for, shipped cards. Structural
 * codes (`series`, trait/position/affiliation/attribute codes) intentionally
 * reuse the shipped catalog vocabulary (`server/data/*.json`) because those
 * are fixed game concepts, not balance data.
 *
 * Exceptions:
 *   - `Fire Core` keeps its exact name because `HwayeomsaEngine` hardcodes it.
 *   - `series: "incinerate"` / `series: "thorn-fragment"` are kept so the
 *     attribute/trigger engines resolve them structurally.
 *
 * Every fixture is validated against the compiled schema by
 * `FixtureCardAudit.test.js`.
 */

const ID = {
  DEPLOY_EVOLVE: 1000,
  DEPLOY_EVOLVE_EVOLVED: 1001,
  TRAIT_UNIT: 1002,
  SCOUT: 1003,
  LIGHT_BEARER: 1004,
  EXPENSIVE_UNIT: 1005,
  LIGHT_BEARER_ONLY: 1006,
  SPEAR_BEARER: 1007,
  EVOLVE_UNIT: 1008,
  EVOLVE_UNIT_EVOLVED: 1009,
  HWAYEOMSA: 1010,
  SHINHEUH: 1011,
  MULTI_POSITION: 1012,
  MULTI_POSITION_EVOLVED: 1013,
  SCOUT_RANKER: 1014,
  FISHERMAN_UNIT: 1015,
  ANIMA_UNIT: 1016,
  COPY_ABILITY_UNIT: 1017,
  SWITCH_POSITION_UNIT: 1018,
  FREE_KEYWORD_UNIT: 1019,
  LANDMARK_UNIT: 1020,
  BURN_PASSIVE_UNIT: 1021,
  NO_UNDYING_UNIT: 1022,
  FILLER_UNIT: 1023,
  BEARER_UNIT: 1024,
  PRINCESS_UNIT: 1025,

  ARMOR: 1030,
  IGNITE_WEAPON: 1031,
  IGNITE_WEAPON_IGNITED: 1032,
  GRANT_ABILITY_EQUIP: 1033,
  MODIFY_ABILITY_EQUIP: 1034,
  THORN: 1035,
  BLUE_THRYSSA: 1036,
  REPEAT_EQUIP: 1037,
  EQUIPMENT_FILLER: 1038,
  THORN_FRAGMENT_I: 1039,
  THORN_FRAGMENT_II: 1040,
  THORN_FRAGMENT_III: 1041,
  THORN_FRAGMENT_IV: 1042,

  HEAL: 1050,
  POISON_SKILL: 1051,
  DAMAGE_SKILL: 1052,
  UNREACHABLE_SKILL: 1053,
  COMPRESS_SKILL: 1054,
  EXPENSIVE_SKILL: 1055,
  INCINERATE_I: 1056,
  INCINERATE_II: 1057,
  INCINERATE_III: 1058,
  INCINERATE_IV: 1059,
  FIRE_CORE: 1060,

  STONE_DOLL: 1061,
  HWA_RYUN: 1062,
  YEO_GOSENG: 1063,
  NOVICK: 1064,
  BACKLINE_HIGH_RANKER: 1065,
  DIONYSOS_WINGS: 1066,
  RANDOM_TARGET_UNIT: 1067,
};

const ALL_POSITIONS = ["fisherman", "spear-bearer", "scout", "light-bearer", "wave-controller"];

const unreachable = { type: "unreachable", raw: "i am Unreachable" };

function generatedBy(amount) {
  return { type: "generated_by", resource: "fire_charge", amount, raw: `create me by spending ${amount} Fire Charges` };
}

/** Named fixture cards (mirrors of the mechanics tests exercise). */
const named = [
  // ── Evolution via deploy trigger ──────────────────────────────────────
  {
    cardId: ID.DEPLOY_EVOLVE, type: "unit", name: "Test Deploy Evolve", cost: 1, deckConstraints: [], hp: 100,
    rank: "regular", positions: [...ALL_POSITIONS], traits: [{ code: "barrier" }], attributes: [], affiliations: [],
    abilities: [], passives: [],
    evolveInto: { triggers: [{ type: "deploy", raw: "when i am deployed" }], cardId: ID.DEPLOY_EVOLVE_EVOLVED },
  },
  {
    cardId: ID.DEPLOY_EVOLVE_EVOLVED, type: "unit", name: "Test Deploy Evolve - Evolved", cost: 1, deckConstraints: [], hp: 100,
    rank: "regular", positions: [...ALL_POSITIONS], traits: [], attributes: [], affiliations: [],
    abilities: [], passives: [], evolvedFrom: ID.DEPLOY_EVOLVE,
  },

  // ── Trait-rich unit (barrier/undying/strong/etc.) ─────────────────────
  {
    cardId: ID.TRAIT_UNIT, type: "unit", name: "Test Trait Unit", cost: 1, deckConstraints: [], hp: 100,
    rank: "regular", positions: [...ALL_POSITIONS],
    traits: [
      { code: "barrier" }, { code: "beacon" }, { code: "bloodthirsty" }, { code: "dealer", value: 10 },
      { code: "immune" }, { code: "last-one-standing", value: 10 }, { code: "lethal" },
      { code: "pierce", value: 10 }, { code: "reflect", value: 10 }, { code: "regenerate", value: 10 },
      { code: "resilient", value: 10 }, { code: "ruthless", value: 10 }, { code: "sharpshooter" },
      { code: "strong", value: 10 }, { code: "taunt" }, { code: "undying" }, { code: "vengeful", value: 10 },
    ],
    attributes: ["living-ignition-weapon"], affiliations: [], abilities: [], passives: [],
  },

  // ── Generic units with specific position/cost/ability shapes ──────────
  {
    cardId: ID.SCOUT, type: "unit", name: "Test Scout", cost: 1, deckConstraints: [], hp: 2, rank: "regular",
    positions: ["fisherman", "scout"], traits: [], attributes: [], affiliations: ["team-chang"],
    abilities: [
      { type: "peek_hand", owner: "opponent", quick: true, position: "scout", raw: "scout: quick: reveal a random card in the opponent's hand" },
      { type: "deal_damage", amount: 1, target: { side: "enemy" }, position: "fisherman", raw: "fisherman: deal 1 to an enemy" },
    ],
    passives: [],
  },
  {
    cardId: ID.LIGHT_BEARER, type: "unit", name: "Test Light Bearer", cost: 1, deckConstraints: [], hp: 1, rank: "regular",
    positions: ["light-bearer"], traits: [], attributes: ["irregular"], affiliations: [], abilities: [], passives: [],
  },
  {
    cardId: ID.EXPENSIVE_UNIT, type: "unit", name: "Test Expensive Unit", cost: 9, deckConstraints: [], hp: 7, rank: "high ranker",
    positions: ["fisherman", "wave-controller"], traits: [], attributes: [], affiliations: ["fug"], abilities: [], passives: [],
  },
  {
    cardId: ID.LIGHT_BEARER_ONLY, type: "unit", name: "Test Light Bearer Only", cost: 0, deckConstraints: [], hp: 2, rank: "regular",
    positions: ["light-bearer"], traits: [{ code: "beacon", value: 1 }], attributes: [], affiliations: ["khun-family"],
    abilities: [{ type: "light_up", amount: 1, raw: "Light Up 1" }], passives: [],
  },
  {
    cardId: ID.SPEAR_BEARER, type: "unit", name: "Test Spear Bearer", cost: 2, deckConstraints: [], hp: 4, rank: "regular",
    positions: ["spear-bearer"], traits: [{ code: "bloodthirsty" }, { code: "taunt" }], attributes: [], affiliations: ["team-baam"],
    abilities: [{ type: "deal_damage", amount: 4, target: { side: "enemy" }, raw: "deal 4 to an enemy" }], passives: [],
  },

  // ── Evolution via equipment (equip trigger) ───────────────────────────
  {
    cardId: ID.EVOLVE_UNIT, type: "unit", name: "Test Evolve Unit", cost: 7, deckConstraints: [], hp: 7, rank: "high ranker",
    positions: ["fisherman", "scout", "wave-controller"], traits: [{ code: "reflect" }], attributes: [], affiliations: ["fug"],
    abilities: [], passives: [
      { type: "modify_keyword", keyword: "quick", target: { side: "ally", affiliation: "karakas-servants" }, raw: "allied karaka's servants' abilities have Quick" },
    ],
    evolveInto: {
      triggers: [{ type: "equip", cardName: "Test Armor", position: "fisherman", raw: "Fisherman: equip with Test Armor" }],
      cardId: ID.EVOLVE_UNIT_EVOLVED,
    },
  },
  {
    cardId: ID.EVOLVE_UNIT_EVOLVED, type: "unit", name: "Test Evolve Unit - Evolved", cost: 7, deckConstraints: [], hp: 9, rank: "high ranker",
    positions: ["fisherman", "scout", "wave-controller"], traits: [{ code: "reflect" }], attributes: [], affiliations: ["fug"],
    abilities: [], passives: [
      { type: "modify_keyword", keyword: "quick", target: { side: "ally", affiliation: "karakas-servants" }, raw: "allied karaka's servants' abilities have Quick" },
      { type: "deal_damage", amount: 3, target: { side: "enemy", scope: "all", condition: "rooted" }, trigger: { type: "round_end" }, raw: "round end: deal 3 to all Rooted enemies" },
    ],
    evolvedFrom: ID.EVOLVE_UNIT,
  },

  // ── Hwayeomsa / attribute-bearing units ───────────────────────────────
  {
    cardId: ID.HWAYEOMSA, type: "unit", name: "Test Hwayeomsa", cost: 5, deckConstraints: [], hp: 6, rank: "regular",
    positions: ["fisherman"], traits: [], attributes: ["hwayeomsa"], affiliations: ["team-baam", "yeon-family"],
    abilities: [
      { type: "give_condition", condition: "exhausted", target: { side: "enemy", count: 2, condition: "burned" }, raw: "give 2 Burned enemies Exhausted" },
    ],
    passives: [
      { type: "modify_targeting", rule: "untargetable_by", target: { side: "any", condition: "burned", conditionValue: 3 }, raw: "units with Burned 3+ can't target me" },
    ],
  },
  {
    cardId: ID.SHINHEUH, type: "unit", name: "Test Shinheuh", cost: 3, deckConstraints: [], hp: 3,
    positions: ["frontline-shinheuh"], traits: [], attributes: [], affiliations: [],
    abilities: [{ type: "deal_damage", amount: 3, target: { side: "enemy" }, quick: true, raw: "quick: deal 3 to an enemy" }],
    passives: [],
  },

  // ── Multi-position transform unit (fisherman + spear-bearer) ──────────
  {
    cardId: ID.MULTI_POSITION, type: "unit", name: "Test Multi Position", cost: 3, deckConstraints: [], hp: 2, rank: "regular",
    positions: ["fisherman", "spear-bearer"], traits: [], attributes: ["jeonsulsa"], affiliations: ["khun-family"],
    abilities: [
      { type: "deal_damage", amount: 3, target: { side: "enemy", scope: "frontline" }, raw: "deal 3 to a frontline enemy" },
      { type: "heal", amount: 2, target: { side: "enemy", name: "Conduit" }, raw: "heal enemy Conduit 2 HP" },
    ],
    passives: [],
    evolveInto: { triggers: [{ type: "given", item: "Test Poison Skill", raw: "Test Poison Skill is played on me" }], cardId: ID.MULTI_POSITION_EVOLVED },
  },
  {
    cardId: ID.MULTI_POSITION_EVOLVED, type: "unit", name: "Test Multi Position - Evolved", cost: 3, deckConstraints: [], hp: 5, rank: "regular",
    positions: ["fisherman", "spear-bearer"], traits: [], attributes: ["jeonsulsa"], affiliations: ["khun-family"],
    abilities: [{ type: "sequence", steps: [
      { type: "deal_damage", amount: 3, target: { side: "enemy", scope: "frontline" } },
      { type: "heal", amount: 2, target: { side: "enemy", name: "Conduit" } },
    ], raw: "deal 3 to a frontline enemy and heal enemy Conduit 2 HP" }],
    passives: [{ type: "sequence", trigger: { type: "round_end" }, steps: [
      { type: "create_card", card: { name: "Test Poison Skill" } },
      { type: "transform", cardName: "Test Multi Position" },
    ], raw: "round end: create Test Poison Skill in your hand and revert me to Test Multi Position" }],
    evolvedFrom: ID.MULTI_POSITION,
  },

  // ── Handler/integration support units ─────────────────────────────────
  {
    cardId: ID.SCOUT_RANKER, type: "unit", name: "Test Scout Ranker", cost: 3, deckConstraints: [], hp: 2, rank: "ranker",
    positions: ["scout"], traits: [], attributes: [], affiliations: ["fug", "karakas-servants"],
    abilities: [{ type: "give_condition", condition: "poisoned", amount: 1, target: { side: "enemy", scope: "backline" }, raw: "give Poisoned 1 to a backline enemy" }],
    passives: [{ type: "modify_condition", condition: "poisoned", amount: 2, target: { side: "enemy", rank: "high ranker" },
      if: { type: "has_equipped", cardName: "Test Grant Ability Equip" }, raw: "if i have Test Grant Ability Equip equipped, i give Poisoned +2 to High Ranker units" }],
  },
  {
    cardId: ID.FISHERMAN_UNIT, type: "unit", name: "Test Fisherman Unit", cost: 4, deckConstraints: [], hp: 6, rank: "regular",
    positions: ["fisherman"], traits: [{ code: "bloodthirsty", value: 1 }, { code: "taunt" }], attributes: [], affiliations: ["team-chang", "canines"],
    abilities: [{ type: "deal_damage", amount: 2, target: { side: "enemy" }, raw: "deal 2 to an enemy" }],
    passives: [{ type: "grant_trait", trait: "resilient", amount: 1, target: { side: "ally", affiliation: "team-chang" }, raw: "allied team-chang members have Resilient 1" }],
  },
  {
    cardId: ID.ANIMA_UNIT, type: "unit", name: "Test Anima Unit", cost: 6, deckConstraints: [], hp: 5, rank: "ranker",
    positions: ["wave-controller", "scout"], traits: [], attributes: ["anima"], affiliations: ["lo-po-bia-family"],
    abilities: [
      { type: "summon", card: { position: ["frontline-shinheuh", "backline-shinheuh"], cost: 2, random: true }, from: "game", onto: "self", raw: "summon a random 2 cost Shinheuh" },
      { type: "steal", card: { position: ["frontline-shinheuh", "backline-shinheuh"], cost: "cheapest" }, raw: "steal the enemy's cheapest Shinheuh" },
    ],
    passives: [],
  },
  {
    cardId: ID.COPY_ABILITY_UNIT, type: "unit", name: "Test Copy Ability Unit", cost: 4, deckConstraints: [], hp: 4, rank: "regular",
    positions: ["wave-controller"], traits: [], attributes: ["irregular"], affiliations: ["fug"],
    abilities: [
      { type: "remove_traits", target: { side: "enemy", has_passive: true }, raw: "Silence an enemy that has at least one passive" },
      { type: "spend_shinsu", amount: 2, effect: { type: "copy_ability", source: { side: "enemy" } }, raw: "spend 2: use an enemy ability" },
    ],
    passives: [],
  },
  {
    cardId: ID.SWITCH_POSITION_UNIT, type: "unit", name: "Test Switch Position Unit", cost: 6, deckConstraints: [], hp: 5, rank: "high ranker",
    positions: ["scout", "light-bearer"], traits: [{ code: "beacon", value: 3 }], attributes: ["silver-dwarf"], affiliations: ["edrok-family"],
    abilities: [
      { type: "draw_card", amount: 1, card: { type: "equipment", choose: true }, raw: "draw an equipment of your choice" },
      { type: "switch_position", target: { side: "enemy", can_switch: true }, raw: "force an enemy to switch positions" },
    ],
    passives: [],
  },
  {
    cardId: ID.FREE_KEYWORD_UNIT, type: "unit", name: "Test Free Keyword Unit", cost: 1, deckConstraints: [], hp: 2, rank: "regular",
    positions: ["scout"], traits: [{ code: "sharpshooter" }], attributes: [], affiliations: ["team-novick"],
    abilities: [
      { type: "give_condition", condition: "blinded", target: { side: "enemy" }, quick: true, raw: "quick: give an enemy Blinded" },
      { type: "give_condition", condition: "ghost", target: { side: "enemy" }, quick: true, raw: "quick: give an enemy Ghost" },
    ],
    passives: [{ type: "modify_keyword", keyword: "free", first: true, target: { side: "self" }, raw: "the first ability i use each round has Free" }],
  },
  {
    cardId: ID.LANDMARK_UNIT, type: "unit", name: "Test Landmark Unit", cost: 2, deckConstraints: [], hp: 11,
    positions: ["landmark"], traits: [], attributes: [], affiliations: [], abilities: [],
    passives: [{ type: "sequence", trigger: { type: "quick_ability_used" }, steps: [
      { type: "charge_shinsu", amount: 1 },
      { type: "deal_damage", amount: 1, target: { side: "self" } },
    ], raw: "when a unit uses an ability that has Quick, they Charge 1 and i lose 1 HP" }],
  },
  {
    cardId: ID.BURN_PASSIVE_UNIT, type: "unit", name: "Test Burn Passive Unit", cost: 2, deckConstraints: [], hp: 4, rank: "regular",
    positions: ["wave-controller"], traits: [{ code: "sharpshooter" }], attributes: [], affiliations: ["team-chang"],
    abilities: [{ type: "spend_shinsu", amount: 3, effect: { type: "deal_damage", amount: 2, target: { side: "enemy", scope: "all", condition: "burned" } }, raw: "spend 3: deal 2 to all Burned enemies" }],
    passives: [{ type: "give_condition", condition: "burned", amount: 1, target: { side: "enemy" }, trigger: { type: "skill_played", cardName: "Test Damage Skill" }, raw: "Test Damage Skill gives Burned 1" }],
  },
  {
    cardId: ID.NO_UNDYING_UNIT, type: "unit", name: "Test No Undying Unit", cost: 1, deckConstraints: [], hp: 3, rank: "regular",
    positions: ["fisherman"], traits: [], attributes: [], affiliations: [],
    abilities: [{ type: "deal_damage", amount: 2, target: { side: "enemy" }, raw: "deal 2 to an enemy" }], passives: [],
  },
  {
    cardId: ID.FILLER_UNIT, type: "unit", name: "Test Filler Unit", cost: 4, deckConstraints: [], hp: 7, rank: "regular",
    positions: ["wave-controller", "spear-bearer"], traits: [{ code: "resilient", value: 1 }], attributes: [], affiliations: ["fug"],
    abilities: [{ type: "heal", amount: 3, target: { side: "self" }, raw: "heal me 3 HP" }], passives: [],
  },
  {
    cardId: ID.BEARER_UNIT, type: "unit", name: "Test Bearer Unit", cost: 8, deckConstraints: [], hp: 11, rank: "high ranker",
    positions: ["fisherman"], traits: [{ code: "barrier" }, { code: "last-one-standing", value: 4 }], attributes: ["irregular"], affiliations: ["wolhaiksong"],
    abilities: [{ type: "deal_damage", amount: 4, target: { side: "enemy" }, raw: "deal 4 to an enemy" }], passives: [],
  },
  {
    cardId: ID.PRINCESS_UNIT, type: "unit", name: "Test Princess Unit", cost: 6, deckConstraints: [], hp: 8, rank: "high ranker",
    positions: ["fisherman"], traits: [{ code: "resilient", value: 3 }], attributes: [], affiliations: ["ha-family"],
    abilities: [{ type: "deal_damage", amount: 6, target: { side: "enemy" }, raw: "deal 6 to an enemy" }], passives: [],
  },

  // ── Equipment ─────────────────────────────────────────────────────────
  {
    cardId: ID.ARMOR, type: "equipment", name: "Test Armor", cost: 4, deckConstraints: [],
    requirements: ["deployed as Fisherman"],
    effects: [
      { type: "modify_cost", amount: -2, if: { type: "started_with_card", cardName: "Ha Jinsung" }, raw: "if you started the game with Ha Jinsung in your deck, i cost 2 less" },
      { type: "grant_trait", trait: "barrier", target: { side: "bearer" }, raw: "the bearer has Barrier" },
    ],
  },
  {
    cardId: ID.IGNITE_WEAPON, type: "equipment", name: "Test Ignite Weapon", cost: 2, deckConstraints: [],
    effects: [{ type: "modify_stat", stat: "damage", amount: 3, target: { side: "bearer" }, raw: "the bearer's damage-dealing abilities deal +3 damage" }],
    igniteInto: { triggers: [{ type: "slay", target: "unit", raw: "the bearer Slays a unit" }], cardId: ID.IGNITE_WEAPON_IGNITED },
  },
  {
    cardId: ID.IGNITE_WEAPON_IGNITED, type: "equipment", name: "Test Ignite Weapon - Ignited", cost: 2, deckConstraints: [],
    effects: [
      { type: "modify_stat", stat: "damage", amount: 3, target: { side: "bearer" }, raw: "the bearer's damage-dealing abilities deal +3 damage" },
      { type: "give_condition", condition: "exhausted", amount: 1, target: { side: "enemy" }, trigger: { type: "deal_damage" }, raw: "the bearer's damage-dealing abilities give Exhausted 1" },
    ],
    ignitedFrom: ID.IGNITE_WEAPON,
  },
  {
    cardId: ID.GRANT_ABILITY_EQUIP, type: "equipment", name: "Test Grant Ability Equip", cost: 3, deckConstraints: [],
    requirements: ["deployed as Scout"],
    effects: [
      { type: "grant_trait", trait: "resilient", amount: 2, target: { side: "bearer" }, raw: "the bearer has Resilient 2" },
      { type: "grant_ability", target: { side: "bearer" }, ability: { type: "give_condition", condition: "poisoned", amount: 4, target: { side: "enemy" } }, raw: "ability: give Poisoned 4 to an enemy" },
    ],
  },
  {
    cardId: ID.MODIFY_ABILITY_EQUIP, type: "equipment", name: "Test Modify Ability Equip", cost: 3, deckConstraints: [],
    requirements: ["khun family member"],
    effects: [
      { type: "modify_ability", target: { side: "bearer" }, effect: { type: "give_condition", condition: "frozen", amount: 1, target: { side: "enemy" } }, raw: "the bearer's abilities give Frozen to enemies" },
      { type: "grant_trait", trait: "pierce", amount: 1, target: { side: "bearer" }, raw: "the bearer has Pierce 1" },
    ],
  },
  {
    cardId: ID.THORN, type: "equipment", name: "Test Thorn", cost: 0, deckConstraints: [unreachable],
    effects: [
      { type: "modify_stat", stat: "damage", amount: 2, target: { side: "bearer" }, raw: "the bearer's damage-dealing abilities deal +2 damage" },
      { type: "modify_stat", stat: "heal", amount: 2, target: { side: "bearer" }, raw: "the bearer's healing abilities heal +2 HP" },
      { type: "modify_stat", stat: "hp", amount: 2, target: { side: "bearer" }, raw: "the bearer has +2 HP" },
      { type: "grant_trait", trait: "bloodthirsty", amount: 1, target: { side: "bearer" }, raw: "the bearer has Bloodthirsty 1" },
    ],
  },
  {
    cardId: ID.BLUE_THRYSSA, type: "equipment", name: "Test Blue Thryssa", cost: 2, deckConstraints: [],
    effects: [{ type: "sequence", steps: [
      { type: "heal", amount: 2, target: { side: "bearer" } },
      { type: "remove_conditions", target: { side: "bearer" } },
    ], raw: "heal the bearer 2 HP and Cleanse the bearer" }],
  },
  {
    cardId: ID.REPEAT_EQUIP, type: "equipment", name: "Test Repeat Equip", cost: 0, deckConstraints: [unreachable],
    effects: [{ type: "modify_repeat", amount: 2, target: { side: "bearer" }, raw: "the bearer's abilities trigger twice" }],
  },
  {
    cardId: ID.EQUIPMENT_FILLER, type: "equipment", name: "Test Equipment Filler", cost: 1, deckConstraints: [],
    effects: [{ type: "grant_trait", trait: "barrier", target: { side: "bearer" }, raw: "the bearer has Barrier" }],
  },

  // ── Skills ────────────────────────────────────────────────────────────
  {
    cardId: ID.HEAL, type: "skill", name: "Test Heal", cost: 2, deckConstraints: [],
    effects: [{ type: "heal", amount: 5, target: { side: "ally" }, raw: "heal an ally 5 HP" }],
  },
  {
    cardId: ID.POISON_SKILL, type: "skill", name: "Test Poison Skill", cost: 1, deckConstraints: [],
    requirements: ["target is an ally"],
    effects: [{ type: "give_condition", condition: "poisoned", amount: 1, target: { side: "ally" }, raw: "give Poisoned 1" }],
  },
  {
    cardId: ID.DAMAGE_SKILL, type: "skill", name: "Test Damage Skill", cost: 0, deckConstraints: [],
    effects: [{ type: "conditional",
      if: { type: "has_unit", target: { side: "ally", position: "wave-controller" } },
      then: { type: "deal_damage", amount: 2, target: { side: "enemy" } },
      otherwise: { type: "deal_damage", amount: 1, target: { side: "enemy" } },
      raw: "if you have an ally Wave Controller, deal 2 to an enemy, otherwise deal 1" }],
  },
  {
    cardId: ID.UNREACHABLE_SKILL, type: "skill", name: "Test Unreachable Skill", cost: 4, deckConstraints: [unreachable],
    requirements: ["have an ally Irregular"],
    effects: [{ type: "give_condition", condition: "doomed", target: { side: "enemy" }, raw: "give an enemy Doomed" }],
  },
  {
    cardId: ID.COMPRESS_SKILL, type: "skill", name: "Test Compress Skill", cost: 2, deckConstraints: [],
    effects: [
      { type: "give_condition", condition: "burned", amount: 1, target: { side: "enemy" }, raw: "give Burned 1 to an enemy" },
      { type: "compress_shinsu", amount: 1, card: { attribute: "hwayeomsa" }, raw: "Compress 1 from a Hwayeomsa in your hand" },
    ],
  },
  {
    cardId: ID.EXPENSIVE_SKILL, type: "skill", name: "Test Expensive Skill", cost: 3, deckConstraints: [],
    requirements: ["I'm the first card you play this round"],
    effects: [
      { type: "extinguish", amount: 1, raw: "Extinguish 1" },
      { type: "heal", amount: 1, target: { side: "ally" }, raw: "heal an ally 1 HP" },
      { type: "compress_shinsu", amount: 1, card: { cost: "most expensive" }, raw: "Compress 1 from the most expensive card in your hand" },
      { type: "reclaim_cards", amount: 1, raw: "Reclaim 1" },
      { type: "remove_traits", target: { side: "enemy" }, raw: "Silence an enemy" },
    ],
  },

  // ── Incinerate series + Fire Core (Hwayeomsa engine) ──────────────────
  {
    cardId: ID.INCINERATE_I, type: "skill", name: "Test Incinerate I", series: "incinerate", cost: 0,
    deckConstraints: [unreachable, generatedBy(1)],
    effects: [{ type: "deal_damage", amount: 1, target: { side: "enemy" }, raw: "deal 1 to an enemy" }],
  },
  {
    cardId: ID.INCINERATE_II, type: "skill", name: "Test Incinerate II", series: "incinerate", cost: 0,
    deckConstraints: [unreachable, generatedBy(3)],
    effects: [{ type: "deal_damage", amount: 2, target: { side: "enemy", count: 2 }, raw: "deal 2 to 2 enemies" }],
  },
  {
    cardId: ID.INCINERATE_III, type: "skill", name: "Test Incinerate III", series: "incinerate", cost: 0,
    deckConstraints: [unreachable, generatedBy(5)],
    effects: [{ type: "sequence", targets: { side: "enemy", count: 3 }, steps: [
      { type: "deal_damage", amount: 2, target: { link: "sequence" } },
      { type: "give_condition", condition: "burned", target: { link: "sequence" } },
    ], raw: "deal 2 to 3 enemies and give them Burn" }],
  },
  {
    cardId: ID.INCINERATE_IV, type: "skill", name: "Test Incinerate IV", series: "incinerate", cost: 0,
    deckConstraints: [unreachable, generatedBy(7)],
    effects: [{ type: "sequence", steps: [
      { type: "deal_damage", amount: 3, target: { side: "enemy", scope: "all" } },
      { type: "give_condition", condition: "burned", amount: 2, target: { side: "enemy", scope: "all" } },
    ], raw: "deal 3 to all enemies and give them Burn 2" }],
  },
  // Name is hardcoded in HwayeomsaEngine — keep exact.
  {
    cardId: ID.FIRE_CORE, type: "skill", name: "Fire Core", cost: 0, deckConstraints: [unreachable],
    effects: [
      { type: "quick", raw: "i am Quick" },
      { type: "create_card", card: { type: "skill", series: "incinerate" }, raw: "Spend Fire Charges to create the highest affordable Incinerate in your hand" },
    ],
  },

  // ── modifier/trigger runtime fixtures ─────────────────────────
  {
    cardId: ID.STONE_DOLL, type: "unit", name: "Test Stone Doll", cost: 0, deckConstraints: [], hp: 20,
    rank: "regular", positions: ["fisherman"], traits: [{ code: "taunt" }], attributes: [], affiliations: [],
    abilities: [{ type: "spend_shinsu", amount: 1, free: true, effect: { type: "deal_damage", amount: 1, target: { side: "enemy" } }, raw: "Free: Spend 1: deal 1 to an enemy" }],
    passives: [{ type: "modify_stat", stat: "damage_taken", amount: 4, target: { side: "self" }, source: { position: "spear-bearer" }, raw: "Spear bearers deal +4 damage to me" }],
  },
  {
    cardId: ID.HWA_RYUN, type: "unit", name: "Test Hwa Ryun", cost: 3, deckConstraints: [], hp: 2, rank: "regular",
    positions: ["scout"], traits: [], attributes: ["red-witch"], affiliations: ["fug", "team-baam", "team-fug"],
    abilities: [{ type: "give_condition", condition: "heavy", amount: 1, target: { side: "enemy", scope: "backline" }, raw: "give Heavy 1 to a backline enemy" }],
    passives: [{ type: "modify_stat", stat: "cost", amount: 1, target: { side: "enemy" }, cardType: "skill",
      if: { type: "has_unit", target: { side: "ally", affiliation: ["team-baam", "team-fug"] } }, raw: "while i have an ally team baam or team fug member, opponents' skills cost 1 more" }],
  },
  {
    cardId: ID.YEO_GOSENG, type: "unit", name: "Test Yeo Goseng", cost: 1, deckConstraints: [], hp: 1, rank: "regular",
    positions: ["light-bearer"], traits: [{ code: "beacon", value: 1 }], attributes: [], affiliations: ["team-sweet-and-sour"],
    abilities: [{ type: "heal", amount: 1, target: { side: "ally", affiliation: "team-sweet-and-sour" }, raw: "heal a team sweet and sour member 1 HP" }],
    passives: [{ type: "modify_stat", stat: "cost", amount: -1, target: { side: "ally", affiliation: "team-sweet-and-sour" }, raw: "team sweet and sour members cost 1 less" }],
  },
  {
    cardId: ID.NOVICK, type: "unit", name: "Test Novick", cost: 5, deckConstraints: [], hp: 6, rank: "regular",
    positions: ["spear-bearer", "fisherman"], traits: [], attributes: [], affiliations: ["team-novick"],
    abilities: [{ type: "deal_damage", amount: 7, target: { side: "enemy" }, position: "spear-bearer", raw: "spear bearer: deal 7 to an enemy" }],
    passives: [{ type: "disarm", target: { side: "enemy" }, to: { zone: "hand", owner: "equipment_owner" }, trigger: { type: "deal_damage" }, raw: "when i deal damage to an enemy: Disarm them" }],
  },
  {
    cardId: ID.BACKLINE_HIGH_RANKER, type: "unit", name: "Test Backline High Ranker", cost: 4, deckConstraints: [], hp: 6, rank: "high ranker",
    positions: ["spear-bearer"], traits: [], attributes: [], affiliations: ["fug"], abilities: [], passives: [],
  },
  {
    cardId: ID.DIONYSOS_WINGS, type: "equipment", name: "Test Dionysos Wings", cost: 2, deckConstraints: [],
    effects: [{ type: "charge_shinsu", amount: 1, trigger: { type: "quick_ability_used" }, raw: "the bearer's Quick abilities Charge 1" }],
  },
  {
    cardId: ID.RANDOM_TARGET_UNIT, type: "unit", name: "Test Random Target Unit", cost: 2, deckConstraints: [], hp: 4, rank: "regular",
    positions: ["fisherman"], traits: [], attributes: [], affiliations: [],
    abilities: [{ type: "deal_damage", amount: 1, target: { side: "enemy", random: true }, raw: "deal 1 to a random enemy" }],
    passives: [],
  },
];

// ── Thorn fragment series (equipment, equip has_all_equipped trigger) ────
function thornFragment(cardId, name, extraEffect) {
  return {
    cardId, type: "equipment", name, series: "thorn-fragment", cost: 1, deckConstraints: [unreachable],
    effects: [
      { type: "conditional", quick: true, trigger: { type: "equip" },
        if: { type: "has_all_equipped", series: "thorn-fragment" },
        then: { type: "sequence", steps: [
          { type: "discard", card: { type: "equipment", series: "thorn-fragment", zone: "attachments" }, owner: "you" },
          { type: "create_card", card: { name: "Test Thorn" } },
        ] },
        raw: "when the bearer is equipped with all 4 unique thorn fragments, discard them and create Test Thorn in your hand" },
      extraEffect,
    ],
  };
}
named.push(
  thornFragment(ID.THORN_FRAGMENT_I, "Test Thorn Fragment I", { type: "modify_stat", stat: "damage", amount: 1, target: { side: "bearer" }, raw: "the bearer's damage-dealing abilities deal +1 damage" }),
  thornFragment(ID.THORN_FRAGMENT_II, "Test Thorn Fragment II", { type: "modify_stat", stat: "heal", amount: 1, target: { side: "bearer" }, raw: "the bearer's healing abilities heal +1 HP" }),
  thornFragment(ID.THORN_FRAGMENT_III, "Test Thorn Fragment III", { type: "modify_stat", stat: "hp", amount: 1, target: { side: "bearer" }, raw: "the bearer has +1 HP" }),
  thornFragment(ID.THORN_FRAGMENT_IV, "Test Thorn Fragment IV", { type: "grant_trait", trait: "bloodthirsty", amount: 1, target: { side: "bearer" }, raw: "the bearer has Bloodthirsty 1" }),
);

// ── Generic filler units (deck padding; ≥30 needed for legal 30-card decks) ──
// Fillers use the LOWEST ids because JavaScript object keys that look like
// integers are sorted numerically, and default-deck construction slices the
// first N eligible cards. Keeping fillers first means deck-based assertions
// never depend on a named fixture's identity.
const FILLER_START = 1;
const FILLER_COUNT = 40;
const fillers = [];
for (let i = 0; i < FILLER_COUNT; i++) {
  fillers.push({
    cardId: FILLER_START + i,
    type: "unit",
    name: `Test Filler ${i + 1}`,
    cost: 1,
    deckConstraints: [],
    hp: 3,
    rank: "regular",
    positions: ["fisherman"],
    traits: [],
    attributes: [],
    affiliations: [],
    abilities: [],
    passives: [],
  });
}

/** Keyed catalog `{ [cardId]: card }`, mirroring the compiled shape. */
export const cards = Object.fromEntries([...fillers, ...named].map((card) => [String(card.cardId), card]));

/** Name (lowercased) → cardId lookup. */
export const byName = Object.fromEntries([...fillers, ...named].map((card) => [card.name.toLowerCase(), card.cardId]));

export default { cards, byName };
