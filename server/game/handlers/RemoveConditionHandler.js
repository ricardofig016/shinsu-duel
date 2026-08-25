import BaseHandler from "./BaseHandler.js";
import EVT from "../EventCatalog.js";
import shuffle from "../utils/shuffle.js";

/**
 * Removes conditions from a target unit.
 *
 * Payload:
 *   { targetId, mode?: "all"|"random"|"choose", amount?: number, condition?: string }
 *
 * - mode "all" (default): remove every condition (optionally filtered by `condition`).
 * - mode "random": remove `amount` randomly-chosen conditions.
 * - mode "choose": remove `amount` conditions chosen by the owner (pending decision).
 *
 * `condition` restricts the eligible set to a single named condition.
 * targetId is always pre-resolved by EffectResolver before this handler runs.
 */
export default class RemoveConditionHandler extends BaseHandler {
  static MODES = ["all", "random", "choose"];

  validate(payload) {
    if (!payload.targetId) {
      throw new Error("RemoveConditionHandler: payload.targetId is required");
    }
    if (payload.mode !== undefined && !RemoveConditionHandler.MODES.includes(payload.mode)) {
      throw new Error(`RemoveConditionHandler: invalid mode "${payload.mode}"`);
    }
    if ((payload.mode === "random" || payload.mode === "choose") &&
        (!Number.isInteger(payload.amount) || payload.amount < 1)) {
      throw new Error(`RemoveConditionHandler: mode "${payload.mode}" requires a positive integer amount`);
    }
  }

  execute(payload, context, gameState) {
    const { targetId, mode = "all", amount, condition: conditionFilter } = payload;
    const modStack = gameState.modifierStack;

    const eligible = this._eligibleKeys(modStack, targetId, conditionFilter);

    if (mode === "all") {
      return this._remove(targetId, eligible, modStack, context);
    }

    const count = Math.min(amount, eligible.length);
    if (count === 0) return { cleansed: [] };

    if (mode === "random") {
      const chosen = shuffle(eligible, gameState._rng).slice(0, count);
      return this._remove(targetId, chosen, modStack, context);
    }

    // mode === "choose" — defer the selection to the owning player unless the
    // whole eligible set is required (no genuine choice).
    const owner = payload.owner || payload.sourceOwner;
    if (count >= eligible.length) {
      return this._remove(targetId, eligible, modStack, context);
    }
    gameState.createPendingDecision({
      owner,
      type: "remove_conditions",
      candidates: eligible.map((key) => ({ id: key, name: key, hp: 0 })),
      minChoices: count,
      maxChoices: count,
      resolve: (chosenKeys) => {
        this._remove(targetId, chosenKeys, modStack, context);
      },
    });
    return { pending: true, cleansed: [] };
  }

  _eligibleKeys(modStack, targetId, conditionFilter) {
    const keys = [...new Set(modStack.getModifiers(targetId, "condition").map((m) => m.key))];
    if (conditionFilter === undefined) return keys;
    return keys.filter((key) => key === conditionFilter);
  }

  _remove(targetId, keys, modStack, context) {
    const keySet = new Set(keys);
    if (keySet.size === 0) return { cleansed: [] };

    const removed = [];
    for (const mod of modStack.getModifiers(targetId, "condition")) {
      if (keySet.has(mod.key)) {
        removed.push({ condition: mod.key, amount: mod.value, sourceId: mod.sourceId });
      }
    }

    modStack.removeWhere(
      (m) => m.targetId === targetId && m.type === "condition" && keySet.has(m.key)
    );

    if (removed.length > 0) {
      context.emitChild(EVT.CONDITION_CLEANSED, { targetId, removed });
    }

    return { cleansed: removed };
  }
}
