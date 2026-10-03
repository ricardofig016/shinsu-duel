import { prefersReducedMotion } from "./component-util.js";

/**
 * Turning a vertical card over.
 *
 * The card's back face is markup the card component renders; this module owns
 * what happens when someone asks for it, so the card, the card detail overlay,
 * and the board all turn a card over the same way. Nothing here authors copy.
 *
 * A card has a front and one or more back faces. A back face carries as many of
 * the card's sections as it can read, and a click turns to the next one, so no
 * card's information has to be cut down to fit a single face; the click after
 * the last back face returns to the front. Every one of those turns is the same
 * turn, and the face being turned to is drawn while the card is edge-on.
 *
 * The turn is explicit motion on the frame's own `rotate` property rather than
 * a CSS transition, because a host may switch transitions off: the card detail
 * overlay does exactly that so its cards land in place instead of sliding in
 * from the row's left edge on open, which is what left the big card snapping
 * edge-on in one frame while the small card animated. Being the frame's own
 * property, the turn also composes with whatever transform the host put on the
 * frame — the hand fan's tilt and the overlay slot's scale both survive it.
 */

/** Milliseconds of one half turn; the face swaps at the edge-on point. */
const FLIP_HALF_MS = 110;
/** The frame's rotation, as the animation drives it. */
const EDGE_ON = "y 90deg";
const FACE_ON = "y 0deg";

const frameOf = (container) => container.querySelector(".card-vertical-frame");

/**
 * The list the back's sections live in, which is also what tells a card with a
 * back from one without: an empty one means there is nothing to turn over for.
 * The list holds the whole card's sections as soon as the card is rendered,
 * whether or not a face has been divided yet, so a card's back is known to
 * exist before anything has been measured.
 */
const backSectionsOf = (container) => frameOf(container)?.querySelector(".card-vertical-back-sections") ?? null;

/** Whether the card has anything to turn over for. */
const hasBack = (container) => (backSectionsOf(container)?.childElementCount ?? 0) > 0;

/** Whether the card in this container is currently showing a back face. */
export const isCardFlipped = (container) => frameOf(container)?.classList.contains("card-vertical-flipped") ?? false;

/** The back face the card would show, 1-based. The card component divides them. */
const currentBackPage = (container) => container.__backPage ?? 1;

/**
 * Put the card back on its front face, on the first back face, with no turn.
 * This is for a host that is placing the card somewhere new rather than turning
 * it, so the card arrives on the face its reader expects instead of inheriting
 * whatever a previous reader left it showing.
 */
export const resetCardFlip = (container) => {
  const frame = frameOf(container);
  if (!frame || frame.dataset.flipping === "true") return;
  frame.classList.remove("card-vertical-flipped");
  container.__backPage = 1;
  container.__renderBackPage?.(1);
};

/**
 * Draw the face the turn is landing on, and say which side that is. `page` is
 * stored even when the card lands on its front: the front is not a face of the
 * back, so the card has to remember that its back starts again from the first
 * face rather than where the last reading stopped. Landing on the front draws
 * the first face, which is what settles the face counter the reader sees next.
 */
const landOn = (container, frame, { page, back }) => {
  // the side is settled before the face is drawn: drawing a back face divides
  // the card's sections, and a face that is not being shown cannot be measured
  frame.classList.toggle("card-vertical-flipped", back);
  container.__backPage = page;
  container.__renderBackPage?.(page, true);
};

/**
 * Rotate the frame edge-on, run `atEdge`, then rotate back. `atEdge` runs while
 * the card is edge-on so the swap happens where nothing can be seen of either
 * face. Resolves once the turn is over.
 */
const turn = (frame, atEdge) => {
  if (prefersReducedMotion() || typeof frame.animate !== "function") {
    atEdge();
    return Promise.resolve();
  }
  // a turn is the only thing that may rotate the frame: whatever a previous one
  // left behind is dropped first
  for (const animation of frame.getAnimations()) animation.cancel();
  frame.dataset.flipping = "true";
  const half = (from, to) =>
    frame.animate([{ rotate: from }, { rotate: to }], {
      duration: FLIP_HALF_MS,
      easing: "ease-in-out",
      fill: "forwards",
    });
  const out = half(FACE_ON, EDGE_ON);
  return out.finished
    .catch(() => {})
    .then(() => {
      atEdge();
      return half(EDGE_ON, FACE_ON).finished.catch(() => {});
    })
    .then(() => {
      for (const animation of frame.getAnimations()) animation.cancel();
      delete frame.dataset.flipping;
    });
};

/**
 * Turn to the card's next face: the next back face, or the front when the back
 * has been read to its end. Every turn is the same turn.
 *
 * @param {HTMLElement} container the card component's container
 * @param {{ animate?: boolean }} [options] `animate: false` swaps instantly
 * @returns {boolean|null} whether a back face is now showing, or null when the
 *   card cannot turn (it has no back) or when a click lands mid-turn
 */
export const toggleCardFlip = (container, options) => {
  const frame = frameOf(container);
  if (!frame || !hasBack(container)) return null;
  if (frame.dataset.flipping === "true") return null;
  // The face is decided before the turn, so an interrupted turn can never leave
  // the face index and the class disagreeing. How many faces the back has is
  // only known once it has been measured, and the card component writes that
  // count back while it divides them; a card whose count is not written yet is
  // treated as having the face it is about to show, so the first turn always
  // lands on a back face.
  const showingBack = frame.classList.contains("card-vertical-flipped");
  const known = Number(frame.dataset.backPages ?? "0");
  const nextPage = showingBack ? currentBackPage(container) + 1 : currentBackPage(container);
  const stayingOnBack = known === 0 || nextPage <= known;
  // Returning to the front also returns the back to its first face: the card's
  // reader starts the back again next time instead of arriving on the face the
  // last reading ended on, which would put every earlier face out of reach.
  const landing = stayingOnBack
    ? { page: nextPage, back: true }
    : { page: 1, back: false };
  if (options?.animate === false || prefersReducedMotion()) {
    landOn(container, frame, landing);
    return stayingOnBack;
  }
  void turn(frame, () => landOn(container, frame, landing));
  return stayingOnBack;
};

