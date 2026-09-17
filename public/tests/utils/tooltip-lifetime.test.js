import { isStaleTooltip } from "../../utils/tooltip-lifetime.js";

/**
 * The tooltip layer's prune policy. Tooltips mount on the body, so a host that
 * removes its own subtree cannot take them along; the layer drops them instead.
 * Getting this wrong is not a cosmetic bug: removing a tooltip that is still
 * loading aborts the stylesheet its renderer waits for, and the caller that
 * mounted it never resumes. A page mounting cards in parallel deadlocked that
 * way, leaving most cards as raw markup and the page's toolbar unwired.
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
