/**
 * The "mirror" deck method: the bot plays exactly the deck the human seat
 * picked for itself.
 *
 * The pick carries the mirrored deck's id and name so the deck reveal and
 * status payloads describe the deck truthfully. It resolves when the start
 * path runs, which is always after the human pick exists — a start cannot be
 * attempted before both seats hold a pick.
 */

export default class MirrorDeckMethod {
  /**
   * Resolve the concrete deck this seat plays.
   *
   * @param {object} context
   * @param {object|null} context.humanPick the human seat's deck pick
   * @returns {Promise<{ deckId: string, name: string, cards: string[], illegal: boolean }>}
   */
  async resolve({ humanPick }) {
    if (!humanPick || !Array.isArray(humanPick.cards)) {
      throw new Error("The mirror deck method needs the human seat's deck pick.");
    }
    return {
      deckId: humanPick.deckId,
      name: humanPick.name,
      cards: [...humanPick.cards],
      illegal: Boolean(humanPick.illegal),
    };
  }
}
