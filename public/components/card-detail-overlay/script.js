import { loadComponent } from "/utils/component-util.js";
import { getCardCatalog } from "/utils/card-catalog.js";
import { assembleDetailRow, relationTag } from "/utils/card-detail-row.js";
import { focusCenterOffset } from "/utils/card-detail-layout.js";

// The focus slot sits at the middle of the viewport with the equipment column
// to its left, so the card the overlay was opened for stays where the eye
// expects it however the row is populated.
const FOCUS_X_RATIO = 0.5;
// Slight graded shrink per step of distance from the focus card, floored so
// distant cards stay readable; overlap and falloff are tuned in the browser.
const SCALE_STEP = 0.05;
const SCALE_FLOOR = 0.65;
// Slots paint above the row's backdrop; distance from the focus lowers them.
const Z_INDEX_BASE = 30;
// Entrance/exit zoom of the focus card between its slot and the source card
// it was opened from (the card-vertical big-card FLIP pattern).
const MOTION_MS = 140;
// How long the cards beside the focus take to travel from behind it to their
// own slots (and back on close).
const SIDE_MOTION_MS = 140;
const BASE_TRANSFORM = "translate(50%, 50%) scale(1)";

/** Whether the user asked for reduced motion; every animation here respects it. */
const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * FLIP zoom of the focus card between the focus position and the source card
 * the overlay was opened from. `target` is the card's settled viewport rect
 * (the overlay derives it from row geometry rather than measuring, because
 * the row and the card are both moving while a focus change animates), and
 * both rects are viewport coordinates, so the page's positioning context is
 * irrelevant. Returns the motion, or null when there is nothing to animate:
 * reduced motion requested, the source gone or hidden, or no animation
 * support. The caller owns what happens on finish (reveal the card / remove
 * the overlay).
 */
const animateFocusCard = (frame, target, source, direction) => {
  const sourceRect = source?.isConnected ? source.getBoundingClientRect() : null;
  if (
    prefersReducedMotion() ||
    !sourceRect ||
    sourceRect.width === 0 ||
    typeof frame.animate !== "function"
  ) {
    return null;
  }
  const dx = sourceRect.left + sourceRect.width / 2 - (target.left + target.width / 2);
  const dy = sourceRect.top + sourceRect.height / 2 - (target.top + target.height / 2);
  const scale = sourceRect.width / target.width;
  const fromTransform = `${BASE_TRANSFORM} translate(${dx}px, ${dy}px) scale(${scale})`;
  const keyframes =
    direction === "open"
      ? [{ transform: fromTransform }, { transform: BASE_TRANSFORM }]
      : [{ transform: BASE_TRANSFORM }, { transform: fromTransform }];
  return frame.animate(keyframes, { duration: MOTION_MS, easing: "ease-out" });
};

// One overlay per page: opening again replaces the open one.
let active = null;

/** Whether a card detail overlay is currently open. */
export const isCardDetailOpen = () => active !== null;

/**
 * Move the open overlay's focus to a card by its runtime cardId. Returns
 * false when no overlay is open or the card is not in its row.
 */
export const focusCardDetail = (cardId) => active?.focusCard?.(cardId) ?? false;

/**
 * Open the card detail overlay for one card: the focus card at its big
 * size, attached equipment to its left, its related cards to its right.
 * Callers pass either `card` (a flattened card view model) or `unit` (a
 * flattened unit view model, whose name-only equipment attachments resolve
 * against the catalog), plus the `source` element the overlay opens from —
 * it anchors the entrance/exit zoom. `onAbilityClick` wires the focus
 * card's ability clicks where the page makes them meaningful. Resolves
 * when the row is assembled and the entrance has started; the overlay
 * stays open until the user closes it or another open replaces it.
 */
