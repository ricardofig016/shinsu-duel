/**
 * Row geometry for the card detail overlay (public/components/
 * card-detail-overlay/).
 *
 * The row is a flex sequence of slots, one per card, each carrying the graded
 * scale of its distance from the focus; the focused slot is the one at full
 * size. Centering the focused card means translating the row by the focused
 * slot's center offset.
 *
 * That offset is derived from the scales the overlay just applied, never from
 * measured layout. The slot footprints and the cards inside them transition to
 * their new scales, so a slot measured right after a focus change still
 * reports the previous scale, and the row lands off center by exactly the sum
 * of the scales that have not caught up yet. Deriving the offset keeps focus
 * changes exact however the browser schedules the animation.
 *
 * Pure geometry; no DOM access.
 */

/**
 * Distance from the row's left edge to the focused slot's center.
 *
 * A slot is a card's footprint scaled by its graded scale, and the stylesheet
 * overlaps neighbors by a constant margin that does not scale with it. Two
 * slots therefore advance by the scaled width minus that constant, which is
 * `(cardWidth - overlap) * scale`, not `baseAdvance + (scale - 1) * cardWidth`:
 * the overlap is a fixed length, so shrinking a slot removes scale-proportional
 * width from it and leaves the overlap where it was. The difference is five
 * hundredths of a slot's width per step at the floor scale, and it accumulates
 * in every slot before the focus, which is what put the focused card off the
 * middle of the viewport on a long row.
 *
 * @param {object} geometry
 * @param {number} geometry.cardWidth Slot footprint at scale 1 (the card's
 *   full-size width).
 * @param {number} geometry.baseAdvance Distance between the left edges of two
 *   scale-1 slots: their width minus the overlap the stylesheet gives them.
 * @param {number} geometry.slotInset The leading edge every slot carries
 *   relative to the row's left edge: its own overlap with the card before it,
 *   which is negative.
 * @param {number[]} geometry.scales Applied scale of every slot, in row order.
 * @param {number} geometry.focusIndex Index of the focused slot (scale 1).
 * @returns {number} Offset of the focused slot's center from the row's left
 *   edge, in the same units as `cardWidth`.
 */
export function focusCenterOffset({ cardWidth, baseAdvance, slotInset, scales, focusIndex }) {
  // The overlap the stylesheet gives each pair of neighbors, as a positive
  // length. It is what does not scale, so it is what the advance is measured
  // against: a slot advances by its own scaled width less that overlap.
  const overlap = cardWidth - baseAdvance;
  let offset = slotInset;
  for (let index = 0; index < focusIndex; index++) {
    // Only the slots before the focus shift the focus slot's position.
    offset += cardWidth * scales[index] - overlap;
  }
  return offset + (cardWidth * scales[focusIndex]) / 2;
}
