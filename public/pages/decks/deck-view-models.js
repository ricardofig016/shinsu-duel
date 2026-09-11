/**
 * Pure view models for the deck collection page.
 *
 * Decks reference cards by **slug** (the persistent card identifier stamped
 * into the compiled catalog); the runtime cardId shifts whenever the catalog
 * changes and is never persisted here.
 *
 * The deck rules stay on the server: `POST /decks/validate` owns what makes a
 * deck legal, and the page renders whatever problems it returns. These helpers
 * only shape what the page displays — collection rows, the card pool, copy
 * counts against the picker cap, and the save-button state. No DOM access here.
 */

import { buildCardViewModel } from "../../game/viewModels.js";
import { buildSearchableText, nameCollator, normalizeCriteria } from "../../utils/card-browse.js";

/**
 * Deck-construction numbers for the page to display and cap input with. They
 * come from the deck API (`GET /decks/data` carries `limits`); these values
 * are the fallback for when a caller has no server payload at hand, and never
 * decide legality.
 */
export const DEFAULT_DECK_LIMITS = { deckSize: 30, maxCardCopies: 3, maxNameLength: 40 };

/** Fallback limits, named for the rules they mirror (`RULES.md`). */
export const DECK_SIZE = DEFAULT_DECK_LIMITS.deckSize;
export const MAX_CARD_COPIES = DEFAULT_DECK_LIMITS.maxCardCopies;
export const MAX_DECK_NAME_LENGTH = DEFAULT_DECK_LIMITS.maxNameLength;

/** Why a save is blocked before it is sent: the name problem mirrors the
 * server's wording for the same failure, and the card problem reports a card
 * the loaded card pool does not offer. */
export function deckNameProblem(limits) {
  return `Deck name must be 1-${resolveLimits(limits).maxNameLength} characters.`;
}
export const DECK_NAME_PROBLEM = deckNameProblem();
export const CARD_POOL_PROBLEM = "Some cards in this deck are not in the card pool.";

/**
 * The limits to render with, falling back to the built-in values when a caller
 * passes nothing.
 * @param {{ deckSize?: number, maxCardCopies?: number, maxNameLength?: number }} [limits]
 */
function resolveLimits(limits) {
  return { ...DEFAULT_DECK_LIMITS, ...(limits ?? {}) };
}

/**
 * The trimmed deck name, or null when the server would reject it.
 * @param {*} name
 * @param {{ maxNameLength?: number }} [limits]
 * @returns {string|null}
 */
export function normalizeDeckName(name, limits) {
  const { maxNameLength } = resolveLimits(limits);
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > maxNameLength) return null;
  return trimmed;
}

/**
 * A copy of a deck's name, with the base shortened as far as the name limit
 * requires.
 * @param {*} name
 * @param {{ maxNameLength?: number }} [limits]
 * @returns {string}
 */
export function duplicateDeckName(name, limits) {
  const { maxNameLength } = resolveLimits(limits);
  const suffix = " copy";
  const base = (typeof name === "string" ? name.trim() : "") || "Deck";
  return `${base.slice(0, maxNameLength - suffix.length).trimEnd()}${suffix}`;
}

/**
 * Copies of each card slug, keyed by slug in the order the cards first
 * appear.
 * @param {string[]} cardSlugs
 * @returns {Map<string, number>}
 */
export function countCopies(cardSlugs) {
  const counts = new Map();
  for (const slug of cardSlugs ?? []) counts.set(slug, (counts.get(slug) ?? 0) + 1);
  return counts;
}

/**
 * One card's copy count against the picker cap.
 * @param {string[]} cardSlugs
 * @param {string} slug
 * @param {{ maxCardCopies?: number }} [limits]
 * @returns {{ count: number, limit: number, reached: boolean, label: string }}
 */
export function copyLimitView(cardSlugs, slug, limits) {
  const { maxCardCopies } = resolveLimits(limits);
  const count = countCopies(cardSlugs).get(slug) ?? 0;
  return {
    count,
    limit: maxCardCopies,
    reached: count >= maxCardCopies,
    label: `${count} / ${maxCardCopies}`,
  };
}

/** Whether the deck already holds the maximum copies of a card. */
export function isCopyLimitReached(cardSlugs, slug, limits) {
  return copyLimitView(cardSlugs, slug, limits).reached;
}

/**
 * The deck size against the deck-size limit.
 * @param {string[]} cardSlugs
 * @param {{ deckSize?: number }} [limits]
 * @returns {{ count: number, limit: number, remaining: number, isFull: boolean, isOver: boolean, label: string }}
 */
