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
const MOTION_MS = 120;
const BASE_TRANSFORM = "translate(50%, 50%) scale(1)";

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
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
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

  // One slot per row entry, focus included; side slots carry their relation
  // tag under the card.
  const row = root.querySelector(".card-detail-overlay-row");
  const entries = [...left, { kind: "focus", card: model }, ...right];
  const slots = [];
  const frames = [];
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
    const isFocus = entry.kind === "focus";
    await loadComponent(host, "card-vertical", isFocus && unit
      ? { unit, isSmall: false, onAbilityClick }
      : { card: isFocus ? model : entry.card, isSmall: false });
    frames.push(host.querySelector(".card-vertical-frame"));
  }

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

  // First placement, then motion. The placement must land in the frame the
  // overlay appears in: a transition on the initial transform would slide the
  // whole row in from the overlay's left edge, and the entrance zoom would
  // measure a card that is still travelling. The forced layout commits the
  // placement while the overlay still has no transitions; enabling motion
  // after that animates focus changes only.
  applyFocus();
  void row.getBoundingClientRect();
  root.classList.add("card-detail-overlay-motion");

  // Entrance: FLIP the focus card from the source card it opened from.
  root.style.visibility = "";
  animateFocusCard(frames[focusIndex], focusTarget(), source, "open");

  // closing
  const close = ({ animated = true } = {}) => {
    if (!active || active.root !== root) return;
    active = null;
    document.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("resize", onResize);
    if (animated) {
      const closeMotion = animateFocusCard(frames[focusSlotIndex], focusTarget(), source, "close");
      if (closeMotion) {
        closeMotion.finished.finally(() => root.remove()).catch(() => root.remove());
        return;
      }
    }
    root.remove();
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
