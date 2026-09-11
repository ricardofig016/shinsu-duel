import { loadComponent } from "/utils/component-util.js";
import { buildCardViewModel } from "/game/viewModels.js";
import { mountCardGrid } from "/utils/card-grid.js";
import { wireCatalogToolbar } from "/utils/catalog-toolbar.js";
import {
  DEFAULT_SORT_KEY,
  artworkDisplayName,
  decodeState,
  encodeState,
  normalizeCriteria,
} from "/utils/card-browse.js";

const ORPHAN_SORT_KEY = DEFAULT_SORT_KEY; // artworks have no cost; always sort by name

const state = {
  dev: false,
  grids: [], // [{ views, show({ criteria, sortKey }) }] — one per section
  criteria: normalizeCriteria(null),
  sortKey: DEFAULT_SORT_KEY,
};

const debounce = (fn, delayMs) => {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  };
};

const showFailure = (message) => {
  const error = document.getElementById("cards-error");
  error.innerText = message;
  error.classList.remove("hidden");
};

const populateSections = async ({ cards, testCards = [], orphanArtworks = [] }) => {
  const orphanViews = orphanArtworks.map((orphan) =>
    buildCardViewModel({
      cardId: `artwork:${orphan.name}`,
      type: null,
      kind: null,
      name: artworkDisplayName(orphan.name),
      sobriquet: null,
      artworkPath: orphan.artworkPath,
      cost: 0,
    })
  );

  const specs = [{ gridId: "cards-grid", countId: "cards-count", views: cards }];
  if (state.dev) {
    specs.push({ gridId: "test-cards-grid", countId: "test-cards-count", views: testCards });
    specs.push({
      gridId: "artworks-grid",
      countId: "artworks-count",
      views: orphanViews,
      fixedSortKey: ORPHAN_SORT_KEY,
    });
    document.getElementById("test-cards-section").classList.remove("hidden");
    document.getElementById("artworks-section").classList.remove("hidden");
  }

  state.grids = [];
  for (const spec of specs) {
    state.grids.push(
      await mountCardGrid({
        gridElement: document.getElementById(spec.gridId),
        countElement: document.getElementById(spec.countId),
        views: spec.views,
        fixedSortKey: spec.fixedSortKey ?? null,
      })
    );
  }
};

const syncUrl = () => {
  const params = encodeState(state.criteria, state.sortKey);
  if (state.dev) params.set("dev", "true");
  const query = params.toString();
  window.history.replaceState(null, "", query === "" ? "/cards" : `/cards?${query}`);
};

const render = () => {
  for (const grid of state.grids) {
    grid.show({ criteria: state.criteria, sortKey: state.sortKey });
  }
};

const onControlChange = () => {
  state.criteria = toolbar.readCriteria();
  state.sortKey = toolbar.readSortKey() ?? state.sortKey;
  syncUrl();
  render();
};

const toolbar = wireCatalogToolbar({
  elements: {
    search: document.getElementById("card-search"),
    type: document.getElementById("filter-type"),
    kind: document.getElementById("filter-kind"),
    rank: document.getElementById("filter-rank"),
    costMin: document.getElementById("cost-min"),
    costMax: document.getElementById("cost-max"),
    sort: document.getElementById("sort-select"),
    facets: {
      affiliations: document.getElementById("filter-affiliations"),
      traits: document.getElementById("filter-traits"),
      positions: document.getElementById("filter-positions"),
    },
  },
  onChange: onControlChange,
});

document.addEventListener("DOMContentLoaded", async () => {
  await loadComponent(document.getElementById("navbar-component"), "navbar");

  const params = new URLSearchParams(window.location.search);
  state.dev = params.get("dev") === "true";
  const decoded = decodeState(params);
  state.criteria = normalizeCriteria(decoded.criteria);
  state.sortKey = decoded.sortKey;

  let payload;
  try {
    const response = await fetch(state.dev ? "/cards/data?dev=true" : "/cards/data");
    if (!response.ok) throw new Error(`/cards/data responded ${response.status}`);
    payload = await response.json();
  } catch (error) {
    console.error(error);
    showFailure("Failed to load the cards. Please try again later.");
    return;
  }

  await populateSections({
    cards: (payload.cards ?? []).map(buildCardViewModel),
    testCards: (payload.testCards ?? []).map(buildCardViewModel),
    orphanArtworks: payload.orphanArtworks ?? [],
  });
  toolbar.populateFacetOptions(state.grids.flatMap((grid) => grid.views));
  toolbar.populateSortOptions();
  toolbar.applyState({ criteria: state.criteria, sortKey: state.sortKey });

  for (const section of document.querySelectorAll(".cards-section")) {
    section.querySelector("h2").addEventListener("click", () => section.classList.toggle("collapsed"));
  }

  syncUrl();
  render();
});