export function deckSizeView(cardSlugs, limits) {
  const { deckSize } = resolveLimits(limits);
  const count = (cardSlugs ?? []).length;
  return {
    count,
    limit: deckSize,
    remaining: deckSize - count,
    isFull: count === deckSize,
    isOver: count > deckSize,
    label: `${count} / ${deckSize}`,
  };
}

/**
 * The list with one more copy of a card. A card already at the picker cap
 * keeps its copies.
 * @param {string[]} cardSlugs
 * @param {string} slug
 * @param {{ maxCardCopies?: number }} [limits]
 * @returns {string[]}
 */
export function withCardCopyAdded(cardSlugs, slug, limits) {
  const cards = cardSlugs ?? [];
  if (isCopyLimitReached(cards, slug, limits)) return [...cards];
  return [...cards, slug];
}

/**
 * The list with one copy of a card removed. The last occurrence goes, so the
 * remaining cards keep their order.
 * @param {string[]} cardSlugs
 * @param {string} slug
 * @returns {string[]}
 */
export function withCardCopyRemoved(cardSlugs, slug) {
  const cards = [...(cardSlugs ?? [])];
  const index = cards.lastIndexOf(slug);
  if (index >= 0) cards.splice(index, 1);
  return cards;
}

/**
 * One pool card: the card's view model plus the marks that a pick will be
 * flagged by the deck rules. Every catalog card stays pickable.
 * @param {object} card catalog card view (`GET /cards/data`)
 * @param {{ isTest?: boolean }} [options]
 */
export function buildPickerEntry(card, { isTest = false } = {}) {
  if (!card || typeof card !== "object" || Array.isArray(card)) {
    throw new TypeError("buildPickerEntry needs a card view object.");
  }
  const view = buildCardViewModel(card);
  const deckEligible = card.deckEligible !== false;
  const marks = [];
  if (!deckEligible) marks.push({ code: "unreachable", label: "Unreachable" });
  if (isTest) marks.push({ code: "test", label: "Test card" });
  return {
    view,
    slug: card.slug ?? null,
    name: view.name,
    cost: view.cost,
    type: view.type,
    isTest,
    deckEligible,
    marks,
  };
}

/**
 * The pool catalog: the public cards, then the test cards a dev catalog
 * adds.
 * @param {{ cards?: object[], testCards?: object[] }} [payload]
 */
export function buildPickerEntries({ cards = [], testCards = [] } = {}) {
  return [
    ...cards.map((card) => buildPickerEntry(card, { isTest: false })),
    ...testCards.map((card) => buildPickerEntry(card, { isTest: true })),
  ];
}

/**
 * A deck's cards grouped by card, in the order they were first picked. A slug
 * the loaded catalog does not offer keeps its slot and is marked unknown.
 * @param {string[]} cardSlugs
 * @param {Map<string, object>} entriesBySlug pool entries keyed by card slug
 */
export function buildDeckContents(cardSlugs, entriesBySlug) {
  return [...countCopies(cardSlugs)].map(([slug, count]) => {
    const entry = entriesBySlug?.get(slug) ?? null;
    return {
      slug,
      count,
      copiesLabel: count === 1 ? "1 copy" : `${count} copies`,
      name: entry ? entry.name : slug,
      cost: entry ? entry.cost : null,
      marks: entry ? [...entry.marks] : [{ code: "unknown", label: "Unknown card" }],
      isUnknown: entry === null,
    };
  });
}

/**
 * The status text for a validation payload (`buildable`, `legal`,
 * `problems`) as returned by `POST /decks/validate` and the collection read.
 * @param {{ buildable?: boolean, legal?: boolean, problems?: string[] }} [validation]
 */
export function buildValidationView(validation) {
  const problems = [...(validation?.problems ?? [])];
  const isLegal = validation?.legal === true;
  return {
    isLegal,
    isBuildable: validation?.buildable !== false,
    label: isLegal ? "Legal" : "Not legal",
    problemLabel: problems.length === 1 ? "1 problem" : `${problems.length} problems`,
    problems,
  };
}

/**
 * One deck-collection row.
 * @param {{ id?: string, name?: string, cards?: string[], buildable?: boolean, legal?: boolean, problems?: string[] }} deck
 * @param {{ deckSize?: number }} [limits]
 */
