import { loadComponent } from "/utils/component-util.js";
import { authFetch, redirectToLogin } from "/utils/auth-redirect.js";
import { EVENTS, ERROR_CODES } from "/game/protocol.js";
import { STEP, roomPath, roomCodeFromPath, goToStep } from "/game/steps.js";
import { isDevRoomCode } from "/game/devRooms.js";

/**
 * The waiting room: the first step of a room, and the page a shared invite
 * link lands on. It claims the free seat, shows the room code to pass on, and
 * hands the browser to the deck step the moment the opponent arrives.
 */

const byId = (id) => document.getElementById(id);

const roomCode = roomCodeFromPath(window.location.pathname);

const showMessage = (text) => {
  byId("waiting-message").textContent = text;
};

/** Take the free seat, or report why there is none. */
const claimSeat = async () => {
  try {
    const response = await authFetch(`/game/${roomCode}/join`, { method: "POST" });
    if (response.ok) return true;
    showMessage((await response.text()) || "This room cannot be joined.");
    return false;
  } catch (error) {
    console.error(error);
    showMessage("Could not reach the room. Check your connection and reload.");
    return false;
  }
};

const fillSeats = (status, username) => {
  byId("waiting-you").textContent = username ?? "-";
  const opponent = (status?.seats ?? []).find((seat) => seat.username !== username);
  if (opponent) byId("waiting-opponent").textContent = opponent.username;
};

const copyInviteLink = async () => {
  const link = `${window.location.origin}${roomPath(roomCode)}`;
  try {
    await navigator.clipboard.writeText(link);
    byId("waiting-copy-hint").textContent = "Invite link copied.";
  } catch {
    // Clipboard access can be refused; the code is on screen either way.
    window.prompt("Copy this invite link:", link);
  }
};

document.addEventListener("DOMContentLoaded", async () => {
  await loadComponent(byId("navbar-component"), "navbar");

  if (roomCode === null) {
    window.location.replace("/play");
    return;
  }

  byId("waiting-room-code").textContent = roomCode;
  byId("waiting-copy-link").addEventListener("click", () => void copyInviteLink());

  if (isDevRoomCode(roomCode)) {
    const notice = byId("waiting-dev-notice");
    notice.classList.remove("hidden");
    notice.textContent = "Dev room: the deck selection accepts illegal decks and starts with rule enforcement off.";
  }

  if (!(await claimSeat())) return;

  const identity = await fetch("/auth/status")
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
  const username = identity?.isAuthenticated ? identity.username : null;
  byId("waiting-you").textContent = username ?? "-";

  const socket = io("/game", { query: { roomCode } });

  // The room is complete: the opponent is here, so the seats are filled for
  // the instant before the deck step takes over.
  socket.on(EVENTS.GAME_DECK_STATUS, (status) => {
    fillSeats(status, username);
    goToStep(roomCode, STEP.DECK);
  });
  socket.on(EVENTS.GAME_INIT, () => goToStep(roomCode, STEP.BOARD));
  socket.on(EVENTS.GAME_ERROR, (payload) => {
    if (payload?.code === ERROR_CODES.UNAUTHENTICATED) {
      socket.disconnect();
      redirectToLogin();
      return;
    }
    showMessage(payload?.message ?? "Something went wrong.");
  });
});
