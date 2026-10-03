/**
 * The header-icon list a card face shows for a unit's printed features and its
 * attachments.
 *
 * Both card faces state the same thing: they draw the icons in the same
 * canonical order and explain each one through the same tooltip. Only their
 * presentation differs — the vertical card lays them out on the right of its
 * title row, the horizontal card hangs them as ribbons off its top edge. This
 * module owns the list, so neither face can drift from the other, and the
 * vertical card's back face reads the same list for its sections.
 *
 * Pure: it reads a flattened view model and the glossary and builds entry
 * descriptors. Nothing here touches the DOM, and nothing authors copy — the
 * glossary holds the concept descriptions and the card view holds the card's
 * own texts (see docs/TOOLTIP_SYSTEM.md).
 *
 * One descriptor is `{ kind, iconPath, title, texts, gameTexts }`: `texts` is
 * the tooltip's list (the game text, then the flavor that explains it, which
 * the tooltip ordering rule fixes) and `gameTexts` is the card's own copy
 * alone, which is what the card back shows.
 */

import { buildCatalogEntryParts, buildProseEntry } from "./tooltip-entries.js";

/**
 * The concept clauses of the list, in the order the card-vertical header draws
 * them. Each names the glossary concept that explains it, the icon it draws,
 * and the card-view field that carries its printed text.
 */
const CLAUSES = [
  { concept: "evolve", iconPath: "/assets/icons/other/evolve.png", field: "evolveTriggers" },
  { concept: "ignition", iconPath: "/assets/icons/other/ignition.png", field: "igniteTriggers" },
  { concept: "passives", iconPath: "/assets/icons/other/passive.png", field: "passiveAbilities" },
  { concept: "requirements", iconPath: "/assets/icons/other/requirements.png", field: "requirements" },
];

/** One icon for a unit's equipment attachments, whatever they are. */
const EQUIPMENT_ICON = "/assets/icons/other/equipment.png";

const isUsablePath = (path) =>
  typeof path === "string" && path.trim() !== "" && path !== "undefined" && path !== "null";

/**
 * A clause's text from the card view, as tooltip entries. Trigger and
 * requirement fields carry one display-segment list each; passive abilities
 * carry an object with a `text` list.
 */
const textForClause = (model, field) => {
  const value = model?.[field];
  if (!Array.isArray(value) || value.length === 0) return [];
  return value.map((item) => ({ segments: field === "passiveAbilities" ? item.text : item }));
};

/** A tooltip's text list: the game-relevant entries, then the flavor entry. */
const tooltipTexts = (gameTexts, flavor) => (flavor ? [...gameTexts, flavor] : [...gameTexts]);

/** One clause of the list: the card's printed text for that concept, then the
 * glossary's italic description of it (the glossary name titles the tooltip).
 * The card's text is the game-relevant part, so it leads and the concept
 * follows it. Null when there is nothing to explain, so the caller contributes
 * no icon.
 */
const conceptClause = (concepts, { concept, iconPath }, texts) => {
  const copy = concepts?.[concept];
  if (!copy || texts.length === 0) return null;
  return {
    kind: concept,
    iconPath,
    title: copy.name,
    texts: tooltipTexts(texts, buildProseEntry(copy.description, "italic")),
    gameTexts: texts,
  };
};

/**
 * The card's printed features as one display list: a single equipment icon for
 * any number of attachments, then one icon per attribute in the canonical
 * order the card view delivers, then evolve, ignition, passive abilities, and
 * requirements. Each entry carries the tooltip that explains it; an entry
 * without an icon to draw is dropped, because a card face cannot render it.
 *
 * @param {object} model a flattened card or unit view
 * @param {object|null} glossary the `/glossary` payload, when it loaded
 */
export const buildUnitHeaderIcons = (model, glossary) => {
  const concepts = glossary?.concepts ?? null;
  const entries = [];
  const add = (entry) => {
    if (isUsablePath(entry.iconPath) && entry.title) entries.push(entry);
  };

  // The attachment names are display copy for the tooltip: the card face has
  // one icon for all of them, so the tooltip is the only place they are read.
  // Its title is the type's own name, so the copy stays glossary-owned;
  // without the glossary the icon still draws and names itself generically.
  const attachments = (model?.equipmentAttachments ?? []).filter(
    (name) => typeof name === "string" && name.trim() !== ""
  );
  if (attachments.length > 0) {
    add({
      kind: "equipment",
      iconPath: EQUIPMENT_ICON,
      title: glossary?.types?.equipment?.name ?? "Equipment",
      texts: [...attachments],
      gameTexts: [...attachments],
    });
  }

  for (const attribute of model?.attributes ?? []) {
    const { gameTexts, flavor } = buildCatalogEntryParts(attribute);
    add({
      kind: "attribute",
      iconPath: attribute.iconPath,
      title: attribute.title ?? attribute.name,
      texts: tooltipTexts(gameTexts, flavor),
      gameTexts,
    });
  }

  for (const clause of CLAUSES) {
    const texts = textForClause(model, clause.field);
    if (texts.length === 0) continue;
    const entry = conceptClause(concepts, clause, texts);
    if (entry) add(entry);
  }

  return entries;
};

/**
 * The card's header information as the sections its back face shows: one
 * section per header icon, in the same canonical order, labeled with that
 * icon's own tooltip title and carrying only the card's game-relevant text.
 * Equipment attachments describe runtime state, not the card, so they stay off
 * the back. A section whose entry states no game text has nothing to say and is
 * dropped; a card left with no sections returns [], which is how the back knows
 * the card has nothing to turn over for.
 *
 * @param {object} model a flattened card or unit view
 * @param {object|null} glossary the `/glossary` payload, when it loaded
 * @returns {Array<{ title: string, texts: object[] }>}
 */
export const buildCardBackSections = (model, glossary) =>
  buildUnitHeaderIcons(model, glossary)
    .filter((entry) => entry.kind !== "equipment")
    .map((entry) => ({ title: entry.title, texts: entry.gameTexts }))
    .filter((section) => section.texts.length > 0);
