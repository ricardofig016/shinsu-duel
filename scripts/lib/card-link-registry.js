import { normalizeName } from "./normalize-name.js";
import conditions from "../../server/data/conditions.json" with { type: "json" };
import traits from "../../server/data/traits.json" with { type: "json" };
import attributes from "../../server/data/attributes.json" with { type: "json" };
import positions from "../../server/data/positions.json" with { type: "json" };
import affiliations from "../../server/data/affiliations.json" with { type: "json" };
import glossary from "../../server/data/glossary.json" with { type: "json" };

/**
 * Link-target registry for card text links (`[[type:ref]]`, see
 * `public/utils/card-text.js`).
 *
 * One resolution surface mapping every link type onto the catalog that owns
 * its vocabulary:
 *
 * - `card` → the card pool being compiled/validated, by exact name
 *   (case-insensitive), stamped as the card's persistent slug.
 * - `condition`, `trait`, `attribute`, `position`, `affiliation` → their
 *   data catalogs in `server/data/`, by code or display name, stamped as the
 *   catalog key.
 * - `series` → the series codes declared by the pool's cards, stamped as the
 *   series code.
 * - `keyword`, `trigger`, `rule` → the glossary sections (`keywords`,
 *   `triggers`, `terms`) that hold hover copy for shared game vocabulary, by
 *   key or display name.
 * - `rank` → the glossary's rank entries, by code or display name.
 *
 * A reference the registry cannot resolve is a build error, so a card text
 * can never ship pointing at vocabulary that does not exist. Resolution
 * never guesses: a `ref` that matches neither a code nor a display name of
 * its own type fails.
 */

function toCode(str) {
  return String(str).toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

const CATALOGS = {
  condition: conditions,
  trait: traits,
  attribute: attributes,
  position: positions,
  affiliation: affiliations,
};

/**
 * Resolve a reference against one code-keyed catalog holding `{ name, ... }`
 * entries: accept the code directly, else match an entry's display name
 * case-insensitively.
 */
function resolveCatalogEntry(catalog, ref) {
  const code = toCode(ref);
  if (Object.hasOwn(catalog, code)) {
    return { ref: code, text: catalog[code].name ?? code };
  }
  const wanted = ref.trim().toLowerCase();
  const entry = Object.entries(catalog).find(([, value]) => (value?.name ?? "").toLowerCase() === wanted);
  if (!entry) return null;
  return { ref: entry[0], text: entry[1].name ?? entry[0] };
}

/**
 * Build the link-target registry for one compilation pool.
 *
 * @param {object} pool
 * @param {string[]} pool.names - card display names of the pool.
 * @param {string[]} [pool.series] - authored series values of the pool.
 * @returns {{ resolve: (type: string, ref: string) => { ref: string, text: string } | null }}
 */
export function createLinkRegistry({ names = [], series = [] } = {}) {
  const cardsBySlug = new Map(names.map((name) => [normalizeName(name), name]));
  const seriesCodes = new Set(series.map(toCode));

  function resolve(type, ref) {
    if (type === "card") {
      const slug = normalizeName(ref);
      const name = cardsBySlug.get(slug);
      if (name === undefined) return null;
      return { ref: slug, text: name };
    }
    if (type === "series") {
      const code = toCode(ref);
      if (!seriesCodes.has(code)) return null;
      return { ref: code, text: ref.trim() };
    }
    if (type === "keyword" || type === "trigger" || type === "rule" || type === "rank") {
      const section =
        type === "keyword"
          ? glossary.keywords
          : type === "trigger"
            ? glossary.triggers
            : type === "rule"
              ? glossary.terms
              : Object.fromEntries(
                  Object.entries(glossary.ranks ?? {}).filter(
                    ([code]) => code !== "title" && code !== "concept"
                  )
                );
      return resolveCatalogEntry(section ?? {}, ref);
    }
    return resolveCatalogEntry(CATALOGS[type], ref);
  }

  return { resolve };
}

/**
 * Registry for a pool of cards (authored or compiled): every card name and
 * series value in the pool becomes resolvable.
 *
 * @param {Array<{ name?: string, series?: string | null }>} cards
 * @returns {{ resolve: (type: string, ref: string) => { ref: string, text: string } | null }}
 */
export function createPoolLinkRegistry(cards) {
  return createLinkRegistry({
    names: cards.map((card) => card.name).filter(Boolean),
    series: cards.map((card) => card.series).filter(Boolean),
  });
}
