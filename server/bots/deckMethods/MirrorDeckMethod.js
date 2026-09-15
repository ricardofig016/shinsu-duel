/**
 * The "mirror" deck method: the bot plays exactly the deck the human seat
 * plays, resolved from that seat's re-read record at start time.
 *
 * The human deck arrives as the start path's re-read record, so a deck the
 * human edited between picking and the start is what the bot mirrors — the
 * same freshness rule the human seat itself plays under. The pick carries a
 * synthetic deck id: a bot seat's pick is validated from its own slug list
 * at start and never re-read through the deck library, which would not find
 * a deck owned by the human under the bot's name.
 */

export default class MirrorDeckMethod {
  /**
   * Resolve the concrete deck this seat plays.
   *
   * @param {object} context
   * @param {object} context.humanDeck the human seat's re-read deck record
   *   (`{ name, cards }`) taken at start time
   * @returns {Promise<{ deckId: string, name: string, cards: string[], illegal: boolean }>}
   */
  async resolve({ humanDeck }) {
    if (!humanDeck || !Array.isArray(humanDeck.cards)) {
      throw new Error("The mirror deck method needs the human seat's re-read deck.");
    }
    return {
      deckId: "mirrored",
      name: humanDeck.name,
      cards: [...humanDeck.cards],
      illegal: false,
    };
  }
}
