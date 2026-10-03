import loadNavbar from "/components/navbar/script.js";
import loadTooltip from "/components/tooltip/script.js";
import loadUnitCardHorizontal from "/components/unit-card-horizontal/script.js";
import loadCardVertical from "/components/card-vertical/script.js";
import loadCardDetailOverlay from "/components/card-detail-overlay/script.js";
import { staleTooltips } from "/utils/tooltip-lifetime.js";

const components = {
  navbar: { load: loadNavbar },
  tooltip: { load: loadTooltip },
  "unit-card-horizontal": { load: loadUnitCardHorizontal },
  "card-vertical": { load: loadCardVertical },
  "card-detail-overlay": { load: loadCardDetailOverlay },
};

/**
 * Whether the document already applies a sheet for this link. A duplicate link
 * to a sheet that is already applied contributes the same rules, so the markup
 * is styled correctly from the moment it is inserted and waiting for that
 * link's own load would only add a task round-trip per component instance. The
 * overlay mounts about ten tooltips per card, which made a ten-card row wait on
 * a hundred of those before its opening animation could start.
 *
 * The answer is cached per link, because a component instance re-links the same
 * sheet: asking meant walking every sheet the document holds, and a ten-card row
 * asked about a hundred times.
 */
let appliedSheets = null;

const keyOf = (href, media) => `${href}|${media ?? ""}`;

const scanAppliedSheets = () => {
  const keys = new Set();
  for (const sheet of document.styleSheets) {
    if (!sheet.disabled) keys.add(keyOf(sheet.href, sheet.media?.mediaText));
  }
  return keys;
};

const sheetAlreadyApplied = (link) => {
  if (!appliedSheets) appliedSheets = scanAppliedSheets();
  const key = keyOf(link.href, link.media);
  if (appliedSheets.has(key)) return true;
  // a sheet that arrived since the cache was built is the only thing that can
  // change the answer, so a miss rescans once rather than reporting stale
  appliedSheets = scanAppliedSheets();
  return appliedSheets.has(key);
};

/**
 * Resolve once every stylesheet the markup just inserted links is applied.
 * `link.sheet` is set as soon as the browser has the sheet's CSSOM, which is
 * when its rules start affecting layout; a sheet still in flight reports null
 * and resolves through its own load or error event. A detached container never
 * starts the fetch, so it resolves instead of blocking the renderer.
 */
const awaitStylesheets = async (container) => {
  const links = [...container.querySelectorAll('link[rel="stylesheet"]')];
  if (!container.isConnected) return;
  await Promise.all(
    links.map(
      (link) =>
        new Promise((resolve) => {
          if (link.sheet || sheetAlreadyApplied(link)) return resolve();
          link.addEventListener("load", resolve, { once: true });
          link.addEventListener("error", resolve, { once: true });
        })
    )
  );
};

/**
 * Load a component's markup into the container and run its renderer.
 * The container must be attached to the document: components that measure
 * their layout while rendering (font fitting, overflow checks) need real
 * geometry, and a detached container measures as zero in every direction.
 *
 * The renderer waits for the component's own stylesheet. Markup arrives with
 * its `<link>`, and freshly inserted markup is laid out unstyled until that
 * sheet loads, so a renderer that measures geometry would measure the wrong
 * tree: the card detail overlay read a full-width unstyled slot as its card
 * width and opened its rows off center.
 */
export const loadComponent = async (container, component, data = null) => {
  if (!components[component] || !container) console.error("Invalid component or container");

  if (!components[component].html) {
    const response = await fetch(`/components/${component}/index.html`);
    components[component].html = await response.text();
  }

  container.innerHTML = components[component].html;
  await awaitStylesheets(container);
  await components[component].load(container, data);
};

/**
 * The page's tooltip layer: every hover tooltip mounts on the body instead of
 * inside the host that owns the hover target.
 *
 * Tooltips float above the surface that hosts them. Inside the card detail
 * overlay a tooltip mounted in its host would sit in that card's slot, which
 * is a stacking context, and any card with a higher z-index would paint over
 * it; on a plain page it would resolve its absolute coordinates against the
 * nearest positioned ancestor rather than the page origin.
 *
 * Mounting on the body costs the host's own cleanup: a host removes its
 * subtree, and a body-mounted tooltip is not in it. The layer therefore watches
 * the document and drops a tooltip whose target has left, in the same task it
 * left in — a host that removes its subtree never fires the `mouseout` that
 * hides the frame, so nothing else would take it off the screen until another
 * tooltip mounted. The layer never grows past the tooltips of the surfaces
 * currently on the page.
 */
const mountedTooltips = new Set();

/**
 * Whether a prune pass was skipped because something in the mounted set was
 * still loading and could not be judged yet. It latches, so the pass is not
 * lost: whichever load settles next runs it.
 */
let pruneDeferred = false;

