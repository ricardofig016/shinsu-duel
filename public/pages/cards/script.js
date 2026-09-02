import { loadComponent } from "/utils/component-util.js";
import { buildCardViewModel } from "/game/viewModels.js";
import {
  DEFAULT_SORT_KEY,
  SORT_KEYS,
  artworkDisplayName,
  decodeState,
  deriveFacetOptions,
  encodeState,
  filterCards,
  normalizeCriteria,
  sortCards,
} from "/utils/card-browse.js";

const SEARCH_DEBOUNCE_MS = 150;
const ORPHAN_SORT_KEY = DEFAULT_SORT_KEY; // artworks have no cost; always sort by name

const state = {
  dev: false,
  sections: [], // [{ grid, count, sortKey, byCardId: Map<cardId, { view, element }> }]
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

/** Build one mounted card component; the wrapper stays unpositioned so
 * tooltips (document-relative) and the fixed zoom copy behave on this page. */
const createCardElement = async (view) => {
  const element = document.createElement("div");
  element.classList.add("card-vertical-component");
  await loadComponent(element, "card-vertical", { card: view, isSmall: true });
  return { view, element };
};

const createSection = (gridId, countId, views, { fixedSortKey = null } = {}) => {
  const grid = document.getElementById(gridId);
  const count = document.getElementById(countId);
  const byCardId = new Map();
  return { grid, count, fixedSortKey, byCardId, views };
};

const sectionSortKey = (section) => section.fixedSortKey ?? state.sortKey;

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

  const sections = [createSection("cards-grid", "cards-count", cards)];
  if (state.dev) {
    sections.push(createSection("test-cards-grid", "test-cards-count", testCards));
    sections.push(
      createSection("artworks-grid", "artworks-count", orphanViews, { fixedSortKey: ORPHAN_SORT_KEY })
    );
    document.getElementById("test-cards-section").classList.remove("hidden");
    document.getElementById("artworks-section").classList.remove("hidden");
  }

  const mounts = [];
  for (const section of sections) {
    for (const view of section.views) {
      mounts.push(
        createCardElement(view).then((mounted) => {
          section.byCardId.set(view.cardId, mounted);
          section.grid.appendChild(mounted.element);
        })
      );
    }
  }
  await Promise.all(mounts);
  state.sections = sections;
};

const populateSelect = (select, values, anyLabel) => {
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.innerText = value;
    select.appendChild(option);
  }
};

const populateFacetGroup = (fieldsetId, values) => {
  const container = document.querySelector(`#${fieldsetId} .facet-options`);
  container.replaceChildren(
    ...values.map((value) => {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = value;
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(value));
      return label;
    })
  );
  container.closest("fieldset").classList.toggle("hidden", values.length === 0);
};

const populateToolbar = () => {
  const options = deriveFacetOptions(state.sections.flatMap((section) => section.views));
  populateSelect(document.getElementById("filter-type"), options.types, "All types");
  populateSelect(document.getElementById("filter-kind"), options.kinds, "All kinds");
  populateSelect(document.getElementById("filter-rank"), options.ranks, "All ranks");
  populateFacetGroup("filter-affiliations", options.affiliations);
  populateFacetGroup("filter-traits", options.traits);
  populateFacetGroup("filter-positions", options.positions);

  const sortSelect = document.getElementById("sort-select");
  sortSelect.replaceChildren(
    ...SORT_KEYS.map((entry) => {
      const option = document.createElement("option");
      option.value = entry.key;
      option.innerText = entry.label;
      return option;
    })
  );
};

const checkedValues = (fieldsetId) =>
  [...document.querySelectorAll(`#${fieldsetId} input:checked`)].map((checkbox) => checkbox.value);

const parseCost = (id) => {
  const value = document.getElementById(id).value.trim();
  if (value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const readCriteriaFromControls = () => ({
  text: document.getElementById("card-search").value,
  type: document.getElementById("filter-type").value || null,
  kind: document.getElementById("filter-kind").value || null,
  rank: document.getElementById("filter-rank").value || null,
  affiliations: checkedValues("filter-affiliations"),
  traits: checkedValues("filter-traits"),
  positions: checkedValues("filter-positions"),
  costMin: parseCost("cost-min"),
  costMax: parseCost("cost-max"),
});

const applyStateToControls = () => {
  document.getElementById("card-search").value = state.criteria.text;
  document.getElementById("filter-type").value = state.criteria.type ?? "";
  document.getElementById("filter-kind").value = state.criteria.kind ?? "";
  document.getElementById("filter-rank").value = state.criteria.rank ?? "";
  for (const checkbox of document.querySelectorAll("#filter-affiliations input")) {
    checkbox.checked = state.criteria.affiliations.includes(checkbox.value);
  }
  for (const checkbox of document.querySelectorAll("#filter-traits input")) {
    checkbox.checked = state.criteria.traits.includes(checkbox.value);
  }
  for (const checkbox of document.querySelectorAll("#filter-positions input")) {
    checkbox.checked = state.criteria.positions.includes(checkbox.value);
  }
  document.getElementById("cost-min").value = state.criteria.costMin ?? "";
  document.getElementById("cost-max").value = state.criteria.costMax ?? "";
  document.getElementById("sort-select").value = state.sortKey;
};

const syncUrl = () => {
  const params = encodeState(state.criteria, state.sortKey);
  if (state.dev) params.set("dev", "true");
  const query = params.toString();
  window.history.replaceState(null, "", query === "" ? "/cards" : `/cards?${query}`);
};

const render = () => {
  for (const section of state.sections) {
    const visible = sortCards(filterCards(section.views, state.criteria), sectionSortKey(section));
    const visibleIds = new Set(visible.map((view) => view.cardId));
    for (const view of section.views) {
      const mounted = section.byCardId.get(view.cardId);
      mounted.element.classList.toggle("hidden", !visibleIds.has(view.cardId));
    }
    for (const view of visible) {
      section.grid.appendChild(section.byCardId.get(view.cardId).element); // reorder
    }
    section.count.innerText = `${visible.length} shown`;
  }
};

const onControlChange = () => {
  state.criteria = normalizeCriteria(readCriteriaFromControls());
  state.sortKey = document.getElementById("sort-select").value;
  syncUrl();
  render();
};

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
  populateToolbar();
  applyStateToControls();

  const debouncedChange = debounce(onControlChange, SEARCH_DEBOUNCE_MS);
  document.getElementById("card-search").addEventListener("input", debouncedChange);
  document.getElementById("cost-min").addEventListener("input", debouncedChange);
  document.getElementById("cost-max").addEventListener("input", debouncedChange);
  for (const id of ["filter-type", "filter-kind", "filter-rank", "sort-select"]) {
    document.getElementById(id).addEventListener("change", onControlChange);
  }
  for (const fieldsetId of ["filter-affiliations", "filter-traits", "filter-positions"]) {
    document.getElementById(fieldsetId).addEventListener("change", onControlChange);
  }
  for (const section of document.querySelectorAll(".cards-section")) {
    section.querySelector("h2").addEventListener("click", () => section.classList.toggle("collapsed"));
  }

  syncUrl();
  render();
});
