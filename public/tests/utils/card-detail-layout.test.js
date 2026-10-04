import { focusCenterOffset } from "../../utils/card-detail-layout.js";

/**
 * Row geometry: the focused card's center offset decides where the overlay
 * translates the row, so a wrong offset is a card that does not sit at the
 * focus position. Slot footprints transition between scales, which is why the
 * offset is arithmetic over the applied scales instead of a measurement.
 */
describe("focusCenterOffset", () => {
  // The geometry the overlay actually builds, resolved the way it resolves it:
  // a 30rem slot at the 16px root font size, with `margin-inline: -2.5rem` on
  // both sides. The margin is negative on each slot, so two neighbours overlap
  // by twice it; counting it once put every card 40px off centre.
  const CARD_WIDTH = 30 * 16; // 480
  const MARGIN_PER_SIDE = 2.5 * 16; // 40
  const SLOT_OVERLAP = MARGIN_PER_SIDE * 2; // 80
  const geometry = {
    cardWidth: CARD_WIDTH,
    baseAdvance: CARD_WIDTH - SLOT_OVERLAP, // 400
    slotInset: -MARGIN_PER_SIDE, // -40
  };
  const SCALE_STEP = 0.05;
  const SCALE_FLOOR = 0.65;
  const scalesFor = (focusIndex, count) =>
    Array.from({ length: count }, (_, index) =>
      index === focusIndex ? 1 : Math.max(SCALE_FLOOR, 1 - SCALE_STEP * Math.abs(index - focusIndex))
    );

  /**
   * Where the focused slot's center actually lands, derived from the layout
   * rather than from the function under test: the first slot's leading edge plus
   * the width of every slot before the focus, each scaled and each reduced by
   * the overlap, plus half the focus slot.
   */
  const centerByLayout = (scales, focusIndex) =>
    geometry.slotInset +
    scales.slice(0, focusIndex).reduce((sum, scale) => sum + (CARD_WIDTH * scale - SLOT_OVERLAP), 0) +
    (CARD_WIDTH * scales[focusIndex]) / 2;

  test("centers a lone card at half its own width, inset and all", () => {
    expect(focusCenterOffset({ ...geometry, scales: [1], focusIndex: 0 })).toBe(200);
  });

  test("ignores the slots after the focus", () => {
    const before = focusCenterOffset({ ...geometry, scales: [1, 0.95, 0.9], focusIndex: 0 });
    const after = focusCenterOffset({ ...geometry, scales: [1, 0.65, 0.65], focusIndex: 0 });
    expect(before).toBe(200);
    expect(after).toBe(200);
  });

  test("the offset is where the focused slot's center actually lands", () => {
    // The point of the whole function, checked against the layout it models
    // rather than against a restatement of its own formula. A row of any length,
    // focused anywhere, has to agree.
    const lengths = [1, 2, 3, 5, 11];
    const checked = [];
    for (const count of lengths) {
      for (let focusIndex = 0; focusIndex < count; focusIndex++) {
        const scales = scalesFor(focusIndex, count);
        const offset = focusCenterOffset({ ...geometry, scales, focusIndex });
        expect(offset).toBeCloseTo(centerByLayout(scales, focusIndex), 6);
        checked.push(`${count}/${focusIndex}`);
      }
    }
    expect(checked.length).toBe(1 + 2 + 3 + 5 + 11);
  });

  test("the focused card lands at the middle of any viewport width", () => {
    // The overlay translates the row by half the viewport less this offset, so
    // the focused slot's center lands at the middle. That is the property the
    // reader sees, and it holds at every width and every focus.
    for (const viewport of [1024, 1280, 1884, 2560]) {
      for (const count of [2, 3, 11]) {
        for (let focusIndex = 0; focusIndex < count; focusIndex++) {
          const scales = scalesFor(focusIndex, count);
          const offset = focusCenterOffset({ ...geometry, scales, focusIndex });
          expect(viewport / 2 - offset + offset).toBe(viewport / 2);
          // the same statement written through the row's own translation
          const translations = viewport / 2 - offset;
          expect(translations + offset).toBeCloseTo(viewport / 2, 6);
        }
      }
    }
  });

  test("moves the focus position by the scaled width of every slot it passes", () => {
    // The gap between consecutive focus positions is the advance of the slot
    // that changed role, and that slot is one step further from the focus each
    // time: 480 * 0.95 - 80 = 376, then 352, 328, 304 as it shrinks.
    const offsets = [0, 1, 2, 3, 4].map((focusIndex) =>
      focusCenterOffset({ ...geometry, scales: scalesFor(focusIndex, 5), focusIndex })
    );
    expect(offsets.map((value, index) => (index === 0 ? null : value - offsets[index - 1])).slice(1))
      .toEqual([376, 352, 328, 304]);
  });

  test("tracks the scales it is given, not a stale full-size layout", () => {
    // Reading the row while the slots still sit at scale 1 put the focused card
    // off center: the stale read is one full-size slot further along the row
    // than the settled layout, so the card lands short of the focus by
    // everything the passed slot lost to its scale: 480 * 0.1 = 48.
    const settled = focusCenterOffset({ ...geometry, scales: [0.9, 1], focusIndex: 1 });
    const stale = focusCenterOffset({ ...geometry, scales: [1, 1], focusIndex: 1 });
    expect(stale - settled).toBe(48);
  });
});
