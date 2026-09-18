import { toCode } from "./code.js";

/**
 * Attribute display name → internal code.
 *
 * The attribute codes are the keys of `server/data/attributes.json`. The card
 * compiler and the shared-copy relation resolver both normalize authored
 * attribute vocabulary against the same map.
 */

export const ATTRIBUTE_CODES = Object.freeze({
  "anima": "anima",
  "silver dwarf": "silver-dwarf",
  "red witch": "red-witch",
  "hwayeomsa": "hwayeomsa",
  "jeonsulsa": "jeonsulsa",
  "irregular": "irregular",
  "living ignition weapon": "living-ignition-weapon",
});

/**
 * Normalize one authored attribute value to its catalog code.
 *
 * @param {string} value - display name or code
 * @returns {string} code
 */
export function normalizeAttribute(value) {
  const str = String(value);
  return ATTRIBUTE_CODES[str.toLowerCase()] || toCode(str);
}
