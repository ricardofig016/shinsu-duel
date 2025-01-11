const load = async (container) => {
  const authSection = container.querySelector("#auth-section");
  const authResponse = await fetch("/auth/status");
  const authStatus = await authResponse.json();

  if (authStatus.isAuthenticated) {
    authSection.innerHTML = `
          <span>Welcome, ${authStatus.username}</span>
          <button id="logout-btn">Logout</button>
        `;
    container.querySelector("#logout-btn").addEventListener("click", async () => {
      const response = await fetch("/auth/logout", { method: "POST" });
      if (response.status === 200) {
        window.location.reload();
      } else {
        alert("Logout failed. Please try again.");
      }
    });
  } else {
    authSection.innerHTML = `
          <button id="login-btn">Login</button>
        `;
    container.querySelector("#login-btn").addEventListener("click", async () => {
      const username = prompt("Enter Your Username:");
      if (username) {
        const response = await fetch("/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username }),
        });
        if (response.status === 200) {
          window.location.reload();
        } else {
          alert("Login failed. Please try again.");
        }
      }
    });
  }
  console.log("Navbar loaded");
};

export default load;
