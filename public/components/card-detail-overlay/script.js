import { loadComponent } from "/utils/component-util.js";
import { getCardCatalog } from "/utils/card-catalog.js";
import { assembleDetailRow, relationTag } from "/utils/card-detail-row.js";

// The focus slot sits right of screen center so the equipment column has
// room on its left.
const FOCUS_X_RATIO = 0.55;
// Slight graded shrink per step of distance from the focus card, floored so
// distant cards stay readable; overlap and falloff are tuned in the browser.
const SCALE_STEP = 0.05;
const SCALE_FLOOR = 0.65;
// Slots paint above the row's backdrop; distance from the focus lowers them.
const Z_INDEX_BASE = 30;
// Movement threshold before a press counts as a drag instead of a click.
const DRAG_THRESHOLD_PX = 8;
// Entrance/exit zoom of the focus card between its slot and the source card
// it was opened from (the card-vertical big-card FLIP pattern).
const MOTION_MS = 120;
const BASE_TRANSFORM = "translate(50%, 50%) scale(1)";

/**
 * FLIP zoom between the focus card's slot position and the source card the
 * overlay was opened from. Both rects are viewport coordinates, so the
 * page's positioning context is irrelevant. Returns the motion, or null
 * when there is nothing to animate: reduced motion requested, the source
 * gone or hidden, or no animation support. The caller owns what happens on
 * finish (reveal the card / remove the overlay).
 */
const animateFocusCard = (frame, source, direction) => {
  const sourceRect = source?.isConnected ? source.getBoundingClientRect() : null;
  if (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    !sourceRect ||
    sourceRect.width === 0 ||
    typeof frame.animate !== "function"
  ) {
    return null;
  }
  const frameRect = frame.getBoundingClientRect();
  const dx = sourceRect.left + sourceRect.width / 2 - (frameRect.left + frameRect.width / 2);
  const dy = sourceRect.top + sourceRect.height / 2 - (frameRect.top + frameRect.height / 2);
  const scale = sourceRect.width / frameRect.width;
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

  // Focus state: which slot is focused and where the row sits. Changing
  // focus only re-grades scales, z-indexes, and the row offset — the list
  // itself never rebuilds.
  let focusSlotIndex = focusIndex;
  let baseTx = 0;
  let panOffset = 0;

  const applyRowTransform = () => {
    row.style.transform = `translateY(-50%) translateX(${baseTx + panOffset}px)`;
  };
  const applyFocus = () => {
    slots.forEach((slot, index) => {
      const distance = Math.abs(index - focusSlotIndex);
      const scale = distance === 0 ? 1 : Math.max(SCALE_FLOOR, 1 - SCALE_STEP * distance);
      slot.style.setProperty("--s", scale.toFixed(3));
      slot.style.zIndex = String(Z_INDEX_BASE - distance);
    });
    const focusSlot = slots[focusSlotIndex];
    baseTx = FOCUS_X_RATIO * window.innerWidth - (focusSlot.offsetLeft + focusSlot.offsetWidth / 2);
    panOffset = 0;
    applyRowTransform();
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

  // Entrance: FLIP the focus card from the source card it opened from.
  applyFocus();
  root.style.visibility = "";
  const entranceFrame = frames[focusIndex];
  const entranceMotion = animateFocusCard(entranceFrame, source, "open");
  if (entranceMotion) {
    // hold the card invisible until the source-anchored entrance runs;
    // visibility (unlike display) keeps layout measurable for the fits
    entranceFrame.style.visibility = "hidden";
    entranceMotion.finished
      .finally(() => { entranceFrame.style.visibility = ""; })
      .catch(() => { entranceFrame.style.visibility = ""; });
  }

  // closing
  const close = ({ animated = true } = {}) => {
    if (!active || active.root !== root) return;
    active = null;
    document.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("resize", onResize);
    if (animated) {
      const closeMotion = animateFocusCard(frames[focusSlotIndex], source, "close");
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

  // Horizontal drag pans the row and snaps back to card alignment; presses
  // that never cross the threshold stay clicks (slot click focuses, backdrop
  // click closes).
  let drag = null;
  let suppressClick = false;
  root.addEventListener("click", (event) => {
    if (!suppressClick) return;
    suppressClick = false;
    event.stopPropagation();
    event.preventDefault();
  }, true);
  root.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    suppressClick = false;
    drag = { startX: event.clientX, lastX: event.clientX, pointerId: event.pointerId, moved: false };
  });
  root.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.moved) {
      if (Math.abs(event.clientX - drag.startX) < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      suppressClick = true;
      row.classList.add("dragging");
      root.setPointerCapture(event.pointerId);
    }
    panOffset += event.clientX - drag.lastX;
    drag.lastX = event.clientX;
    applyRowTransform();
  });
  const endDrag = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { moved } = drag;
    drag = null;
    row.classList.remove("dragging");
    if (moved) {
      // snap to the card whose center sits nearest the focus position
      const target = FOCUS_X_RATIO * window.innerWidth;
      let best = focusSlotIndex;
      let bestDistance = Infinity;
      slots.forEach((slot, index) => {
        const center = slot.offsetLeft + slot.offsetWidth / 2 + baseTx + panOffset;
        const distance = Math.abs(center - target);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      });
      setFocus(best);
      return;
    }
    const slot = event.target?.closest?.(".card-detail-slot");
    if (slot && row.contains(slot)) setFocus(Number(slot.dataset.index));
    else close();
  };
  root.addEventListener("pointerup", endDrag);
  root.addEventListener("pointercancel", () => {
    if (!drag) return;
    drag = null;
    row.classList.remove("dragging");
    applyFocus();
  });
  root.addEventListener("contextmenu", (event) => event.preventDefault());

  active = { root, close, focusCard };
}

// Registry load contract: the overlay mounts itself (openCardDetail appends
// its own root to the body), so a registry load with no card is a no-op that
// only primes the component markup cache.
export default function load(container, data = null) {
  return openCardDetail(data ?? {});
}
