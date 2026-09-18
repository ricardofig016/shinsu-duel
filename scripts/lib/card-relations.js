import { LINK_TYPES } from "../../public/utils/card-text.js";
import { isTestCard } from "../../server/utils/test-card.js";
import { normalizeName } from "./normalize-name.js";

/**
 * Card relation stamping for the compiled artifact.
 *
 * Every compiled card carries `relatedCards` — the deduplicated, recursively
 * closed, deterministically ordered list of cards it relates to. The list is
 * what the client detail view renders as the related-card carousel, so its
 * order is a data contract: breadth-first traversal from the card, edges
 * examined in a fixed priority, ties broken by cardId (the name-sorted
 * index). A card is never repeated: the first edge that reaches it wins its
 * entry.
 *
 * An entry is `{ cardId, kind, peerCardId }`, plus `seriesCode` on the two
 * series kinds. `kind` is directional and describes the entry's own card:
 * each tagged card states its relation to the peer it was reached from.
 *
 * - `evolves-into` / `evolves-from` — the tagged card is the later / earlier
 *   stage of the pair (`evolvedFrom` and `evolveInto.cardId` name the peer).
 * - `ignites-into` / `ignited-from` — the same for the ignition pair
 *   (`ignitedFrom` / `igniteInto.cardId`).
 * - `mentions` — the tagged card's copy names the peer. A named series
 *   counts as naming every member.
 * - `mentioned-in` — the peer's copy names the tagged card.
 * - `series-mentioned` — the peer's copy names a series the tagged card
 *   belongs to; one entry per member, carrying the series code.
 * - `same-series-as` — the tagged card shares a series with the peer, the
 *   card whose `series` field reached the tagged card.
 *
 * Edge priority per card is evolution, ignition, card mentions, series
 * mentions, reverse mentions, then series siblings. A card's copy naming a
 * series expands to every member at that step, before the traversal recurses
 * into any of them, so each member keeps the series mention rather than being
 * claimed later as a sibling.
 *
 * References that resolve to no compiled card (an unlinked machine reference
 * the compiler never validated) contribute nothing; link targets are already
 * compile errors when unresolvable.
 *
 * Test cards (`_Test*`, see `server/utils/test-card.js`) are outside the
 * graph. The served catalog filters them out, so a relation naming one could
 * never render: it would either list a card the client cannot find or leave a
 * slot whose tag names a peer it cannot resolve. Their copy also must not
 * route a real card into a closure it has nothing to do with, which is how a
 * dev card naming another card once pulled that card, and everything it
 * relates to, into a real card's carousel.
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

const compareByCardId = (a, b) => a.cardId - b.cardId;

function isCardId(value) {
  return Number.isInteger(value);
}

/**
 * Stamp `relatedCards` on every card (omitted when a card relates to
 * nothing). Cards must already carry final `cardId`, `slug`, stamped text
 * segments, and resolved evolve/ignite cross-references.
 *
 * `extraReferences` extends a card's own forward references with the ones its
 * shared catalog copy carries or names (see
 * `scripts/lib/catalog-mentions.js`): `"slug:<slug>"` for a card and
 * `"series:<code>"` for a series. They join the card's own references at the
 * mention edge, so an inherited mention behaves exactly like one the card
 * makes itself.
 *
 * @param {object[]} cards - compiled cards (array form, pre-keying)
 * @param {((card: object) => string[] | Record<string, string[]>) | null}
 *   [extraReferences] - per-card inherited reference keys, keyed by cardId
 * @returns {Map<number, { cardSlugs: Set<string>, seriesCodes: Set<string> }>}
 *   resolved forward references per cardId
 */
