import { loadComponent } from "/utils/component-util.js";
import { authFetch, redirectToLogin } from "/utils/auth-redirect.js";
import { EVENTS, ERROR_CODES } from "/game/protocol.js";
import { buildDeckSelect } from "/game/actions.js";
import { STEP, roomCodeFromPath, followRoomStep, goToStep } from "/game/steps.js";
import { buildPickerEntries, compareDecks, DEFAULT_DECK_LIMITS } from "/utils/deck-model.js";
import { buildDeckTableHeader, buildDeckRowElement, mountDeckFan } from "/utils/deck-table.js";
import {
  SELECTION_COLUMNS,
  VERSUS_BEAT_MS,
  buildDeckStepView,
  buildVersusView,
  pickCleared,
} from "/pages/game/deck/view-model.js";

/**
 * The deck step: the player picks the deck the game starts with. The page
 * renders the deck list with the fan of the deck it would play, locks a deck
 * in on a row click (changeable until the game starts), and plays the versus
 * reveal when both seats are locked before handing over to the board.
 */

const byId = (id) => document.getElementById(id);

const roomCode = roomCodeFromPath(window.location.pathname);

const state = {
  username: null,
  dev: false,
  decks: [],
  limits: DEFAULT_DECK_LIMITS,
  entriesBySlug: null,
  status: null,
  rows: new Map(),
  search: "",
  legality: "all",
  versusRunning: false,
};

const showMessage = (text) => {
  byId("deck-message").textContent = text;
};

/* Data */

const loadIdentity = async () => {
  const response = await fetch("/auth/status").catch(() => null);
  const payload = response?.ok ? await response.json() : null;
  return payload?.isAuthenticated ? payload.username : null;
};

const loadDecks = async () => {
  try {
    const response = await authFetch("/decks/data");
    if (!response.ok) throw new Error(`/decks/data responded ${response.status}`);
    const payload = await response.json();
    state.decks = payload.decks ?? [];
    state.limits = { ...DEFAULT_DECK_LIMITS, ...(payload.limits ?? {}) };
    return true;
  } catch (error) {
    console.error(error);
    showMessage("Failed to load your decks. Please try again later.");
    return false;
  }
};

const loadCatalog = async () => {
  try {
    const response = await fetch(state.dev ? "/cards/data?dev=true" : "/cards/data");
    if (!response.ok) throw new Error(`/cards/data responded ${response.status}`);
    const payload = await response.json();
    state.entriesBySlug = new Map(
      buildPickerEntries({ cards: payload.cards ?? [], testCards: payload.testCards ?? [] }).map((entry) => [
        entry.slug,
        entry,
      ])
    );
    return true;
  } catch (error) {
    console.error(error);
    showMessage("Failed to load the cards. Please try again later.");
    return false;
  }
};

/* Table */

const isVisible = (row) => {
  const needle = state.search.trim().toLowerCase();
  if (needle !== "" && !row.name.toLowerCase().includes(needle)) return false;
  if (state.legality === "legal") return row.isLegal;
  if (state.legality === "not-legal") return !row.isLegal;
  return true;
};

const syncTable = () => {
  const body = byId("deck-table-body");
  const visible = [];
  for (const entry of state.rows.values()) {
    const shows = isVisible(entry.row);
    entry.element.classList.toggle("hidden", !shows);
    if (shows) visible.push(entry);
  }
  visible.sort((a, b) => compareDecks("name-asc")(a.row, b.row));
  for (const entry of visible) body.appendChild(entry.element);

  byId("deck-empty").classList.toggle("hidden", state.decks.length > 0);
  byId("deck-no-match").classList.toggle("hidden", state.decks.length === 0 || visible.length > 0);
};

const buildRows = async (rows) => {
  const body = byId("deck-table-body");
  body.replaceChildren();
  state.rows.clear();

  const mounts = [];
  for (const row of rows) {
    const { element, cells } = buildDeckRowElement({ row, deck: row.deck, columns: SELECTION_COLUMNS });
    element.classList.toggle("not-selectable", !row.selectable);
    element.addEventListener("click", () => lockIn(row));
    body.appendChild(element);
    state.rows.set(row.id, { row, element });
    mounts.push(mountDeckFan(cells.get("fan"), row.fan));
  }
  await Promise.all(mounts);
  syncTable();
};

const markLocked = (deckId) => {
  for (const entry of state.rows.values()) {
    entry.element.classList.toggle("selected", entry.row.id === deckId);
  }
};

