import { isStaleTooltip, staleTooltips } from "../../utils/tooltip-lifetime.js";

/**
 * The tooltip layer's prune policy. Tooltips mount on the body, so a host that
 * removes its own subtree cannot take them along; the layer drops them instead.
 * Getting this wrong is not a cosmetic bug: removing a tooltip that is still
 * loading aborts the stylesheet its renderer waits for, and the caller that
 * mounted it never resumes. A page mounting cards in parallel deadlocked that
 * way, leaving most cards as raw markup and the page's toolbar unwired.
 *
 * `staleTooltips` is the batch the layer prunes: it takes the connection the
 * caller observed, so the rule and its memory are testable here. That the layer
 * observes the document at all — and not only the next mount — is a wiring
 * contract, checked in `component-contract.test.js`.
 */
describe("isStaleTooltip", () => {
  const mounted = { settled: true, attached: true, targetConnected: false };

  test("drops a loaded tooltip whose target has left the document", () => {
    expect(isStaleTooltip(mounted)).toBe(true);
  });

  test("keeps a tooltip that is still loading, however its target is doing", () => {
    expect(isStaleTooltip({ ...mounted, settled: false })).toBe(false);
    expect(isStaleTooltip({ settled: false, attached: false, targetConnected: false })).toBe(false);
  });

  test("keeps a tooltip whose target is still in the document", () => {
    expect(isStaleTooltip({ ...mounted, targetConnected: true })).toBe(false);
  });

  test("keeps a tooltip whose target has never been in the document", () => {
    // Callers build an element before appending it, and mount its tooltip in
    // between; a target that never attached has not left.
    expect(isStaleTooltip({ settled: true, attached: false, targetConnected: false })).toBe(false);
  });
});

describe("staleTooltips", () => {
  const mounted = (overrides = {}) => ({ target: { name: "target" }, settled: true, attached: true, ...overrides });

  test("drops the settled tooltips whose targets have left", () => {
    const live = mounted();
    const gone = mounted();
    expect(staleTooltips([live, gone], (target) => target !== gone.target)).toEqual([gone]);
  });

  test("remembers a target it has seen connected, so the next pass can drop it", () => {
    // The caller rebuilds the document after the tooltip mounted, so a single
    // observation is not enough: `attached` latches across passes.
    const observed = mounted({ attached: false });
    expect(staleTooltips([observed], () => true)).toEqual([]);
    expect(observed.attached).toBe(true);
    expect(staleTooltips([observed], () => false)).toEqual([observed]);
  });

  test("never drops a tooltip that is still loading, however its target is doing", () => {
    expect(staleTooltips([mounted({ settled: false })], () => false)).toEqual([]);
  });
});
