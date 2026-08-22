import BaseHandler from "./BaseHandler.js";
import EVT from "../EventCatalog.js";
import shuffle from "../utils/shuffle.js";
import traits from "../../data/traits.json" with { type: "json" };

/**
 * Grants a random trait to a target unit.
 *
 * DSL type: grant_random_trait
 *
 * `numeric` restricts the pool to numeric traits (`numeric: true`) or
 * non-numeric traits (`numeric: false`); omitted, any trait is eligible. The
 * trait is chosen deterministically via the seeded RNG and granted at value 1.
 *
 * Payload:
 *   { targetId, numeric?, sourceId, sourceType }
 */
export default class GrantRandomTraitHandler extends BaseHandler {
  validate(payload) {
    if (!payload.targetId) throw new Error("GrantRandomTraitHandler: payload.targetId is required");
  }

  execute(payload, context, gameState) {
    const { targetId, numeric, sourceId, sourceType = "system" } = payload;

    const eligible = Object.keys(traits).filter((key) => {
      if (numeric === true) return traits[key].numeric === true;
      if (numeric === false) return traits[key].numeric !== true;
      return true;
    });

    if (eligible.length === 0) return { granted: false, reason: "no eligible trait" };

    const key = shuffle(eligible, gameState._rng)[0];

    gameState.modifierStack.apply({
      sourceId,
      sourceType,
      targetId,
      type: "trait",
      key,
      value: 1,
      operation: "add",
    });

    context.emitChild(EVT.TRAIT_GRANTED, {
      targetId,
      trait: key,
      amount: 1,
      sourceId,
    });

    return { granted: true, trait: key };
  }
}
