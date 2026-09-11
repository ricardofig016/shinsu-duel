import { loadComponent } from "/utils/component-util.js";
import { mountCardGrid } from "/utils/card-grid.js";
import { wireCatalogToolbar } from "/utils/catalog-toolbar.js";
import { normalizeCriteria } from "/utils/card-browse.js";
import {
  buildDeckContents,
  buildDeckTableRow,
  buildPickerEntries,
  buildSaveState,
  buildValidationView,
  compareDecks,
  compareInDeckFirst,
  copyLimitView,
  DECK_SORT_KEYS,
  DEFAULT_DECK_LIMITS,
  deckMatchesCardCriteria,
  deckSizeView,
  deckFanTransforms,
  DECK_TABLE_COLUMNS,
  duplicateDeckName,
  POOL_IN_DECK_SORT_KEY,
  POOL_SORT_KEYS,
  withCardCopyAdded,
  withCardCopyRemoved,
} from "/pages/decks/deck-view-models.js";

const SEARCH_DEBOUNCE_MS = 150;
const VALIDATE_DEBOUNCE_MS = 200;

const byId = (id) => document.getElementById(id);

const debounce = (fn, delayMs) => {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  };
};

const state = {
  dev: false,
  decks: [],
  limits: DEFAULT_DECK_LIMITS,
  entries: [],
  entriesBySlug: new Map(),
  knownSlugs: new Set(),
  // deck list
  deckSearch: "",
  deckLegality: "all",
  deckSortKey: "name-asc",
  deckCardCriteria: normalizeCriteria(null),
  deckRows: new Map(),
  // builder draft
  deckId: null,
  name: "",
  cards: [],
  validation: null,
  validationFailed: false,
  validationRequest: 0,
  savedSignature: "",
  // card pool
  showIllegal: false,
  inDeckOnly: false,
  poolSortKey: POOL_IN_DECK_SORT_KEY,
  poolCriteria: normalizeCriteria(null),
  pool: { grid: null, cards: new Map() },
};

const draftSignature = () => JSON.stringify({ id: state.deckId, name: state.name, cards: state.cards });
state.savedSignature = draftSignature();

const hasUnsavedChanges = () => draftSignature() !== state.savedSignature;

const confirmLeaveBuilder = () => !hasUnsavedChanges() || window.confirm("You have unsaved changes. Leave anyway?");

const showMessage = (text) => {
  const message = byId("decks-message");
  message.innerText = text;
  message.classList.remove("hidden");
};

const hideMessage = () => {
  byId("decks-message").classList.add("hidden");
};

const createSmallButton = (text, onClick) => {
  const button = document.createElement("button");
  button.type = "button";
  button.classList.add("small-button");
  button.innerText = text;
  button.addEventListener("click", onClick);
  return button;
};

/* Card pool */

// Dev decks may exceed every deck rule, so the caps the pool enforces
// disappear in dev mode; the server keeps flagging what it keeps flagging.
const activeLimits = () => (state.dev ? { ...state.limits, maxCardCopies: Number.POSITIVE_INFINITY } : state.limits);

const copyCount = (slug) => state.cards.filter((card) => card === slug).length;

const refreshPoolCard = (slug) => {
  const refs = state.pool.cards.get(slug);
  if (!refs) return;
  const limit = copyLimitView(state.cards, slug, activeLimits());
  refs.badge.innerText = state.dev ? `${limit.count}` : limit.label;
  refs.badge.classList.toggle("has-copies", limit.count > 0);
  refs.minus.disabled = limit.count === 0;
  refs.plus.disabled = !state.dev && limit.reached;
};

const refreshPoolCards = () => {
  for (const slug of state.pool.cards.keys()) refreshPoolCard(slug);
};

const decoratePoolCard = (element, view) => {
  const bar = document.createElement("div");
  bar.classList.add("pool-card-bar");

  const minus = document.createElement("button");
  minus.type = "button";
  minus.classList.add("deck-card-button");
  minus.innerText = "−";
  minus.addEventListener("click", () => removeCard(view.slug));

  const plus = document.createElement("button");
  plus.type = "button";
  plus.classList.add("deck-card-button");
  plus.innerText = "+";
  plus.addEventListener("click", () => addCard(view.slug));

  const badge = document.createElement("span");
  badge.classList.add("pool-copy-badge");

  bar.append(minus, plus, badge);
  element.appendChild(bar);

  element.addEventListener("click", (event) => {
    if (event.button !== 0) return;
    if (event.target.closest(".pool-card-bar")) return;
    addCard(view.slug);
  });

  state.pool.cards.set(view.slug, { badge, plus, minus });
  refreshPoolCard(view.slug);
};

