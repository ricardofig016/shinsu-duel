import { focusCenterOffset } from "../../utils/card-detail-layout.js";

/**
 * Row geometry: the focused card's center offset decides where the overlay
 * translates the row, so a wrong offset is a card that does not sit at the
 * focus position. Slot footprints transition between scales, which is why the
 * offset is arithmetic over the applied scales instead of a measurement.
 */
describe("focusCenterOffset", () => {
  // One live row: a 480px full-size slot, 400px between slot left edges
  // (30rem card, 2.5rem overlap on each side), and slots whose scales fall
  // 5% per step away from the focus.
  const geometry = { cardWidth: 480, baseAdvance: 400, slotInset: -40 };
  const scalesFor = (focusIndex, count) =>
    Array.from({ length: count }, (_, index) =>
      index === focusIndex ? 1 : Math.max(0.65, 1 - 0.05 * Math.abs(index - focusIndex))
    );

  test("centers a lone card at half its own width, inset and all", () => {
    expect(focusCenterOffset({ ...geometry, scales: [1], focusIndex: 0 })).toBe(200);
  });

  test("ignores the slots after the focus", () => {
    const before = focusCenterOffset({ ...geometry, scales: [1, 0.95, 0.9], focusIndex: 0 });
    const after = focusCenterOffset({ ...geometry, scales: [1, 0.65, 0.65], focusIndex: 0 });
    expect(before).toBe(200);
    expect(after).toBe(200);
  });

  test("sums the scaled advance of every slot before the focus", () => {
    const scales = scalesFor(2, 5);
    expect(scales).toEqual([0.9, 0.95, 1, 0.95, 0.9]);
    // advances: 400 + (0.9 - 1) * 480 = 352, then 400 + (0.95 - 1) * 480 = 376
    expect(focusCenterOffset({ ...geometry, scales, focusIndex: 2 })).toBe(-40 + 352 + 376 + 240);
  });

  test("moves the focus position by the scale of every slot it passes", () => {
    // Focus moving right grows the slots it passes, and each one shifts the
    // focused card's center by its own scaled width: 400 at scale 1, then
    // 376, 352, 328, and 304 as the step away from the focus grows.
    const offsets = [0, 1, 2, 3, 4].map((focusIndex) =>
      focusCenterOffset({ ...geometry, scales: scalesFor(focusIndex, 5), focusIndex })
    );
    expect(offsets).toEqual([200, 576, 928, 1256, 1560]);
  });

  test("tracks the scales it is given, not a stale full-size layout", () => {
    // Reading the row while the slots still sit at scale 1 is what put the
    // focused card off center: the stale read is 48px further along the row
    // than the settled layout, so the card lands 48px short of the focus.
    const settled = focusCenterOffset({ ...geometry, scales: [0.9, 1], focusIndex: 1 });
    const stale = focusCenterOffset({ ...geometry, scales: [1, 1], focusIndex: 1 });
    expect(stale - settled).toBe(48);
  });
});
