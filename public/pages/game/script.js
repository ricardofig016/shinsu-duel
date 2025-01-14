import { loadComponent } from "/utils/component-util.js";

document.addEventListener("DOMContentLoaded", async () => {
  const cardContainers = document.getElementsByClassName("card-vertical-component");
  for (let i = 0; i < cardContainers.length; i++) {
    const container = cardContainers[i];
    await loadComponent(container, "card-vertical", { id: i });
  }
});
