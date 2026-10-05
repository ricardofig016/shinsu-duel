/**
 * The deploy-line rule and the placement registry: the single definition of
 * where a unit may deploy and what a board drop target for it looks like.
 *
 * A leaf module by design. `Card` projects card views and already imports the
 * display catalogs, so an engine that reached them would close a cycle; every
 * catalog this module needs is passed in instead.
 */

const FRONTLINE = "frontline";
const BACKLINE = "backline";

/** The field lines, in the order a board paints them. */
const LINE_ORDER = [FRONTLINE, BACKLINE];

/**
 * Kinds that occupy a line of their own rather than the line of a chosen
 * position, keyed by kind code. One entry per kind, and the only place a kind's
 * lines live:
 *
 * - `lines` are the lines the kind may occupy. The placement registry offers one
 *   slot per line, so a shinheuh's two entries widen the offer to both lines and
 *   a card's own `deployLines` narrows the match back to the line it names. The
 *   rule reads these lines directly for a kind the kind itself decides; a
 *   shinheuh authors its line on each card, so its card is the authority and
 *   these two lines are the generic descriptor the board offers.
 * - `slot` tracks hand-deployability onto the player's OWN board: the registry
 *   offers a slot only for a kind a player can deploy from hand. `conduit` is
 *   false because the Jeonsulsa attribute engine summons it onto the *enemy*
 *   backline and no shipped card puts one in a player's hand; if future content
 *   lets a player deploy a conduit from hand it becomes `slot: true` and nothing
 *   else changes.
 */
export const KIND_LINES = {
  shinheuh: { lines: [FRONTLINE, BACKLINE], slot: true },
  landmark: { lines: [BACKLINE], slot: true },
  conduit: { lines: [BACKLINE], slot: false },
};

/** De-duplicate line codes, keeping first-occurrence order. */
const unique = (values) => [...new Set(values)];

/**
 * The lines a card may occupy.
 *
 * A standard unit occupies the line of the position it was placed in, or, when
 * no position is given, every line its printed positions resolve to. A shinheuh
 * occupies the lines its own card names. A landmark and the Conduit occupy the
 * backline. Codes are de-duplicated and returned in a deterministic order:
 * the position's own answer, the card's authored order, or the kind's declared
 * order.
 *
 * @param {{ kind?: string, line?: string|string[]|null, positions?: object }} card
 * @param {string|null} [positionCode] the chosen position, meaningful only for
 *   a standard unit
 * @param {object|null} [positions] the position catalog (`code -> { line }`)
 *   a standard unit's position is resolved against; defaults to the card's own
 *   printed positions, which carry the catalog's line
 * @returns {string[]} every line the card may occupy
 */
export function deployLinesFor(card, positionCode = null, positions = null) {
  if (!card || typeof card !== "object") {
    throw new Error("deployLinesFor requires a card.");
  }

  const kind = card.kind ?? "standard";
  // A shinheuh's card is the authority for its line; the kind's map entry widens
  // the registry's offer to both lines, and the card narrows it back.
  if (kind === "shinheuh") {
    if (!card.line) throw new Error(`Shinheuh "${card.name}" has no line.`);
    return unique(Array.isArray(card.line) ? card.line : [card.line]);
  }
  if (Object.hasOwn(KIND_LINES, kind)) return [...KIND_LINES[kind].lines];
  return positionLines(card, positionCode, positions);
}

/**
 * A standard unit's lines: the chosen position's line, or every line its
 * printed positions resolve to. An unknown position code fails with the
 * engine's own message rather than deploying somewhere unspecified.
 */
function positionLines(card, positionCode, positions) {
  const catalog = positions ?? card.positions ?? {};
  const printed = card.positions ?? {};

  if (positionCode !== null && positionCode !== undefined) {
    const definition = catalog[positionCode];
    if (!definition) throw new Error(`Invalid position: "${positionCode}"`);
    return [definition.line];
  }

  const lines = [];
  for (const code of Object.keys(printed)) {
    const definition = catalog[code] ?? printed[code];
    if (definition?.line) lines.push(definition.line);
  }
  return unique(lines);
}

/**
 * The placement registry: for each field line, that line's placeable slots —
 * the standard positions printed on cards, followed by one slot per
 * line-deployable kind that may occupy it. Every slot is `{ code, kind, lines,
 * name, iconPath }`, so a board paints and tooltips them identically. Kind
 * display data is overlaid by the display catalogs afterwards, which is where a
 * kind slot gains the kind's description.
 *
 * A position slot selects the `standard` kind and names one position code. A
 * kind slot selects a non-standard kind and names the one line it sits on; a
 * card narrows the registry's per-line slots to its own `deployLines` (a
 * shinheuh offers a placeholder on each line a shinheuh may occupy, and the
 * card says which of them it may use). A kind slot offers no position code to
 * the engine, because the resolved line decides the destination. Icons are
 * copied from the entries the caller resolved; this module derives no paths of
 * its own.
 *
 * @param {object} positions the position catalog (`code -> { line, name, iconPath }`)
 * @param {object} kinds the kind glossary (`code -> { name, iconPath }`), as in
 *   `server/data/glossary.json`; a kind this module does not classify, and a
 *   kind a player cannot deploy from hand, is skipped
 * @returns {{ [line: string]: Array<{ code: string, kind: string, lines: string[], name: string, iconPath: string|null }> }}
 */
export function buildPlacementRegistry(positions = {}, kinds = {}) {
  const registry = Object.fromEntries(registryLines(positions).map((line) => [line, []]));

  for (const [code, position] of Object.entries(positions ?? {})) {
    registry[position?.line]?.push({
      code,
      kind: "standard",
      lines: [position.line],
      name: position.name ?? code,
      iconPath: position.iconPath ?? null,
    });
  }

  for (const [code, kind] of Object.entries(kinds ?? {})) {
    const rule = Object.hasOwn(KIND_LINES, code) ? KIND_LINES[code] : null;
    if (!rule?.slot) continue;
    for (const line of rule.lines) {
      registry[line]?.push({
        code,
        kind: code,
        lines: [line],
        name: kind?.name ?? code,
        iconPath: kind?.iconPath ?? null,
      });
    }
  }

  return registry;
}

/**
 * Every line the registry lists: the canonical lines first, then any line a
 * caller's catalog introduces, so a new line is never silently dropped.
 */
function registryLines(positions) {
  const lines = [...LINE_ORDER];
  const add = (line) => {
    if (line && !lines.includes(line)) lines.push(line);
  };
  for (const position of Object.values(positions ?? {})) add(position?.line);
  for (const rule of Object.values(KIND_LINES)) rule.lines.forEach(add);
  return lines;
}
