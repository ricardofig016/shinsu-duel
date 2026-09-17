/**
 * Tooltip lifetime: the rule that decides whether a mounted tooltip has
 * outlived its hover target and may be dropped.
 *
 * Tooltips mount on the body (`public/utils/component-util.js`), so a host that
 * removes its own subtree cannot take them along and the layer has to clean up
 * after it. Both conditions in the rule are load-bearing, and both were learned
 * the hard way.
 *
 * - A tooltip that is still loading is never dropped. Its renderer waits on its
 *   own stylesheet, and removing the element aborts that load, so the caller
 *   that mounted it never resumes: one card's tooltip could deadlock another
 *   card's render, and with it a whole page's setup.
 * - A target that has never been in the document has not left it. Callers build
 *   an element and then append it; a target still being built must keep the
 *   tooltip mounted on it.
 *
 * Pure; no DOM access. The caller observes the target's connection and passes
 * it in.
 */

/**
 * @param {object} tooltip
 * @param {boolean} tooltip.settled Whether the tooltip finished loading.
 * @param {boolean} tooltip.attached Whether its hover target has ever been in
 *   the document.
 * @param {boolean} tooltip.targetConnected Whether the target is in the document
 *   right now.
 * @returns {boolean} whether the tooltip may be removed.
 */
export const isStaleTooltip = ({ settled, attached, targetConnected }) =>
  settled && attached && !targetConnected;
