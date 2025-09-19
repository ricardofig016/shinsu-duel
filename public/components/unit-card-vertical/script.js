import { loadComponent, addTooltip } from "/utils/component-util.js";

const DEFAULT_PASSIVE_ABILITIES_ICON = "/assets/icons/passive-ability/infinity.png";
const DEFAULT_ARTWORK = "/assets/images/placeholder.png";
const DEFAULT_TRAIT_ICON = "/assets/icons/traits/placeholder.png";
const DEFAULT_POSITION_ICON = "/assets/icons/positions/placeholder.png";

const safePath = (p, fallback) => {
  if (typeof p === "string" && p.trim() !== "" && p !== "undefined" && p !== "null") return p;
  return fallback;
};

const displayCardBack = (container) => {
  const cardFrame = container.querySelector(".unit-card-vertical-frame");
  cardFrame.style.backgroundImage = `url("/assets/images/card/back.png")`;
  cardFrame.classList.add("unit-card-vertical-small", "no-hover");
  cardFrame.innerHTML = "";
};

const useAbility = (socket, unitId, abilityCode) => {
  if (!socket || !unitId || !abilityCode) return;
  socket.emit("game-action", {
    type: "use-ability-action",
    data: {
      unitId: unitId,
      abilityCode: abilityCode,
    },
  });
};

