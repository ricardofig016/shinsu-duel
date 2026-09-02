/**
 * Pure search, filter, sort, and URL-state logic for the cards browse page.
 *
 * Operates on the flattened card view models from `public/game/viewModels.js`
 * (built from `Card.toSanitizedObject()` payloads). No DOM access here, so
 * the page script stays free of data-shaping logic.
 */

export const DEFAULT_SORT_KEY = "name-asc";

export const SORT_KEYS = Object.freeze([
  { key: "name-asc", label: "Name A-Z" },
  { key: "name-desc", label: "Name Z-A" },
  { key: "cost-asc", label: "Cost low-high" },
  { key: "cost-desc", label: "Cost high-low" },
]);

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/**
 * Human card name for an artwork file stem, following the artwork contract
 * where the stem is the card slug: `twenty_fifth_baam` becomes `Twenty Fifth Baam`.
 */
export function artworkDisplayName(stem) {
  if (typeof stem !== "string" || stem.trim() === "") return "";
  return stem
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/(^|\s)\S/g, (character) => character.toUpperCase());
}

const asString = (value) => (typeof value === "string" ? value : "");

/** Every text a card can be searched by, lowercased into one string. */
export function buildSearchableText(view) {
  const parts = [
    asString(view.name),
    asString(view.sobriquet),
    asString(view.type),
    asString(view.kind),
    asString(view.rank),
    ...(view.abilities ?? []).map((ability) => asString(ability.text)),
    ...(view.passiveAbilities ?? []).map((passive) => asString(passive.text)),
    ...(view.requirements ?? []),
    ...(view.effects ?? []),
    ...(view.rules ?? []),
    ...(view.evolveTriggers ?? []),
    ...(view.igniteTriggers ?? []),
    ...(view.affiliations ?? []).map((affiliation) => asString(affiliation.name)),
    ...(view.printedTraits ?? []).flatMap((trait) => [asString(trait.name), asString(trait.description)]),
    ...(view.attributes ?? []).flatMap((attribute) => [asString(attribute.name), asString(attribute.description)]),
    ...Object.values(view.positions ?? {}).flatMap((position) => [asString(position.name), asString(position.description)]),
  ];
  return parts.filter((part) => part !== "").join(" ").toLowerCase();
}

const EMPTY_CRITERIA = Object.freeze({
  text: "",
  type: null,
  kind: null,
  rank: null,
  affiliations: [],
  traits: [],
  positions: [],
  costMin: null,
  costMax: null,
});

/** Fill missing criteria fields with their neutral values. */
export function normalizeCriteria(criteria) {
  const input = criteria ?? {};
  return {
    text: asString(input.text),
    type: input.type ?? null,
    kind: input.kind ?? null,
    rank: input.rank ?? null,
    affiliations: [...(input.affiliations ?? [])],
    traits: [...(input.traits ?? [])],
    positions: [...(input.positions ?? [])],
    costMin: input.costMin ?? null,
    costMax: input.costMax ?? null,
  };
}

/**
 * Filter cards by the criteria. Facets combine with AND; the values inside
 * one facet combine with OR; the cost bounds are inclusive.
 */
export function filterCards(views, criteria) {
  const { text, type, kind, rank, affiliations, traits, positions, costMin, costMax } =
    normalizeCriteria(criteria);
  const needle = text.trim().toLowerCase();

  const matchesText = (view) => needle === "" || buildSearchableText(view).includes(needle);
  const matchesSingle = (value, selected) => selected === null || value === selected;
  const matchesAny = (names, selected) =>
    selected.length === 0 || names.some((name) => selected.includes(name));
  const matchesCost = (cost) =>
    (costMin === null || cost >= costMin) && (costMax === null || cost <= costMax);

  return views.filter((view) => {
    if (!matchesText(view)) return false;
    if (!matchesSingle(view.type, type)) return false;
    if (!matchesSingle(view.kind, kind)) return false;
    if (!matchesSingle(view.rank, rank)) return false;
    if (!matchesAny((view.affiliations ?? []).map((entry) => entry.name), affiliations)) return false;
    if (!matchesAny((view.printedTraits ?? []).map((entry) => entry.name), traits)) return false;
    if (!matchesAny(Object.values(view.positions ?? {}).map((entry) => entry.name), positions)) return false;
    return matchesCost(view.cost ?? 0);
  });
}

