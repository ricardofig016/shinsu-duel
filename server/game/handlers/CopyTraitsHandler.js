import BaseHandler from "./BaseHandler.js";

/**
 * Copies every active trait from a source unit onto a target unit.
 *
 * DSL type: copy_traits
 *
 * `target` is resolved by EffectResolver into `targetId`; `source` (a unit
 * descriptor) into `sourceUnitId`. Each active trait modifier on the source
 * is granted to the target, provenance-tracked under the effect's `sourceId`.
 *
 * Payload:
 *   { targetId, sourceUnitId, sourceId, sourceType }
 */
export default class CopyTraitsHandler extends BaseHandler {
  validate(payload) {
    if (!payload.targetId) throw new Error("CopyTraitsHandler: payload.targetId is required");
    if (!payload.sourceUnitId) throw new Error("CopyTraitsHandler: payload.sourceUnitId is required");
  }

  execute(payload, context, gameState) {
    const { targetId, sourceUnitId, sourceId, sourceType = "system" } = payload;
    const source = gameState._findUnit(sourceUnitId);
    const target = gameState._findUnit(targetId);
    if (!source || !target || !target.isAlive()) return { copied: 0 };

    const traits = gameState.modifierStack.getModifiers(source.id, "trait");
    const copied = [];
    for (const mod of traits) {
      if (mod.disabledCount > 0) continue;
      gameState.modifierStack.apply({
        sourceId,
        sourceType,
        targetId: target.id,
        type: "trait",
        key: mod.key,
        value: mod.value,
        operation: "add",
      });
      copied.push({ trait: mod.key, value: mod.value });
    }

    return { copied: copied.length, traits: copied };
  }
}
