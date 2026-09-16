/**
 * Row assembly for the card detail overlay (public/components/
 * card-detail-overlay/).
 *
 * The carousel row is the focused card plus every card it relates to, laid
 * out as: attached equipment (left of the focus, in the unit's attachment
 * order), the focus card, then the focus's compiled `relatedCards` order.
 * Attached equipment recursion folds into the right-hand list at open time:
 * each attachment's own relatedCards appends after the focus's, with the
 * same never-repeat rule — a card already in the row keeps its first
 * position, so a card both attached and statically related stays in the
 * equipment column. The list is fully static for the overlay's lifetime;
 * changing focus never rebuilds it.
 *
 * Pure data shaping over the flattened card view models and the catalog
 * index from `public/utils/card-catalog.js`; no DOM access.
 */

import { buildCardViewModel } from "../game/viewModels.js";

/** The subtle relation tag each side card carries, keyed by relation kind. */
export const RELATION_TAGS = Object.freeze({
  evolution: "Evolves from",
  ignition: "Ignited",
  mention: "Mentions this",
  "mentioned-by": "Mentioned in",
});

/**
 * The tag text for one row entry. Series entries carry the sharing series
 * code; attachments are tagged as equipment.
 *
 * @param {{ kind: string, seriesCode?: string | null }} entry
 * @returns {string}
 */
export function relationTag({ kind, seriesCode = null }) {
  if (kind === "equipment") return "Equipment";
  if (kind === "series") return `Series: ${seriesCode ?? ""}`;
  return RELATION_TAGS[kind] ?? "";
}

/**
 * Assemble the overlay row for one opened card.
 *
 * @param {object} model - the flattened card or unit view the overlay opens
 *   for (the focus card; a unit view resolves its name-only
 *   `equipmentAttachments` through the catalog)
 * @param {{ byId: Map<number, object>, byName: Map<string, object> } | null} catalogIndex
 * @returns {{ left: Array<object>, right: Array<object>, focusIndex: number }}
 *   Row entries shaped `{ kind, seriesCode, card }` — `left` holds the
 *   equipment column, `right` the related cards in display order, and
 *   `focusIndex` is the focus card's index in `[...left, focus, ...right]`.
 */
export function assembleDetailRow(model, catalogIndex) {
  const byId = catalogIndex?.byId ?? new Map();
  const byName = catalogIndex?.byName ?? new Map();

  const seen = new Set([model.cardId]);
  const toEntry = (kind, seriesCode, view) => ({ kind, seriesCode, card: buildCardViewModel(view) });

  // Equipment column: resolve the wire's attachment names, keeping the
  // unit's attachment order. Repeat cards collapse under the same
  // never-repeat rule as every other edge: one entry per distinct card.
  const left = [];
  for (const name of model.equipmentAttachments ?? []) {
    const view = byName.get(String(name).toLowerCase());
    if (!view || seen.has(view.cardId)) continue;
    seen.add(view.cardId);
    left.push(toEntry("equipment", null, view));
  }

  // Related cards: the focus's compiled closure first, then each attached
  // equipment's own closure folded in. A series entry carries the code of
  // the card whose closure produced it.
  const right = [];
  const addRelated = (kind, cardId, seriesCode) => {
    if (seen.has(cardId)) return;
    const view = byId.get(cardId);
    if (!view) return;
    seen.add(cardId);
    right.push(toEntry(kind, seriesCode, view));
  };
  for (const { cardId, kind } of model.relatedCards ?? []) {
    addRelated(kind, cardId, model.series ?? null);
  }
  for (const attachment of left) {
    for (const { cardId, kind } of attachment.card.relatedCards ?? []) {
      addRelated(kind, cardId, attachment.card.series ?? null);
    }
  }

  return { left, right, focusIndex: left.length };
}
