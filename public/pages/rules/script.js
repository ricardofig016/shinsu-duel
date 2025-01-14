import { loadComponent } from "/utils/component-util.js";

document.addEventListener("DOMContentLoaded", async () => {
  const navbarContainer = document.getElementById("navbar-component");
  await loadComponent(navbarContainer, "navbar");
});
