import { LINK_TYPES } from "../../public/utils/card-text.js";
import { normalizeName } from "./normalize-name.js";

/**
 * Card relation stamping for the compiled artifact.
 *
 * Every compiled card carries `relatedCards` — the deduplicated, recursively
 * closed, deterministically ordered list of cards it relates to. The list is
 * what the client detail view renders as the related-card carousel, so its
 * order is a data contract: breadth-first traversal over all edge kinds,
 * edges examined from each card in a fixed priority (evolution/ignition
 * links first, then mentions, then reverse mentions, then series siblings),
 * ties broken by cardId (the name-sorted index). A card is never repeated:
 * the first edge that reaches it wins its relation kind.
 *
 * Edge kinds and their sources:
 *
 * - `evolution` — `evolvedFrom` / `evolveInto.cardId`, stamped by the
 *   compiler's evolution resolution.
 * - `ignition` — `ignitedFrom` / `igniteInto.cardId`.
 * - `mention` — this card's text points at the target: explicit text links
 *   (`card` and `series` segments) plus the machine-readable references the
 *   DSL already carries: `name`/`series` on the target descriptors shaped
 *   under `card`, `target`, `targets`, and `source`, plus `cardName`,
 *   `cardNames`, and `has_all_equipped` series. A series reference counts
 *   as a mention of every card in that series.
 * - `mentioned-by` — the reverse of `mention`, computed from every card's
 *   forward references.
 * - `series` — cards sharing the card's `series` code, with no reference
 *   between them.
 *
 * References that resolve to no compiled card (an unlinked machine reference
 * the compiler never validated) contribute nothing; link targets are already
 * compile errors when unresolvable.
 */

const NODE_LISTS = ["abilities", "passives", "effects", "requirements", "rules", "deckConstraints"];
const TRANSFORMATION_LISTS = ["evolveInto", "igniteInto"];

function isLinkSegment(value) {
  return (
    value !== null && typeof value === "object" && !Array.isArray(value) &&
    typeof value.type === "string" && LINK_TYPES.includes(value.type) &&
    typeof value.ref === "string" && value.ref !== "" &&
    typeof value.text === "string" && value.text !== ""
  );
}

function walkValue(value, visit) {
  if (Array.isArray(value)) {
    for (const item of value) walkValue(item, visit);
    return;
  }
  if (!value || typeof value !== "object") return;

  visit(value);

  for (const child of Object.values(value)) walkValue(child, visit);
}

function walkCardNodes(card, visit) {
  for (const listName of NODE_LISTS) {
    if (Array.isArray(card[listName])) walkValue(card[listName], visit);
  }
  for (const listName of TRANSFORMATION_LISTS) {
    const transformation = card[listName];
    if (transformation && Array.isArray(transformation.triggers)) {
      walkValue(transformation.triggers, visit);
    }
  }
}

/**
 * Forward references a compiled card's text makes: card slugs from `card`
 * link segments and `series` codes from `series` link segments, plus the
 * machine-readable DSL references.
 *
 * @returns {{ cardSlugs: Set<string>, seriesCodes: Set<string> }}
 */
export function collectForwardReferences(card) {
  const cardSlugs = new Set();
  const seriesCodes = new Set();

  const addName = (name) => {
    // Machine references carry authored names; slugs (link segments) are
    // already normalized, and normalizeName is idempotent on them.
    if (typeof name === "string" && name.trim() !== "") cardSlugs.add(normalizeName(name));
  };
  const addSeries = (series) => {
    if (typeof series === "string" && series.trim() !== "") seriesCodes.add(series.trim().toLowerCase());
  };

  walkCardNodes(card, (node) => {
    if (isLinkSegment(node)) {
      if (node.type === "card") cardSlugs.add(node.ref);
      if (node.type === "series") seriesCodes.add(node.ref);
      return;
    }
    if (typeof node.cardName === "string") addName(node.cardName);
    if (Array.isArray(node.cardNames)) node.cardNames.forEach(addName);
    if (typeof node.series === "string") addSeries(node.series);

    // `unit_on_board` requirements name a specific card.
    if (node.type === "unit_on_board") addName(node.name);

    // Target descriptors shape `name`/`series` identically wherever they
    // pin a specific card or series: `card` (cardTarget) and the unit,
    // predicate, and filter targets under `target`, `targets`, `source`.
    for (const key of ["card", "target", "targets", "source"]) {
      const descriptor = node[key];
      if (descriptor && typeof descriptor === "object" && !Array.isArray(descriptor)) {
        addName(descriptor.name);
        addSeries(descriptor.series);
      }
    }
  });

  return { cardSlugs, seriesCodes };
}

