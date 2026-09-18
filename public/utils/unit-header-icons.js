/**
 * The header-icon list a card face shows for a unit's printed features and its
 * attachments.
 *
 * Both card faces state the same thing: they draw the icons in the same
 * canonical order and explain each one through the same tooltip. Only their
 * presentation differs — the vertical card lays them out on the right of its
 * title row, the horizontal card hangs them as ribbons off its top edge. This
 * module owns the list, so neither face can drift from the other.
 *
 * Pure: it reads a flattened view model and the glossary and builds entry
 * descriptors. Nothing here touches the DOM, and nothing authors copy — the
 * glossary holds the concept descriptions and the card view holds the card's
 * own texts (see docs/TOOLTIP_SYSTEM.md).
 */

import { buildAttributeTooltipEntries, proseEntries } from "./tooltip-entries.js";

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

/** One clause of the list: the glossary's own name and italic description, then
 * the card's printed text for that concept. Null when there is nothing to
 * explain, so the caller contributes no icon.
 */
const conceptClause = (concepts, { concept, iconPath }, texts) => {
  const copy = concepts?.[concept];
  if (!copy || texts.length === 0) return null;
  return {
    iconPath,
    title: copy.name,
    texts: [...proseEntries(copy.description, null, "italic"), ...texts],
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
  const add = (iconPath, title, texts) => {
    if (isUsablePath(iconPath) && title) entries.push({ iconPath, title, texts });
  };

  // The attachment names are display copy for the tooltip: the card face has
  // one icon for all of them, so the tooltip is the only place they are read.
  // Its title is the type's own name, so the copy stays glossary-owned;
  // without the glossary the icon still draws and names itself generically.
  const attachments = (model?.equipmentAttachments ?? []).filter(
    (name) => typeof name === "string" && name.trim() !== ""
  );
  if (attachments.length > 0) {
    add(EQUIPMENT_ICON, glossary?.types?.equipment?.name ?? "Equipment", attachments);
  }

  for (const attribute of model?.attributes ?? []) {
    add(attribute.iconPath, attribute.title ?? attribute.name, buildAttributeTooltipEntries(attribute));
  }

  for (const clause of CLAUSES) {
    const texts = textForClause(model, clause.field);
    if (texts.length === 0) continue;
    const entry = conceptClause(concepts, clause, texts);
    if (entry) add(entry.iconPath, entry.title, entry.texts);
  }

  return entries;
};
