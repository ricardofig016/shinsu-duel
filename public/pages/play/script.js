import { loadComponent } from "/utils/component-util.js";

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
    const response = await fetch("/game/createRoom", {
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

const joinRoom = async (roomCode) => {
  try {
    if (roomCode) {
      const response = await fetch(`/game/${roomCode}/join`, { method: "POST" });
      if (response.status !== 200) {
        alert(await response.text());
      } else {
        window.location.href = `/game/${roomCode}`;
      }
    }
  } catch (error) {
    console.error(error);
    alert("An error occurred while entering the room.\nPlease check your network connection and try again.");
  }
};

document.addEventListener("DOMContentLoaded", async () => {
  await loadComponent("navbar");
  setupModeSelection();
  setupPvE();
  setupPvP();
});
