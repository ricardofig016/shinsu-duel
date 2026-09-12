/**
 * The dev console's query bookkeeping.
 *
 * Every query is sent under its own request id and settles exactly once: with
 * the result that names it, with the refusal that names it, or on its own
 * timeout. A refusal that names no request answers another command (a refused
 * mutation, say) and is not part of this bookkeeping at all — failing the
 * queries in flight there would fail a query the server is still answering.
 *
 * DOM-free and dependency-free, so Node tests can drive it (see
 * `public/tests/game/debugRequests.test.js`).
 */

const DEFAULT_TIMEOUT_MS = 10000;

/**
 * @param {object} [options]
 * @param {number} [options.timeoutMs] how long a query waits for its answer
 * @param {Function} [options.setTimer] timer implementation, injectable for tests
 * @param {Function} [options.clearTimer] timer cancellation, injectable for tests
 */
export function createQueryTracker({
  timeoutMs = DEFAULT_TIMEOUT_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) {
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("timeoutMs must be a positive number.");
  }
  if (typeof setTimer !== "function" || typeof clearTimer !== "function") {
    throw new TypeError("setTimer and clearTimer must be functions.");
  }

  /** requestId → { timer, resolve, reject } for the queries waiting for an answer. */
  const pending = new Map();
  let counter = 0;

  /** Remove a query's bookkeeping and disarm its timeout. */
  const take = (requestId) => {
    const entry = pending.get(requestId);
    if (!entry) return null;
    pending.delete(requestId);
    clearTimer(entry.timer);
    return entry;
  };

  return {
    /**
     * Start tracking one query of `kind`. The caller sends it under the
     * returned id and hands the promise back to the command.
     *
     * @param {string} kind
     * @returns {{ requestId: string, promise: Promise<object> }}
     */
    begin(kind) {
      if (typeof kind !== "string" || kind.trim() === "") {
        throw new TypeError("A query needs a kind.");
      }
      counter += 1;
      const requestId = `q${counter}`;

      const promise = new Promise((resolve, reject) => {
        const timer = setTimer(() => {
          take(requestId)?.reject(new Error(`Query ${requestId} (${kind}) was never answered.`));
        }, timeoutMs);
        timer?.unref?.();
        pending.set(requestId, { timer, resolve, reject });
      });

      return { requestId, promise };
    },

    /**
     * Settle the query a result answers.
     *
     * @returns {boolean} whether a query was waiting for it
     */
    resolve(requestId, data) {
      const entry = take(requestId);
      if (!entry) return false;
      entry.resolve(data);
      return true;
    },

    /**
     * Settle the query a refusal names. `requestId` is null (or anything no
     * query is tracked under) for a refusal that answers another command, which
     * leaves every query in flight untouched.
     *
     * @returns {boolean} whether a query was waiting for it
     */
    refuse(requestId, message) {
      const entry = take(requestId);
      if (!entry) return false;
      entry.reject(new Error(message));
      return true;
    },

    /** How many queries are waiting for an answer. */
    get size() {
      return pending.size;
    },
  };
}
