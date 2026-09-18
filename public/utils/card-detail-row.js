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

/** `jeonsul-baang` becomes `Jeonsul Baang`; an absent code becomes "". */
export function seriesDisplayName(seriesCode) {
  if (typeof seriesCode !== "string" || seriesCode === "") return "";
  return seriesCode
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * The tag each relation kind renders, keyed by kind. Every kind is
 * directional and describes the tagged card (the row entry's own card), so
 * each tag names the peer it relates to — the card whose closure produced
 * the entry. A template returns "" when the name it needs is unresolved, and
 * an unknown kind renders nothing at all.
 */
export const RELATION_TAGS = Object.freeze({
  "evolves-into": ({ peerName }) => (peerName ? `Evolves into ${peerName}` : ""),
  "evolves-from": ({ peerName }) => (peerName ? `Evolves from ${peerName}` : ""),
  "ignites-into": ({ peerName }) => (peerName ? `Ignites into ${peerName}` : ""),
  "ignited-from": ({ peerName }) => (peerName ? `Ignited from ${peerName}` : ""),
  mentions: ({ peerName }) => (peerName ? `Mentions ${peerName}` : ""),
  "mentioned-in": ({ peerName }) => (peerName ? `Mentioned in ${peerName}` : ""),
  "series-mentioned": ({ peerName, seriesCode }) => {
    const series = seriesDisplayName(seriesCode);
    return series && peerName ? `${series} series mentioned by ${peerName}` : "";
  },
  "same-series-as": ({ peerName }) => (peerName ? `Same series as ${peerName}` : ""),
  // Client-side only: attached equipment is resolved from the wire's
  // name-only attachment list, never stamped into the compiled artifact.
  equipment: ({ focusName }) => (focusName ? `Equipped to ${focusName}` : ""),
});

/**
 * The tag text for one row entry. The entry carries the peer's display name
 * (the focused card, another row card, or an attachment) and the focused
 * card's name; equipment entries name the focus they hang off.
 *
 * @param {{ kind: string, seriesCode?: string | null, peerName?: string | null, focusName?: string | null }} entry
 * @returns {string}
 */
export function relationTag(entry) {
  return RELATION_TAGS[entry?.kind]?.(entry) ?? "";
}

/**
 * Assemble the overlay row for one opened card.
 *
 * @param {object} model - the flattened card or unit view the overlay opens
 *   for (the focus card; a unit view resolves its name-only
 *   `equipmentAttachments` through the catalog)
 * @param {{ byId: Map<number, object>, byName: Map<string, object> } | null} catalogIndex
 * @returns {{ left: Array<object>, right: Array<object>, focusIndex: number }}
 *   Row entries shaped `{ kind, seriesCode, peerName, focusName, card }` —
 *   `left` holds the equipment column, `right` the related cards in display
 *   order, and `focusIndex` is the focus card's index in
 *   `[...left, focus, ...right]`. Every entry in `right` carries a tag: one
 *   whose relation cannot be stated is dropped rather than shown untagged.
 */
export function assembleDetailRow(model, catalogIndex) {
  const byId = catalogIndex?.byId ?? new Map();
  const byName = catalogIndex?.byName ?? new Map();

  // The focused model may be a unit view, so its own name wins over the
  // catalog entry for the same cardId; every other peer resolves by id.
  const focusName = model.name ?? null;
  const peerNameOf = (cardId) =>
    cardId === model.cardId ? focusName : byId.get(cardId)?.name ?? null;

  const seen = new Set([model.cardId]);
  const toEntry = (kind, seriesCode, peerCardId, view) => ({
    kind,
    seriesCode,
    peerName: peerNameOf(peerCardId),
    focusName,
    card: buildCardViewModel(view),
  });

  // Equipment column: resolve the wire's attachment names, keeping the
  // unit's attachment order. Repeat cards collapse under the same
  // never-repeat rule as every other edge: one entry per distinct card.
  const left = [];
  for (const name of model.equipmentAttachments ?? []) {
    const view = byName.get(String(name).toLowerCase());
    if (!view || seen.has(view.cardId)) continue;
    seen.add(view.cardId);
    left.push(toEntry("equipment", null, model.cardId, view));
  }

  // Related cards: the focus's compiled closure first, then each attached
  // equipment's own closure folded in. Each entry carries its own peer and
  // series code — the card whose closure produced it.
  const right = [];
  const addRelated = (kind, seriesCode, peerCardId, cardId) => {
    if (seen.has(cardId)) return;
    const view = byId.get(cardId);
    if (!view) return;
    const entry = toEntry(kind, seriesCode, peerCardId, view);
    // A side slot exists to state its relation. An entry whose tag cannot be
    // rendered — an unknown kind, a peer the catalog does not name, a series
    // entry with no series — would put a card in the row claiming nothing, so
    // it is dropped and the next edge that reaches the card takes the slot.
    if (relationTag(entry) === "") return;
    seen.add(cardId);
    right.push(entry);
  };
  for (const { cardId, kind, peerCardId, seriesCode } of model.relatedCards ?? []) {
    addRelated(kind, seriesCode ?? null, peerCardId, cardId);
  }
  for (const attachment of left) {
    for (const { cardId, kind, peerCardId, seriesCode } of attachment.card.relatedCards ?? []) {
      addRelated(kind, seriesCode ?? null, peerCardId, cardId);
    }
  }

  return { left, right, focusIndex: left.length };
}