/**
 * Stamp `relatedCards` on every card (omitted when a card relates to
 * nothing). Cards must already carry final `cardId`, `slug`, stamped text
 * segments, and resolved evolve/ignite cross-references.
 *
 * @param {object[]} cards - compiled cards (array form, pre-keying)
 */
export function stampRelatedCards(cards) {
  const byId = new Map(cards.map((card) => [card.cardId, card]));
  const bySlug = new Map(cards.map((card) => [card.slug, card]));
  const seriesGroups = new Map();
  for (const card of cards) {
    if (card.series) {
      if (!seriesGroups.has(card.series)) seriesGroups.set(card.series, []);
      seriesGroups.get(card.series).push(card.cardId);
    }
  }
  for (const members of seriesGroups.values()) members.sort((a, b) => a - b);

  // Mention edges resolve through both slug (link segments) and the
  // normalized authored names of machine references.
  const mentionEdges = new Map();
  const mentionedByEdges = new Map();
  for (const card of cards) {
    const targets = new Set();
    const { cardSlugs, seriesCodes } = collectForwardReferences(card);
    for (const slug of cardSlugs) {
      const target = bySlug.get(slug);
      if (target) targets.add(target.cardId);
    }
    for (const code of seriesCodes) {
      for (const cardId of seriesGroups.get(code) ?? []) targets.add(cardId);
    }
    targets.delete(card.cardId);
    mentionEdges.set(card.cardId, [...targets].sort((a, b) => a - b));
  }
  for (const [sourceId, targets] of mentionEdges) {
    for (const targetId of targets) {
      if (!mentionedByEdges.has(targetId)) mentionedByEdges.set(targetId, []);
      mentionedByEdges.get(targetId).push(sourceId);
    }
  }
  for (const sources of mentionedByEdges.values()) sources.sort((a, b) => a - b);

  function edgeGroups(card) {
    const evolution = [];
    if (card.evolvedFrom !== null && card.evolvedFrom !== undefined) evolution.push(card.evolvedFrom);
    if (card.evolveInto?.cardId !== null && card.evolveInto?.cardId !== undefined) {
      evolution.push(card.evolveInto.cardId);
    }

    const ignition = [];
    if (card.ignitedFrom !== null && card.ignitedFrom !== undefined) ignition.push(card.ignitedFrom);
    if (card.igniteInto?.cardId !== null && card.igniteInto?.cardId !== undefined) {
      ignition.push(card.igniteInto.cardId);
    }

    return [
      ["evolution", evolution.sort((a, b) => a - b)],
      ["ignition", ignition.sort((a, b) => a - b)],
      ["mention", mentionEdges.get(card.cardId) ?? []],
      ["mentioned-by", mentionedByEdges.get(card.cardId) ?? []],
      ["series", (seriesGroups.get(card.series) ?? []).filter((cardId) => cardId !== card.cardId)],
    ];
  }

  for (const card of cards) {
    const related = [];
    const seen = new Set([card.cardId]);
    const queue = [card.cardId];
    while (queue.length > 0) {
      const current = byId.get(queue.shift());
      for (const [kind, targets] of edgeGroups(current)) {
        for (const targetId of targets) {
          if (seen.has(targetId)) continue;
          seen.add(targetId);
          related.push({ cardId: targetId, kind });
          queue.push(targetId);
        }
      }
    }
    if (related.length > 0) card.relatedCards = related;
  }
}
