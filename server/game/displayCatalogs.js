import compiledCopy from "../data/compiled/catalog-copy.json" with { type: "json" };
import attributesSource from "../data/attributes.json" with { type: "json" };
import traitsSource from "../data/traits.json" with { type: "json" };
import positionsSource from "../data/positions.json" with { type: "json" };
import conditionsSource from "../data/conditions.json" with { type: "json" };
import glossarySource from "../data/glossary.json" with { type: "json" };
import { buildPlacementRegistry, KIND_LINES } from "./placement.js";
import { getIconPath } from "../utils/file-util.js";
import { RANKS } from "./ranks.js";

/**
 * The path `getIconPath` answers with when the icon folder carries no icon for
 * a code. It is how a caller tells "this line has its own icon" from "this line
 * has none", because `getIconPath` reports both the same way. Kept in step with
 * `server/utils/file-util.js` by the icon assertions in
 * `server/utils/tests/card-catalog.test.js`.
 */
const PLACEHOLDER_ICON_PATH = "/assets/images/placeholder.png";

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

/**
 * The vocabulary, copy, and icon for every kind `server/game/placement.js`
 * classifies: the code, the display name and prose the glossary carries, and
 * the icon the board paints from the same `positions` icon folder the position
 * slots read, so a slot is paintable whichever shape it is.
 *
 * The description is the glossary's own projected field, which is the shape a
 * position entry's description has — compiled display segments in a
 * `{ segments }` object — because both are prose from the same compiled
 * artifact. A kind carries no verbose description, and none is authored: the
 * chip tooltip ends at the kind's own copy.
 *
 * A kind that is placed on more than one line paints differently per line when
 * the folder carries that line's icon (`frontline-shinheuh.png`,
 * `backline-shinheuh.png`), and otherwise falls back to the kind's own icon
 * (`landmark.png`), then to the placeholder path `getIconPath` returns when the
 * folder carries neither.
 *
 * Which of these kinds earns a slot on which line is the registry's own
 * decision (`KIND_LINES[kind].slot` and `.lines`), so this projection supplies
 * only the display vocabulary and never filters the set itself.
 */
function buildKindSlots(glossaryView) {
  return Object.fromEntries(
    Object.keys(KIND_LINES)
      .filter((code) => glossaryView.kinds?.[code])
      .map((code) => [
        code,
        {
          code,
          name: glossaryView.kinds[code].name,
          description: glossaryView.kinds[code].description,
          iconPath: getIconPath(code, "positions"),
          slotIcons: Object.fromEntries(
            KIND_LINES[code].lines.map((line) => {
              const lineIcon = getIconPath(`${line}-${code}`, "positions");
              return [line, lineIcon === PLACEHOLDER_ICON_PATH ? getIconPath(code, "positions") : lineIcon];
            })
          ),
        },
      ])
  );
}

/**
 * The position catalog with each entry's icon resolved, which is how both the
 * positions route and the placement registry serve it. Composed per call so a
 * fixture copy swapped in for a test run reads the catalog it swapped in.
 */
export function getPositionCatalog() {
  const positions = getPositions();
  return Object.fromEntries(
    Object.keys(positions).map((code) => [
      code,
      { ...positions[code], code, iconPath: getIconPath(code, "positions") },
    ])
  );
}

/**
 * One registry slot with the display fields the kind it stands for supplies.
 * `server/game/placement.js` composes a slot from the codes and lines the
 * deploy rule owns and copies only the name and icon its caller resolved, so
 * the kind's description, which a chip tooltip reads, is attached here from the
 * same projection the name comes from.
 *
 * A position slot selects the `standard` kind, which has no kind vocabulary, so
 * it passes through as the registry built it and keeps its position entry's own
 * copy.
 */
function withKindDisplay(slot, kinds, line) {
  const kind = kinds[slot.kind];
  if (!kind) return slot;

  const described = { ...slot, description: kind.description };
  const slotIcon = kind.slotIcons?.[line];
  return slotIcon && slotIcon !== described.iconPath
    ? { ...described, iconPath: slotIcon }
    : described;
}

/**
 * The placement registry for the board: one entry per field line, each holding
 * that line's placeable slots (see `server/game/placement.js`). Position slots
 * come first from the projected position catalog and kind slots follow from the
 * kinds the deploy rule classifies, so a consumer never maintains the list
 * itself.
 *
 * A kind slot is painted with the icon for the line its instance sits on: the
 * icon folder ships `frontline-shinheuh.png` and `backline-shinheuh.png` beside
 * `shinheuh.png`, so a shinheuh offers one slot per line and each slot looks
 * like the line it is for. A kind whose folder carries no per-line icon
 * (`landmark.png`) keeps its own.
 *
 * A kind slot also carries the kind's glossary description, so the chip a card
 * face builds from it tooltips like a position chip — line label, then the
 * kind's copy — instead of showing the label alone.
 */
export function getPlacementRegistry() {
  const kinds = buildKindSlots(current().glossary);
  const registry = buildPlacementRegistry(getPositionCatalog(), kinds);
  return Object.fromEntries(
    Object.entries(registry).map(([line, lineSlots]) => [
      line,
      lineSlots.map((slot) => withKindDisplay(slot, kinds, line)),
    ])
  );
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
