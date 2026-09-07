/**
 * Tooltip entry building for the shared tooltip component.
 *
 * All tooltip copy is server-owned: it arrives through the card views (Card.
 * toSanitizedObject) or the /glossary route. These helpers only arrange
 * server-provided fields into the entry contract the tooltip renders: an
 * entry is a plain string, or { text, style } with one of the styles below.
 * Nothing here authors copy; when the glossary is unavailable the entries
 * degrade to the data the card views still carry.
 */

export const TOOLTIP_ENTRY_STYLES = Object.freeze(["italic", "strong", "label"]);

const KNOWN_STYLES = new Set(TOOLTIP_ENTRY_STYLES);

/**
 * Normalize a tooltip text payload into [{ text, style }] entries: strings
 * become unstyled entries, objects keep their known style, and empty or
 * invalid entries are dropped.
 */
export const normalizeTooltipEntries = (textList) => {
  const raw = typeof textList === "string" ? [textList] : textList ?? [];
  const entries = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      if (entry.trim() !== "") entries.push({ text: entry, style: null });
      continue;
    }
    if (entry && typeof entry === "object" && typeof entry.text === "string" && entry.text.trim() !== "") {
      entries.push({ text: entry.text, style: KNOWN_STYLES.has(entry.style) ? entry.style : null });
    }
  }
  return entries;
};

/**
 * Position tooltip entries: the battlefield line as a label, then the short
 * description, then the verbose description in italic. `chosen` appends the
 * server-owned chosen suffix to the description entry.
 */
export const buildPositionTooltipEntries = (position, glossary, { chosen = false } = {}) => {
  if (!position) return [];
  const entries = [];
  const label = glossary?.lines?.[position.line]?.label;
  if (label) entries.push({ text: label, style: "label" });
  if (position.description) {
    const suffix = chosen ? ` ${glossary?.hud?.chosenSuffix ?? "(chosen)"}` : "";
    entries.push({ text: `${position.description}${suffix}` });
  }
  if (position.verboseDescription) entries.push({ text: position.verboseDescription, style: "italic" });
  return entries;
};

/**
 * Attribute tooltip entries: the attribute's prose description in italic,
 * then its effect lines (the core mechanic) as plain entries.
 */
export const buildAttributeTooltipEntries = (attribute) => {
  if (!attribute) return [];
  const entries = [];
  if (attribute.description) entries.push({ text: attribute.description, style: "italic" });
  for (const line of attribute.effect ?? []) entries.push({ text: line });
  return entries;
};

/**
 * Rank tooltip: the title plus the italic concept line, then one entry per
 * rank with its cost range and description; the card's own rank is strong.
 * Returns null when the glossary carries no ranks.
 */
export const buildRankTooltip = (rankCode, ranks) => {
  if (!ranks?.title || !Array.isArray(ranks.list) || ranks.list.length === 0) return null;
  const texts = [];
  if (ranks.concept) texts.push({ text: ranks.concept, style: "italic" });
  for (const rank of ranks.list) {
    const text = `${rank.name} (cost ${rank.minCost}-${rank.maxCost}): ${rank.description}`;
    texts.push(rank.code === rankCode ? { text, style: "strong" } : { text });
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
  if (model.type === "unit") {
    const kind = glossary.kinds?.[model.kind ?? "standard"];
    return kind ? { title: kind.name, texts: [kind.description] } : null;
  }
  const type = glossary.types?.[model.type];
  return type ? { title: type.name, texts: [type.description] } : null;
};

/**
 * Deck tooltip text: the server-owned template with the live count filled in.
 */
export const buildDeckTooltipText = (count, deckEntry) => {
  if (!deckEntry?.textTemplate) return null;
  return deckEntry.textTemplate.replace("{count}", String(count));
};