export function stampRelatedCards(cards, extraReferences = null) {
  // The pool the graph is built over: every card the client can be served.
  // Filtering here keeps cardIds untouched (they are assigned before this
  // stamp), so an excluded card simply has no relations in either direction.
  const pool = cards.filter((card) => !isTestCard(card));
  const byId = new Map(pool.map((card) => [card.cardId, card]));
  const bySlug = new Map(pool.map((card) => [card.slug, card]));

  const seriesGroups = new Map();
  for (const card of pool) {
    if (!card.series) continue;
    if (!seriesGroups.has(card.series)) seriesGroups.set(card.series, []);
    seriesGroups.get(card.series).push(card.cardId);
  }
  for (const members of seriesGroups.values()) members.sort((a, b) => a - b);

  // Inherited references are keyed by cardId; the hook accepts a map or a
  // lookup function so both compile pipelines can pass what they have.
  const inheritedFor = (card) => {
    if (!extraReferences) return [];
    if (typeof extraReferences === "function") return extraReferences(card) ?? [];
    return extraReferences[card.cardId] ?? [];
  };

  const ownReferences = new Map();
  for (const card of pool) {
    ownReferences.set(card.cardId, collectForwardReferences(card));
  }

  // Split one reference key list into card slugs and series codes.
  const splitReferences = (references) => {
    const cardSlugs = new Set();
    const seriesCodes = new Set();
    for (const reference of references) {
      if (typeof reference !== "string") continue;
      if (reference.startsWith("slug:")) cardSlugs.add(reference.slice("slug:".length));
      else if (reference.startsWith("series:")) seriesCodes.add(reference.slice("series:".length));
    }
    return { cardSlugs, seriesCodes };
  };

  // Forward references resolve through both slug (link segments) and the
  // normalized authored names of machine references. Naming a card and
  // naming a series that contains it are separate edges: the named card gets
  // the direct `mentioned-in`, the other members the `series-mentioned`.
  // A card's own references are examined before the ones it inherits.
  const namedEdges = new Map();
  const seriesEdges = new Map();
  for (const card of pool) {
    const own = ownReferences.get(card.cardId);
    const inherited = splitReferences(inheritedFor(card));

    const named = new Set();
    for (const slug of own.cardSlugs) {
      const target = bySlug.get(slug);
      if (target && target.cardId !== card.cardId) named.add(target.cardId);
    }
    for (const slug of inherited.cardSlugs) {
      const target = bySlug.get(slug);
      if (target && target.cardId !== card.cardId) named.add(target.cardId);
    }
    namedEdges.set(card.cardId, [...named].sort((a, b) => a - b));

    const series = [];
    for (const code of [...new Set([...own.seriesCodes, ...inherited.seriesCodes])].sort()) {
      const members = (seriesGroups.get(code) ?? []).filter((cardId) => cardId !== card.cardId);
      if (members.length > 0) series.push({ seriesCode: code, cardIds: members });
    }
    seriesEdges.set(card.cardId, series);
  }

  // Reverse mentions: every card whose copy names this one, directly or
  // through a series it names.
  const mentionedByEdges = new Map();
  for (const card of pool) {
    const targets = new Set(namedEdges.get(card.cardId));
    for (const { cardIds } of seriesEdges.get(card.cardId)) {
      for (const cardId of cardIds) targets.add(cardId);
    }
    for (const targetId of targets) {
      if (!mentionedByEdges.has(targetId)) mentionedByEdges.set(targetId, []);
      mentionedByEdges.get(targetId).push(card.cardId);
    }
  }
  for (const sources of mentionedByEdges.values()) sources.sort((a, b) => a - b);

  // Edges out of one card, in the priority the traversal examines them. A
  // target's kind describes the target, so it reads as the reverse of the
  // direction this card relates to it in.
  function edgeGroups(card) {
    const evolution = [];
    if (isCardId(card.evolvedFrom)) evolution.push({ cardId: card.evolvedFrom, kind: "evolves-into" });
    if (isCardId(card.evolveInto?.cardId)) evolution.push({ cardId: card.evolveInto.cardId, kind: "evolves-from" });

    const ignition = [];
    if (isCardId(card.ignitedFrom)) ignition.push({ cardId: card.ignitedFrom, kind: "ignites-into" });
    if (isCardId(card.igniteInto?.cardId)) ignition.push({ cardId: card.igniteInto.cardId, kind: "ignited-from" });

    const mentions = namedEdges.get(card.cardId).map((cardId) => ({ cardId, kind: "mentioned-in" }));

    const series = [];
    for (const { seriesCode, cardIds } of seriesEdges.get(card.cardId)) {
      for (const cardId of cardIds) series.push({ cardId, kind: "series-mentioned", seriesCode });
    }

    const mentionedBy = (mentionedByEdges.get(card.cardId) ?? [])
      .map((cardId) => ({ cardId, kind: "mentions" }));

    const siblings = (seriesGroups.get(card.series) ?? [])
      .filter((cardId) => cardId !== card.cardId)
      .map((cardId) => ({ cardId, kind: "same-series-as", seriesCode: card.series }));

    return [evolution, ignition, mentions, series, mentionedBy, siblings]
      .map((group) => group.sort(compareByCardId));
  }

  for (const card of pool) {
    const related = [];
    const seen = new Set([card.cardId]);
    const queue = [card.cardId];
    while (queue.length > 0) {
      const current = byId.get(queue.shift());
      for (const group of edgeGroups(current)) {
        for (const edge of group) {
          if (seen.has(edge.cardId)) continue;
          seen.add(edge.cardId);
          const entry = { cardId: edge.cardId, kind: edge.kind, peerCardId: current.cardId };
          if (edge.seriesCode !== undefined) entry.seriesCode = edge.seriesCode;
          related.push(entry);
          queue.push(edge.cardId);
        }
      }
    }
    if (related.length > 0) card.relatedCards = related;
  }
}
