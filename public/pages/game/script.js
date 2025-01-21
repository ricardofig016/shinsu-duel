import { loadComponent } from "/utils/component-util.js";

document.addEventListener("DOMContentLoaded", async () => {
  const cardContainers = document.getElementsByClassName("unit-card-vertical-component");
  const traitCodes = [
    "barrier",
    "bloodthirsty",
    "burned",
    "creator",
    "cursed",
    "dealer",
    "doomed",
    "exhausted",
    "ghost",
    "heavy",
    "immune",
    "lastonestanding",
    "lethal",
    "pierce",
    "poisoned",
    "reflect",
    "regenerate",
    "resilient",
    "rooted",
    "ruthless",
    "sharpshooter",
    "strong",
    "stunned",
    "taunt",
    "weak",
  ];
  for (let i = 0; i < cardContainers.length; i++) {
    const container = cardContainers[i];
    // randomize the card info
    const randomId = Math.floor(Math.random() * 6);
    const randomCodeNumber = Math.floor(Math.random() * 16);
    const shuffledTraitCodes = traitCodes.sort(() => 0.5 - Math.random());
    const selectedTraitCodes = shuffledTraitCodes.slice(0, randomCodeNumber);
    // load card component
    await loadComponent(container, "unit-card-vertical", {
      id: randomId,
      traitCodes: selectedTraitCodes,
      placedPosition: null,
      currentHp: null,
      isSmall: true,
    });
  }
});
