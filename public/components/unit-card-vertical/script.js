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

/**
 * Runtime state rows for a unit: conditions with magnitudes, equipment
 * attachments, and runtime traits. Text content only, hidden for plain cards.
 */
const loadStatus = (container, unit) => {
  const statusContainer = container.querySelector(".unit-card-vertical-status");
  const rows = [];
  if (unit.conditions.length > 0) {
    rows.push({ label: "Conditions", value: unit.conditions.map((c) => `${c.key} ${c.magnitude}`).join(", ") });
  }
  if (unit.equipmentAttachments.length > 0) {
    rows.push({ label: "Equipped", value: unit.equipmentAttachments.join(", ") });
  }
  if (unit.runtimeTraits.length > 0) {
    rows.push({ label: "Runtime traits", value: unit.runtimeTraits.join(", ") });
  }
  if (rows.length === 0) {
    statusContainer.classList.add("hidden");
    return;
  }
  statusContainer.classList.remove("hidden");
  statusContainer.replaceChildren(
    ...rows.map(({ label, value }) => {
      const row = document.createElement("div");
      row.className = "unit-card-vertical-status-row";
      const labelSpan = document.createElement("span");
      labelSpan.className = "unit-card-vertical-status-label";
      labelSpan.textContent = label;
      const valueSpan = document.createElement("span");
      valueSpan.textContent = value;
      row.append(labelSpan, valueSpan);
      return row;
    })
  );
};

