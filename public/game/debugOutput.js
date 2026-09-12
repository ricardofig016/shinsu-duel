/**
 * Formatting for the dev console.
 *
 * The console's output is built here, DOM-free and dependency-free, so the
 * command wrappers in `debugConsole.js` stay a thin socket layer and the
 * presentation can be tested in Node (see `public/tests/game/debugOutput.test.js`).
 */

/** The command surface shown by `debug.help()`. */
export const DEBUG_COMMANDS = Object.freeze([
  ["debug.help()", "list these commands"],
  ["debug.draw(amount = 1, seat?)", "draw cards from a seat's deck"],
  ["debug.mulligan(amount = 5, seat?)", "shuffle a seat's hand back and redraw"],
  ["debug.addToHand(cardId, seat?)", "create a card into a seat's hand"],
  ["debug.addToDeck(cardId, placement = 'top', seat?)", "put a card on a deck's top or bottom"],
  ["debug.shuffleDeck(seat?)", "shuffle a seat's deck"],
  ["debug.grantShinsu(amount, seat?)", "gain shinsu for a seat (capped by the round)"],
  ["debug.endRound()", "end the round immediately"],
  ["debug.forceTurn()", "hand the turn to the other player"],
  ["debug.setRound(round)", "set the round counter"],
  ["debug.spawn(cardId, positionCode, seat?)", "put a unit on a seat's field for free"],
  ["debug.setUnitHp(unitId, value)", "set a deployed unit's HP"],
  ["debug.destroyUnit(unitId)", "destroy a deployed unit"],
  ["debug.modifyLighthouses(delta, seat?)", "change a seat's lighthouses"],
  ["debug.hand(seat?)", "list a hand (card id, instance id, name)"],
  ["debug.deck(seat?)", "list a deck in draw order"],
  ["debug.abilities(unitId)", "list a unit's printed and granted abilities"],
  ["debug.state()", "dump the full serialized game state"],
  ["debug.logs()", "dump the accumulated logger entries"],
  ["debug.firehose(enabled?)", "toggle the live engine event stream"],
  ["debug.restart()", "restart the room at the deck-selection step"],
  ["debug.card(idOrName)", "look a card up in the cached catalog"],
]);

/** `seat?` arguments default to the connection's own seat. */
const SEAT_NOTE = "Arguments marked seat? default to your own seat.";

/**
 * Render the command list.
 *
 * @param {Array<[string, string]>} [commands]
 * @returns {string}
 */
export function formatHelp(commands = DEBUG_COMMANDS) {
  const width = Math.max(...commands.map(([signature]) => signature.length));
  return [
    "Shinsu Duel dev console (TESTROOM rooms only).",
    ...commands.map(([signature, description]) => `  ${signature.padEnd(width)}  ${description}`),
    "",
    SEAT_NOTE,
    "Mutations run as engine actions and are recorded in the replay stream; queries are read-only.",
  ].join("\n");
}

/**
 * Index catalog card views (`GET /cards/data`) by id, name, and slug.
 *
 * @param {object[]} cardViews
 * @returns {{ byId: Map<number, object>, byName: Map<string, object>, bySlug: Map<string, object> }}
 */
export function buildCardIndex(cardViews = []) {
  const byId = new Map();
  const byName = new Map();
  const bySlug = new Map();

  for (const view of cardViews) {
    if (!view || typeof view !== "object") continue;
    if (Number.isInteger(view.cardId)) byId.set(view.cardId, view);
    if (typeof view.name === "string") byName.set(view.name.toLowerCase(), view);
    if (typeof view.slug === "string") bySlug.set(view.slug, view);
  }
  return { byId, byName, bySlug };
}

/**
 * Find a catalog card by numeric id, slug, or name (case-insensitive).
 *
 * @param {{ byId: Map, byName: Map, bySlug: Map }} index
 * @param {number|string} reference
 * @returns {object|null}
 */
export function findCard(index, reference) {
  if (reference === null || reference === undefined) return null;

  const numeric = typeof reference === "number" ? reference : Number(reference);
  if (Number.isInteger(numeric) && index.byId.has(numeric)) return index.byId.get(numeric);
  if (typeof reference !== "string") return null;

  return index.bySlug.get(reference) ?? index.byName.get(reference.toLowerCase()) ?? null;
}

/**
 * A card's display label: its name when the catalog knows it, and the raw id
 * when it does not, so a listing never hides an id behind a blank.
 */
export function cardLabel(index, cardId) {
  const card = index.byId.get(Number(cardId));
  if (typeof card?.name === "string" && card.name !== "") return `${card.name} (#${cardId})`;
  return `#${cardId} (unknown card)`;
}

/** One engine event line: sequence, event name, and its scalar payload fields. */
export function formatDebugEvent(line) {
  const fields = Object.entries(line?.fields ?? {})
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join("|") : value}`)
    .join(" ");

  return `[event #${line?.sequence ?? "?"}] ${line?.name ?? "?"}${fields ? ` ${fields}` : ""}`;
}

/**
 * A hand or deck listing. Deck listings come in draw order, so the first
 * entry is the next card drawn.
 */
export function formatCardList(kind, result, index) {
  const cards = result?.cards ?? [];
  const header = `${result?.username ?? "?"}'s ${kind} (${cards.length})`;
  const rows = cards.map((card, position) => {
    const marker = kind === "deck" && position === 0 ? " (top)" : "";
    return `  ${position}${marker}: ${cardLabel(index, card.cardId)} instance ${card.instanceId}`;
  });

  return [header, ...rows].join("\n");
}

/** An ability's one-line summary: its printed text when the DSL carries one. */
function abilitySummary(ability) {
  if (!ability || typeof ability !== "object") return String(ability ?? "unknown");
  return ability.raw ?? ability.type ?? JSON.stringify(ability);
}

/** A unit's printed and granted abilities, with the codes the client sends back. */
export function formatUnitAbilities(result) {
  const native = (result?.native ?? []).map(
    (entry) => `  ${entry.abilityCode}: ${abilitySummary(entry.ability)}`
  );
  const granted = (result?.granted ?? []).map(
    (entry) => `  ${entry.abilityCode}: ${abilitySummary(entry.ability)} (from ${entry.sourceId})`
  );

  return [
    `${result?.name ?? "?"} (${result?.unitId ?? "?"})${result?.owner ? ` owned by ${result.owner}` : ""}`,
    "printed:",
    ...(native.length ? native : ["  none"]),
    "granted:",
    ...(granted.length ? granted : ["  none"]),
  ].join("\n");
}
