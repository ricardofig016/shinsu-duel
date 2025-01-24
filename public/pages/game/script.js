import { loadComponent, addTooltip } from "/utils/component-util.js";

let data;

const prepareData = async () => {
  // init
  data = {};
  data.game = {};
  data.game.player = {};
  data.game.opponent = {};
  data.cards = {};

  // fetch data
  data.traits = await fetchFromPath("traits");
  data.affiliations = await fetchFromPath("affiliations");
  data.positions = await fetchFromPath("positions");
};

const fetchFromPath = async (path) => {
  const response = await fetch(`/${path}/`);
  if (!response.ok) return console.error(await response.text());
  return await response.json();
};

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
  const positions = ["fisherman", "lightbearer", "scout", "spearbearer", "wavecontroller"];
  const positionAmount = Math.floor(Math.random() * 6);
  playerData.combatIndicatorCodes = [];
  for (let i = 0; i < positionAmount; i++) {
    const randomIndex = Math.floor(Math.random() * positions.length);
    playerData.combatIndicatorCodes.push(positions[randomIndex]);
    positions.splice(randomIndex, 1);
  }
  // console.log(positionAmount);
  // console.log(positions);
  // console.log(playerData.combatIndicatorCodes);

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

  // shinsu
  playerData.shinsu = {};
  playerData.shinsu.spent = Math.floor(Math.random() * 11);
  playerData.shinsu.available = Math.floor(Math.random() * (playerData.shinsu.spent + 1));
  playerData.shinsu.recharged = Math.floor(Math.random() * 3);

  return playerData;
};

const loadCombatIndicators = async () => {
  for (let player in data.game) {
    const indicatorsContainer = document.querySelector(`#${player}-container .combat-indicators-container`);
    for (let code of data.game[player].combatIndicatorCodes) {
      const newImg = document.createElement("img");
      newImg.src = `/assets/icons/positions/${code}.png`;
      newImg.alt = code;
      await addTooltip(
        indicatorsContainer,
        newImg,
        data.positions[code].name,
        data.positions[code].description,
        newImg.src
      );
      indicatorsContainer.appendChild(newImg);
    }
  }
};

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

  for (let player in data.game) {
    for (let card of data.game[player].hand) {
      // create div
      const handContainer = document.querySelector(`#${player}-container .hand-container`);
      const newDiv = document.createElement("div");
      newDiv.classList.add("unit-card-vertical-component");
      handContainer.appendChild(newDiv);
      // fetch card data
      if (!data.cards[card.id]) {
        const response = await fetch(`/cards/${card.id}`);
        if (!response.ok) return console.error(await response.text());
        data.cards[card.id] = await response.json();
      }
      // load card component
      await loadComponent(newDiv, "unit-card-vertical", {
        id: card.id,
        traitCodes: card.traitCodes,
        placedPosition: null,
        currentHp: null,
        isSmall: true,
        cardData: data.cards[card.id],
        traitData: data.traits,
        affiliationData: data.affiliations,
        positionData: data.positions,
      });
    }
  }

  alignCards();
  window.addEventListener("resize", alignCards);
};

const loadShinsu = async () => {
  const maxNormalShinsu = 10;
  const maxRechargedShinsu = 2;
  for (let player in data.game) {
    const shinsuContainer = document.querySelector(`#${player}-container .shinsu-container`);
    // normal shinsu
    let shinsuCircles = Array.from(shinsuContainer.querySelectorAll(".shinsu-circle"));
    for (let i = 0; i < data.game[player].shinsu.available; i++) shinsuCircles[i].classList.add("available");
    for (let i = data.game[player].shinsu.available; i < data.game[player].shinsu.spent; i++)
      shinsuCircles[i].classList.add("spent");
    for (let i = data.game[player].shinsu.spent; i < maxNormalShinsu; i++)
      shinsuCircles[i].classList.add("unavailable");
    // recharged shinsu
    for (let i = maxNormalShinsu; i < maxNormalShinsu + data.game[player].shinsu.recharged; i++)
      shinsuCircles[i].classList.add("available");
    for (
      let i = maxNormalShinsu + data.game[player].shinsu.recharged;
      i < maxNormalShinsu + maxRechargedShinsu;
      i++
    )
      shinsuCircles[i].classList.add("spent");
    // tooltips
    const normalContainer = shinsuContainer.querySelector(".normal-shinsu");
    await addTooltip(
      shinsuContainer,
      normalContainer,
      "Shinsu",
      "The resource that lets you play cards and use certain abilities"
    );
    const rechargedContainer = shinsuContainer.querySelector(".recharged-shinsu");
    await addTooltip(
      shinsuContainer,
      rechargedContainer,
      "Recharged Shinsu",
      "The shinsu that wasn't used last turn"
    );
  }
};

document.addEventListener("DOMContentLoaded", async () => {
  await prepareData();

  // debugging
  // addBorderToDivs();
  data.game.opponent = getRandomPlayerData();
  data.game.player = getRandomPlayerData();

  await loadCombatIndicators();
  await loadHands();
  await loadShinsu();
});