const mountPool = async () => {
  if (state.pool.grid) return;
  state.pool.grid = await mountCardGrid({
    gridElement: byId("pool-grid"),
    countElement: byId("pool-count"),
    views: state.entries.map((entry) => entry.view),
    decorate: decoratePoolCard,
  });
};

const renderPool = () => {
  if (!state.pool.grid) return;
  const visible = state.pool.grid.show({
    criteria: state.poolCriteria,
    predicate: (view) => {
      const entry = state.entriesBySlug.get(view.slug);
      if (!state.showIllegal && entry?.deckEligible === false) return false;
      if (state.inDeckOnly && copyCount(view.slug) === 0) return false;
      return true;
    },
    ...(state.poolSortKey === POOL_IN_DECK_SORT_KEY
      ? { compare: compareInDeckFirst((slug) => copyCount(slug)) }
      : { sortKey: state.poolSortKey }),
  });
  byId("pool-empty").classList.toggle("hidden", visible.length > 0);
  refreshPoolCards();
};

const poolToolbar = wireCatalogToolbar({
  elements: {
    search: byId("pool-card-search"),
    type: byId("pool-filter-type"),
    kind: byId("pool-filter-kind"),
    rank: byId("pool-filter-rank"),
    costMin: byId("pool-cost-min"),
    costMax: byId("pool-cost-max"),
    sort: byId("pool-sort"),
    facets: {
      affiliations: byId("pool-facet-affiliations"),
      traits: byId("pool-facet-traits"),
      positions: byId("pool-facet-positions"),
    },
  },
  onChange: () => {
    state.poolCriteria = poolToolbar.readCriteria();
    const sortKey = poolToolbar.readSortKey();
    if (sortKey) state.poolSortKey = sortKey;
    renderPool();
  },
  sortKeys: POOL_SORT_KEYS,
});

/* Builder draft */

const addCard = (slug) => {
  if (!slug) return;
  state.cards = withCardCopyAdded(state.cards, slug, activeLimits());
  renderDeck();
};

const removeCard = (slug) => {
  if (!slug) return;
  state.cards = withCardCopyRemoved(state.cards, slug);
  renderDeck();
};

const createContentsRow = (group) => {
  const row = document.createElement("li");
  row.classList.add("contents-row");

  const remove = createSmallButton("-", () => removeCard(group.slug));
  remove.classList.add("deck-card-button");

  const add = createSmallButton("+", () => addCard(group.slug));
  add.classList.add("deck-card-button");
  add.disabled = copyLimitView(state.cards, group.slug, activeLimits()).reached;

  const name = document.createElement("span");
  name.classList.add("contents-name");
  name.innerText = group.name;

  const cost = document.createElement("span");
  cost.classList.add("contents-cost");
  cost.innerText = group.cost ?? "";

  const copies = document.createElement("span");
  copies.classList.add("contents-count");
  copies.innerText = group.copiesLabel;

  const marks = document.createElement("span");
  marks.classList.add("picker-marks");
  marks.replaceChildren(...group.marks.map(createMark));

  row.append(remove, add, name, cost, copies, marks);
  return row;
};

const createMark = (mark) => {
  const span = document.createElement("span");
  span.classList.add("mark", `mark-${mark.code}`);
  span.innerText = mark.label;
  return span;
};

const renderDeckContents = () => {
  const contents = buildDeckContents(state.cards, state.entriesBySlug);
  byId("deck-contents-empty").classList.toggle("hidden", contents.length > 0);
  byId("deck-contents").replaceChildren(...contents.map(createContentsRow));
};

const renderSize = () => {
  const size = deckSizeView(state.cards, state.limits);
  const label = byId("deck-size");
  label.innerText = `${size.label} cards`;
  label.classList.toggle("over", size.isOver);
};

