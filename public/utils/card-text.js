/**
 * Card display-text segments — the shared format for card prose.
 *
 * Authored card text (the `raw` string on DSL nodes in card YAML and every
 * prose field of the shared catalogs) may embed explicit links shaped
 * `[[type:ref]]`, optionally carrying a display alias: `[[card:Kranos|Kranos'
 * blade]]`, `[[condition:Burned]]`. The build-time compiler tokenizes every
 * authored field into an ordered segment list — a plain string, or a link
 * segment `{ type, ref, text }` — and the compiled artifact carries segments
 * under `text`. Nothing downstream parses authored text: this module is the
 * single definition of the segment format and of its plain-text projection,
 * shared by the build scripts, the server, and the client.
 *
 * A `value` link names a runtime value slot instead of a catalog entry, which
 * is how numeric trait and condition copy states its number: `[[value:trait]]`
 * in a trait description, `[[value:condition]]` in a condition description,
 * `[[value:count]]` in the deck HUD copy. No registry resolves it, because the
 * number exists per instance rather than at build time; the renderer fills it
 * from the values the entry carries, and every context without an instance
 * (plain-text projections, a static `[[trait:Resilient]]` hover) shows the
 * slot's `text`, the authored alias or the default placeholder `x`.
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
  "trigger",
  "rank",
  "value",
]);

/**
 * The value slots a `value` link may name. Each one is a number a caller
 * supplies when it renders the prose: a trait's value, a condition's
 * magnitude, and the deck's remaining count.
 */
export const VALUE_SLOTS = Object.freeze(["trait", "condition", "count"]);

/** What a value slot shows where no instance value exists. */
export const VALUE_FALLBACK = "x";

/**
 * The same placeholder in a tooltip title. A title has no sentence around it,
 * so it states the slot's absence with the capital its position in the title
 * calls for.
 */
export const TITLE_VALUE_FALLBACK = "X";

const LINK_PATTERN = /\[\[([^\[\]]+)\]\]/g;

/**
 * Tokenize one authored `raw` string into display segments.
 *
 * @param {string} raw - authored display text; links are `[[type:ref]]`,
 *   optionally `[[type:ref|alias]]`. A `value` link names one of
 *   `VALUE_SLOTS` and takes no registry target.
 * @param {string} context - source path used in error messages.
 * @param {{ resolve: (type: string, ref: string) => { ref: string, text: string } | null } | null} registry
 *   target registry; required only when the text carries a catalog link.
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

  // A value slot carries no build-time target: its number belongs to the
  // instance the prose is rendered for, so the segment keeps the slot name and
  // the text to fall back on.
  if (type === "value") {
    if (!VALUE_SLOTS.includes(ref)) {
      throw new Error(`${context}: link "[[${body}]]" names unknown value slot "${ref}" — expected one of: ${VALUE_SLOTS.join(", ")}`);
    }
    return { type, ref, text: alias ?? VALUE_FALLBACK };
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
 * Plain-text projection of display text: link segments collapse to their
 * display text, so the result is exactly what a player reads. A value slot
 * projects to its fallback, because plain text has no instance to read a
 * number from. Accepted forms are segments themselves, a compiled prose field
 * (`{ segments }`), or plain text, so a caller can project any of them.
 *
 * @param {string | Array<string | { text: string }> | { segments: Array } | null | undefined} value
 * @returns {string}
 */
export function segmentsToPlainText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((segment) => (typeof segment === "string" ? segment : segment.text))
      .join("");
  }
  if (value && Array.isArray(value.segments)) return segmentsToPlainText(value.segments);
  return "";
}