/** Sort a copy of the views; unknown keys fail instead of guessing. */
export function sortCards(views, sortKey = DEFAULT_SORT_KEY) {
  if (!SORT_KEYS.some((entry) => entry.key === sortKey)) {
    throw new TypeError(`Unknown sort key: ${String(sortKey)}`);
  }
  const direction = sortKey.endsWith("-desc") ? -1 : 1;
  const field = sortKey.startsWith("cost") ? "cost" : "name";
  const byCardId = (a, b) => (a.cardId ?? 0) - (b.cardId ?? 0);
  const compare = (a, b) => {
    if (field === "cost") {
      const delta = (a.cost ?? 0) - (b.cost ?? 0);
      if (delta !== 0) return delta * direction;
    }
    const byName = collator.compare(a.name ?? "", b.name ?? "") * direction;
    if (byName !== 0) return byName;
    return byCardId(a, b);
  };
  return [...views].sort(compare);
}

const distinctSorted = (values) => [...new Set(values.filter((value) => value != null))].sort(collator.compare);

/** Facet choices offered by the toolbar, derived from the catalog itself. */
export function deriveFacetOptions(views) {
  return {
    types: distinctSorted(views.map((view) => view.type)),
    kinds: distinctSorted(views.map((view) => view.kind)),
    ranks: distinctSorted(views.map((view) => view.rank)),
    affiliations: distinctSorted(views.flatMap((view) => (view.affiliations ?? []).map((entry) => entry.name))),
    traits: distinctSorted(views.flatMap((view) => (view.printedTraits ?? []).map((entry) => entry.name))),
    positions: distinctSorted(views.flatMap((view) => Object.values(view.positions ?? {}).map((entry) => entry.name))),
  };
}

/**
 * Toolbar state as query parameters. Defaults are omitted so shareable URLs
 * stay short; `dev` is page-level state and never written here.
 */
export function encodeState(criteria, sortKey = DEFAULT_SORT_KEY) {
  const { text, type, kind, rank, affiliations, traits, positions, costMin, costMax } =
    normalizeCriteria(criteria);
  const params = new URLSearchParams();
  const query = text.trim();
  if (query !== "") params.set("q", query);
  if (type !== null) params.set("type", type);
  if (kind !== null) params.set("kind", kind);
  if (rank !== null) params.set("rank", rank);
  for (const name of affiliations) params.append("affiliation", name);
  for (const name of traits) params.append("trait", name);
  for (const name of positions) params.append("position", name);
  if (costMin !== null) params.set("min", String(costMin));
  if (costMax !== null) params.set("max", String(costMax));
  if (sortKey !== DEFAULT_SORT_KEY) params.set("sort", sortKey);
  return params;
}

const singleParam = (params, name) => {
  const value = params.get(name);
  return typeof value === "string" && value !== "" ? value : null;
};

const multiParams = (params, name) => params.getAll(name);

const numberParam = (params, name) => {
  const value = singleParam(params, name);
  if (value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

/** Parse query parameters back into toolbar state; invalid values fall back to defaults. */
export function decodeState(params) {
  const sortParam = singleParam(params, "sort");
  const sortKey = SORT_KEYS.some((entry) => entry.key === sortParam) ? sortParam : DEFAULT_SORT_KEY;
  return {
    criteria: {
      text: singleParam(params, "q") ?? "",
      type: singleParam(params, "type"),
      kind: singleParam(params, "kind"),
      rank: singleParam(params, "rank"),
      affiliations: multiParams(params, "affiliation"),
      traits: multiParams(params, "trait"),
      positions: multiParams(params, "position"),
      costMin: numberParam(params, "min"),
      costMax: numberParam(params, "max"),
    },
    sortKey,
  };
}
