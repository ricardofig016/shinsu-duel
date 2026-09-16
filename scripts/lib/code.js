/**
 * Display vocabulary → internal code: lowercase, spaces dashed, everything
 * outside letters/digits/dashes dropped. Mirrors the catalog keys of traits,
 * positions, attributes, affiliations, and conditions ("Team Sweet and Sour"
 * → "team-sweet-and-sour").
 *
 * @param {string} str - authored display value
 * @returns {string} code
 */
export function toCode(str) {
  return String(str).toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}