const load = async (container, { card = null, unit = null, isSmall = false, onAbilityClick = null }) => {
  const loadPassiveAbility = async (container, passives) => {
    const passiveContainer = container.querySelector(".unit-card-vertical-passive-abilities");

    if (passives.length === 0) return passiveContainer.classList.add("hidden");

    passiveContainer.classList.remove("hidden");
    addTooltip(
      container,
      passiveContainer,
      "Passive Abilities",
      passives.map((p) => p.text),
      DEFAULT_PASSIVE_ABILITIES_ICON
    );
  };

  const loadName = async (container, name, sobriquet) => {
    const nameContainer = container.querySelector(".unit-card-vertical-name");
    nameContainer.innerText = name;
    await addTooltip(container, nameContainer, name, sobriquet ? sobriquet : "");
  };

  const loadTraits = async (container, printedTraits) => {
    const rowSize = 4;
    const traitsList = container.querySelector(".unit-card-vertical-traits");
    const traitsTooltipFrame = container.querySelector(".unit-card-vertical-traits-tooltip-frame");
    traitsList.innerHTML = "";
    for (let i = 0; i < printedTraits.length; i++) {
      const trait = printedTraits[i];
      const img = document.createElement("img");
      if (i + 1 >= rowSize && printedTraits.length > rowSize) {
        img.src = "/assets/icons/ellipsis.png";
        img.addEventListener("mouseover", () => traitsTooltipFrame.classList.add("show"));
        img.addEventListener("mouseout", () =>
          setTimeout(() => traitsTooltipFrame.classList.remove("show"), 200)
        );
        traitsList.appendChild(img);
        break;
      }
      const traitIcon = safePath(trait.iconPath, DEFAULT_TRAIT_ICON);
      img.src = traitIcon;
      await addTooltip(container, img, trait.name, trait.description, traitIcon);
      traitsList.appendChild(img);
    }
    if (printedTraits.length === 0) traitsList.innerText = "Traits";

    // load tooltip traits
    const traitsTooltip = container.querySelector(".unit-card-vertical-traits-tooltip");
    traitsTooltip.innerHTML = "";
    let tooltipRow = document.createElement("div");
    tooltipRow.classList.add("unit-card-vertical-traits-tooltip-row", "container-horizontal");
    for (let i = rowSize - 1; i < printedTraits.length; i++) {
      const trait = printedTraits[i];
      const img = document.createElement("img");
      const traitIcon = safePath(trait.iconPath, DEFAULT_TRAIT_ICON);
      img.src = traitIcon;
      await addTooltip(container, img, trait.name, trait.description, traitIcon);
      tooltipRow.appendChild(img);
      if ((i - (rowSize - 1)) % rowSize === rowSize - 1 || i === printedTraits.length - 1) {
        traitsTooltip.appendChild(tooltipRow);
        tooltipRow = document.createElement("div");
        tooltipRow.classList.add("unit-card-vertical-traits-tooltip-row", "container-horizontal");
      }
    }
  };

  const loadAffiliations = async (container, affiliations) => {
    const affiliationsContainer = container.querySelector(".unit-card-vertical-affiliations");
    const text = affiliations.length === 0 ? "Affiliations" : affiliations[0].name;
    affiliationsContainer.innerText = text;
    if (affiliations.length <= 1) return;

    const affiliationsTooltipFrame = container.querySelector(
      ".unit-card-vertical-affiliations-tooltip-frame"
    );
    affiliationsContainer.addEventListener("mouseover", () => affiliationsTooltipFrame.classList.add("show"));
    affiliationsContainer.addEventListener("mouseout", () =>
      setTimeout(() => affiliationsTooltipFrame.classList.remove("show"), 200)
    );

    const affiliationsTooltip = container.querySelector(".unit-card-vertical-affiliations-tooltip");
    affiliationsTooltip.replaceChildren(
      ...affiliations.slice(1).map((affiliation) => {
        const p = document.createElement("p");
        p.textContent = affiliation.name;
        return p;
      })
    );
  };

  const loadAbilities = (container, model, unit, onAbilityClick) => {
    const abilitiesList = container.querySelector(".unit-card-vertical-abilities");
    const maxSize = { width: abilitiesList.scrollWidth, height: abilitiesList.scrollHeight };
    abilitiesList.innerHTML = "";
    let fontSize = 2; // base font size
    const minFontSize = 1;
    let currentSize = { width: 0, height: 0 };
    let listItems = [];

    // Ability clicks exist only where the page wired them: your own units.
    const abilityClick = unit && onAbilityClick ? (code) => onAbilityClick(unit.id, code) : null;

    const addAbilityItem = (text, code, isGranted) => {
      const li = document.createElement("li");
      li.innerText = text;
      if (isGranted) li.classList.add("unit-card-vertical-granted-ability");
      if (abilityClick && code) li.addEventListener("click", () => abilityClick(code));
      abilitiesList.appendChild(li);
      listItems.push(li);
    };

    for (let ability of model.abilities) addAbilityItem(ability.text, ability.code, false);
    for (let granted of unit ? unit.grantedAbilities : []) {
      addAbilityItem(granted.text, granted.abilityCode, true);
    }

    // adjust font size
    do {
      if (fontSize < minFontSize) break;
      for (let item of listItems) item.style.fontSize = `${fontSize}em`;
      fontSize -= 0.2;
      currentSize = { width: abilitiesList.scrollWidth, height: abilitiesList.scrollHeight };
    } while (currentSize.width > maxSize.width || currentSize.height > maxSize.height);

    abilitiesList.style.maxHeight = `${maxSize.height}px`;
  };

  const loadPositions = async (container, model, unit) => {
    const positionsList = container.querySelector(".unit-card-vertical-positions");
    positionsList.innerHTML = "";
    const entries = [];
    if (unit) {
      const placed = unit.placedPositionCode ? model.positions[unit.placedPositionCode] : null;
      if (placed) entries.push({ position: placed, chosen: false });
      const chosen =
        unit.chosenPositionCode && unit.chosenPositionCode !== unit.placedPositionCode
          ? model.positions[unit.chosenPositionCode]
          : null;
      if (chosen) entries.push({ position: chosen, chosen: true });
    } else {
      for (const code of Object.keys(model.positions)) {
        entries.push({ position: model.positions[code], chosen: false });
      }
    }
    for (const { position, chosen } of entries) {
      const li = document.createElement("li");
      const posIcon = safePath(position.iconPath, DEFAULT_POSITION_ICON);
      li.style.backgroundImage = `url("${posIcon}")`;
      if (chosen) li.classList.add("chosen-position");
      await addTooltip(
        container,
        li,
        position.name,
        position.description + (chosen ? " (chosen)" : ""),
        posIcon
      );
      positionsList.appendChild(li);
    }
  };

  // Need either unit or card, but not both; both are flattened view models.
  if ((unit && card) || (!unit && !card)) return displayCardBack(container);
  const model = unit ?? card;

  // hidden card
  if (model.cardId == null) return displayCardBack(container);

  // size
  const cardFrame = container.querySelector(".unit-card-vertical-frame");
  cardFrame.classList.remove("unit-card-vertical-small", "unit-card-vertical-big", "no-hover");
  cardFrame.classList.add(isSmall ? "unit-card-vertical-small" : "unit-card-vertical-big");
  if (isSmall) {
    cardFrame.addEventListener("contextmenu", async (event) => {
      event.preventDefault();
      const cardComponent = document.createElement("div");
      cardComponent.classList.add("unit-card-vertical-component");
      container.appendChild(cardComponent);
      await loadComponent(cardComponent, "unit-card-vertical", {
        unit: unit ?? null,
        card: unit ? null : model,
        isSmall: false,
        onAbilityClick: unit ? onAbilityClick : null,
      });
    });
  } else {
    // close the big card when clicking outside; the listener removes itself
    const closeOnClickOutside = (event) => {
      if (!container.isConnected) {
        document.removeEventListener("mousedown", closeOnClickOutside);
        return;
      }
      if (event.target !== cardFrame && !cardFrame.contains(event.target)) {
        document.removeEventListener("mousedown", closeOnClickOutside);
        container.remove();
      }
    };
    document.addEventListener("mousedown", closeOnClickOutside);
  }

  // passive ability
  await loadPassiveAbility(container, model.passiveAbilities);
  // name
  await loadName(container, model.name, model.sobriquet);
  // artwork (use fallback when missing)
  const artworkPath = safePath(model.artworkPath, DEFAULT_ARTWORK);
  container.querySelector(".unit-card-vertical-artwork").style.backgroundImage = `url("${artworkPath}")`;
  // traits
  await loadTraits(container, model.printedTraits);
  // affiliations
  await loadAffiliations(container, model.affiliations);
  // runtime state (units only; hidden for plain cards)
  if (unit) loadStatus(container, unit);
  else container.querySelector(".unit-card-vertical-status").classList.add("hidden");
  // abilities
  loadAbilities(container, model, unit, onAbilityClick);
  // shinsu
  const shinsuContainer = container.querySelector(".unit-card-vertical-shinsu");
  shinsuContainer.innerText = model.cost;
  await addTooltip(container, shinsuContainer, "Shinsu", "The cost of playing this card");
  // positions
  await loadPositions(container, model, unit);
  // hp
  const hpContainer = container.querySelector(".unit-card-vertical-hp");
  hpContainer.innerText = unit ? unit.currentHp : model.maxHp;
  const hpText = unit
    ? "The current hit points of this unit card"
    : "The maximum hit points of this unit card";
  await addTooltip(container, hpContainer, "HP", hpText);
};

export default load;
