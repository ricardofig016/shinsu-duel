/**
 * Linked-text rendering for compiled display segments.
 *
 * The single projection from segments (public/utils/card-text.js) into DOM:
 * plain strings become text nodes, and link segments become highlighted
 * spans whose behavior is keyed by target type. Everything is built with
 * createElement/createTextNode — never markup strings — so authored card
 * text can never inject markup.
 *
 * Link behavior:
 *
 * - **card** links are clickable: clicking one moves the card detail
 *   overlay's focus when it is open, and opens the overlay for that card on
 *   every other surface.
 * - every link carries a lazy hover tooltip built from server-owned data:
 *   card links show a mini card preview (the card face rendered through
 *   card-vertical) with no tooltip chrome of its own, condition/trait/
 *   attribute/position links their name and
 *   compiled prose from the shared data catalogs (which carries its own
 *   inline links), keyword/trigger/rule/rank links the glossary copy, and
 *   series/affiliation links the list of cards in that group (computed from
 *   the card catalog). Tooltip entries come from the shared builders in
 *   `public/utils/tooltip-entries.js`, so catalog prose renders identically
 *   wherever it appears. A fetch failure
 *   degrades to no tooltip; the link itself still renders.
 */

import { loadComponent, mountTooltip } from "/utils/component-util.js";
import { getGlossary } from "/utils/glossary.js";
import { getCardCatalog } from "/utils/card-catalog.js";
import { buildCardViewModel } from "/game/viewModels.js";
import { buildCatalogTooltipEntries } from "/utils/tooltip-entries.js";
import { openCardDetail, isCardDetailOpen, focusCardDetail } from "/components/card-detail-overlay/script.js";

// The data catalogs a link's hover copy comes from; each fetches once per
// page load.
const CATALOG_ROUTES = Object.freeze({
  condition: "/conditions/",
  trait: "/traits/",
  attribute: "/attributes/",
  position: "/positions/",
});

let dataCatalogsPromise = null;
const getDataCatalogs = () => {
  if (!dataCatalogsPromise) {
    dataCatalogsPromise = Promise.all(
      Object.values(CATALOG_ROUTES).map((path) =>
        fetch(path).then((response) => (response.ok ? response.json() : {}))
      )
    ).then(([conditions, traits, attributePayload, positions]) => ({
      condition: conditions,
      trait: traits,
      attribute: attributePayload,
      position: positions,
    }));
  }
  return dataCatalogsPromise;
};

/**
 * Card-link click navigation: move the open carousel's focus to the card,
 * or open the overlay for it on every other surface.
 */
const navigateToCard = async (segment, source) => {
  const catalog = await getCardCatalog().catch(() => null);
  const view = catalog?.bySlug.get(segment.ref);
  if (!view) return;
  if (isCardDetailOpen() && focusCardDetail(view.cardId)) return;
  await openCardDetail({ source, card: buildCardViewModel(view) });
};

/**
 * Off-screen host for building card previews. A card fits its own text while
 * it renders, so it has to be rendered itself: a detached card measures zero
 * everywhere, keeps its text at full size, and shows the last lines clipped.
 * The preview is built here, laid out but never painted, and the tooltip that
 * receives it takes the element out of this host.
 */
let previewHost = null;
const offscreenHost = () => {
  if (!previewHost) {
    previewHost = document.createElement("div");
    previewHost.className = "card-text-preview-host";
    document.body.appendChild(previewHost);
  }
  return previewHost;
};

