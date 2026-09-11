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
 * A `sourceTraits` snapshot overrides the live stack read: triggered
 * resolutions (the silenced unit's traits) reference traits the source has
 * already lost by resolution time, so the snapshot carries
 * `{ trait, value?, disabled? }` entries.
 *
 * Payload:
 *   { targetId, sourceUnitId, sourceId, sourceType, sourceTraits? }
 */
export default class CopyTraitsHandler extends BaseHandler {
  validate(payload) {
    if (!payload.targetId) throw new Error("CopyTraitsHandler: payload.targetId is required");
    if (!payload.sourceUnitId) throw new Error("CopyTraitsHandler: payload.sourceUnitId is required");
  }

  execute(payload, context, gameState) {
    const { targetId, sourceUnitId, sourceId, sourceType = "system", sourceTraits } = payload;
    const source = gameState._findUnit(sourceUnitId);
    const target = gameState._findUnit(targetId);
    if (!target || !target.isAlive()) return { copied: 0 };

    const copied = [];
    if (sourceTraits) {
      for (const entry of sourceTraits) {
        if (entry.disabled) continue;
        gameState.modifierStack.apply({
          sourceId,
          sourceType,
          targetId: target.id,
          type: "trait",
          key: entry.trait,
          value: entry.value,
          operation: "add",
        });
        copied.push({ trait: entry.trait, value: entry.value });
      }
      return { copied: copied.length, traits: copied };
    }

    if (!source) return { copied: 0 };
    const traits = gameState.modifierStack.getModifiers(source.id, "trait");
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
