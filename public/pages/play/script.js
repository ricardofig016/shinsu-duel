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
  document.getElementById("easy-mode-btn").addEventListener("click", () => {
    alert("Easy Mode selected.");
  });

  document.getElementById("hard-mode-btn").addEventListener("click", () => {
    alert("Hard Mode selected.");
  });
};

const setupPvP = () => {
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
      alert(
        "An error occurred while entering the room.\nPlease check your network connection and try again."
      );
    }
  };

  document.getElementById("create-room-btn").addEventListener("click", async () => {
    try {
      const response = await fetch("/game/createRoom", { method: "POST" });
      if (response.status === 200) {
        const roomCode = await response.text();
        await joinRoom(roomCode);
      } else {
        alert(await response.text());
      }
    } catch (error) {
      console.error(error);
      alert(
        "An error occurred while creating the room.\nPlease check your network connection and try again."
      );
    }
  });

  document.getElementById("enter-room-btn").addEventListener("click", async () => {
    const roomCode = prompt("Enter Room Code:");
    await joinRoom(roomCode);
  });
};

document.addEventListener("DOMContentLoaded", async () => {
  await loadComponent("navbar");
  setupModeSelection();
  setupPvE();
  setupPvP();
});