const renderSaveState = () => {
  const save = buildSaveState({ name: state.name, cards: state.cards, knownSlugs: state.knownSlugs, limits: state.limits });
  byId("save-deck-btn").disabled = !save.enabled;
  byId("save-hint").innerText = save.blockedReason ?? "";
};

const renderValidation = () => {
  const status = byId("deck-legal");
  const problems = byId("deck-problems");

  if (state.validationFailed) {
    status.innerText = "Could not check the deck";
    status.classList.add("problems");
    problems.replaceChildren();
    return;
  }

  if (state.validation === null) {
    status.innerText = "";
    status.classList.remove("problems");
    problems.replaceChildren();
    return;
  }

  const view = buildValidationView(state.validation);
  status.innerText = view.isLegal ? "Legal" : `Not legal: ${view.problemLabel}`;
  status.classList.toggle("problems", !view.isLegal);
  problems.replaceChildren(
    ...view.problems.map((problem) => {
      const entry = document.createElement("li");
      entry.innerText = problem;
      return entry;
    })
  );
};

const validateDeck = async () => {
  const requestId = ++state.validationRequest;
  try {
    const response = await fetch("/decks/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cards: state.cards }),
    });
    if (!response.ok) throw new Error(`/decks/validate responded ${response.status}`);
    const validation = await response.json();
    if (requestId !== state.validationRequest) return;
    state.validation = validation;
    state.validationFailed = false;
  } catch (error) {
    console.error(error);
    if (requestId !== state.validationRequest) return;
    state.validation = null;
    state.validationFailed = true;
  }
  renderValidation();
};

const scheduleValidation = debounce(validateDeck, VALIDATE_DEBOUNCE_MS);

const renderDeck = () => {
  renderDeckContents();
  renderPool();
  renderSize();
  renderSaveState();
  scheduleValidation();
};

const openBuilder = async (deck) => {
  if (state.entriesBySlug.size === 0) {
    showMessage("Failed to load the card pool. Please try again later.");
    return;
  }
  if (!confirmLeaveBuilder()) return;

  state.deckId = deck?.id ?? null;
  state.name = deck?.name ?? "";
  state.cards = [...(deck?.cards ?? [])];
  state.savedSignature = draftSignature();
  state.validation = null;
  state.validationFailed = false;
  state.validationRequest++;
  hideMessage();
  byId("builder-title").innerText = deck ? deck.name : "New deck";
  byId("deck-name").value = state.name;
  byId("decks-list-view").classList.add("hidden");
  byId("builder-view").classList.remove("hidden");

  byId("pool-count").innerText = "loading...";
  await mountPool();
  renderDeck();
};

const showDeckList = () => {
  byId("builder-view").classList.add("hidden");
  byId("decks-list-view").classList.remove("hidden");
};

const saveDeck = async () => {
  const save = buildSaveState({ name: state.name, cards: state.cards, knownSlugs: state.knownSlugs, limits: state.limits });
  if (!save.enabled) return;
  try {
    const response = await fetch(state.deckId ? `/decks/${state.deckId}` : "/decks", {
      method: state.deckId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: save.name, cards: save.cards }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const lines = [payload?.message, ...(payload?.problems ?? [])].filter(Boolean);
      showMessage(lines.length > 0 ? lines.join("\n") : "Failed to save the deck. Please try again later.");
      return;
    }
    state.savedSignature = draftSignature();
    showDeckList();
    await loadDecks();
  } catch (error) {
    console.error(error);
    showMessage("Failed to save the deck. Please try again later.");
  }
};

/* Deck list */

const loadCatalog = async () => {
  try {
    const response = await fetch(state.dev ? "/cards/data?dev=true" : "/cards/data");
    if (!response.ok) throw new Error(`/cards/data responded ${response.status}`);
    const payload = await response.json();
    state.entries = buildPickerEntries({ cards: payload.cards ?? [], testCards: payload.testCards ?? [] });
  } catch (error) {
    console.error(error);
    return false;
  }
  state.entriesBySlug = new Map(state.entries.map((entry) => [entry.slug, entry]));
  state.knownSlugs = new Set(state.entries.map((entry) => entry.slug));
  return true;
};

