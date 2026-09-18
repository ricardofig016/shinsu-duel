/**
 * The runtime state strip a deployed unit's card face shows: the traits the
 * unit actually has, then the conditions on it, in that order.
 *
 * Both card faces state the same state from the same view model: the vertical
 * card packs the entries into two framed strips with a paged overflow tooltip,
 * the horizontal card lays them along one bare row. This module owns the entry
 * list and each entry's tooltip, so the two faces never disagree about what is
 * on the unit or how a number reads.
 *
 * Pure: it reads a flattened unit view and builds entry descriptors. Nothing
 * here touches the DOM, and nothing authors copy (see docs/TOOLTIP_SYSTEM.md).
 */

import { buildEntryTitle, proseEntries } from "./tooltip-entries.js";

const DEFAULT_TRAIT_ICON = "/assets/icons/traits/placeholder.png";
const DEFAULT_CONDITION_ICON = "/assets/icons/conditions/placeholder.png";

const safePath = (path, fallback) =>
  typeof path === "string" && path.trim() !== "" && path !== "undefined" && path !== "null" ? path : fallback;

/**
 * The number an entry states, or null when it states none. The catalog's
 * numeric flag is the gate: a condition's magnitude exists for every condition
 * (none is suppressed without one), so without the flag a non-numeric
 * condition would claim a number it does not have.
 */
const readValue = (entry, value) => (entry.numeric === true ? value ?? null : null);

const stripEntry = (entry, { key, name, description, iconPath, value, slot, fallbackIcon }) => ({
  code: key,
  iconPath: safePath(iconPath, fallbackIcon),
  value,
  title: buildEntryTitle({ name: name ?? key, numeric: entry.numeric === true }, value),
  texts: proseEntries(description, value === null ? null : { [slot]: value }),
});

/**
 * A unit's traits and conditions as one display list: every trait first, in the
 * order the unit's runtime state delivers them, then every condition in the
 * same order. Traits carry their effective value as `value`; conditions carry
 * their magnitude. Only an entry the catalog marks numeric states a number.
 *
 * @param {object} unit a flattened unit view
 */
export const buildTraitStripEntries = (unit) => {
  const traits = (unit?.runtimeTraits ?? []).map((trait) =>
    stripEntry(trait, {
      key: trait.code,
      name: trait.name,
      description: trait.description,
      iconPath: trait.iconPath,
      value: readValue(trait, trait.value),
      slot: "trait",
      fallbackIcon: DEFAULT_TRAIT_ICON,
    })
  );
  const conditions = (unit?.conditions ?? []).map((condition) =>
    stripEntry(condition, {
      key: condition.key,
      name: condition.name,
      description: condition.description,
      iconPath: condition.iconPath,
      value: readValue(condition, condition.magnitude),
      slot: "condition",
      fallbackIcon: DEFAULT_CONDITION_ICON,
    })
  );
  return [...traits, ...conditions];
};
