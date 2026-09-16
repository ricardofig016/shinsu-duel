/**
 * Card display-text segments — the shared format for card prose.
 *
 * Authored card text (the `raw` string on DSL nodes in card YAML) may embed
 * explicit links shaped `[[type:ref]]`, optionally carrying a display alias
 * and parameters: `[[card:Kranos|Kranos' blade]]`, `[[condition:Burned]]`.
 * The build-time compiler tokenizes every `raw` into an ordered segment list
 * — a plain string, or a link segment `{ type, ref, text }` — and the
 * compiled artifact carries segments under `text`. Nothing downstream parses
 * authored text: this module is the single definition of the segment format
 * and of its plain-text projection, shared by the build scripts, the server,
 * and the client.
 *
 * The module is dependency-free so the browser can serve it directly; the
 * link-target registry (which knows the data catalogs) lives in
 * `scripts/lib/card-link-registry.js`.
 */

export const LINK_TYPES = Object.freeze([
  "card",
  "condition",
  "trait",
  "attribute",
  "position",
  "affiliation",
  "series",
  "keyword",
  "rule",
]);

const LINK_PATTERN = /\[\[([^\[\]]+)\]\]/g;

/**
 * Tokenize one authored `raw` string into display segments.
 *
 * @param {string} raw - authored display text; links are `[[type:ref]]`,
 *   optionally `[[type:ref|alias]]` with further `key=value` pipes reserved
 *   for future parameters.
 * @param {string} context - source path used in error messages.
 * @param {{ resolve: (type: string, ref: string) => { ref: string, text: string } | null } | null} registry
 *   target registry; required only when the text carries links.
 * @returns {Array<string | { type: string, ref: string, text: string }>} segments
 */
export function tokenizeSegments(raw, context, registry = null) {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error(`${context}: display text must be a non-empty string`);
  }

  const segments = [];
  let cursor = 0;
  let links = 0;
  for (const match of raw.matchAll(LINK_PATTERN)) {
    if (match.index > cursor) segments.push(raw.slice(cursor, match.index));
    segments.push(parseLink(match[1], context, registry));
    cursor = match.index + match[0].length;
    links++;
  }
  if (cursor < raw.length) segments.push(raw.slice(cursor));

  if (segments.length === 0) {
    throw new Error(`${context}: display text must be a non-empty string`);
  }
  // Every "[[" must be consumed by a link match: a marker that never closes
  // would print authoring markup to players, and one still leaks when a
  // valid link appears later in the same text.
  if ((raw.match(/\[\[/g) ?? []).length !== links) {
    throw new Error(`${context}: unclosed link marker "[[" — links must close with "]]"`);
  }
  return segments;
}

function parseLink(body, context, registry) {
  const parts = body.split("|").map((part) => part.trim());
  const [head, alias, ...paramParts] = parts;

  const shaped = /^([a-z][a-z-]*):(.*)$/.exec(head);
  if (!shaped) {
    throw new Error(`${context}: link "[[${body}]]" must be shaped [[type:ref]]`);
  }
  const [, type, authoredRef] = shaped;
  if (!LINK_TYPES.includes(type)) {
    throw new Error(`${context}: unknown link type "${type}" — expected one of: ${LINK_TYPES.join(", ")}`);
  }
  const ref = authoredRef.trim();
  if (ref === "") {
    throw new Error(`${context}: link "[[${body}]]" has an empty reference`);
  }
  if (alias !== undefined && alias === "") {
    throw new Error(`${context}: link "[[${body}]]" has an empty alias`);
  }
  if (paramParts.length > 0) {
    throw new Error(`${context}: link "[[${body}]]" declares unknown parameters — no link parameters are defined`);
  }
  if (!registry) {
    throw new Error(`${context}: link "[[${body}]]" found but no link registry is available`);
  }

  const resolved = registry.resolve(type, ref);
  if (!resolved) {
    throw new Error(`${context}: unknown ${type} link target "${ref}"`);
  }
  return { type, ref: resolved.ref, text: alias ?? resolved.text };
}

/**
 * Plain-text projection of display segments: link segments collapse to their
 * display text, so the result is exactly what a player reads.
 *
 * @param {Array<string | { text: string }> | null | undefined} segments
 * @returns {string}
 */
export function segmentsToPlainText(segments) {
  if (!Array.isArray(segments)) return "";
  return segments
    .map((segment) => (typeof segment === "string" ? segment : segment.text))
    .join("");
}
