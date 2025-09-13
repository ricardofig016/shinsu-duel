import { loadComponent, addTooltip } from "/utils/component-util.js";

const load = async (
  container,
  {
    id = null,
    traitCodes = null,
    placedPositionCode = null,
    currentHp = null,
    isSmall = false,
    cardData,
    traitData,
    affiliationData,
    positionData,
  }
) => {
  // display card back
  const cardElement = container.querySelector(".unit-card-horizontal");
  if (id === null || !placedPositionCode || !cardData || !traitData || !affiliationData || !positionData) {
    console.error("Invalid data", {
      id,
      placedPositionCode,
      cardData,
      traitData,
      affiliationData,
      positionData,
    });
    cardElement.style.backgroundImage = `url("/assets/images/card/back.png")`;
    cardElement.innerHTML = "";
    return;
  }

  // expand to vertical card
  cardElement.addEventListener("contextmenu", async (event) => {
    event.preventDefault();
    const cardComponent = document.createElement("div");
    cardComponent.classList.add("unit-card-vertical-component");
    cardElement.appendChild(cardComponent);
    await loadComponent(cardComponent, "unit-card-vertical", {
      id,
      traitCodes,
      placedPositionCode,
      currentHp,
      isSmall: false,
      cardData,
      traitData,
      affiliationData,
      positionData,
    });
  });

  // artwork
  const artworkContainer = container.querySelector(".unit-card-horizontal-artwork");
  artworkContainer.style.backgroundImage = `url("${cardData.artworkPath}")`;
  await addTooltip(container, artworkContainer, cardData.name, cardData.abilityCodes);
  // position
  const positionContainer = container.querySelector(".unit-card-horizontal-position");
  positionContainer.innerHTML = "";
  positionContainer.style.backgroundImage = `url("${positionData[placedPositionCode].iconPath}")`;
  await addTooltip(
    container,
    positionContainer,
    positionData[placedPositionCode].name,
    positionData[placedPositionCode].description,
    positionData[placedPositionCode].iconPath
  );
  // hp
  const hpContainer = container.querySelector(".unit-card-horizontal-hp");
  hpContainer.querySelector("h1").innerText = currentHp || cardData.hp;
  await addTooltip(container, hpContainer, "HP", "The current hit points of this unit card");
};

export default load;