const lockIn = (row) => {
  if (!connection) return;
  if (!row.selectable) {
    showMessage(row.problems[0] ?? "This deck cannot start a game.");
    return;
  }
  connection.emit(EVENTS.GAME_DECK_SELECT, buildDeckSelect(row.id));
};

/* Rendering */

const renderStep = (view) => {
  byId("deck-you").textContent = state.username ?? "-";
  byId("deck-opponent").textContent = view.opponentSeat?.username ?? "No one yet";
  byId("deck-opponent-status").textContent = view.opponentLine;
  markLocked(view.lockedDeckId);
  showMessage(view.mySeat?.deckChosen ? "Deck locked in. You can still change it." : "Click a deck to lock it in.");

  const notice = byId("deck-dev-notice");
  notice.classList.toggle("hidden", !view.dev);
  notice.textContent = view.dev
    ? "Dev room: illegal decks are selectable and the game starts with rule enforcement off."
    : "";
};

const renderVersus = (reveal) => {
  const view = buildVersusView(reveal, state.entriesBySlug);
  const seats = byId("versus-seats");
  seats.replaceChildren(
    ...view.seats.map((seat) => {
      const wrapper = document.createElement("div");
      wrapper.classList.add("versus-seat", "container-vertical");

      const name = document.createElement("h3");
      name.textContent = seat.deckName;

      const who = document.createElement("span");
      who.textContent = seat.username;

      const fan = document.createElement("div");
      fan.classList.add("deck-fan-cell");

      wrapper.append(who, name, fan);
      void mountDeckFan(fan, seat.fan);
      return wrapper;
    })
  );
  byId("versus-overlay").classList.remove("hidden");
};

/** Hand over to the board once the beat has been up for its full time. */
const finishVersus = () => {
  if (!state.versusRunning) return;
  state.versusRunning = false;
  goToStep(roomCode, STEP.BOARD);
};

/* Boot */

let connection = null;

document.addEventListener("DOMContentLoaded", async () => {
  await loadComponent(byId("navbar-component"), "navbar");

  if (roomCode === null) {
    window.location.replace("/play");
    return;
  }

  state.username = await loadIdentity();
  connection = io("/game", { query: { roomCode } });

  buildDeckTableHeader(byId("deck-table-header-row"), SELECTION_COLUMNS);

  byId("deck-search").addEventListener("input", () => {
    state.search = byId("deck-search").value;
    syncTable();
  });
  byId("deck-legality").addEventListener("change", () => {
    state.legality = byId("deck-legality").value;
    syncTable();
  });

  followRoomStep(connection, roomCode, STEP.DECK, { ignore: [EVENTS.GAME_INIT] });

  connection.on(EVENTS.GAME_DECK_STATUS, (status) => {
    void (async () => {
      // A status that clears this seat's pick means the server refused a deck
      // it accepted earlier (deleted, unbuildable, or illegal in this room),
      // so the list the page holds is stale; the dev flag decides whether the
      // catalog needs the test cards.
      const reloadDecks = state.status === null || pickCleared(state.status, status, state.username);
      const reloadCatalog = state.entriesBySlug === null || state.dev !== Boolean(status.dev);
      state.status = status;
      state.dev = Boolean(status.dev);

      if (reloadDecks && !(await loadDecks())) return;
      if (reloadCatalog && !(await loadCatalog())) return;

      const view = buildDeckStepView({
        status,
        decks: state.decks,
        username: state.username,
        entriesBySlug: state.entriesBySlug,
        limits: state.limits,
      });
      if (!view) return;
      if (reloadDecks || state.rows.size === 0) await buildRows(view.rows);
      renderStep(view);
    })();
  });

  connection.on(EVENTS.GAME_DECK_REVEAL, (reveal) => {
    renderVersus(reveal);
    state.versusRunning = true;
    setTimeout(finishVersus, VERSUS_BEAT_MS);
  });

  // The board is already running underneath the reveal, so a seat that is
  // still watching it waits for the beat instead of loading the board twice.
  connection.on(EVENTS.GAME_INIT, () => {
    if (state.versusRunning) return;
    goToStep(roomCode, STEP.BOARD);
  });

  connection.on(EVENTS.GAME_ERROR, (payload) => {
    if (payload?.code === ERROR_CODES.UNAUTHENTICATED) {
      connection.disconnect();
      redirectToLogin();
      return;
    }
    showMessage(payload?.message ?? "Something went wrong.");
  });
});