export async function openCardDetail({
  source = null,
  card = null,
  unit = null,
  onAbilityClick = null,
} = {}) {
  const model = unit ?? card;
  if (!model || typeof model !== "object" || model.cardId == null) return;

  if (active) active.close({ animated: false });

  const root = document.createElement("div");
  root.className = "card-detail-overlay-component";
  // held invisible while the row assembles: cards load over several awaits,
  // and the first paint should show the full row already posed
  root.style.visibility = "hidden";
  document.body.appendChild(root);
  await loadComponent(root, "card-detail-overlay", null);

  // Relations and attachments resolve against the page-level catalog; a
  // failure degrades to the focus card alone.
  const catalog = await getCardCatalog().catch((error) => {
    console.error(`Card catalog unavailable: ${error.message}`);
    return null;
  });
  const { left, right, focusIndex } = assembleDetailRow(model, catalog);

  // An ability click plays the ability on the board the overlay covers, so the
  // overlay dismisses itself: left up, it hides the field the player has to
  // pick the ability's target on. The handler runs first — the ability is the
  // action and the dismissal is what follows it. `close` belongs to the
  // lifecycle declared below and is only ever reached from a click, which the
  // overlay cannot receive while it is still assembling.
  const abilityClick = onAbilityClick
    ? (unitId, abilityCode) => {
        onAbilityClick(unitId, abilityCode);
        close();
      }
    : null;

  // One slot per row entry, focus included; side slots carry their relation
  // tag under the card. Every slot joins the row in order first, then the cards
  // render: each card mounts about ten tooltips and fits two blocks of text, and
  // building them one after another made a long row sit still for about a second
  // before its opening animation could start.
  const row = root.querySelector(".card-detail-overlay-row");
  const entries = [...left, { kind: "focus", card: model }, ...right];
  const slots = [];
  const frames = new Array(entries.length);
  for (const [index, entry] of entries.entries()) {
    const slot = document.createElement("div");
    slot.className = "card-detail-slot";
    slot.dataset.index = String(index);
    const host = document.createElement("div");
    slot.appendChild(host);
    if (entry.kind !== "focus") {
      const tag = document.createElement("div");
      tag.className = "card-detail-tag";
      tag.textContent = relationTag(entry);
      slot.appendChild(tag);
    }
    row.appendChild(slot);
    slots.push(slot);
  }
  await Promise.all(
    entries.map(async (entry, index) => {
      const isFocus = entry.kind === "focus";
      await loadComponent(slots[index].firstElementChild, "card-vertical", isFocus && unit
        ? { unit, isSmall: false, onAbilityClick: abilityClick }
        : { card: isFocus ? model : entry.card, isSmall: false });
      frames[index] = slots[index].querySelector(".card-vertical-frame");
    })
  );

  // Slot geometry at scale 1, read once before any scale is applied: the
  // stylesheet owns the slot's size and overlap, and every row offset below
  // is derived from these numbers instead of re-read from layout. The row has
  // no transform yet, so its rect is the untransformed origin.
  const unscaledSlot = slots[0].getBoundingClientRect();
  const cardWidth = unscaledSlot.width;
  const cardHeight = unscaledSlot.height;
  const slotInset = unscaledSlot.left - row.getBoundingClientRect().left;
  const baseAdvance = slots.length > 1
    ? slots[1].getBoundingClientRect().left - unscaledSlot.left
    : 0;

  // Focus state: which slot is focused. Changing focus only re-grades scales,
  // z-indexes, and the row offset — the list itself never rebuilds.
  let focusSlotIndex = focusIndex;

  const scaleFor = (index) => {
    const distance = Math.abs(index - focusSlotIndex);
    return distance === 0 ? 1 : Math.max(SCALE_FLOOR, 1 - SCALE_STEP * distance);
  };
  /**
   * The focused card's settled viewport rect. Its center comes from the row
   * (whose height no focus change affects) and the focus position, never
   * from a measured card: the row, the slot footprints, and the card's own
   * placement all transition, so anything read here right after a focus
   * change still reports the previous scale.
   */
  const focusTarget = () => {
    const rowRect = row.getBoundingClientRect();
    const centerY = rowRect.top + rowRect.height / 2;
    return {
      left: FOCUS_X_RATIO * window.innerWidth - cardWidth / 2,
      top: centerY - cardHeight / 2,
      width: cardWidth,
      height: cardHeight,
    };
  };
  const applyFocus = () => {
    const scales = slots.map((slot, index) => {
      // one rounding, shared by the applied scale and the offset arithmetic
      const scale = Number(scaleFor(index).toFixed(3));
      slot.style.setProperty("--s", scale.toFixed(3));
      slot.style.zIndex = String(Z_INDEX_BASE - Math.abs(index - focusSlotIndex));
      return scale;
    });
    const baseTx = FOCUS_X_RATIO * window.innerWidth
      - focusCenterOffset({ cardWidth, baseAdvance, slotInset, scales, focusIndex: focusSlotIndex });
    row.style.transform = `translateY(-50%) translateX(${baseTx}px)`;
  };
  const setFocus = (index) => {
    focusSlotIndex = Math.max(0, Math.min(slots.length - 1, index));
    unparkSides();
    applyFocus();
  };
  // Card-link navigation: move the focus to the row entry for a card.
  const slotByCardId = new Map();
  entries.forEach((entry, index) => {
    const cardId = entry.card?.cardId;
    if (cardId != null && !slotByCardId.has(cardId)) slotByCardId.set(cardId, index);
  });
  const focusCard = (cardId) => {
    const index = slotByCardId.get(cardId);
    if (index === undefined) return false;
    setFocus(index);
    return true;
  };

  // Motion of the cards beside the focus. They wait parked at the focus slot's
  // centre, where the focus card hides them (every side card is smaller than
  // it), and travel to their own slots together once the focus card has
  // finished expanding, their tags fading in as they emerge. Closing runs it
  // backwards, so the cards return behind the focus card before it shrinks
  // away. A focus change abandons the park: the row must never animate cards
  // from a position the row has already left.
  const stillOpen = () => active?.root === root;
  // The slots parked at open: every slot except the one focused then. A focus
  // change abandons the park, so this set is only ever used by the opening.
  const sideSlots = slots.filter((slot, index) => index !== focusIndex);
  const sideTags = sideSlots.map((slot) => slot.querySelector(".card-detail-tag"));
  /**
   * Every slot except the one focused right now, with its tag. Closing recomputes
   * this rather than reusing the opening set: once the focus has moved, the
   * focused slot is no longer the one it parked around, and hiding it would make
   * its own exit animation play on an invisible card.
   */
  const besideFocus = () =>
    slots
      .filter((_, index) => index !== focusSlotIndex)
      .map((slot) => ({ slot, tag: slot.querySelector(".card-detail-tag") }));
  let parked = false;
  let parkedOffsets = [];

  /** How far each side slot sits from the focus slot's centre, in pixels. */
  const offsetsToFocus = () => {
    const focusRect = slots[focusSlotIndex].getBoundingClientRect();
    const focusCenter = focusRect.left + focusRect.width / 2;
    return sideSlots.map((slot) => {
      const rect = slot.getBoundingClientRect();
      return focusCenter - (rect.left + rect.width / 2);
    });
  };
  const parkSides = () => {
    if (sideSlots.length === 0 || prefersReducedMotion()) return;
    parkedOffsets = offsetsToFocus();
    sideSlots.forEach((slot, index) => {
      slot.style.transform = `translateX(${parkedOffsets[index]}px)`;
      slot.style.opacity = "0";
    });
    for (const tag of sideTags) tag.style.opacity = "0";
    parked = true;
  };
  const unparkSides = () => {
    if (!parked) return;
    parked = false;
    for (const slot of sideSlots) {
      slot.style.transform = "";
      slot.style.opacity = "";
    }
    for (const tag of sideTags) tag.style.opacity = "";
  };
  const travelSides = () => {
    if (!parked || !stillOpen()) return;
    parked = false;
    const offsets = parkedOffsets;
    sideSlots.forEach((slot, index) => {
      slot.style.transform = "";
      slot.style.opacity = "";
      slot.animate(
        [{ transform: `translateX(${offsets[index]}px)` }, { transform: "translateX(0px)" }],
        { duration: SIDE_MOTION_MS, easing: "ease-out" }
      );
    });
    for (const tag of sideTags) {
      // the park wrote an inline opacity of 0, and the animation must not hand
      // the tag back to it when it ends: clear it and animate from 0 instead
      tag.style.opacity = "";
      tag.animate([{ opacity: 0 }, { opacity: 1 }], { duration: SIDE_MOTION_MS, easing: "ease-out" });
    }
  };
  /**
   * The reverse of `travelSides`, resolving once the cards are back behind the
   * focus card and hidden there. Each card starts from wherever it is now, so a
   * close during the opening travel does not first snap it to its slot, and the
   * cards are hidden before the focus card shrinks: left visible, they would be
   * revealed behind it as it leaves.
   */
  const gatherSides = () => {
    if (slots.length < 2 || prefersReducedMotion()) return null;
    const beside = besideFocus();
    const focusRect = slots[focusSlotIndex].getBoundingClientRect();
    const focusCenter = focusRect.left + focusRect.width / 2;
    const motions = beside.map(({ slot }) => {
      const rect = slot.getBoundingClientRect();
      const dx = focusCenter - (rect.left + rect.width / 2);
      const from = getComputedStyle(slot).transform;
      for (const animation of slot.getAnimations()) animation.cancel();
      return slot.animate(
        [{ transform: from === "none" ? "translateX(0px)" : from }, { transform: `translateX(${dx}px)` }],
        { duration: SIDE_MOTION_MS, easing: "ease-in", fill: "forwards" }
      );
    });
    for (const { tag } of beside) {
      if (!tag) continue;
      const from = getComputedStyle(tag).opacity;
      for (const animation of tag.getAnimations()) animation.cancel();
      tag.animate([{ opacity: from }, { opacity: 0 }], { duration: SIDE_MOTION_MS, easing: "ease-in", fill: "forwards" });
    }
    return Promise.all(motions.map((motion) => motion.finished.catch(() => {}))).then(() => {
      for (const { slot } of beside) slot.style.opacity = "0";
    });
  };

  // First placement, then motion. The placement must land in the frame the
  // overlay appears in: a transition on the initial transform would slide the
  // whole row in from the overlay's left edge, and the entrance zoom would
  // measure a card that is still travelling. The forced layout commits the
  // placement while the overlay still has no transitions; enabling motion
  // after that animates focus changes only.
  applyFocus();
  void row.getBoundingClientRect();
  root.classList.add("card-detail-overlay-motion");
  // park the side cards in the same committed frame, so they are never painted
  // at their own slots before the entrance
  parkSides();

  // Entrance: FLIP the focus card from the source card it opened from, then let
  // the parked cards travel out from behind it.
  root.style.visibility = "";
  const entranceMotion = animateFocusCard(frames[focusIndex], focusTarget(), source, "open");
  if (entranceMotion) entranceMotion.finished.catch(() => {}).then(travelSides);
  else travelSides();

  // closing
  const close = ({ animated = true } = {}) => {
    if (!active || active.root !== root) return;
    active = null;
    document.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("resize", onResize);
    // `withMotion` is what the caller asked for, not a preference: another card
    // opening over this one replaces it with no exit animation at all.
    const shrinkFocus = (withMotion) => {
      const closeMotion = withMotion
        ? animateFocusCard(frames[focusSlotIndex], focusTarget(), source, "close")
        : null;
      if (closeMotion) {
        closeMotion.finished.finally(() => root.remove()).catch(() => root.remove());
        return;
      }
      root.remove();
    };
    if (!animated) {
      shrinkFocus(false);
      return;
    }
    // the cards return behind the focus card before it shrinks away, so closing
    // reads as the opening in reverse
    if (parked) {
      unparkSides();
      shrinkFocus(true);
      return;
    }
    const gathering = gatherSides();
    if (gathering) {
      gathering.then(() => shrinkFocus(true));
      return;
    }
    shrinkFocus(true);
  };

  // interactions
  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      close();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      setFocus(focusSlotIndex - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setFocus(focusSlotIndex + 1);
    }
  };
  const onResize = () => applyFocus();
  document.addEventListener("keydown", onKeyDown);
  window.addEventListener("resize", onResize);

  root.addEventListener("wheel", (event) => {
    event.preventDefault();
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (delta === 0) return;
    setFocus(focusSlotIndex + (delta > 0 ? 1 : -1));
  }, { passive: false });

  // Clicking a card focuses it; a click anywhere else is a backdrop click and
  // closes. Escaping ability clicks inside the focus card land on the already
  // focused slot, so they only run their own handler.
  root.addEventListener("click", (event) => {
    const slot = event.target?.closest?.(".card-detail-slot");
    if (slot && row.contains(slot)) setFocus(Number(slot.dataset.index));
    else close();
  });
  // right-clicking anywhere in the overlay closes it, on the card or beside it
  root.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    close();
  });

  active = { root, close, focusCard };
}

// Registry load contract: the overlay mounts itself (openCardDetail appends
// its own root to the body), so a registry load with no card is a no-op that
// only primes the component markup cache.
export default function load(container, data = null) {
  return openCardDetail(data ?? {});
}
