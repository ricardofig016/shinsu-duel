import { loadComponent } from "/utils/component-util.js";

let cardData = {};
let traitData = {};

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
    await addTooltip(img, traitData[code].name, traitData[code].description, traitData[code].iconPath);
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
    await addTooltip(img, traitData[code].name, traitData[code].description, traitData[code].iconPath);
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

const loadPositions = (container, positionCodes, positionData) => {
  const positionsList = container.querySelector(".card-positions");
  positionsList.innerHTML = "";
  for (let code of positionCodes) {
    const li = document.createElement("li");
    li.style.backgroundImage = `url("${positionData[code].iconPath}")`;
    positionsList.appendChild(li);
  }
};

const addTooltip = async (hoverContainer, title, text, iconPath) => {
  const tooltipComponent = document.createElement("div");
  tooltipComponent.classList.add("tooltip-component");
  document.body.appendChild(tooltipComponent);
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
  container.querySelector(".card-name").innerText = cardData[id].name;
  // artwork
  container.querySelector(".card-artwork").style.backgroundImage = `url("${cardData[id].artworkPath}")`;
  // traits
  await loadTraits(container, traitCodes || cardData[id].traitCodes);
  // affiliations
  // abilities
  loadAbilities(container, cardData[id].abilities);
  // shinsu
  container.querySelector(".card-shinsu").innerText = cardData[id].cost;
  // positions
  let positionCodes = Object.keys(cardData[id].positions);
  if (placedPosition && cardData[id].positions[placedPosition]) positionCodes = [placedPosition];
  loadPositions(container, positionCodes, cardData[id].positions);
  // hp
  container.querySelector(".card-hp").innerText = currentHp || cardData[id].hp;
};

export default load;
