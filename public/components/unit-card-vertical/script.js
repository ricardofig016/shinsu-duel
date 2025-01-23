import { loadComponent } from "/utils/component-util.js";

let cardData = {};
let traitData = {};
let affiliationData = {};
let positionData = {};

const loadName = async (container, name, sobriquet) => {
  const nameContainer = container.querySelector(".card-name");
  nameContainer.innerText = name;
  if (sobriquet) await addTooltip(container, nameContainer, name, sobriquet);
};

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

const loadAffiliations = async (container, affiliationCodes) => {
  // fetch affiliation data
  if (Object.keys(affiliationData).length === 0) {
    const response = await fetch(`/affiliations/`);
    if (!response.ok) return console.error(await response.text());
    affiliationData = await response.json();
  }

  // remove invalid affiliation codes
  affiliationCodes = affiliationCodes.filter((code) => affiliationData[code]);
  if (affiliationCodes.length === 0) return;

  // first affiliation
  const affiliationsContainer = container.querySelector(".card-affiliations");
  affiliationsContainer.innerHTML = affiliationData[affiliationCodes[0]].name;
  if (affiliationCodes.length === 1) return;

  // hover to show tooltip
  const affiliationsTooltipFrame = container.querySelector(".card-affiliations-tooltip-frame");
  affiliationsContainer.addEventListener("mouseover", () => affiliationsTooltipFrame.classList.add("show"));
  affiliationsContainer.addEventListener("mouseout", () =>
    setTimeout(() => affiliationsTooltipFrame.classList.remove("show"), 200)
  );

  // load affiliations
  const affiliationsTooltip = container.querySelector(".card-affiliations-tooltip");
  affiliationsTooltip.innerHTML = "";
  for (let i = 1; i < affiliationCodes.length; i++) {
    const code = affiliationCodes[i];
    const p = document.createElement("p");
    p.innerText = affiliationData[code].name;
    affiliationsTooltip.appendChild(p);
  }
};

const loadAbilities = (container, abilities) => {
  const abilitiesList = container.querySelector(".card-abilities");
  abilitiesList.innerHTML = "";
  const maxSize = { width: abilitiesList.scrollWidth, height: abilitiesList.scrollHeight };
  let fontSize = 2; // base font size
  const minFontSize = 1;
  let currentSize = { width: 0, height: 0 };
  let listItems = [];

  // create list items
  for (let ability of abilities) {
    const li = document.createElement("li");
    li.innerText = ability;
    abilitiesList.appendChild(li);
    li.addEventListener("click", () => console.log(ability));
    listItems.push(li);
  }

  // adjust font size
  do {
    if (fontSize < minFontSize) break;
    for (let item of listItems) item.style.fontSize = `${fontSize}em`;
    fontSize -= 0.2;
    currentSize = { width: abilitiesList.scrollWidth, height: abilitiesList.scrollHeight };
  } while (currentSize.width > maxSize.width || currentSize.height > maxSize.height);

  // set max height
  abilitiesList.style.maxHeight = `${maxSize.height}px`;
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

const load = async (
  container,
  { id, traitCodes = null, placedPosition = null, currentHp = null, isSmall = false }
) => {
  if (id === null) return;
  if (!cardData[id]) {
    const response = await fetch(`/cards/${id}`);
    if (!response.ok) return console.error(await response.text());
    cardData[id] = await response.json();
  }

  //size
  const cardFrame = container.querySelector(".card-frame");
  cardFrame.classList.remove("card-small", "card-big");
  cardFrame.classList.add(isSmall ? "card-small" : "card-big");
  if (isSmall) {
    cardFrame.addEventListener("contextmenu", async (event) => {
      event.preventDefault();
      const cardComponent = document.createElement("div");
      cardComponent.classList.add("unit-card-vertical-component");
      container.appendChild(cardComponent);
      await loadComponent(cardComponent, "unit-card-vertical", {
        id,
        traitCodes,
        placedPosition,
        currentHp,
        isSmall: false,
      });
    });
  } else {
    document.addEventListener("click", async (event) => {
      if (event.target !== cardFrame && !cardFrame.contains(event.target)) container.remove();
    });
    let removeCount = 0;
    document.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      if (event.target !== cardFrame && !cardFrame.contains(event.target) && removeCount > 0)
        container.remove();
      removeCount++;
    });
  }

  // name
  await loadName(container, cardData[id].name, cardData[id].sobriquet);
  // artwork
  container.querySelector(".card-artwork").style.backgroundImage = `url("${cardData[id].artworkPath}")`;
  // traits
  await loadTraits(container, traitCodes || cardData[id].traitCodes);
  // affiliations
  await loadAffiliations(container, cardData[id].affiliationCodes);
  // abilities
  await loadAbilities(container, cardData[id].abilities);
  // shinsu
  const shinsuContainer = container.querySelector(".card-shinsu");
  shinsuContainer.innerText = cardData[id].cost;
  await addTooltip(container, shinsuContainer, "Shinsu", "The cost of playing this card");
  // positions
  let positionCodes = cardData[id].positionCodes;
  if (placedPosition && positionCodes.includes(placedPosition)) positionCodes = [placedPosition];
  await loadPositions(container, positionCodes);
  // hp
  const hpContainer = container.querySelector(".card-hp");
  hpContainer.innerText = currentHp || cardData[id].hp;
  await addTooltip(container, hpContainer, "HP", "The current hit points of this unit card");
};

export default load;
