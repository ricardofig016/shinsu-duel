const load = async (container) => {
  const authResponse = await fetch("/auth/status");
  const authStatus = await authResponse.json();

  if (authStatus.isAuthenticated) {
    container.querySelector("#loggedin-container").classList.remove("hidden");
    container.querySelector("#loggedout-container").classList.add("hidden");

    container.querySelector("#username-span").innerText = authStatus.username;
    container.querySelector("#logout-btn").addEventListener("click", async () => {
      const response = await fetch("/auth/logout", { method: "POST" });
      if (response.status === 200) {
        window.location.reload();
      } else {
        alert("Logout failed. Please try again.");
      }
    });
  } else {
    container.querySelector("#loggedin-container").classList.add("hidden");
    container.querySelector("#loggedout-container").classList.remove("hidden");

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
