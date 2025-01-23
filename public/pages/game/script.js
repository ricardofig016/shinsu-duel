import { loadComponent } from "/utils/component-util.js";

let gameData = { player: {}, opponent: {} };

const addBorderToDivs = () => {
  const divs = document.querySelectorAll("div");
  divs.forEach((div) => {
    const randomColor = `#${Math.floor(Math.random() * 16777215).toString(16)}`;
    div.style.border = `1px solid ${randomColor}`;
  });
};

const getRandomPlayerData = () => {
  let playerData = {};

  // combat indicators

  // hands
  playerData.hand = [];
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
  const cardAmount = Math.floor(Math.random() * 11);
  const maxId = 6;
  const maxTraitCodes = 15;
  for (let i = 0; i < cardAmount; i++) {
    let card = {};
    card.id = Math.floor(Math.random() * (maxId + 1));
    const randomCodeNumber = Math.floor(Math.random() * (maxTraitCodes + 1));
    const shuffledTraitCodes = traitCodes.sort(() => 0.5 - Math.random());
    card.traitCodes = shuffledTraitCodes.slice(0, randomCodeNumber);
    playerData.hand.push(card);
  }
  console.log(playerData.hand);

  // shinsu
  playerData.shinsu = {};
  playerData.shinsu.spent = Math.floor(Math.random() * 11);
  playerData.shinsu.available = Math.floor(Math.random() * (playerData.shinsu.spent + 1));
  playerData.shinsu.recharged = Math.floor(Math.random() * 3);

  return playerData;
};

const loadCombatIndicators = async () => {};

const loadHands = async () => {
  const alignCards = () => {
    const handContainers = document.querySelectorAll(".hand-container");
    handContainers.forEach((handContainer) => {
      const handContainerWidth = window.innerWidth - handContainer.getBoundingClientRect().left;
      const cards = handContainer.querySelectorAll(".unit-card-vertical-component");
      if (cards.length === 0) return;
      const cardWidth = cards[0].offsetWidth;
      if (cards.length * cardWidth < handContainerWidth) handContainer.style.justifyContent = "center";
      else {
        const cardOffset = (handContainerWidth - cardWidth) / (cards.length - 1);
        cards.forEach((card, index) => {
          if (index !== 0) card.style.marginLeft = `${-cardWidth + cardOffset}px`;
        });
      }
    });
  };

  for (let player in gameData) {
    for (let card of gameData[player].hand) {
      // create div
      const handContainer = document.querySelector(`#${player}-container .hand-container`);
      const newDiv = document.createElement("div");
      newDiv.classList.add("unit-card-vertical-component");
      handContainer.appendChild(newDiv);
      // load card component
      await loadComponent(newDiv, "unit-card-vertical", {
        id: card.id,
        traitCodes: card.traitCodes,
        placedPosition: null,
        currentHp: null,
        isSmall: true,
      });
    }
  }

  alignCards();
  window.addEventListener("resize", alignCards);
};

const loadShinsu = async () => {
  const maxNormalShinsu = 10;
  const maxRechargedShinsu = 2;
  for (let player in gameData) {
    const shinsuContainer = document.querySelector(`#${player}-container .shinsu-container`);
    // normal shinsu
    let shinsuCircles = Array.from(shinsuContainer.querySelectorAll(".shinsu-circle"));
    for (let i = 0; i < gameData[player].shinsu.available; i++) shinsuCircles[i].classList.add("available");
    for (let i = gameData[player].shinsu.available; i < gameData[player].shinsu.spent; i++)
      shinsuCircles[i].classList.add("spent");
    for (let i = gameData[player].shinsu.spent; i < maxNormalShinsu; i++)
      shinsuCircles[i].classList.add("unavailable");
    // recharged shinsu
    for (let i = maxNormalShinsu; i < maxNormalShinsu + gameData[player].shinsu.recharged; i++)
      shinsuCircles[i].classList.add("available");
    for (
      let i = maxNormalShinsu + gameData[player].shinsu.recharged;
      i < maxNormalShinsu + maxRechargedShinsu;
      i++
    )
      shinsuCircles[i].classList.add("spent");
  }
};

document.addEventListener("DOMContentLoaded", async () => {
  // debugging
  // addBorderToDivs();
  gameData.opponent = getRandomPlayerData();
  gameData.player = getRandomPlayerData();

  await loadCombatIndicators();
  await loadHands();
  await loadShinsu();
});