const fillFan = async (cell, fanEntries) => {
  const transforms = deckFanTransforms(fanEntries.length);
  await Promise.all(
    fanEntries.map(async (entry, index) => {
      const element = document.createElement("div");
      element.classList.add("card-vertical-component", "deck-fan-card");
      element.style.transform = transforms[index].transform;
      element.style.zIndex = String(transforms[index].zIndex);
      cell.appendChild(element);
      await loadComponent(element, "card-vertical", { card: entry.view, isSmall: true });
    })
  );
};

const buildDeckRowElements = async () => {
  const tbody = byId("decks-table-body");
  tbody.replaceChildren();
  state.deckRows = new Map();

  const mounts = [];
  for (const deck of state.decks) {
    const row = buildDeckTableRow(deck, { entriesBySlug: state.entriesBySlug, limits: state.limits });
    const tr = document.createElement("tr");
    tr.classList.add("deck-row");

    const fanCell = document.createElement("td");
    fanCell.classList.add("deck-fan-cell");

    const nameCell = document.createElement("td");
    nameCell.innerText = row.name;

    const sizeCell = document.createElement("td");
    sizeCell.classList.add("deck-size-cell");
    sizeCell.innerText = row.sizeLabel;

    const compositionCell = document.createElement("td");
    compositionCell.innerText = row.compositionLabel;

    const costCell = document.createElement("td");
    costCell.innerText = row.averageCostLabel;

    const statusCell = document.createElement("td");
    const flag = document.createElement("span");
    flag.classList.add("deck-flag", row.isLegal ? "legal" : "problems");
    flag.innerText = row.isLegal ? row.label : `${row.label}: ${row.problemLabel}`;
    flag.title = row.problems.join("\n");
    statusCell.appendChild(flag);

    const updatedCell = document.createElement("td");
    updatedCell.innerText = row.updatedAtLabel;

    const actionsCell = document.createElement("td");
    const actions = document.createElement("div");
    actions.classList.add("deck-row-actions");
    actions.append(
      createSmallButton("Edit", () => openBuilder(deck)),
      createSmallButton("Duplicate", () => duplicateDeck(deck)),
      createSmallButton("Delete", () => deleteDeck(deck))
    );
    actionsCell.appendChild(actions);

    // One cell per declared column, in order: the header is generated from the
    // same list, so rows and header cannot drift apart.
    const cells = {
      fan: fanCell,
      name: nameCell,
      size: sizeCell,
      composition: compositionCell,
      averageCost: costCell,
      status: statusCell,
      updatedAt: updatedCell,
      actions: actionsCell,
    };
    tr.append(...DECK_TABLE_COLUMNS.map((column) => cells[column.key]));
    tr.addEventListener("click", (event) => {
      if (event.target.closest("button")) return;
      openBuilder(deck);
    });

    tbody.appendChild(tr);
    state.deckRows.set(deck.id, { deck, tr });
    mounts.push(fillFan(fanCell, row.fan));
  }
  await Promise.all(mounts);
  syncDeckTable();
};

const syncDeckTable = () => {
  const tbody = byId("decks-table-body");
  const needle = state.deckSearch.trim().toLowerCase();
  const visible = [];
  for (const { deck, tr } of state.deckRows.values()) {
    const matches =
      (needle === "" || deck.name.toLowerCase().includes(needle)) &&
      (state.deckLegality === "all" || (state.deckLegality === "legal" ? deck.legal : !deck.legal)) &&
      deckMatchesCardCriteria(deck.cards, state.entriesBySlug, state.deckCardCriteria);
    tr.classList.toggle("hidden", !matches);
    if (matches) visible.push({ tr, sortView: { id: deck.id, name: deck.name, cardCount: (deck.cards ?? []).length } });
  }
  const ordered = [...visible].sort(compareDecks(state.deckSortKey));
  for (const { tr } of ordered) tbody.appendChild(tr); // reorder

  byId("decks-empty").classList.toggle("hidden", state.decks.length > 0);
  byId("decks-no-match").classList.toggle("hidden", state.decks.length === 0 || visible.length > 0);
};