/** Hover copy for one link segment, or null when the target is unknown. */
async function buildLinkHover(segment) {
  if (segment.type === "card") {
    const catalog = await getCardCatalog().catch(() => null);
    const view = catalog?.bySlug.get(segment.ref);
    if (!view) return null;
    const host = document.createElement("div");
    host.className = "card-text-link-preview";
    offscreenHost().appendChild(host);
    await loadComponent(host, "card-vertical", { card: buildCardViewModel(view), isSmall: true });
    // suppress the hand-hover zoom: a preview is read, not interacted with
    host.querySelector(".card-vertical-frame")?.classList.add("no-hover");
    // bare: the card face is the whole tooltip, so the frame adds no chrome
    return { bare: true, title: view.name, entries: [{ node: host }] };
  }

  if (segment.type === "series" || segment.type === "affiliation") {
    const catalog = await getCardCatalog().catch(() => null);
    if (!catalog) return null;
    const key = segment.type === "series" ? "series" : "affiliations";
    const members = [...catalog.byId.values()]
      .filter((view) => (key === "series" ? view.series === segment.ref : view.affiliations?.[segment.ref]))
      .map((view) => view.name);
    if (members.length === 0) return null;
    return { title: `${segment.text}`, entries: members.map((name) => ({ text: name })) };
  }

  if (segment.type === "keyword" || segment.type === "trigger" || segment.type === "rule") {
    const glossary = await getGlossary().catch(() => null);
    const section =
      segment.type === "keyword"
        ? glossary?.keywords
        : segment.type === "trigger"
          ? glossary?.triggers
          : glossary?.terms;
    const entry = section?.[segment.ref];
    if (!entry) return null;
    return { title: entry.name, entries: buildCatalogTooltipEntries(entry) };
  }

  if (segment.type === "rank") {
    const glossary = await getGlossary().catch(() => null);
    const entry = glossary?.ranks?.list?.find(
      (rank) => rank.code === segment.ref || rank.name?.toLowerCase() === segment.ref
    );
    if (!entry) return null;
    const entries = buildCatalogTooltipEntries(entry);
    if (entry.minCost != null && entry.maxCost != null) {
      entries.push({ text: `Cost range: ${entry.minCost}-${entry.maxCost}` });
    }
    return { title: entry.name, entries };
  }

  const catalogPath = CATALOG_ROUTES[segment.type];
  if (!catalogPath) return null;
  const catalogs = await getDataCatalogs().catch(() => null);
  const entry = catalogs?.[segment.type]?.[segment.ref];
  if (!entry) return null;
  return { title: entry.name, entries: buildCatalogTooltipEntries(entry) };
}

/**
 * Wire one link span's lazy hover tooltip: built on first hover, removed on
 * leave, so re-rendered text can never leak tooltip nodes. The tooltip mounts
 * through the shared tooltip layer, exactly like every other hover surface.
 *
 * The component reveals itself on `mouseover` and follows `mousemove`, but a
 * lazily built tooltip attaches those listeners only after its markup loads,
 * long after the hover that requested it. The pointer position is tracked so
 * the component's own handlers can be replayed once it exists, in the order a
 * real hover produces: the reveal first, so the frame has a box to measure
 * before the move decides where to put it. Without the replay the tooltip
 * stays in the DOM with `display: none`; out of order it lands on the cursor
 * with a zero height.
 */
const wireLinkHover = (span, segment) => {
  let pending = null;
  let pointer = { x: 0, y: 0 };
  span.addEventListener("mousemove", (event) => {
    pointer = { x: event.clientX, y: event.clientY };
  });
  span.addEventListener("mouseenter", async (event) => {
    if (pending) return;
    pointer = { x: event.clientX, y: event.clientY };
    const state = { cancelled: false, tooltip: null };
    pending = state;
    const payload = await buildLinkHover(segment).catch(() => null);
    if (!payload || state.cancelled || !span.isConnected) {
      // a payload that never reaches a tooltip would leave its built nodes behind
      for (const entry of payload?.entries ?? []) entry.node?.remove();
      pending = null;
      return;
    }
    const { element, loaded } = mountTooltip(span, {
      title: payload.title,
      textList: payload.entries,
      bare: payload.bare === true,
    });
    state.tooltip = element;
    await loaded;
    if (state.cancelled) {
      element.remove();
      return;
    }
    span.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    span.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: pointer.x, clientY: pointer.y }));
  });
  span.addEventListener("mouseleave", () => {
    if (!pending) return;
    pending.tooltip?.remove();
    pending.cancelled = true;
    pending = null;
  });
};

/**
 * Render display segments into a DOM fragment: plain text nodes, and link
 * segments as highlighted spans. Card links navigate (carousel focus or
 * overlay open); `onCardLink(segment, sourceElement)` overrides the default
 * navigation where a surface needs its own behavior.
 *
 * @param {Array<string | { type: string, ref: string, text: string }>} segments
 * @param {{ onCardLink?: (segment: object, source: Element) => void }} [options]
 * @returns {DocumentFragment}
 */
export function renderSegments(segments, { onCardLink = null } = {}) {
  const fragment = document.createDocumentFragment();
  for (const segment of segments ?? []) {
    if (typeof segment === "string") {
      if (segment !== "") fragment.appendChild(document.createTextNode(segment));
      continue;
    }
    if (!segment || typeof segment !== "object") continue;
    const span = document.createElement("span");
    span.className = `card-text-link card-text-link-${segment.type}`;
    span.textContent = segment.text;
    wireLinkHover(span, segment);
    if (segment.type === "card") {
      span.classList.add("card-text-link-clickable");
      span.addEventListener("click", (event) => {
        event.stopPropagation();
        if (onCardLink) onCardLink(segment, span);
        else navigateToCard(segment, span);
      });
    }
    fragment.appendChild(span);
  }
  return fragment;
}
