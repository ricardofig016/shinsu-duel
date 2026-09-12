/**
 * The dev console's read-only queries.
 *
 * A query reads authoritative state and returns a plain, JSON-safe projection.
 * Nothing here mutates the game, bumps the session revision, or reaches the
 * Logger, which is what keeps inspection outside the replay artifact. Hidden
 * information is available because the caller only ever runs in a dev room.
 */

/** Every query the console can ask. */
export const DEBUG_QUERY_KINDS = Object.freeze({
  HAND: "hand",
  DECK: "deck",
  UNIT_ABILITIES: "unit-abilities",
  STATE: "state",
  LOGS: "logs",
});

const PLAYER_STATE_MESSAGE = (username) => `Player ${username} not found.`;

/** One card view: the compiled card id, the instance id, and the name. */
function cardView(card) {
  return { cardId: card.cardId, instanceId: card.id, name: card.name };
}

/**
 * A seat's hand, in hand order.
 *
 * @param {object} game
 * @param {string} username
 */
function handView(game, username) {
  const player = game.playerStates[username];
  if (!player) throw new Error(PLAYER_STATE_MESSAGE(username));
  return { username, cards: (player.hand || []).map(cardView) };
}

/**
 * A seat's deck in draw order: the next card drawn comes first.
 *
 * @param {object} game
 * @param {string} username
 */
function deckView(game, username) {
  const player = game.playerStates[username];
  if (!player) throw new Error(PLAYER_STATE_MESSAGE(username));
  return { username, cards: [...(player.deck || [])].reverse().map(cardView) };
}

/**
 * A unit's abilities: every printed ability under the code the client sends
 * back to `use-ability-action`, plus every ability granted at runtime with the
 * source that granted it.
 *
 * @param {object} game
 * @param {string} unitId
 */
function unitAbilitiesView(game, unitId) {
  const unit = game._findUnit(unitId);
  if (!unit) throw new Error(`Unit ${unitId} is not on the field.`);

  return {
    unitId: unit.id,
    name: unit.card?.name ?? null,
    owner: unit.owner,
    native: (unit.card?.abilities || []).map((ability, index) => ({
      abilityCode: String(index),
      ability,
    })),
    granted: game._abilityRegistry.getGranted(unit.id).map((entry) => ({
      abilityCode: entry.code,
      ability: entry.ability,
      sourceId: entry.sourceId,
    })),
  };
}

/**
 * Answer one dev-console query.
 *
 * @param {object} args
 * @param {object} args.game the session's GameState
 * @param {string} args.kind one of `DEBUG_QUERY_KINDS`
 * @param {string} [args.username] the seat `hand`/`deck` read (required there)
 * @param {string} [args.unitId] the unit `unit-abilities` reads
 * @returns {object} the query's result data
 */
export function resolveDebugQuery({ game, kind, username = null, unitId = null }) {
  if (!game) throw new Error("The game has not started yet.");

  switch (kind) {
    case DEBUG_QUERY_KINDS.HAND:
      return handView(game, username);
    case DEBUG_QUERY_KINDS.DECK:
      return deckView(game, username);
    case DEBUG_QUERY_KINDS.UNIT_ABILITIES:
      return unitAbilitiesView(game, unitId);
    case DEBUG_QUERY_KINDS.STATE:
      return game.toSerializedState();
    case DEBUG_QUERY_KINDS.LOGS:
      return { entries: game.logger.getLogs() };
    default:
      throw new Error(
        `Unknown debug query "${kind}". Available: ${Object.values(DEBUG_QUERY_KINDS).join(", ")}.`
      );
  }
}
