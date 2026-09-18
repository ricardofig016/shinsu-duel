import loadNavbar from "/components/navbar/script.js";
import loadTooltip from "/components/tooltip/script.js";
import loadUnitCardHorizontal from "/components/unit-card-horizontal/script.js";
import loadCardVertical from "/components/card-vertical/script.js";
import loadCardDetailOverlay from "/components/card-detail-overlay/script.js";
import { isStaleTooltip } from "/utils/tooltip-lifetime.js";

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
 */
const sheetAlreadyApplied = (link) =>
  [...document.styleSheets].some(
    (sheet) =>
      !sheet.disabled &&
      sheet.href === link.href &&
      (sheet.media?.mediaText ?? "") === (link.media ?? "")
  );

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
 * subtree, and a body-mounted tooltip is not in it. A page that opens and
 * closes the overlay mounts a tooltip per card face each time, so a tooltip
 * whose target has left the document is dropped as soon as the next one
 * mounts. That keeps at most one dead host alive, and the layer never grows
 * past the tooltips of the surfaces currently on the page.
 */
const mountedTooltips = new Set();

const pruneTooltips = () => {
  for (const tooltip of [...mountedTooltips]) {
    const targetConnected = tooltip.target.isConnected;
    if (targetConnected) tooltip.attached = true;
    if (!isStaleTooltip({ settled: tooltip.settled, attached: tooltip.attached, targetConnected })) continue;
    tooltip.element.remove();
    mountedTooltips.delete(tooltip);
  }
};

/**
 * Mount one tooltip for `hoverContainer` and start loading it. Returns the
 * tooltip element — already in the document, so a caller that has to remove it
 * early (a hover that ended while the tooltip was still loading) can — with
 * the load itself as `loaded`. `options` are the tooltip component's, minus
 * the hover target: `title`, `textList`, `iconPath`, and `bare`.
 */
export const mountTooltip = (hoverContainer, options = {}) => {
  pruneTooltips();
  const element = document.createElement("div");
  element.classList.add("tooltip-component");
  document.body.appendChild(element);
  const mounted = { target: hoverContainer, element, settled: false, attached: hoverContainer.isConnected };
  mountedTooltips.add(mounted);
  const loaded = loadComponent(element, "tooltip", { ...options, hoverContainer });
  // the settled mark is bookkeeping for the prune pass; the caller still owns
  // the load's rejection
  loaded
    .finally(() => {
      mounted.settled = true;
    })
    .catch(() => {});
  return { element, loaded };
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