const duplicateDeck = async (deck) => {
  try {
    const response = await fetch("/decks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: duplicateDeckName(deck.name, state.limits), cards: deck.cards }),
    });
    if (!response.ok) throw new Error(`/decks responded ${response.status}`);
    await loadDecks();
  } catch (error) {
    console.error(error);
    showMessage("Failed to duplicate the deck. Please try again later.");
  }
};

const deleteDeck = async (deck) => {
  if (!window.confirm(`Delete deck "${deck.name}"?`)) return;
  try {
    const response = await fetch(`/decks/${deck.id}`, { method: "DELETE" });
    if (!response.ok) throw new Error(`/decks/${deck.id} responded ${response.status}`);
    await loadDecks();
  } catch (error) {
    console.error(error);
    showMessage("Failed to delete the deck. Please try again later.");
  }
};

const loadDecks = async () => {
  try {
    const response = await fetch("/decks/data");
    if (!response.ok) throw new Error(`/decks/data responded ${response.status}`);
    const payload = await response.json();
    state.decks = payload.decks ?? [];
    state.limits = { ...DEFAULT_DECK_LIMITS, ...(payload.limits ?? {}) };
    byId("deck-name").maxLength = state.limits.maxNameLength;
  } catch (error) {
    console.error(error);
    showMessage("Failed to load your decks. Please try again later.");
    return false;
  }
  await buildDeckRowElements();
  return true;
};

/* Toolbar and control wiring */

const deckCardToolbar = wireCatalogToolbar({
  elements: {
    search: byId("deck-card-search"),
    type: byId("deck-card-type"),
    facets: { affiliations: byId("deck-card-affiliations") },
  },
  onChange: () => {
    state.deckCardCriteria = deckCardToolbar.readCriteria();
    syncDeckTable();
  },
});

document.addEventListener("DOMContentLoaded", async () => {
  await loadComponent(byId("navbar-component"), "navbar");

  state.dev = new URLSearchParams(window.location.search).get("dev") === "true";

  if (!(await loadCatalog())) {
    showMessage("Failed to load the cards. Please try again later.");
    return;
  }

  poolToolbar.populateFacetOptions(state.entries.map((entry) => entry.view));
  poolToolbar.populateSortOptions();
  byId("pool-sort").value = state.poolSortKey;

  deckCardToolbar.populateFacetOptions(state.entries.map((entry) => entry.view));
  byId("deck-sort").replaceChildren(
    ...DECK_SORT_KEYS.map((entry) => {
      const option = document.createElement("option");
      option.value = entry.key;
      option.innerText = entry.label;
      return option;
    })
  );
  byId("deck-sort").value = state.deckSortKey;

  byId("decks-table-header-row").replaceChildren(
    ...DECK_TABLE_COLUMNS.map((column) => {
      const th = document.createElement("th");
      th.innerText = column.label;
      if (column.key === "fan") th.classList.add("deck-fan-column");
      return th;
    })
  );

  byId("deck-search").addEventListener(
    "input",
    debounce(() => {
      state.deckSearch = byId("deck-search").value;
      syncDeckTable();
    }, SEARCH_DEBOUNCE_MS)
  );
  byId("deck-legality").addEventListener("change", () => {
    state.deckLegality = byId("deck-legality").value;
    syncDeckTable();
  });
  byId("deck-sort").addEventListener("change", () => {
    state.deckSortKey = byId("deck-sort").value;
    syncDeckTable();
  });

  byId("pool-show-illegal").addEventListener("change", (event) => {
    state.showIllegal = event.target.checked;
    renderPool();
  });
  byId("pool-in-deck-only").addEventListener("change", (event) => {
    state.inDeckOnly = event.target.checked;
    renderPool();
  });

  byId("deck-name").addEventListener("input", () => {
    state.name = byId("deck-name").value;
    renderSaveState();
  });
  byId("save-deck-btn").addEventListener("click", saveDeck);
  byId("back-to-decks-btn").addEventListener("click", () => {
    if (confirmLeaveBuilder()) showDeckList();
  });
  byId("new-deck-btn").addEventListener("click", () => openBuilder(null));

  window.addEventListener("beforeunload", (event) => {
    if (byId("builder-view").classList.contains("hidden")) return;
    if (!hasUnsavedChanges()) return;
    event.preventDefault();
    event.returnValue = "";
  });

  await loadDecks();
});
