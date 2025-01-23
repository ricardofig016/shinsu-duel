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
      const randomId = Math.floor(Math.random() * (maxId + 1));
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

const loadShinsu = async () => {
  const maxNormalShinsu = 10;
  const maxRechargedShinsu = 2;

  const createRandomShinsu = () => {
    const spentShinsu = Math.floor(Math.random() * (maxNormalShinsu + 1));
    const availableShinsu = Math.floor(Math.random() * (spentShinsu + 1));
    const rechargedShinsu = Math.floor(Math.random() * (maxRechargedShinsu + 1));
    console.log(availableShinsu, spentShinsu, rechargedShinsu);
    return { availableShinsu, spentShinsu, rechargedShinsu };
  };

  const shinsuContainers = document.querySelectorAll(".shinsu-container");
  shinsuContainers.forEach((shinsuContainer) => {
    // debugging
    const { availableShinsu, spentShinsu, rechargedShinsu } = createRandomShinsu();
    // normal shinsu
    let shinsuCircles = Array.from(shinsuContainer.querySelectorAll(".shinsu-circle"));
    for (let i = 0; i < availableShinsu; i++) shinsuCircles[i].classList.add("available");
    for (let i = availableShinsu; i < spentShinsu; i++) shinsuCircles[i].classList.add("spent");
    for (let i = spentShinsu; i < maxNormalShinsu; i++) shinsuCircles[i].classList.add("unavailable");
    // recharged shinsu
    for (let i = maxNormalShinsu; i < maxNormalShinsu + rechargedShinsu; i++)
      shinsuCircles[i].classList.add("available");
    for (let i = maxNormalShinsu + rechargedShinsu; i < maxNormalShinsu + maxRechargedShinsu; i++)
      shinsuCircles[i].classList.add("spent");
  });
};

document.addEventListener("DOMContentLoaded", async () => {
  // debugging
  // addBorderToDivs();

  await loadHands();
  await loadShinsu();
});
