import { tokenizeSegments } from "../../public/utils/card-text.js";

/**
 * Shared catalog copy compilation.
 *
 * The five shared catalogs (`server/data/attributes.json`, `traits.json`,
 * `positions.json`, `conditions.json`, `glossary.json`) are the authoring
 * source for copy that card prose and tooltips display. Their prose fields
 * take the same inline links as card prose (`[[type:ref]]`), so the build
 * tokenizes them with the same pool link registry card prose uses and the
 * compiled artifacts carry display segments under the field the authoring
 * file names (`description`, `effect`, `verboseDescription`, ...). The `text`
 * projection clients read is `segmentsToPlainText(entry[field].segments)`.
 *
 * Only the prose fields listed here compile; every other field (names, codes,
 * colors, mechanics) stays with the authoring catalog, which the engine keeps
 * reading. `affiliations.json` is out of scope: its copy is plain text and
 * produces no relations.
 */

const PROSE_FIELDS = Object.freeze(["description", "verboseDescription"]);

const GLOSSARY_PROSE_SECTIONS = Object.freeze([
  "types",
  "kinds",
  "concepts",
  "terms",
  "triggers",
  "keywords",
]);

/**
 * Compile one prose field into `{ segments }`, or null when the authoring
 * value is absent or not a string.
 */
function compileProse(value, context, registry) {
  if (typeof value !== "string" || value.trim() === "") return null;
  return { segments: tokenizeSegments(value, context, registry) };
}

function compileProseFields(entry, context, registry, { fields = PROSE_FIELDS, arrays = [] } = {}) {
  const compiled = {};
  for (const field of fields) {
    const prose = compileProse(entry?.[field], `${context}.${field}`, registry);
    if (prose) compiled[field] = prose;
  }
  for (const field of arrays) {
    const values = entry?.[field];
    if (!Array.isArray(values)) continue;
    // Each line compiles to `{ segments }`, the same shape as a lone prose
    // field, so a consumer reads one representation per line everywhere.
    const lines = values.map((value, index) =>
      compileProse(value, `${context}.${field}[${index}]`, registry)
    ).filter(Boolean);
    if (lines.length > 0) compiled[field] = lines;
  }
  return compiled;
}

function compileGlossarySection(section, sectionName, registry) {
  if (!section || typeof section !== "object") return {};
  const compiled = {};
  for (const [code, entry] of Object.entries(section)) {
    const fields = compileProseFields(entry, `glossary.${sectionName}.${code}`, registry);
    if (Object.keys(fields).length > 0) compiled[code] = fields;
  }
  return compiled;
}

/**
 * Compile the prose copy of every in-scope catalog.
 *
 * @param {{ attributes: object, traits: object, positions: object,
 *   conditions: object, glossary: object }} catalogs authoring catalogs
 * @param {{ resolve: (type: string, ref: string) => object | null }} registry
 *   pool link registry (card links resolve against the pool being compiled)
 * @returns {object} compiled catalog copy artifact
 */
export function compileCatalogCopy(catalogs, registry) {
  const compiled = {
    attributes: {},
    traits: {},
    positions: {},
    conditions: {},
    glossary: {
      ranks: {},
      hud: {},
    },
  };

  for (const [name, catalog] of [
    ["attributes", catalogs.attributes],
    ["traits", catalogs.traits],
    ["positions", catalogs.positions],
    ["conditions", catalogs.conditions],
  ]) {
    for (const [code, entry] of Object.entries(catalog ?? {})) {
      const fields = compileProseFields(entry, `${name}.${code}`, registry, {
        arrays: name === "attributes" ? ["effect"] : [],
      });
      if (Object.keys(fields).length > 0) compiled[name][code] = fields;
    }
  }

  const glossary = catalogs.glossary ?? {};

  // `rules.title` holds "Rank" and `rules.concept` the rank concept line.
  if (typeof glossary.ranks?.title === "string") {
    compiled.glossary.ranks.title = {
      segments: tokenizeSegments(glossary.ranks.title, "glossary.ranks.title", registry),
    };
  }
  if (typeof glossary.ranks?.concept === "string") {
    compiled.glossary.ranks.concept = {
      segments: tokenizeSegments(glossary.ranks.concept, "glossary.ranks.concept", registry),
    };
  }
  for (const [code, entry] of Object.entries(glossary.ranks ?? {})) {
    if (code === "title" || code === "concept") continue;
    const fields = compileProseFields(entry, `glossary.ranks.${code}`, registry);
    if (Object.keys(fields).length > 0) compiled.glossary.ranks[code] = fields;
  }

  for (const sectionName of GLOSSARY_PROSE_SECTIONS) {
    const section = compileGlossarySection(glossary[sectionName], sectionName, registry);
    if (Object.keys(section).length > 0) compiled.glossary[sectionName] = section;
  }

  for (const [code, entry] of Object.entries(glossary.hud ?? {})) {
    const fields = compileProseFields(entry, `glossary.hud.${code}`, registry, { fields: [], arrays: ["texts"] });
    if (Object.keys(fields).length > 0) compiled.glossary.hud[code] = fields;
  }

  return compiled;
}

/**
 * Serialize a compiled artifact. Every artifact is written through this
 * helper so the on-disk bytes are identical across runs: keys keep their
 * insertion order (the catalogs are code-ordered, not hash-ordered) and the
 * trailing newline matches the other build artifacts.
 *
 * @param {object} value compiled artifact
 * @returns {string}
 */
export function serializeArtifact(value) {
  return JSON.stringify(value, null, 2) + "\n";
}
