import { loadComponent } from "/utils/component-util.js";

let cardData = {};
let traitData = {};
let positionData = {};

const loadTraits = async (container, traitCodes) => {
  // fetch trait data
  if (Object.keys(traitData).length === 0) {
    const response = await fetch(`/traits/`);
    if (!response.ok) return console.error(await response.text());
    traitData = await response.json();
  }

  // remove invalid trait codes
  traitCodes = traitCodes.filter((code) => traitData[code]);

  // load main traits
  const rowSize = 4;
  const traitsList = container.querySelector(".card-traits");
  const traitsTooltipFrame = container.querySelector(".card-traits-tooltip-frame");
  traitsList.innerHTML = "";
  for (let i = 0; i < traitCodes.length; i++) {
    const code = traitCodes[i];
    const img = document.createElement("img");
    if (i + 1 >= rowSize && traitCodes.length > rowSize) {
      img.src = "/assets/icons/ellipsis.png";
      img.classList.add("show-all-traits");
      img.addEventListener("mouseover", () => traitsTooltipFrame.classList.add("show"));
      img.addEventListener("mouseout", () =>
        setTimeout(() => traitsTooltipFrame.classList.remove("show"), 200)
      );
      traitsList.appendChild(img);
      break;
    }
    img.src = traitData[code].iconPath;
    await addTooltip(
      container,
      img,
      traitData[code].name,
      traitData[code].description,
      traitData[code].iconPath
    );
    traitsList.appendChild(img);
  }
  if (traitCodes.length === 0) traitsList.innerText = "Traits";

  // load tooltip traits
  const traitsTooltip = container.querySelector(".card-traits-tooltip");
  traitsTooltip.innerHTML = "";
  let tooltipRow = document.createElement("div"); // first row
  tooltipRow.classList.add("card-traits-tooltip-row", "container-horizontal");
  for (let i = 3; i < traitCodes.length; i++) {
    const code = traitCodes[i];
    const img = document.createElement("img");
    img.src = traitData[code].iconPath;
    await addTooltip(
      container,
      img,
      traitData[code].name,
      traitData[code].description,
      traitData[code].iconPath
    );
    tooltipRow.appendChild(img);
    // end of row
    if (i % 4 === 2 || i === traitCodes.length - 1) {
      traitsTooltip.appendChild(tooltipRow);
      tooltipRow = document.createElement("div");
      tooltipRow.classList.add("card-traits-tooltip-row", "container-horizontal");
    }
  }
};

const loadAbilities = (container, abilities) => {
  const abilitiesList = container.querySelector(".card-abilities");
  abilitiesList.innerHTML = "";
  for (let ability of abilities) {
    const li = document.createElement("li");
    li.innerText = ability;
    abilitiesList.appendChild(li);
  }
};

const loadPositions = async (container, positionCodes) => {
  // fetch position data
  if (Object.keys(positionData).length === 0) {
    const response = await fetch(`/positions/`);
    if (!response.ok) return console.error(await response.text());
    positionData = await response.json();
  }

  const positionsList = container.querySelector(".card-positions");
  positionsList.innerHTML = "";
  for (let code of positionCodes) {
    const li = document.createElement("li");
    li.style.backgroundImage = `url("${positionData[code].iconPath}")`;
    await addTooltip(
      container,
      li,
      positionData[code].name,
      positionData[code].description,
      positionData[code].iconPath
    );
    positionsList.appendChild(li);
  }
};

const addTooltip = async (container, hoverContainer, title, text, iconPath = null) => {
  const tooltipComponent = document.createElement("div");
  tooltipComponent.classList.add("tooltip-component");
  container.appendChild(tooltipComponent);
  await loadComponent(tooltipComponent, "tooltip", { hoverContainer, title, text, iconPath });
};

const load = async (container, { id, traitCodes = null, placedPosition = null, currentHp = null }) => {
  if (id === null) return;
  if (!cardData[id]) {
    const response = await fetch(`/cards/${id}`);
    if (!response.ok) return console.error(await response.text());
    cardData[id] = await response.json();
  }

  // name
  const nameContainer = container.querySelector(".card-name");
  nameContainer.innerText = cardData[id].name;
  if (cardData[id].sobriquet)
    await addTooltip(container, nameContainer, cardData[id].name, cardData[id].sobriquet);
  // artwork
  container.querySelector(".card-artwork").style.backgroundImage = `url("${cardData[id].artworkPath}")`;
  // traits
  await loadTraits(container, traitCodes || cardData[id].traitCodes);
  // affiliations
  // abilities
  await loadAbilities(container, cardData[id].abilities);
  // shinsu
  const shinsuContainer = container.querySelector(".card-shinsu");
  shinsuContainer.innerText = cardData[id].cost;
  await addTooltip(container, shinsuContainer, "Shinsu", "The cost of playing this card");
  // positions
  let positionCodes = cardData[id].positionCodes;
  if (placedPosition && placedPosition in cardData[id].positionCodes) positionCodes = [placedPosition];
  await loadPositions(container, positionCodes);
  // hp
  const hpContainer = container.querySelector(".card-hp");
  hpContainer.innerText = currentHp || cardData[id].hp;
  await addTooltip(container, hpContainer, "HP", "The current hit points of this unit card");
};

export default load;
