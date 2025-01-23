import { loadComponent } from "/utils/component-util.js";

const addBorderToDivs = () => {
  const divs = document.querySelectorAll("div");
  divs.forEach((div) => {
    const randomColor = `#${Math.floor(Math.random() * 16777215).toString(16)}`;
    div.style.border = `1px solid ${randomColor}`;
  });
};

const loadHands = async () => {
  const handContainers = document.querySelectorAll(".hand-container");
  const createRandomCards = async (amount, hand) => {
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
    for (let i = 0; i < amount; i++) {
      // create div
      const newDiv = document.createElement("div");
      newDiv.classList.add("unit-card-vertical-component");
      handContainers[hand].appendChild(newDiv);
      // randomize the card info
      const maxId = 6;
      const randomId = Math.floor(Math.random() * maxId + 1);
      const randomCodeNumber = Math.floor(Math.random() * 16);
      const shuffledTraitCodes = traitCodes.sort(() => 0.5 - Math.random());
      const selectedTraitCodes = shuffledTraitCodes.slice(0, randomCodeNumber);
      // load card component
      await loadComponent(newDiv, "unit-card-vertical", {
        id: randomId,
        traitCodes: selectedTraitCodes,
        placedPosition: null,
        currentHp: null,
        isSmall: true,
      });
    }
  };
  const alignCards = () => {
    const handContainerWidth = window.innerWidth - handContainers[0].getBoundingClientRect().left;
    handContainers.forEach((hand) => {
      const cards = hand.querySelectorAll(".unit-card-vertical-component");
      if (cards.length === 0) return;
      const cardWidth = cards[0].offsetWidth;
      if (cards.length * cardWidth < handContainerWidth) {
        hand.style.justifyContent = "center";
      } else {
        const cardOffset = (handContainerWidth - cardWidth) / (cards.length - 1);
        cards.forEach((card, index) => {
          if (index !== 0) card.style.marginLeft = `${-cardWidth + cardOffset}px`;
        });
      }
    });
  };

  // debugging
  await createRandomCards(Math.floor(Math.random() * 11), 0);
  await createRandomCards(Math.floor(Math.random() * 11), 1);

  alignCards();
  window.addEventListener("resize", alignCards);
};

document.addEventListener("DOMContentLoaded", async () => {
  // debugging
  addBorderToDivs();

  await loadHands();
});
