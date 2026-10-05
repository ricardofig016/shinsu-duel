/**
 * Client-side access to the positions payload (`GET /positions/`).
 *
 * The payload is the combat-position catalog keyed by position code, plus, under
 * its reserved `placement` key, the placement registry: one entry per field
 * line, each holding that line's placeable slots. The board builds its drop
 * targets from the registry and answers it whole, so nothing may swallow the
 * key; `getPositions` is the page's single fetch of it, shared with the card
 * faces exactly as `getGlossary` and `getCardCatalog` share theirs.
 *
 * A slot is `{ code, kind, lines, name, iconPath }`, plus the `description` a
 * kind slot carries: the kind's glossary copy as compiled display segments,
 * which a position slot does not, because a position's copy comes from the
 * position entry. Its `kind` is `standard` for a position slot and the kind's
 * own code otherwise, and its `lines` is the one line that slot instance sits
 * on. The position a special-kind card face shows is one of these slots — never
 * a path derived from the kind and the line, because a kind paints per line
 * only where the icon folder carries that line's icon
 * (`frontline-shinheuh.png`, `backline-shinheuh.png`, `landmark.png`).
 */

/**
 * Fetch the positions payload. One request per call — callers that want the
 * page's single shared fetch use `getPositions`, whose page-level cache holds
 * the promise.
 *
 * @returns {Promise<object>} the payload whole: the position catalog keyed by
 *   position code, plus `placement` (`{ <line>: slot[] }`)
 */
export async function fetchPositions() {
  const response = await fetch("/positions/");
  if (!response.ok) throw new Error(`GET /positions/ failed: ${response.status}`);
  return response.json();
}

let positionsPromise = null;

/**
 * The page-level positions cache: the first caller fetches, every later one
 * shares the same promise (a failure is cached too, so callers see one
 * consistent outcome instead of refetching) — the same contract as
 * `getGlossary`. The payload is answered whole, `placement` included, and
 * callers decide how to degrade when it is unavailable.
 *
 * @returns {Promise<object>}
 */
export const getPositions = () => {
  if (!positionsPromise) positionsPromise = fetchPositions();
  return positionsPromise;
};

/**
 * The placement slots a card shows a position chip for, read from the page's
 * cached registry: the slot for the line a deployed unit occupies, or one slot
 * per line a hand card may deploy to. An unavailable catalog costs the chip,
 * not the card face, which still renders without it.
 *
 * @param {{ kind?: string, deployLines?: string[] }} model a flattened card or
 *   unit view
 * @param {{ line?: string|null }} [options] the line a deployed unit occupies;
 *   a hand card passes none and is offered every line it may deploy to
 * @returns {Promise<Array<object>>} the slots, in line order
 */
export const getPlacementSlots = async (model, options) => {
  const payload = await getPositions().catch((error) => {
    console.error(`Positions catalog unavailable: ${error.message}`);
    return null;
  });
  return buildPlacementSlots(payload?.placement ?? {}, model, options);
};

/**
 * The placement slots a model shows, from a given registry. Pure, so the
 * narrowing has one definition the board-side rule is checked against and both
 * card faces read, rather than each restating it.
 *
 * A slot stands for a kind and the line it sits on, so only a special kind has
 * one: a standard unit's chip is the position it was placed in, which the card
 * view already carries and this deliberately does not restate. A deployed unit
 * narrows the offer to the line it occupies; a card still in hand is offered
 * every line it may deploy to, in the order the card names them.
 *
 * Each answer is the registry entry with the line it stands for named as
 * `line`, which is what the chip renders and what `buildPositionTooltipEntries`
 * labels. The registry states that line as the one-element `lines` list a drop
 * is matched against, and the entry is composed under the line it sits on.
 *
 * @param {object} registry `{ <line>: slot[] }`, the payload's `placement` key
 * @param {{ kind?: string, deployLines?: string[] }} model
 * @param {{ line?: string|null }} [options]
 * @returns {Array<object>} `{ code, kind, lines, name, iconPath, line }`
 */
export const buildPlacementSlots = (registry, model, { line = null } = {}) => {
  const kind = model?.kind ?? "standard";
  if (kind === "standard") return [];
  const lines = line ? [line] : (model?.deployLines ?? []);
  const slots = [];
  for (const code of lines) {
    const slot = (registry?.[code] ?? []).find((candidate) => candidate?.kind === kind);
    if (slot) slots.push({ ...slot, line: code });
  }
  return slots;
};
