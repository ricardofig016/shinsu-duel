import { loadComponent, prefersReducedMotion } from "/utils/component-util.js";
import { setCardFlipClickable, resetCardFlip } from "/utils/card-flip.js";
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
// The focus card's settled placement, as the entrance/exit zoom animates it: the
// frame's resting centring is its own `translate` property, so this is the scale
// alone and the two never state the same offset twice.
const BASE_TRANSFORM = "scale(1)";

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
    // A frame that never mounted has nothing to animate, and the overlay still
    // has to be able to close over it.
    typeof frame?.animate !== "function"
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
  const { left, right, more, focusIndex } = assembleDetailRow(model, catalog);

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

  // One slot per row entry, focus included; side slots carry their relation tag
  // under the card. The revealed tier has no slots here at all: it has none
  // anywhere until the reader opens it, and the button that opens it is not a
  // slot either. The slots are cheap and fixed in size by the stylesheet, so the
  // row's geometry is known before any card is built and every card can be
  // measured against it.
  const row = root.querySelector(".card-detail-overlay-row");
  // The row is its cards, and nothing else. The button that opens the revealed
  // tier is a sibling of the row rather than a slot in it: a slot is a place a
  // card can be, and that button holds no card, so making it a slot is what put
  // it in reach of the focus and of the row's own arithmetic.
  const entries = [...left, { kind: "focus", card: model }, ...right];
  // The index the revealed tier starts at, which is also where the button sits
  // between the two tiers. A revealed card keeps its true row index: there is no
  // second index space and so nothing to translate between them.
  const revealIndex = left.length + right.length + 1;
  const slots = [];
  const frames = new Array(entries.length + more.length);
  let revealed = false;

  const buildSlot = (entry, index) => {
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
    slots[index] = slot;
    return slot;
  };

  /**
   * The button that opens the revealed tier. It is appended to the overlay
   * rather than to the row, and the stylesheet pins it to the right edge of the
   * screen as a faded strip: it holds no card, so it must not read as one more
   * card, and it is outside the row's layout, so the row's geometry cannot
   * depend on it. The click that opens the tier is attached further down.
   */
  const buildReveal = () => {
    // A div rather than a button on purpose: the page styles every `button`
    // element globally, and none of that chrome belongs on a fade.
    const button = document.createElement("div");
    button.className = "card-detail-reveal";
    const label = document.createElement("span");
    label.className = "card-detail-reveal-label";
    label.textContent = "Show more";
    const arrow = document.createElement("span");
    arrow.className = "card-detail-reveal-arrow";
    arrow.textContent = ">";
    button.append(label, arrow);
    root.appendChild(button);
    return button;
  };
  const revealButton = more.length > 0 ? buildReveal() : null;
  entries.forEach(buildSlot);

  /**
   * Mount one row entry's card. A card fits two blocks of text and mounts about
   * ten tooltips, so this is the row's real cost.
   */
  const mountEntry = async (entry, index) => {
    const isFocus = entry.kind === "focus";
    await loadComponent(slots[index].firstElementChild, "card-vertical", isFocus && unit
      ? { unit, isSmall: false, onAbilityClick: abilityClick }
      : { card: isFocus ? model : entry.card, isSmall: false });
    frames[index] = slots[index].querySelector(".card-vertical-frame");
  };

  // The focus card alone is enough to open with: it is what the entrance zoom
  // flies from the source card, and it hides every side card while they are
  // parked behind it. Building the whole row first left the reader looking at
  // nothing for the length of about eleven card mounts, so the focus card is
  // built now and the rest are mounted once the row is already on screen. The
  // secondary tier is not mounted even then: it is built when the reader asks
  // for it.
  await mountEntry(entries[focusIndex], focusIndex);

  // Slot geometry at scale 1. The stylesheet owns the slot's size and its
  // overlap, and every row offset below is derived from these numbers rather
  // than re-read from layout, because the slots and the cards inside them are
  // both transitioning and a measurement taken mid-flight reports the layout
  // that is leaving.
  //
  // Every number here is asked of the browser in the unit the layout works in,
  // pixels. Nothing is converted between rem and pixels by hand, and nothing
  // assumes the slot's font size is the root's: a declaration says `30rem` and
  // the browser is the only thing that knows what that comes to, so the answers
  // are read back through their computed style. Doing that arithmetic here is
  // what put the focused card 40px off centre on every card, because on the
  // machine it was tested on the numbers did not line up that way.
  const slotStyle = getComputedStyle(slots[0]);
  const px = (value) => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const scaleOf = (element) => {
    const scale = Number.parseFloat(getComputedStyle(element).getPropertyValue("--s"));
    return Number.isFinite(scale) && scale > 0 ? scale : 1;
  };
  /**
   * The slot's own inline margin, in pixels. `margin-inline` is shorthand for
   * two longhands, and which of them a browser reports for a single
   * `margin-inline` declaration is not something to build arithmetic on, so
   * both are read and the larger wins.
   */
  const inlineMarginOf = (element) => {
    const style = getComputedStyle(element);
    return Math.max(
      Math.abs(px(style.marginInlineStart) || px(style.marginLeft)),
      Math.abs(px(style.marginInlineEnd) || px(style.marginRight))
    );
  };

  // The slot's footprint at scale 1, taken from the width the browser resolved
  // for it while `--s` is unset. This is the one live read in the whole
  // geometry, and it cannot be mid-flight: with no `--s` there is no scale to be
  // part way through.
  const slotWidth = slots[0].getBoundingClientRect().width;
  const slotScale = scaleOf(slots[0]);
  const cardWidth = slotWidth > 0 ? slotWidth / slotScale : 0;

  // The leading edge of the first slot, relative to the row's left edge: its own
  // negative margin, one side's worth.
  const marginPerSide = Math.abs(inlineMarginOf(slots[0]));
  const slotInset = -marginPerSide;
  // Two neighbours overlap by twice one side's margin, because the margin sits on
  // the end of one slot and on the start of the next. Counting it once is a
  // silent 2.5rem error in every offset.
  const slotOverlap = marginPerSide * 2;
  const baseAdvance = cardWidth - slotOverlap;
  // The card's height comes from the same declaration as its width, at the same
  // scale, so it is the width's ratio rather than a second guess.
  const cardHeight = cardWidth * (45 / 30);

  // What the row was built with, on the element itself: the overlay's geometry
  // is arithmetic over these numbers, so a row that comes out off centre is a
  // question of which numbers it used, and they are not otherwise visible.
  row.dataset.geometry = JSON.stringify({
    cardWidth,
    cardHeight,
    marginPerSide,
    slotOverlap,
    baseAdvance,
    slotInset,
    slotScale,
    viewportWidth: window.innerWidth,
  });

  // Focus state: which slot is focused. Changing focus only re-grades scales,
  // z-indexes, and the row offset — the list itself never rebuilds.
  let focusSlotIndex = focusIndex;
  /**
   * Whether this overlay is still the open one. Declared here because the
   * reveal needs it after its own awaits, and an overlay closed during a mount
   * must not be written to afterwards.
   */
  const stillOpen = () => active?.root === root;

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

    // Only the card in focus may be turned over, and a card that was showing its
    // back returns to its front when the focus leaves it: a back belongs to the
    // card being read, not to a card shrinking into the row. Placing a card is
    // not a turn, so this is done without one.
    slots.forEach((slot, index) => {
      const focused = index === focusSlotIndex;
      setCardFlipClickable(slot, focused);
      if (!focused) resetCardFlip(slot);
    });
  };
  const setFocus = (index) => {
    // Every index in the row is a card, so the focus simply lands on one. A
    // revealed card keeps its true index, which is what makes one step one card.
    focusSlotIndex = Math.max(0, Math.min(slots.length - 1, index));
    unparkSides();
    applyFocus();
  };
  // Card-link navigation: move the focus to the row entry for a card. A card
  // still behind the reveal is not in the row yet, so it cannot be focused:
  // the link opens its own overlay instead, which is what a link to any card
  // outside the row already does.
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

  /**
   * Open the revealed tier: the button gives up its place to the cards it stood
   * for, which travel out from where it sat. The cards and their slots are built
   * here, so nothing in the tier exists before the reader asks for it and no row
   * position is ever filled twice.
   *
   * The focus takes the first of them, so the row centres on a real card. That
   * card takes the index the button stood in front of, which is why the focus can
   * simply name it.
   */
  const revealMore = async () => {
    if (!revealButton || revealed) return;
    revealed = true;
    // The button leaves now, in the frame its click arrives in, and the tier's
    // first card takes its place as it goes. Removing it before the cards mount
    // is what makes the substitution the reader asked for: the position is never
    // empty and the button is never still there beside its own answer.
    revealButton.remove();

    const secondary = more.map((entry, offset) => ({ entry, index: revealIndex + offset }));
    const fresh = secondary.map(({ entry, index }) => {
      const slot = buildSlot(entry, index);
      // hidden until the cards are in: the row is laid out, so the new slots hold
      // their places, but nothing is painted at a size the mount has not settled
      slot.style.visibility = "hidden";
      return slot;
    });

    try {
      await Promise.all(
        secondary.map(async ({ entry, index }) => {
          await mountEntry(entry, index);
          const cardId = entry.card?.cardId;
          if (cardId != null && !slotByCardId.has(cardId)) slotByCardId.set(cardId, index);
        })
      );
    } catch (error) {
      // the button is already out of the row, so a failed card mount leaves a
      // short row rather than a button that cannot be pressed again
      console.error(`Card detail reveal failed to mount: ${error.message}`);
    }
    if (!active || active.root !== root) return;

    // The revealed cards travel in from the strip they were behind, which is a
    // fixed point on the right edge rather than a place in the row, so the
    // travel reads as the row continuing into the space the strip marked.
    const animate = !prefersReducedMotion();
    // The fade covers the screen's right edge, so the cards behind it are beyond
    // that edge: they travel in from off-screen rather than from the middle of
    // the fade.
    const entryEdge = () => window.innerWidth;
    for (const slot of fresh) {
      slot.style.visibility = "";
      if (animate) {
        const rect = slot.getBoundingClientRect();
        slot.animate(
          [
            { transform: `translateX(${entryEdge() - (rect.left + rect.width / 2)}px)`, opacity: 0 },
            { transform: "translateX(0px)", opacity: 1 },
          ],
          { duration: SIDE_MOTION_MS, easing: "ease-out" }
        );
      }
    }
    // The opening park's offsets were measured for the slots the row had then,
    // so they are abandoned with the reveal rather than run over cards that
    // arrived after them. `unparkSides` is what clears the park's inline
    // transforms and opacities and drops the flag itself; clearing the flag
    // first made it return immediately and left every side card hidden behind
    // the focus, which is what happened when the tier was opened during the
    // entrance.
    unparkSides();
    // the first of the new cards stands exactly where the button stood, so the
    // reader keeps their place and the focus lands on the card that replaced it
    setFocus(revealIndex);
  };

  // Motion of the cards beside the focus. They wait parked at the focus slot's
  // centre, where the focus card hides them (every side card is smaller than
  // it), and travel to their own slots together once the focus card has
  // finished expanding, their tags fading in as they emerge. Closing runs it
  // backwards, so the cards return behind the focus card before it shrinks
  // away. A focus change abandons the park: the row must never animate cards
  // from a position the row has already left.
  // The slots the opening parks and travels: every slot the row has except the
  // focused one. Captured once rather than read back from the row, because a
  // reveal replaces the button with cards, and a detached element left in this
  // set would be measured as a zero rectangle.
  const sideSlots = slots.filter((slot, index) => index !== focusIndex);
  /**
   * A slot's relation tag, or null where it has none. The reveal slot states an
   * action rather than a relation, so it carries no tag, and every park, travel,
   * and close below has to leave it out: on a card whose relations are all in the
   * revealed tier it is the only side slot there is.
   */
  const tagOf = (slot) => slot?.querySelector(".card-detail-tag") ?? null;
  const sideTags = sideSlots.map(tagOf);
  /**
   * Every slot except the one focused right now, with its tag. Closing recomputes
   * this rather than reusing the opening set: once the focus has moved, the
   * focused slot is no longer the one it parked around, and hiding it would make
   * its own exit animation play on an invisible card.
   */
  const besideFocus = () =>
    slots
      .filter((_, index) => index !== focusSlotIndex)
      .map((slot) => ({ slot, tag: tagOf(slot) }));
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
    for (const tag of sideTags) if (tag) tag.style.opacity = "0";
    parked = true;
  };
  const unparkSides = () => {
    if (!parked) return;
    parked = false;
    for (const slot of sideSlots) {
      slot.style.transform = "";
      slot.style.opacity = "";
    }
    for (const tag of sideTags) if (tag) tag.style.opacity = "";
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
      if (!tag) continue;
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

  // The button's own click opens the tier, which is the only thing that opens
  // it: it is not a slot, so the focus cannot reach it and nothing else can
  // press it.
  if (revealButton) {
    revealButton.addEventListener("click", (event) => {
      event.stopPropagation();
      void revealMore();
    });
  }

  // The rest of the row mounts behind the focus card while it is flying out. They
  // are parked at the focus slot's centre and invisible there, so nothing the
  // reader sees depends on them, and the row's geometry never does: the slots are
  // sized by the stylesheet. Queued so this turn ends first, which is what lets
  // the entrance start in the frame the overlay appears in. The secondary tier is
  // deliberately absent: it has no slots and no entries until the reader opens
  // it.
  queueMicrotask(() => {
    void Promise.all(
      entries.map((entry, index) => {
        if (index === focusIndex) return null;
        return mountEntry(entry, index);
      })
    ).catch((error) => console.error(`Card detail row failed to mount: ${error.message}`));
  });

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
