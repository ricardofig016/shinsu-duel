import { toCode } from "./code.js";

/**
 * Position display name → internal code.
 *
 * The position codes are the keys of `server/data/positions.json`. The card
 * compiler and the shared-copy relation resolver both normalize authored
 * position vocabulary, so the map lives here rather than in either caller.
 */

export const POSITION_CODES = Object.freeze({
  "fisherman": "fisherman",
  "light bearer": "light-bearer",
  "scout": "scout",
  "spear bearer": "spear-bearer",
  "wave controller": "wave-controller",
});

/**
 * Normalize one authored position value to its catalog code.
 *
 * @param {string} value - display name or code
 * @returns {string} code
 */
export function normalizePosition(value) {
  if (value === null || value === undefined) return null;
  const str = String(value);
  return POSITION_CODES[str.toLowerCase()] || toCode(str);
}
