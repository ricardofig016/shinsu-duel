/**
 * Tooltip entry building for the shared tooltip component.
 *
 * All tooltip copy is server-owned: it arrives through the card views (Card.
 * toSanitizedObject) or the /glossary route. These helpers only arrange
 * server-provided fields into the entry contract the tooltip renders. An
 * entry is one of:
 *
 * - a plain string, or `{ text, style }` with one of the styles below,
 * - `{ segments }` — compiled display segments rendered by the linked-text
 *   renderer (ability/requirement/trigger prose keeps its inline links),
 *   optionally with `values`, the numbers its value slots fill from,
 * - `{ node }` — a pre-built DOM element (e.g. a card preview), appended as
 *   is; callers build elements, never markup strings.
 *
 * Entries are built in the order the tooltip renders them: what the entry does
 * in the game first, the flavor that explains it (the italic descriptions and
 * concept lines) after. Nothing here authors copy; when the glossary is
 * unavailable the entries degrade to the data the card views still carry.
 */

import { segmentsToPlainText, TITLE_VALUE_FALLBACK } from "./card-text.js";

export const TOOLTIP_ENTRY_STYLES = Object.freeze(["italic", "strong", "label"]);

const KNOWN_STYLES = new Set(TOOLTIP_ENTRY_STYLES);

/**
 * The tooltip title for a catalog entry. A numeric entry states its number, so
 * a trait or condition tooltip reads "Resilient 3" where the value is known and
 * "Resilient X" where it is not — a static `[[trait:Resilient]]` hover has no
 * instance to read one from. A non-numeric entry keeps its plain name.
 *
 * @param {{ name?: string, numeric?: boolean }|null} entry catalog entry
 * @param {number|string|null} [value] the entry's value, when the caller knows it
 */
export const buildEntryTitle = (entry, value = null) => {
  const name = entry?.name ?? "";
  if (entry?.numeric !== true) return name;
  return `${name} ${value ?? TITLE_VALUE_FALLBACK}`;
};

/**
 * One catalog prose field as a tooltip entry. Shared catalog copy arrives as
 * compiled display segments (`{ segments }`, see
 * `docs/COMPILED_CARD_DSL.md`) so its inline links render; copy that is still
 * a plain string (synthetic card views, synthetic tooltip payloads) renders
 * as text. Anything else is dropped, and a null style adds no field.
 *
 * `values` fills the field's value slots when the caller knows them (a trait's
 * value, a condition's magnitude, the deck's count); without it a slot shows
 * its own fallback.
 *
 * @param {object|string|Array} value compiled prose: `{ segments }`, segments,
 *   or plain text
 * @param {string|null} [style] one of `TOOLTIP_ENTRY_STYLES`
 * @param {Record<string, number|string>|null} [values] value slots for the entry
 */
export const buildProseEntry = (value, style = null, values = null) => {
  const segments = Array.isArray(value) ? value : value?.segments;
  if (Array.isArray(segments)) {
    if (segments.length === 0) return null;
    return { segments, ...(style ? { style } : {}), ...(values ? { values } : {}) };
  }
  if (typeof value === "string" && value.trim() !== "") {
    return style ? { text: value, style } : { text: value };
  }
  return null;
};

/**
 * One catalog prose field as the entry list a tooltip renders: the single
 * entry `buildProseEntry` produces, or nothing when the field is empty. The
 * uniform shape lets a caller spread several prose fields into one tooltip
 * without testing each one first.
 *
 * @param {object|string|Array} value compiled prose: `{ segments }`, segments,
 *   or plain text
 * @param {Record<string, number|string>|null} [values] value slots for the entry
 * @param {string|null} [style] one of `TOOLTIP_ENTRY_STYLES`
 */
export const proseEntries = (value, values = null, style = null) => {
  const entry = buildProseEntry(value, style, values);
  return entry ? [entry] : [];
};

/**
 * Normalize a tooltip text payload into renderable entries: strings become
 * unstyled entries, `{ text }` keeps its known style, `{ segments }` and
 * `{ node }` pass through, and empty or invalid entries are dropped. A null
 * style is dropped rather than carried, matching the entry shape callers
 * compare against; an entry's `values` survive so its value slots can fill.
 */
export const normalizeTooltipEntries = (textList) => {
  // A payload is normally a list, but copy fields are objects now that catalog
  // prose compiles to segments, so a caller can hand one over by mistake. Take
  // it as a single entry rather than iterating something that has no iterator:
  // a tooltip must never be able to take a whole page's setup down with it.
  const raw = textList == null ? [] : Array.isArray(textList) ? textList : [textList];
  const entries = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      if (entry.trim() !== "") entries.push({ text: entry });
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const style = KNOWN_STYLES.has(entry.style) ? entry.style : null;
    if (Array.isArray(entry.segments) && entry.segments.length > 0) {
      const values = entry.values && typeof entry.values === "object" ? entry.values : null;
      entries.push({
        segments: entry.segments,
        ...(style ? { style } : {}),
        ...(values ? { values } : {}),
      });
      continue;
    }
    if (entry.node) {
      entries.push({ node: entry.node });
      continue;
    }
    if (typeof entry.text === "string" && entry.text.trim() !== "") {
      entries.push(style ? { text: entry.text, style } : { text: entry.text });
    }
  }
  return entries;
};