const load = async (container, { unit, card, isSmall = false, socket = null }) => {
  const loadPassiveAbility = async (container, passives) => {
    const passiveContainer = container.querySelector(".unit-card-vertical-passive-abilities");

    if (passives.length === 0) return passiveContainer.classList.add("hidden");

    passiveContainer.classList.remove("hidden");
    addTooltip(
      container,
      passiveContainer,
      "Passive Abilities",
      passives.map((p) => p.text) || [],
      DEFAULT_PASSIVE_ABILITIES_ICON
    );
  };

  const loadName = async (container, name, sobriquet) => {
    const titleContainer = container.querySelector(".unit-card-vertical-title");
    const nameContainer = container.querySelector(".unit-card-vertical-name");
    // set text (truncation handled by CSS)
    nameContainer.innerText = name;
    await addTooltip(container, nameContainer, name, sobriquet ? sobriquet : "");
    return;
  };

  const loadTraits = async (container, traits) => {
    // load main traits
    const rowSize = 4;
    const traitsList = container.querySelector(".unit-card-vertical-traits");
    const traitsTooltipFrame = container.querySelector(".unit-card-vertical-traits-tooltip-frame");
    traitsList.innerHTML = "";
    const traitCodes = Object.keys(traits);
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
      const traitIcon = safePath(traits[code].iconPath, DEFAULT_TRAIT_ICON);
      img.src = traitIcon;
      await addTooltip(container, img, traits[code].name, traits[code].description, traitIcon);
      traitsList.appendChild(img);
    }
    if (traitCodes.length === 0) traitsList.innerText = "Traits";

    // load tooltip traits
    const traitsTooltip = container.querySelector(".unit-card-vertical-traits-tooltip");
    traitsTooltip.innerHTML = "";
    let tooltipRow = document.createElement("div"); // first row
    tooltipRow.classList.add("unit-card-vertical-traits-tooltip-row", "container-horizontal");
    for (let i = 3; i < traitCodes.length; i++) {
      const code = traitCodes[i];
      const img = document.createElement("img");
      const traitIcon = safePath(traits[code].iconPath, DEFAULT_TRAIT_ICON);
      img.src = traitIcon;
      await addTooltip(container, img, traits[code].name, traits[code].description, traitIcon);
      tooltipRow.appendChild(img);
      // end of row
      if (i % 4 === 2 || i === traitCodes.length - 1) {
        traitsTooltip.appendChild(tooltipRow);
        tooltipRow = document.createElement("div");
        tooltipRow.classList.add("unit-card-vertical-traits-tooltip-row", "container-horizontal");
      }
    }
  };

  const loadAffiliations = async (container, affiliations) => {
    const affiliationCodes = Object.keys(affiliations);
    // first affiliation
    const affiliationsContainer = container.querySelector(".unit-card-vertical-affiliations");
    const text = affiliationCodes.length === 0 ? "Affiliations" : affiliations[affiliationCodes[0]].name;
    affiliationsContainer.innerHTML = text;
    if (affiliationCodes.length <= 1) return;

    // hover to show tooltip
    const affiliationsTooltipFrame = container.querySelector(
      ".unit-card-vertical-affiliations-tooltip-frame"
    );
    affiliationsContainer.addEventListener("mouseover", () => affiliationsTooltipFrame.classList.add("show"));
    affiliationsContainer.addEventListener("mouseout", () =>
      setTimeout(() => affiliationsTooltipFrame.classList.remove("show"), 200)
    );

    // load affiliations
    const affiliationsTooltip = container.querySelector(".unit-card-vertical-affiliations-tooltip");
    affiliationsTooltip.innerHTML = "";
    for (let i = 1; i < affiliationCodes.length; i++) {
      const code = affiliationCodes[i];
      const p = document.createElement("p");
      p.innerText = affiliations[code].name;
      affiliationsTooltip.appendChild(p);
    }
  };

  const loadAbilities = (container, abilities) => {
    const abilitiesList = container.querySelector(".unit-card-vertical-abilities");
    const maxSize = { width: abilitiesList.scrollWidth, height: abilitiesList.scrollHeight };
    abilitiesList.innerHTML = "";
    let fontSize = 2; // base font size
    const minFontSize = 1;
    let currentSize = { width: 0, height: 0 };
    let listItems = [];

    // create list items
    for (let ability of abilities) {
      const li = document.createElement("li");
      li.innerText = ability.text;
      abilitiesList.appendChild(li);
      li.addEventListener("click", () => {
        useAbility(socket, unit.id, ability.code);
      });
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

  const loadPositions = async (container, positions) => {
    const positionsList = container.querySelector(".unit-card-vertical-positions");
    positionsList.innerHTML = "";
    for (let code of Object.keys(positions)) {
      const li = document.createElement("li");
      const posIcon = safePath(positions[code].iconPath, DEFAULT_POSITION_ICON);
      li.style.backgroundImage = `url("${posIcon}")`;
      await addTooltip(container, li, positions[code].name, positions[code].description, posIcon);
      positionsList.appendChild(li);
    }
  };

  // Need either unit or card, but not both
  if ((unit && card) || (!unit && !card)) return displayCardBack(container);

  if (unit) card = unit.card;

  // hidden card
  if (card.cardId == null) return displayCardBack(container);

  // size
  const cardFrame = container.querySelector(".unit-card-vertical-frame");
  cardFrame.classList.remove("unit-card-vertical-small", "unit-card-vertical-big");
  cardFrame.classList.add(isSmall ? "unit-card-vertical-small" : "unit-card-vertical-big");
  if (isSmall) {
    cardFrame.addEventListener("contextmenu", async (event) => {
      event.preventDefault();
      const cardComponent = document.createElement("div");
      cardComponent.classList.add("unit-card-vertical-component");
      container.appendChild(cardComponent);
      await loadComponent(cardComponent, "unit-card-vertical", {
        unit: unit,
        card: unit ? null : card, // only pass card if this isn't a unit
        isSmall: false,
        socket: unit ? null : socket, // only pass socket if this isn't a unit
      });
    });
  } else {
    document.addEventListener("mousedown", (event) => {
      // close the big card if clicked outside
      if (event.target !== cardFrame && !cardFrame.contains(event.target)) container.remove();
    });
  }

  // passive ability
  await loadPassiveAbility(container, card.passiveAbilities);
  // name
  await loadName(container, card.name, card.sobriquet);
  // artwork (use fallback when missing)
  const artworkPath = safePath(card.artworkPath, DEFAULT_ARTWORK);
  container.querySelector(".unit-card-vertical-artwork").style.backgroundImage = `url("${artworkPath}")`;
  // traits
  await loadTraits(container, card.traits);
  // affiliations
  await loadAffiliations(container, card.affiliations);
  // abilities
  await loadAbilities(container, card.abilities);
  // shinsu
  const shinsuContainer = container.querySelector(".unit-card-vertical-shinsu");
  shinsuContainer.innerText = card.cost;
  await addTooltip(container, shinsuContainer, "Shinsu", "The cost of playing this card");
  // positions
  let positionsToLoad = card.positions;
  if (unit && unit.placedPositionCode && unit.placedPositionCode in unit.card.positions)
    positionsToLoad = { [unit.placedPositionCode]: unit.card.positions[unit.placedPositionCode] };
  await loadPositions(container, positionsToLoad);
  // hp
  const hpContainer = container.querySelector(".unit-card-vertical-hp");
  hpContainer.innerText = unit ? unit.currentHp : card.maxHp;
  const hpText = unit
    ? "The current hit points of this unit card"
    : "The maximum hit points of this unit card";
  await addTooltip(container, hpContainer, "HP", hpText);
};

export default load;
