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
 * - `{ node }` — a pre-built DOM element (e.g. a card preview), appended as
 *   is; callers build elements, never markup strings.
 *
 * Nothing here authors copy; when the glossary is unavailable the entries
 * degrade to the data the card views still carry.
 */

import { segmentsToPlainText } from "./card-text.js";

export const TOOLTIP_ENTRY_STYLES = Object.freeze(["italic", "strong", "label"]);

const KNOWN_STYLES = new Set(TOOLTIP_ENTRY_STYLES);

/**
 * One catalog prose field as a tooltip entry. Shared catalog copy arrives as
 * compiled display segments (`{ segments }`, see
 * `docs/COMPILED_CARD_DSL.md`) so its inline links render; copy that is still
 * a plain string (synthetic card views, synthetic tooltip payloads) renders
 * as text. Anything else is dropped, and a null style adds no field.
 */
export const buildProseEntry = (value, style = null) => {
  const segments = Array.isArray(value) ? value : value?.segments;
  if (Array.isArray(segments)) {
    return segments.length > 0 ? (style ? { segments, style } : { segments }) : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    return style ? { text: value, style } : { text: value };
  }
  return null;
};

/**
 * Normalize a tooltip text payload into renderable entries: strings become
 * unstyled entries, `{ text }` keeps its known style, `{ segments }` and
 * `{ node }` pass through, and empty or invalid entries are dropped. A null
 * style is dropped rather than carried, matching the entry shape callers
 * compare against.
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
      entries.push(style ? { segments: entry.segments, style } : { segments: entry.segments });
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
 * Attribute tooltip entries: the attribute's prose description in italic,
 * then its effect lines (the core mechanic) as plain entries.
 */
export const buildAttributeTooltipEntries = (attribute) => {
  if (!attribute) return [];
  const entries = [];
  const description = buildProseEntry(attribute.description, "italic");
  if (description) entries.push(description);
  for (const line of attribute.effect ?? []) {
    const entry = buildProseEntry(line);
    if (entry) entries.push(entry);
  }
  return entries;
};

/**
 * A code-keyed catalog entry's tooltip entries: its prose description in
 * italic, then its effect lines. Conditions, traits, and positions all
 * display this way; positions additionally use the position builder above.
 */
export const buildCatalogTooltipEntries = (entry) => {
  if (!entry) return [];
  const entries = [];
  const description = buildProseEntry(entry.description, "italic");
  if (description) entries.push(description);
  for (const line of entry.effect ?? []) {
    const item = buildProseEntry(line);
    if (item) entries.push(item);
  }
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
 * Rank tooltip: the italic concept line, then one entry per rank with its
 * cost range and description; the card's own rank is strong. Returns null
 * when the glossary carries no ranks.
 */
export const buildRankTooltip = (rankCode, ranks) => {
  if (!ranks?.title || !Array.isArray(ranks.list) || ranks.list.length === 0) return null;
  const texts = [];
  const concept = buildProseEntry(ranks.concept, "italic");
  if (concept) texts.push(concept);
  for (const rank of ranks.list) {
    const style = rank.code === rankCode ? "strong" : null;
    const label = `${rank.name} (cost ${rank.minCost}-${rank.maxCost}): `;
    if (Array.isArray(rank.description)) {
      const segments = [{ text: label }, ...rank.description];
      texts.push(style ? { segments, style } : { segments });
    } else {
      const text = `${label}${rank.description}`;
      texts.push(style ? { text, style } : { text });
    }
  }
  return { title: ranks.title, texts };
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
 * Deck tooltip text: the server-owned template with the live count filled in.
 */
export const buildDeckTooltipText = (count, deckEntry) => {
  if (!deckEntry?.textTemplate) return null;
  return deckEntry.textTemplate.replace("{count}", String(count));
};
