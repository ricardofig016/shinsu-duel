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
        alert(await response.text());
      }
    });
  } else {
    container.querySelector("#loggedin-container").classList.add("hidden");
    container.querySelector("#loggedout-container").classList.remove("hidden");
  }
};

export default load;
