import { loadComponent } from "/utils/component-util.js";
import { authFetch } from "/utils/auth-redirect.js";
import { roomPath } from "/game/steps.js";

const isValidRoomCode = (code) => {
  return typeof code === "string" && code.trim() !== "" && code !== "undefined" && code !== "null";
};

const setupModeSelection = () => {
  const friendButton = document.getElementById("friend-btn");
  const botButton = document.getElementById("bot-btn");

  friendButton.addEventListener("click", () => {
    friendButton.classList.add("active");
    botButton.classList.remove("active");
    document.getElementById("friend-container").classList.remove("hidden");
    document.getElementById("bot-container").classList.add("hidden");
  });

  botButton.addEventListener("click", () => {
    botButton.classList.add("active");
    friendButton.classList.remove("active");
    document.getElementById("bot-container").classList.remove("hidden");
    document.getElementById("friend-container").classList.add("hidden");
  });
};

const setupPvE = () => {
  document.getElementById("easy-mode-btn").addEventListener("click", async () => {
    const roomCode = await createRoom("bot", "easy");
    await joinRoom(roomCode);
  });

  document.getElementById("hard-mode-btn").addEventListener("click", async () => {
    const roomCode = await createRoom("bot", "hard");
    await joinRoom(roomCode);
  });
};

const setupPvP = () => {
  document.getElementById("create-room-btn").addEventListener("click", async () => {
    const roomCode = await createRoom("friend");
    await joinRoom(roomCode);
  });

  document.getElementById("enter-room-btn").addEventListener("click", async () => {
    const roomCode = prompt("Enter Room Code:");
    await joinRoom(roomCode);
  });
};

const createRoom = async (opponent, difficulty = null) => {
  try {
    const response = await authFetch("/game/createRoom", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ opponent, difficulty }),
    });
    if (response.status === 200) {
      const roomCode = await response.text();
      return roomCode;
    } else {
      alert(await response.text());
    }
  } catch (error) {
    console.error(error);
    alert("An error occurred while creating the room. Please try again.");
  }
};

const joinRoom = (roomCode) => {
  if (!isValidRoomCode(roomCode)) {
    alert("Invalid room code. Please enter a valid room code.");
    return;
  }
  // The room address is the only door into a room: it resolves the step the
  // room is in and the waiting room claims the free seat, whether the player
  // typed the code here or opened a shared invite link.
  window.location.href = roomPath(roomCode.trim());
};

document.addEventListener("DOMContentLoaded", async () => {
  const navbarContainer = document.getElementById("navbar-component");
  await loadComponent(navbarContainer, "navbar");
  setupModeSelection();
  setupPvE();
  setupPvP();
});
