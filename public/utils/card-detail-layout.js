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
  let offset = slotInset;
  for (let index = 0; index < focusIndex; index++) {
    // A slot advances by its own scaled width plus the constant overlap, so
    // only the slots before the focus shift the focus slot's position.
    offset += baseAdvance + (scales[index] - 1) * cardWidth;
  }
  return offset + (cardWidth * scales[focusIndex]) / 2;
}