export function buildDeckRow(deck, limits) {
  const size = deckSizeView(deck?.cards, limits);
  const validation = buildValidationView(deck);
  return {
    id: deck?.id ?? null,
    name: deck?.name ?? "",
    cardCount: size.count,
    sizeLabel: `${size.count} / ${size.limit} cards`,
    isLegal: validation.isLegal,
    isBuildable: validation.isBuildable,
    label: validation.label,
    problemLabel: validation.problemLabel,
    problems: validation.problems,
  };
}

/**
 * Whether the deck may be sent to the server: a name inside the name limit and
 * every card slug present in the loaded catalog. Deck rule violations never
 * block a save, because the collection keeps them flagged. The result carries
 * the full card list so the save request sends exactly the deck being edited.
 * @param {{ name?: string, cards?: string[], knownSlugs?: Set<string>|string[], limits?: object }} [draft]
 * @returns {{ name: string|null, cards: string[], unknownSlugs: string[], enabled: boolean, blockedReason: string|null }}
 */
export function buildSaveState({ name, cards = [], knownSlugs, limits } = {}) {
  const normalizedName = normalizeDeckName(name, limits);
  const known = knownSlugs instanceof Set ? knownSlugs : new Set(knownSlugs ?? []);
  const unknownSlugs = [...new Set(cards.filter((slug) => !known.has(slug)))];

  if (normalizedName === null) {
    return { name: null, cards: [...cards], unknownSlugs, enabled: false, blockedReason: deckNameProblem(limits) };
  }
  if (unknownSlugs.length > 0) {
    return { name: normalizedName, cards: [...cards], unknownSlugs, enabled: false, blockedReason: CARD_POOL_PROBLEM };
  }
  return { name: normalizedName, cards: [...cards], unknownSlugs, enabled: true, blockedReason: null };
}

/**
 * The deck table's columns, in order. The header is built from this list and
 * the row builder produces exactly one cell per column, so the two can never
 * drift apart.
 */
export const DECK_TABLE_COLUMNS = [
  { key: "fan", label: "Deck" },
  { key: "name", label: "Name" },
  { key: "size", label: "Cards" },
  { key: "composition", label: "Units / skills / equipment" },
  { key: "averageCost", label: "Avg cost" },
  { key: "status", label: "Status" },
  { key: "updatedAt", label: "Updated" },
  { key: "actions", label: "Actions" },
];

/**
 * The deck list's sort choices.
 */
export const DECK_SORT_KEYS = [
  { key: "name-asc", label: "Name A-Z" },
  { key: "name-desc", label: "Name Z-A" },
  { key: "size-desc", label: "Size high-low" },
  { key: "size-asc", label: "Size low-high" },
];

/**
 * The fan transforms for `count` cards: even angular spread around the center,
 * the last card (the most expensive) frontmost. The caller applies each result
 * as the wrapper's inline `transform` and `zIndex`.
 * @param {number} count
 * @param {{ spreadRem?: number, angleDeg?: number, scale?: number }} [options]
 * @returns {{ transform: string, zIndex: number }[]}
 */
export function deckFanTransforms(count, { spreadRem = 2.2, angleDeg = 14, scale = 0.73 } = {}) {
  return Array.from({ length: count }, (_, index) => {
    const offset = (index - (count - 1) / 2) * spreadRem;
    const angle = (index - (count - 1) / 2) * angleDeg;
    return {
      transform: `translateX(calc(-50% + ${offset}rem)) rotate(${angle}deg) scale(${scale})`,
      zIndex: index + 1,
    };
  });
}

/** Comparator for the deck list order; `size` means total card count. */
export function compareDecks(sortKey = "name-asc") {
  const direction = sortKey.endsWith("-desc") ? -1 : 1;
  const bySize = sortKey.startsWith("size");
  return (a, b) => {
    if (bySize) {
      const delta = ((a.cardCount ?? 0) - (b.cardCount ?? 0)) * direction;
      if (delta !== 0) return delta;
    } else {
      const byName = nameCollator.compare(a.name ?? "", b.name ?? "") * direction;
      if (byName !== 0) return byName;
    }
    return (a.id ?? "").localeCompare(b.id ?? "");
  };
}

/**
 * A deck's fan: up to `limit` distinct units, the most expensive ones, in
 * display order (cheapest left, most expensive right and frontmost). Slugs
 * missing from the pool and non-unit cards never appear.
 * @param {string[]} cardSlugs
 * @param {Map<string, object>} entriesBySlug pool entries keyed by card slug
 * @param {{ limit?: number }} [options]
 * @returns {object[]} pool entries, cheapest first
 */
