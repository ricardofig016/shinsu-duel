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
  document.getElementById("create-room-btn").addEventListener("click", async () => {
    try {
      const response = await fetch("/game/create-room", { method: "POST" });
      if (response.redirected) {
        window.location.href = response.url;
      } else {
        alert("Failed to create room, please try again.\nIf the issue persists, please contact support.");
      }
    } catch (error) {
      alert(
        "An error occurred while creating the room.\nPlease check your network connection and try again."
      );
    }
  });

  document.getElementById("enter-room-btn").addEventListener("click", () => {
    const roomCode = prompt("Enter Room Code:");
    if (roomCode) {
      alert(`Entered Room Code: ${roomCode}`);
    }
  });
};

document.addEventListener("DOMContentLoaded", () => {
  // setups
  setupModeSelection();
  setupPvE();
  setupPvP();
});
