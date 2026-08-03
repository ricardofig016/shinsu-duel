/**
 * Shared monotonic clock for deterministic event ordering.
 *
 * Every handler registration, modifier application, and unit deployment
 * consumes a tick from this clock. The resulting sequence number is used
 * as `sourceAge` to break ties when two handlers share the same priority.
 *
 * Earlier ticks → older sources → run first.
 */
export default class GameClock {
  #tick = 0;

  /** @returns {number} The next monotonic sequence number. */
  now() {
    return this.#tick++;
  }

  /** Reset the clock. Primarily for testing. */
  reset() {
    this.#tick = 0;
  }

  /** @returns {number} Current tick without advancing. */
  peek() {
    return this.#tick;
  }
}