/**
 * Position tooltip entries: the battlefield line as a label, then the short
 * description, then the verbose description in italic. `chosen` appends the
 * server-owned chosen suffix to the description entry, projecting the
 * description to plain text for the composition.
 */
export const buildPositionTooltipEntries = (position, glossary, { chosen = false } = {}) => {
  if (!position) return [];
  const entries = [];
  const label = glossary?.lines?.[position.line]?.label;
  if (label) entries.push({ text: label, style: "label" });
  const suffix = chosen ? ` ${glossary?.hud?.chosenSuffix ?? "(chosen)"}` : "";
  if (suffix === "") {
    const description = buildProseEntry(position.description);
    if (description) entries.push(description);
  } else {
    const text = `${segmentsToPlainText(position.description)}${suffix}`;
    if (text.trim() !== "") entries.push({ text });
  }
  const verbose = buildProseEntry(position.verboseDescription, "italic");
  if (verbose) entries.push(verbose);
  return entries;
};

/**
 * A catalog entry's tooltip entries: its effect lines first, then its own prose
 * in italic. That prose is the entry's flavor — an attribute's lore — or the
 * concept line that explains the entry, and flavor never leads the tooltip:
 * someone hovering wants what the entry does to the game before what it is. An
 * entry carrying only prose (a condition, trait, position, keyword, or rank)
 * reads as that one italic entry.
 *
 * Serves both the attribute icon on a card face and every catalog link hover
 * (`public/utils/card-text-dom.js`), which must read identically.
 */
export const buildCatalogTooltipEntries = (entry) => {
  if (!entry) return [];
  const entries = [];
  for (const line of entry.effect ?? []) {
    const item = buildProseEntry(line);
    if (item) entries.push(item);
  }
  const description = buildProseEntry(entry.description, "italic");
  if (description) entries.push(description);
  return entries;
};

/**
 * Deployed-unit ability tooltip entries: the unit's own abilities as plain
 * entries, then the abilities granted by equipment in italic — display text
 * carries the compiled display segments, keeping their inline links.
 */
export const buildUnitAbilityTooltipEntries = (unit) => {
  const entries = [];
  for (const ability of unit?.abilities ?? []) {
    if (Array.isArray(ability?.text) && ability.text.length > 0) entries.push({ segments: ability.text });
  }
  for (const granted of unit?.grantedAbilities ?? []) {
    if (Array.isArray(granted?.text) && granted.text.length > 0) {
      entries.push({ segments: granted.text, style: "italic" });
    }
  }
  return entries;
};

/**
 * A prose field as a flat segment list, whatever shape it arrived in: compiled
 * segments pass through, a plain string becomes one text segment, and an
 * absent field contributes nothing. Composing a label ahead of a description
 * has to keep the description's own links, so the line is never projected to a
 * string first.
 */
const proseSegments = (value) => {
  const entry = buildProseEntry(value);
  if (!entry) return [];
  return entry.segments ?? [entry.text];
};

/**
 * Rank tooltip: one entry per rank with its cost range and description, the
 * card's own rank strong, then the italic concept line. The ranks and their
 * ranges are the game-relevant part, so they open the tooltip and the concept
 * follows them. Returns null when the glossary carries no ranks.
 *
 * The rank title is compiled prose like the rest of the glossary copy, but a
 * tooltip title is a plain string field, so it is projected here; handing the
 * `{ segments }` object to the component printed "[object Object]".
 */
export const buildRankTooltip = (rankCode, ranks) => {
  if (!ranks?.title || !Array.isArray(ranks.list) || ranks.list.length === 0) return null;
  const texts = [];
  for (const rank of ranks.list) {
    const style = rank.code === rankCode ? "strong" : null;
    // The label is prose, not a reference: as a string segment it renders as
    // text, where a link segment would highlight it and hunt for a tooltip.
    const label = `${rank.name} (cost ${rank.minCost}-${rank.maxCost}): `;
    const segments = [label, ...proseSegments(rank.description)];
    texts.push(style ? { segments, style } : { segments });
  }
  const concept = buildProseEntry(ranks.concept, "italic");
  if (concept) texts.push(concept);
  return { title: segmentsToPlainText(ranks.title), texts };
};

/**
 * Type letter tooltip: for units the kind carries the tooltip (a standard
 * unit shows as "Unit", any other kind as the kind name); other types use
 * the type entry itself. Returns null when there is no entry to show.
 */
export const buildTypeLetterTooltip = (model, glossary) => {
  if (!glossary) return null;
  const entry =
    model.type === "unit"
      ? glossary.kinds?.[model.kind ?? "standard"]
      : glossary.types?.[model.type];
  if (!entry) return null;
  const texts = [];
  const description = buildProseEntry(entry.description);
  if (description) texts.push(description);
  return { title: entry.name, texts };
};

/**
 * Deck tooltip entries: the server-owned HUD copy with the live count filled
 * into its value slot. The count belongs to the viewer's board state, so it is
 * a render value like any other: the copy is compiled, the number is not.
 */
export const buildDeckTooltipEntries = (count, deckEntry) =>
  (deckEntry?.texts ?? [])
    .map((line) => buildProseEntry(line, null, { count }))
    .filter(Boolean);
