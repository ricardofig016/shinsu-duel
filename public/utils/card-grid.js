import { loadComponent } from "./component-util.js";
import { planGrid } from "./card-browse.js";

/**
 * The catalog card grid shared by the cards page and the deck builder.
 *
 * A grid mounts every view's `card-vertical` component exactly once and never
 * re-mounts: syncing only toggles visibility, re-appends elements in display
 * order, and rewrites the count label. A mount measures real layout (text
 * fitting) and is far too expensive to repeat per interaction, so per-card
 * extras added through `decorate` must be updated in place by their owner.
 * The grid element must be attached and visible while mounting.
 */

/**
 * Mount one grid of card views.
 *
 * @param {{
 *   gridElement: HTMLElement,
 *   countElement?: HTMLElement|null,
 *   views: object[],
 *   fixedSortKey?: string,
 *   decorate?: (element: HTMLElement, view: object, mounted: object) => (void|Promise<void>),
 * }} options `decorate` receives each wrapper element after its component
 *   mounted and is the seam for per-card extras (badges, buttons); extras live
 *   inside the wrapper because the wrapper is what syncing hides and moves.
 * @returns {Promise<{ views: object[], byCardId: Map<string|number, { view: object, element: HTMLElement }>, show: (options?: object) => object[] }>}
 *   `show({ criteria, sortKey, predicate, compare })` syncs the grid and
 *   returns the visible views in display order.
 */
export async function mountCardGrid({ gridElement, countElement = null, views, fixedSortKey = null, decorate = null }) {
  const byCardId = new Map();
  await Promise.all(
    views.map(async (view) => {
      const element = document.createElement("div");
      element.classList.add("card-vertical-component");
      gridElement.appendChild(element);
      await loadComponent(element, "card-vertical", { card: view, isSmall: true });
      const mounted = { view, element };
      byCardId.set(view.cardId, mounted);
      if (decorate) await decorate(element, view, mounted);
    })
  );

  return {
    views,
    byCardId,
    show({ criteria = null, sortKey = null, predicate = null, compare = null } = {}) {
      const visible = planGrid(views, { criteria, sortKey, fixedSortKey, compare, predicate });
      const visibleIds = new Set(visible.map((view) => view.cardId));
      for (const view of views) {
        byCardId.get(view.cardId).element.classList.toggle("hidden", !visibleIds.has(view.cardId));
      }
      for (const view of visible) {
        gridElement.appendChild(byCardId.get(view.cardId).element); // reorder
      }
      if (countElement) countElement.innerText = `${visible.length} shown`;
      return visible;
    },
  };
}
