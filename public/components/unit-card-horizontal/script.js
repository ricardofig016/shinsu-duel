import { loadComponent, addTooltip } from "/utils/component-util.js";

const DEFAULT_ARTWORK = "/assets/images/placeholder.png";
const DEFAULT_POSITION_ICON = "/assets/icons/positions/placeholder.png";

const safePath = (p, fallback) => {
  if (typeof p === "string" && p.trim() !== "" && p !== "undefined" && p !== "null") return p;
  return fallback;
};

/**
 * Compact runtime-state badges: conditions with magnitudes, equipment
 * attachments, granted abilities, and runtime traits. Text content only.
 */
const loadStatus = (container, unit) => {
  const statusContainer = container.querySelector(".unit-card-horizontal-status");
  const badges = [
    ...unit.conditions.map((condition) => ({ text: `${condition.key} ${condition.magnitude}`, kind: "condition" })),
    ...unit.equipmentAttachments.map((name) => ({ text: name, kind: "equipment" })),
    ...unit.grantedAbilities.map((granted) => ({ text: granted.abilityCode, kind: "granted-ability" })),
    ...unit.runtimeTraits.map((key) => ({ text: key, kind: "runtime-trait" })),
  ];
  if (badges.length === 0) {
    statusContainer.classList.add("hidden");
    return;
  }
  statusContainer.classList.remove("hidden");
  statusContainer.replaceChildren(
    ...badges.map(({ text, kind }) => {
      const badge = document.createElement("span");
      badge.className = `unit-card-horizontal-badge ${kind}`;
      badge.textContent = text;
      return badge;
    })
  );
};

const load = async (container, { unit, interactive = false, onAbilityClick = null }) => {
  const cardElement = container.querySelector(".unit-card-horizontal");

  // basic validation: the input is a buildUnitViewModel view model
  if (!unit || typeof unit !== "object" || typeof unit.name !== "string" || !Array.isArray(unit.abilities)) {
    cardElement.style.backgroundImage = `url("/assets/images/card/back.png")`;
    cardElement.innerHTML = "";
    return;
  }

  // expand to the full card on right-click; ability clicks are wired for your
  // own units only
  cardElement.addEventListener("contextmenu", async (event) => {
    event.preventDefault();
    const cardComponent = document.createElement("div");
    cardComponent.classList.add("unit-card-vertical-component");
    cardElement.appendChild(cardComponent);
    await loadComponent(cardComponent, "unit-card-vertical", {
      unit,
      isSmall: false,
      onAbilityClick: interactive ? onAbilityClick : null,
    });
  });

  // artwork (use fallback if missing)
  const artworkContainer = container.querySelector(".unit-card-horizontal-artwork");
  artworkContainer.style.backgroundImage = `url("${safePath(unit.artworkPath, DEFAULT_ARTWORK)}")`;
  await addTooltip(container, artworkContainer, unit.name, unit.abilities.map((ability) => ability.text));

  // status badges
  loadStatus(container, unit);

  // position icons: the placed position, plus the chosen one when a landmark
  // choice moved the unit and differs from where it stands
  const positionContainer = container.querySelector(".unit-card-horizontal-position:not(.unit-card-horizontal-position-chosen)");
  const chosenContainer = container.querySelector(".unit-card-horizontal-position-chosen");
  const placedPosition = unit.placedPositionCode ? unit.positions[unit.placedPositionCode] : null;
  const chosenPosition =
    unit.chosenPositionCode && unit.chosenPositionCode !== unit.placedPositionCode
      ? unit.positions[unit.chosenPositionCode]
      : null;
  positionContainer.innerHTML = "";
  if (placedPosition) {
    const positionIcon = safePath(placedPosition.iconPath, DEFAULT_POSITION_ICON);
    positionContainer.style.backgroundImage = `url("${positionIcon}")`;
    await addTooltip(container, positionContainer, placedPosition.name, placedPosition.description, positionIcon);
  } else {
    positionContainer.style.backgroundImage = `url("${DEFAULT_POSITION_ICON}")`;
  }
  if (chosenPosition) {
    const chosenIcon = safePath(chosenPosition.iconPath, DEFAULT_POSITION_ICON);
    chosenContainer.classList.remove("hidden");
    chosenContainer.style.backgroundImage = `url("${chosenIcon}")`;
    await addTooltip(
      container,
      chosenContainer,
      chosenPosition.name,
      chosenPosition.description + " (chosen)",
      chosenIcon
    );
  } else {
    chosenContainer.classList.add("hidden");
  }

  // hp (use 0 if missing)
  const hpContainer = container.querySelector(".unit-card-horizontal-hp");
  const hpHeader = hpContainer.querySelector("h1");
  if (hpHeader) hpHeader.innerText = unit.currentHp ?? 0;
  await addTooltip(container, hpContainer, "HP", "The current hit points of this unit card");
};

export default load;