/**
 * Whether a left click turns the card over. A host that owns the click (a pool
 * card that adds a copy, a deck fan inside a clickable row, a hover preview)
 * turns it off; the card detail overlay turns it on for the card in focus only.
 */
export const setCardFlipClickable = (container, clickable) => {
  const frame = frameOf(container);
  if (frame) frame.dataset.flipClickable = clickable ? "true" : "false";
};

/**
 * Put the back of every card away except the frame this click landed on. A back
 * is something the reader asked to see for a moment, not a state a card keeps,
 * so clicking anywhere else puts it away. Wired once, on the document, so it
 * covers every surface a card can be mounted on.
 *
 * @param {EventTarget|null} except the frame whose own click is being handled
 * @returns {number} how many cards were turned back
 */
export const resetAllCardFlips = (except = null) => {
  let reset = 0;
  for (const frame of document.querySelectorAll(".card-vertical-frame.card-vertical-flipped")) {
    if (frame === except || frame.dataset.flipping === "true") continue;
    const container = frame.closest(".card-vertical-component") ?? frame.parentElement;
    if (!container) continue;
    reset += 1;
    resetCardFlip(container);
  }
  return reset;
};

/**
 * Wire the card's own click to the turn. A click on an ability line is a play
 * rather than a card turn, so it is left to that line's own handler; card links
 * stop their own propagation and never reach here.
 */
export const wireCardFlipClick = (container) => {
  const frame = frameOf(container);
  if (!frame) return;
  frame.addEventListener("click", (event) => {
    if (event.button !== 0) return;
    if (frame.dataset.flipClickable === "false") return;
    if (event.target?.closest?.(".card-vertical-text li.clickable")) return;
    toggleCardFlip(container);
  });
};

/**
 * Mark the one card under the pointer, so its hover styling is the card's own
 * state rather than the browser's.
 *
 * A card that turns paints nothing while it is edge-on, so it stops being the
 * element under the pointer: its `:hover` is cleared on the way through, and the
 * browser does not hit-test again until the pointer moves. A host that lays its
 * cards out calls this once and the card keeps the hover it had.
 *
 * The card already marked keeps the mark while the pointer is inside it, because
 * a card's hovered size overflows the space it has in the layout and therefore
 * covers its neighbours: without that rule, moving the pointer within a grown
 * card and releasing near its edge handed the mark to a card underneath and left
 * the first stuck at its grown size.
 *
 * The cards' resting boxes are read once, when the mark moves, rather than on
 * every pointer event: a grid of a hundred cards would otherwise pay a hundred
 * layout reads per movement, which is what made a page of them feel slow while
 * something else was opening over it.
 *
 * @param {HTMLElement} container a host containing card components
 */
export const trackCardHover = (container) => {
  let hovered = null;
  let boxes = null;
  const measure = () =>
    [...container.querySelectorAll(".card-vertical-component")]
      .filter((card) => frameOf(card) && !frameOf(card).classList.contains("hidden"))
      .map((card) => ({ card, rect: card.getBoundingClientRect() }));
  const release = () => {
    hovered?.classList.remove("card-vertical-hovered");
    hovered = null;
  };
  const inside = (rect, event) =>
    event.clientX >= rect.left &&
    event.clientX <= rect.right &&
    event.clientY >= rect.top &&
    event.clientY <= rect.bottom;

  container.addEventListener("mousemove", (event) => {
    // the mark stays where it is while the pointer is still on that card
    if (hovered) {
      const current = boxes?.find((entry) => entry.card === hovered);
      if (current && inside(current.rect, event)) return;
    }
    // The boxes are read before any class moves a card, so the choice of card is
    // the layout's rather than the grown card's own footprint. Only a card the
    // pointer is actually inside may take the mark: falling back to the nearest
    // centre marked the first card of a column whenever the pointer was in the
    // empty space beside it.
    boxes = measure();
    const under = boxes.filter((entry) => inside(entry.rect, event));
    if (under.length === 0) {
      // `release` is a no-op when nothing is marked
      release();
      return;
    }
    let closest = null;
    let closestDistance = Infinity;
    for (const entry of under) {
      const distance = Math.abs(event.clientX - (entry.rect.left + entry.rect.width / 2));
      if (distance >= closestDistance) continue;
      closestDistance = distance;
      closest = entry.card;
    }
    if (closest === hovered) return;
    release();
    if (!closest) return;
    hovered = closest;
    closest.classList.add("card-vertical-hovered");
  });
  container.addEventListener("mouseleave", release);
  // A box read is only good while the layout holds still, and only a scroll of
  // the page or of this host moves these cards. The listeners are deliberately
  // not in capture: a scroll bubbles, so a capture listener here would also catch
  // every nested scroller (the page's own scroll host) and throw the reads away on
  // each of its scroll events, making the next pointer movement pay for the whole
  // grid again.
  const invalidate = () => {
    boxes = null;
  };
  window.addEventListener("resize", invalidate, { passive: true });
  container.addEventListener("scroll", invalidate, { passive: true });
  (container.closest(".allow-scroll") ?? document.scrollingElement)?.addEventListener("scroll", invalidate, {
    passive: true,
  });
};

// Clicking anywhere but the card showing a back puts that back away.
document.addEventListener("click", (event) => {
  resetAllCardFlips(event.target?.closest?.(".card-vertical-frame") ?? null);
});

