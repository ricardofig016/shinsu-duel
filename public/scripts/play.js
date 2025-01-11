const loadNavbar = async () => {
  const navbarContainer = document.getElementById("navbar-container");
  const response = await fetch("/templates/navbar.html");
  const navbarHtml = await response.text();
  navbarContainer.innerHTML = navbarHtml;

  const authSection = document.getElementById("auth-section");
  const authResponse = await fetch("/auth/status");
  const authStatus = await authResponse.json();

  if (authStatus.isAuthenticated) {
    authSection.innerHTML = `
      <span>Welcome, ${authStatus.username}</span>
      <button id="logout-btn">Logout</button>
    `;
    document.getElementById("logout-btn").addEventListener("click", async () => {
      const response = await fetch("/auth/logout", { method: "POST" });
      if (response.status === 200) {
        alert("Logout successful");
        window.location.reload();
      } else {
        alert("Logout failed. Please try again.");
      }
    });
  } else {
    authSection.innerHTML = `
      <button id="login-btn">Login</button>
    `;
    document.getElementById("login-btn").addEventListener("click", async () => {
      const username = prompt("Enter Your Username:");
      if (username) {
        const response = await fetch("/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username }),
        });
        if (response.status === 200) {
          alert("Login successful");
          window.location.reload();
        } else {
          alert("Login failed. Please try again.");
        }
      }
    });
  }
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
      alert(
        "An error occurred while entering the room.\nPlease check your network connection and try again."
      );
    }
  };

  document.getElementById("create-room-btn").addEventListener("click", async () => {
    try {
      const response = await fetch("/game/create-room", { method: "POST" });
      if (response.status === 200) {
        const roomCode = await response.text();
        await joinRoom(roomCode);
      } else {
        alert(await response.text());
      }
    } catch (error) {
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

document.addEventListener("DOMContentLoaded", () => {
  loadNavbar();
  setupModeSelection();
  setupPvE();
  setupPvP();
});
