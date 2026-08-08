/**
 * Canonical shinsu pool management per RULES.md §Resources.
 *
 * Rules:
 *   - Max normal shinsu = round number (capped at 10)
 *   - Up to 2 unspent shinsu carry over as "recharged"
 *   - Charging/gaining adds to normal pool only
 *   - Spending deducts recharged first, then normal
 */

export default class ShinsuService {
  static MAX_NORMAL = 10;
  static MAX_RECHARGED = 2;

  /**
   * Reset shinsu at round start: carry over up to 2 unspent as recharged,
   * fill normal pool up to round cap.
   */
  static reset(playerState, round) {
    const unspent = (playerState.shinsu?.normalAvailable || 0) +
      (playerState.shinsu?.recharged || 0);
    playerState.shinsu = {
      normalSpent: 0,
      normalAvailable: Math.min(ShinsuService.MAX_NORMAL, round),
      recharged: Math.min(ShinsuService.MAX_RECHARGED, unspent),
    };
  }

  /** @returns {number} Total shinsu (normal + recharged). */
  static getTotal(playerState) {
    if (!playerState.shinsu) return 0;
    return (playerState.shinsu.normalAvailable || 0) +
      (playerState.shinsu.recharged || 0);
  }

  /**
   * Check if player can afford a cost.
   * @returns {boolean}
   */
  static canAfford(playerState, cost) {
    return ShinsuService.getTotal(playerState) >= cost;
  }

  /**
   * Spend shinsu: deduct recharged first, then normal.
   * @returns {{ spent: number }} Amount actually spent.
   */
  static spend(playerState, amount) {
    const s = playerState.shinsu;
    if (!s) throw new Error("ShinsuService: playerState.shinsu not initialized");

    const total = ShinsuService.getTotal(playerState);
    if (total < amount) {
      throw new Error(`insufficient shinsu (need ${amount}, have ${total})`);
    }

    const fromRecharged = Math.min(s.recharged, amount);
    s.recharged -= fromRecharged;
    s.normalAvailable -= (amount - fromRecharged);
    s.normalSpent += (amount - fromRecharged);

    return { spent: amount };
  }

  /**
   * Gain shinsu (to normal pool only), capped at round max.
   * @returns {{ gained: number }}
   */
  static gain(playerState, amount, round) {
    const s = playerState.shinsu;
    if (!s) throw new Error("ShinsuService: playerState.shinsu not initialized");

    const max = Math.min(ShinsuService.MAX_NORMAL, round);
    const before = s.normalAvailable;
    s.normalAvailable = Math.min(max, s.normalAvailable + amount);

    return { gained: s.normalAvailable - before };
  }
}
