import { loadComponent, addTooltip } from "/utils/component-util.js";

const DEFAULT_BACK_IMAGE = "/assets/images/card/back.png";
const DEFAULT_ARTWORK = "/assets/images/placeholder.png";
const DEFAULT_POSITION_ICON = "/assets/icons/positions/placeholder.png";

const load = async (container, { unit, isSmall = false }) => {
  const cardElement = container.querySelector(".unit-card-horizontal");

  // Basic validation: allow currentHp === 0, but require placedPositionCode and affiliations/traits objects
  if (!unit || typeof unit !== "object" || !unit.card || typeof unit.card !== "object") {
    console.error("Invalid data for unit-card-horizontal", unit);
    cardElement.style.backgroundImage = `url("${DEFAULT_BACK_IMAGE}")`;
    cardElement.innerHTML = "";
    return;
  }

  // expand to vertical card on right-click (safe, use local available data)
  cardElement.addEventListener("contextmenu", async (event) => {
    event.preventDefault();
    const cardComponent = document.createElement("div");
    cardComponent.classList.add("unit-card-vertical-component");
    cardElement.appendChild(cardComponent);
    await loadComponent(cardComponent, "unit-card-vertical", {
      unit,
      isSmall: false,
    });
  });

  // artwork (use fallback if missing)
  const artworkContainer = container.querySelector(".unit-card-horizontal-artwork");
  const artworkPath =
    typeof unit.card.artworkPath === "string" && unit.card.artworkPath.trim() !== ""
      ? unit.card.artworkPath
      : DEFAULT_ARTWORK;
  artworkContainer.style.backgroundImage = `url("${artworkPath}")`;
  const abilityTexts = unit.card.abilities.map((ability) => ability.text);
  await addTooltip(container, artworkContainer, unit.card.name, abilityTexts || []);

  // position icon (use fallback if missing)
  const positionContainer = container.querySelector(".unit-card-horizontal-position");
  positionContainer.innerHTML = "";
  const placedPosition = unit.card.positions[unit.placedPositionCode];
  const positionIcon = placedPosition.iconPath || DEFAULT_POSITION_ICON;
  positionContainer.style.backgroundImage = `url("${positionIcon}")`;
  await addTooltip(
    container,
    positionContainer,
    placedPosition.name,
    placedPosition.description,
    positionIcon
  );

  // hp (use 0 if missing)
  const hpContainer = container.querySelector(".unit-card-horizontal-hp");
  const hpValue = unit.currentHp ? unit.currentHp : "0";
  const hpHeader = hpContainer.querySelector("h1");
  if (hpHeader) hpHeader.innerText = hpValue;
  await addTooltip(container, hpContainer, "HP", "The current hit points of this unit card");
};

export default load;
