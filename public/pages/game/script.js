import { loadComponent } from "/utils/component-util.js";

document.addEventListener("DOMContentLoaded", async () => {
  await loadComponent("card-vertical", { cardId: 1 });
});