const pruneTooltips = () => {
  if (mountedTooltips.size === 0) {
    pruneDeferred = false;
    return;
  }
  // a tooltip that is still loading is never dropped, so a pass that meets one
  // has to be repeated once it settles rather than decided on a half-known set
  pruneDeferred = [...mountedTooltips].some((tooltip) => !tooltip.settled);
  for (const tooltip of staleTooltips([...mountedTooltips], (target) => target.isConnected)) {
    tooltip.element.remove();
    mountedTooltips.delete(tooltip);
  }
};

/**
 * Prune on every change to the document, so a target's removal is enough on its
 * own. One observer per page, installed with the first tooltip and kept:
 * pruning is one pass over the mounted set and removes nothing while none of
 * them is stale. Mutation callbacks run once per synchronous DOM change, after
 * it has finished, so a target that a host moved is connected again by the time
 * the rule reads it and its tooltip survives.
 *
 * Overlapping changes coalesce into one pass at the end of the task. A row of
 * cards mounts about ten tooltips each and every one of them changes the
 * document, so a pass per change walked a set of hundreds on each of hundreds of
 * changes; the pass is the same whichever of them runs it, and by the end of the
 * task every removal has already happened.
 */
let documentObserver = null;
let pruneScheduled = false;

const schedulePrune = () => {
  if (pruneScheduled) return;
  pruneScheduled = true;
  queueMicrotask(() => {
    pruneScheduled = false;
    pruneTooltips();
  });
};

const observeTooltipTargets = () => {
  if (documentObserver || typeof MutationObserver !== "function") return;
  documentObserver = new MutationObserver(schedulePrune);
  documentObserver.observe(document.body, { childList: true, subtree: true });
};

/**
 * Mount one tooltip for `hoverContainer` and start loading it. Returns the
 * tooltip element — already in the document, so a caller that has to remove it
 * early (a hover that ended while the tooltip was still loading) can — with
 * the load itself as `loaded`. `options` are the tooltip component's, minus
 * the hover target: `title`, `textList`, `iconPath`, and `bare`.
 */
export const mountTooltip = (hoverContainer, options = {}) => {
  const element = document.createElement("div");
  element.classList.add("tooltip-component");
  document.body.appendChild(element);
  const mounted = { target: hoverContainer, element, settled: false, attached: hoverContainer.isConnected };
  mountedTooltips.add(mounted);
  observeTooltipTargets();
  const loaded = loadComponent(element, "tooltip", { ...options, hoverContainer });
  // A mount is not what makes a tooltip stale — the observer installed above
  // prunes on every change to the document, which is the same task a removed
  // target leaves in. Pruning here as well made every mount walk every mounted
  // tooltip: a card mounts about ten, so a ten-card row walked a set of hundreds
  // on each of about a hundred mounts.
  //
  // What a mount does own is the tooltip that was still loading when its target
  // left: the prune pass cannot drop it yet, so the check is repeated for it once
  // it settles. The settle latch also means a pass skipped then is not lost.
  loaded
    .finally(() => {
      mounted.settled = true;
      if (!mounted.target.isConnected) {
        mounted.element.remove();
        mountedTooltips.delete(mounted);
        return;
      }
      if (pruneDeferred) pruneTooltips();
    })
    .catch(() => {});
  return { element, loaded };
};

/**
 * Drop one mounted tooltip whose hover target is still on the page, which the
 * layer's own rule would keep: the caller knows it is replacing that tooltip
 * (a value its copy carries changed), so the layer must forget it too. Returns
 * whether the element was one of the layer's.
 */
export const releaseTooltip = (element) => {
  for (const tooltip of mountedTooltips) {
    if (tooltip.element !== element) continue;
    mountedTooltips.delete(tooltip);
    tooltip.element.remove();
    return true;
  }
  return false;
};

/**
 * Attach a hover tooltip to `hoverContainer`, resolving when it is ready to
 * show. `iconPath` leads the tooltip; `bare` drops the frame chrome, for a
 * tooltip whose entry node is the whole tooltip (a card link's card face).
 */
export const addTooltip = async (hoverContainer, title, textList, iconPath = null, { bare = false } = {}) => {
  const { element, loaded } = mountTooltip(hoverContainer, { title, textList, iconPath, bare });
  await loaded;
  return element;
};

/**
 * Whether the user asked for reduced motion. Every animation in the shared
 * components respects it, and they read the preference from here so the check
 * has one home.
 */
export const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Shrink the font size of the elements until the caller's overflow test stops
 * firing, starting at `max` em and stepping down to `min`. When the floor is
 * reached and content still overflows, the caller's CSS (ellipsis, clipping)
 * takes over. All sizes are in em relative to each element's parent.
 */
export const fitFontSize = (elements, isOverflowing, { max = 2, min = 0.8, step = 0.2 } = {}) => {
  if (elements.length === 0) return;
  const setFontSize = (size) => {
    for (const element of elements) element.style.fontSize = `${size}em`;
  };
  setFontSize(max);
  let size = max;
  while (size > min && isOverflowing()) {
    size = Math.max(min, size - step);
    setFontSize(size);
  }
};
