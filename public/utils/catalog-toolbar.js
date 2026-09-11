import { SORT_KEYS, deriveFacetOptions, normalizeCriteria } from "./card-browse.js";

const SEARCH_DEBOUNCE_MS = 150;

const debounce = (fn, delayMs) => {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  };
};

/**
 * Wires a catalog toolbar (search box, type/kind/rank selects, cost range,
 * facet fieldsets, sort select) to criteria state. Every element is optional,
 * so a page passes only the controls it has; text and cost changes debounce,
 * everything else fires immediately.
 *
 * The module owns no state: it reads from and writes to the controls, and the
 * page keeps criteria wherever it wants (module state, URL, ...).
 *
 * @param {{
 *   elements: {
 *     search?: HTMLInputElement,
 *     type?: HTMLSelectElement,
 *     kind?: HTMLSelectElement,
 *     rank?: HTMLSelectElement,
 *     costMin?: HTMLInputElement,
 *     costMax?: HTMLInputElement,
 *     sort?: HTMLSelectElement,
 *     facets?: { affiliations?: HTMLFieldSetElement, traits?: HTMLFieldSetElement, positions?: HTMLFieldSetElement },
 *   },
 *   onChange: () => void,
 *   sortKeys?: Array<{ key: string, label: string }>,
 *   debounceMs?: number,
 * }} options
 */
export function wireCatalogToolbar({ elements, onChange, sortKeys = SORT_KEYS, debounceMs = SEARCH_DEBOUNCE_MS }) {
  const facets = elements.facets ?? {};
  const debouncedChange = debounce(onChange, debounceMs);

  const facetOptionsContainer = (fieldset) => fieldset?.querySelector(".facet-options") ?? null;

  const checkedValues = (fieldset) =>
    [...(fieldset?.querySelectorAll("input:checked") ?? [])].map((checkbox) => checkbox.value);

  const parseCost = (input) => {
    const value = input?.value.trim() ?? "";
    if (value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };

  const populateSelect = (select, values) => {
    if (!select) return;
    for (const value of values) {
      const option = document.createElement("option");
      option.value = value;
      option.innerText = value;
      select.appendChild(option);
    }
  };

  const populateFacet = (fieldset, values) => {
    const container = facetOptionsContainer(fieldset);
    if (!container) return;
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

  const controlChanged = (element, event) => {
    if (!element) return;
    element.addEventListener(event, onChange);
  };

  for (const input of [elements.search, elements.costMin, elements.costMax]) {
    if (input) input.addEventListener("input", debouncedChange);
  }
  for (const select of [elements.type, elements.kind, elements.rank, elements.sort]) {
    controlChanged(select, "change");
  }
  for (const fieldset of Object.values(facets)) {
    controlChanged(fieldset, "change");
  }

  return {
    /** Fill the present selects and facet fieldsets from the catalog itself. */
    populateFacetOptions(views) {
      const options = deriveFacetOptions(views);
      populateSelect(elements.type, options.types);
      populateSelect(elements.kind, options.kinds);
      populateSelect(elements.rank, options.ranks);
      populateFacet(facets.affiliations, options.affiliations);
      populateFacet(facets.traits, options.traits);
      populateFacet(facets.positions, options.positions);
    },

    /** Fill the sort select; defaults stay offered as the empty option value. */
    populateSortOptions() {
      if (!elements.sort) return;
      elements.sort.replaceChildren(
        ...sortKeys.map((entry) => {
          const option = document.createElement("option");
          option.value = entry.key;
          option.innerText = entry.label;
          return option;
        })
      );
    },

    /** The criteria the current controls express, normalized. */
    readCriteria() {
      return normalizeCriteria({
        text: elements.search?.value ?? "",
        type: elements.type?.value || null,
        kind: elements.kind?.value || null,
        rank: elements.rank?.value || null,
        affiliations: checkedValues(facets.affiliations),
        traits: checkedValues(facets.traits),
        positions: checkedValues(facets.positions),
        costMin: parseCost(elements.costMin),
        costMax: parseCost(elements.costMax),
      });
    },

    readSortKey() {
      return elements.sort?.value ?? null;
    },

    /** Push criteria (and optionally a sort key) into the controls. */
    applyState({ criteria, sortKey } = {}) {
      const normalized = normalizeCriteria(criteria);
      if (elements.search) elements.search.value = normalized.text;
      if (elements.type) elements.type.value = normalized.type ?? "";
      if (elements.kind) elements.kind.value = normalized.kind ?? "";
      if (elements.rank) elements.rank.value = normalized.rank ?? "";
      for (const [fieldset, values] of [
        [facets.affiliations, normalized.affiliations],
        [facets.traits, normalized.traits],
        [facets.positions, normalized.positions],
      ]) {
        for (const checkbox of fieldset?.querySelectorAll("input") ?? []) {
          checkbox.checked = values.includes(checkbox.value);
        }
      }
      if (elements.costMin) elements.costMin.value = normalized.costMin ?? "";
      if (elements.costMax) elements.costMax.value = normalized.costMax ?? "";
      if (elements.sort && sortKey) elements.sort.value = sortKey;
    },
  };
}
