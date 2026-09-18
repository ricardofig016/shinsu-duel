import compiledCopy from "../data/compiled/catalog-copy.json" with { type: "json" };
import attributesSource from "../data/attributes.json" with { type: "json" };
import traitsSource from "../data/traits.json" with { type: "json" };
import positionsSource from "../data/positions.json" with { type: "json" };
import conditionsSource from "../data/conditions.json" with { type: "json" };
import glossarySource from "../data/glossary.json" with { type: "json" };
import { RANKS } from "./ranks.js";

/**
 * The single boundary between shared catalog **mechanics** and shared catalog
 * **copy**.
 *
 * The engine keeps reading the authoring catalogs (`server/data/*.json`) for
 * codes, lines, colors, icon paths, and numeric flags. Every prose field a
 * player reads comes from the compiled copy artifact instead
 * (`server/data/compiled/catalog-copy.json`, built by `npm run compile:cards`
 * from the same authoring text), where it is stored as compiled display
 * segments — `{ segments }`, tokenized at build time so inline links
 * (`[[condition:Burned]]`) render wherever the copy is displayed.
 *
 * A projection keeps every authoring field and replaces the prose fields with
 * their compiled form, so a served entry carries the same shape it always did
 * apart from its prose becoming segments. Anything that needs plain text
 * projects it with `segmentsToPlainText` from `public/utils/card-text.js`.
 *
 * Projections are built on first use and invalidated when the compiled copy
 * is swapped, so a consumer that captured a view before the swap still reads
 * the active copy afterwards (tests swap in the fixture artifact).
 *
 * `affiliations` is deliberately absent: its copy is plain text and takes no
 * links.
 */

let compiledCatalog = compiledCopy;
let projections = null;

/**
 * Swap the compiled copy for a test run (fixtures own their own artifact).
 * Production always reads the shipped artifact.
 *
 * @param {object} copy compiled catalog copy artifact
 */
export function setCompiledCatalogCopy(copy) {
  compiledCatalog = copy;
  projections = null;
}

/** The active compiled catalog copy artifact. */
export const getCompiledCatalogCopy = () => compiledCatalog;

/** A compiled prose field: `{ segments }`, or null when it is not one. */
const proseSegments = (value) =>
  value && typeof value === "object" && Array.isArray(value.segments) ? value : null;

/**
 * Overlay compiled prose on one authoring value. A prose field the compiled
 * copy carries is replaced by its `{ segments }` object; object fields
 * recurse, so nested prose (`hud` entries, rank lists) projects too. Values
 * the compiled copy does not mention stay exactly as authored, so a catalog
 * gap degrades to the authored text instead of dropping a field.
 */
function overlayProse(value, copy) {
  const compiled = proseSegments(copy);
  if (compiled) return compiled;

  if (Array.isArray(value)) {
    // Prose lines compile into a parallel array of `{ segments }` entries; a
    // non-prose array (none in these catalogs) keeps its authored values.
    const lines = Array.isArray(copy) ? copy : [];
    return value.map((item, index) =>
      overlayProse(item, Object.hasOwn(lines, index) ? lines[index] : undefined)
    );
  }

  if (
    value && typeof value === "object" &&
    copy && typeof copy === "object" && !Array.isArray(copy)
  ) {
    const merged = {};
    for (const [key, field] of Object.entries(value)) {
      merged[key] = Object.hasOwn(copy, key) ? overlayProse(field, copy[key]) : field;
    }
    return merged;
  }

  return value;
}

/**
 * A catalog projected against its compiled copy: same keys, prose fields
 * carrying compiled display segments.
 */
const projectCatalog = (source, copy) => overlayProse(source ?? {}, copy ?? {});

/**
 * The glossary with prose fields carrying compiled segments. The rank concept
 * is a lone line, so it stays an array of segments rather than gaining a
 * container no consumer reads.
 */
function buildGlossary(copy) {
  const projected = projectCatalog(glossarySource, copy.glossary);
  const concept = proseSegments(projected.ranks?.concept)?.segments;
  if (Array.isArray(concept)) {
    projected.ranks = { ...projected.ranks, concept };
  }
  return projected;
}

/**
 * Rank entries for the glossary route: the copy composed from the canonical
 * rank catalog, so the displayed cost ranges can't drift from build-time
 * validation. A missing rank copy throws, which surfaces at boot in
 * production and on the first request for a swapped fixture copy.
 */
function buildRankList(glossaryView) {
  return Object.entries(RANKS).map(([code, rank]) => {
    const entry = glossaryView.ranks?.[code];
    if (!entry) throw new Error(`Glossary is missing rank copy for "${code}".`);
    return {
      code,
      name: entry.name,
      description: entry.description,
      minCost: rank.minCost,
      maxCost: rank.maxCost,
    };
  });
}

function build() {
  const copy = compiledCatalog;
  const glossary = buildGlossary(copy);
  return {
    attributes: projectCatalog(attributesSource, copy.attributes),
    traits: projectCatalog(traitsSource, copy.traits),
    positions: projectCatalog(positionsSource, copy.positions),
    conditions: projectCatalog(conditionsSource, copy.conditions),
    glossary,
    rankList: buildRankList(glossary),
  };
}

function current() {
  if (!projections) projections = build();
  return projections;
}

/**
 * The glossary route's payload: the projected glossary with its rank list
 * composed from the canonical rank catalog. Built per call from the active
 * compiled copy.
 */
export function getGlossaryView() {
  const { glossary, rankList } = current();
  return {
    ...glossary,
    ranks: { title: glossary.ranks.title, concept: glossary.ranks.concept, list: rankList },
  };
}

/** The attribute catalog with prose fields carrying compiled segments. */
export const getAttributes = () => current().attributes;

/** The trait catalog with prose fields carrying compiled segments. */
export const getTraits = () => current().traits;

/** The position catalog with prose fields carrying compiled segments. */
export const getPositions = () => current().positions;

/** The condition catalog with prose fields carrying compiled segments. */
export const getConditions = () => current().conditions;