export function buildDeckFan(cardSlugs, entriesBySlug, { limit = 3 } = {}) {
  const units = [...new Set(cardSlugs ?? [])]
    .map((slug) => entriesBySlug?.get(slug) ?? null)
    .filter((entry) => entry && entry.view.type === "unit");
  units.sort(
    (a, b) =>
      (b.view.cost ?? 0) - (a.view.cost ?? 0) ||
      nameCollator.compare(a.name, b.name) ||
      (a.slug ?? "").localeCompare(b.slug ?? "")
  );
  return units.slice(0, limit).reverse();
}

/**
 * How many copies of each card type a deck holds. Slugs missing from the pool
 * count as other.
 * @param {string[]} cardSlugs
 * @param {Map<string, object>} entriesBySlug pool entries keyed by card slug
 * @returns {{ unit: number, skill: number, equipment: number, other: number }}
 */
export function buildDeckComposition(cardSlugs, entriesBySlug) {
  const composition = { unit: 0, skill: 0, equipment: 0, other: 0 };
  for (const slug of cardSlugs ?? []) {
    const type = entriesBySlug?.get(slug)?.view?.type;
    if (type === "unit" || type === "skill" || type === "equipment") composition[type]++;
    else composition.other++;
  }
  return composition;
}

/** The composition as a compact units / skills / equipment label. */
export function buildDeckCompositionLabel(composition) {
  const { unit, skill, equipment } = composition ?? { unit: 0, skill: 0, equipment: 0 };
  return `${unit} / ${skill} / ${equipment}`;
}

/**
 * A deck's average card cost, or null for an empty deck.
 * @param {string[]} cardSlugs
 * @param {Map<string, object>} entriesBySlug pool entries keyed by card slug
 * @returns {number|null}
 */
export function deckAverageCost(cardSlugs, entriesBySlug) {
  const cards = cardSlugs ?? [];
  if (cards.length === 0) return null;
  const total = cards.reduce((sum, slug) => sum + (entriesBySlug?.get(slug)?.view?.cost ?? 0), 0);
  return Math.round((total / cards.length) * 10) / 10;
}

/**
 * Whether a deck satisfies every active card filter independently: some card
 * in the deck matches the text, some card carries one of the selected
 * affiliations, some card has the selected type. Slugs missing from the pool
 * match nothing.
 * @param {string[]} cardSlugs
 * @param {Map<string, object>} entriesBySlug pool entries keyed by card slug
 * @param {object} criteria normalized card criteria (text, type, affiliations)
 */
export function deckMatchesCardCriteria(cardSlugs, entriesBySlug, criteria) {
  const { text, type, affiliations } = normalizeCriteria(criteria);
  const views = [...new Set(cardSlugs ?? [])]
    .map((slug) => entriesBySlug?.get(slug)?.view)
    .filter(Boolean);

  const needle = text.trim().toLowerCase();
  if (needle !== "" && !views.some((view) => buildSearchableText(view).includes(needle))) return false;
  if (type !== null && !views.some((view) => view.type === type)) return false;
  if (
    affiliations.length > 0 &&
    !views.some((view) => (view.affiliations ?? []).some((affiliation) => affiliations.includes(affiliation.name)))
  ) {
    return false;
  }
  return true;
}

/**
 * One deck-table row: the collection row plus the fan, composition counts,
 * average cost, and last-updated stamp.
 * @param {{ id?: string, name?: string, cards?: string[], buildable?: boolean, legal?: boolean, problems?: string[], updatedAt?: string }} deck
 * @param {{ entriesBySlug?: Map<string, object>, limits?: object }} [options]
 */
export function buildDeckTableRow(deck, { entriesBySlug = null, limits } = {}) {
  const row = buildDeckRow(deck, limits);
  const composition = buildDeckComposition(deck?.cards, entriesBySlug);
  const averageCost = deckAverageCost(deck?.cards, entriesBySlug);
  return {
    ...row,
    composition,
    compositionLabel: buildDeckCompositionLabel(composition),
    averageCost,
    averageCostLabel: averageCost === null ? "-" : averageCost.toFixed(1),
    updatedAt: deck?.updatedAt ?? null,
    updatedAtLabel: deck?.updatedAt ? String(deck.updatedAt).slice(0, 10) : "-",
    fan: buildDeckFan(deck?.cards, entriesBySlug),
  };
}
