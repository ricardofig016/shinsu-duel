import { loadComponent, addTooltip } from "/utils/component-util.js";

const TYPE_LETTER_ICONS = Object.freeze({
  skill: "/assets/icons/types/skill.png",
  equipment: "/assets/icons/types/equipment.png",
  unit: "/assets/icons/types/unit.png",
});
const LANDMARK_TYPE_LETTER_ICON = "/assets/icons/types/landmark.png";
const HEADER_ICON_PATHS = Object.freeze({
  requirements: "/assets/icons/other/requirements.png",
  passive: "/assets/icons/other/passive.png",
  evolve: "/assets/icons/other/evolve.png",
  ignition: "/assets/icons/other/ignition.png",
});
const DEFAULT_ARTWORK = "/assets/images/placeholder.png";
const DEFAULT_TRAIT_ICON = "/assets/icons/traits/placeholder.png";
const DEFAULT_CONDITION_ICON = "/assets/icons/conditions/placeholder.png";
const DEFAULT_POSITION_ICON = "/assets/icons/positions/placeholder.png";
const OVERFLOW_ICON = "/assets/icons/other/ellipsis.png";
const STRIP_ROW_SIZE = 4;

const safePath = (p, fallback = null) => {
  if (typeof p === "string" && p.trim() !== "" && p !== "undefined" && p !== "null") return p;
  return fallback;
};

const displayCardBack = (container) => {
  const cardFrame = container.querySelector(".card-vertical-frame");
  cardFrame.style.backgroundImage = `url("/assets/images/card/back.png")`;
  cardFrame.classList.add("card-vertical-small", "no-hover");
  cardFrame.innerHTML = "";
};

/**
 * The type letter is the card type's own icon; landmarks are units but carry
 * their dedicated letter.
 */
const loadTypeLetter = (container, model) => {
  const letter = container.querySelector(".card-vertical-type-letter");
  const icon =
    model.type === "unit" && model.kind === "landmark"
      ? LANDMARK_TYPE_LETTER_ICON
      : TYPE_LETTER_ICONS[model.type] ?? null;
  if (!icon) {
    letter.classList.add("hidden");
    return;
  }
  letter.classList.remove("hidden");
  letter.src = icon;
};

/**
 * Header icons surface the card's printed features: attributes, evolve/ignition
 * triggers, passive abilities, and requirements. Attributes render in the
 * canonical order delivered by the card view. Each icon is hover-only and
 * explains itself through the shared tooltip.
 */
const loadHeaderIcons = async (container, model) => {
  const headerIcons = container.querySelector(".card-vertical-header-icons");
  headerIcons.replaceChildren();

  const entries = [];
  for (const attribute of model.attributes ?? []) {
    entries.push({
      iconPath: attribute.iconPath,
      title: attribute.name,
      texts: attribute.description ? [attribute.description] : [],
    });
  }
  if (model.evolveTriggers?.length > 0) {
    entries.push({ iconPath: HEADER_ICON_PATHS.evolve, title: "Evolve", texts: model.evolveTriggers });
  }
  if (model.igniteTriggers?.length > 0) {
    entries.push({ iconPath: HEADER_ICON_PATHS.ignition, title: "Ignition", texts: model.igniteTriggers });
  }
  if (model.passiveAbilities?.length > 0) {
    entries.push({
      iconPath: HEADER_ICON_PATHS.passive,
      title: "Passive Abilities",
      texts: model.passiveAbilities.map((passive) => passive.text),
    });
  }
  if (model.requirements?.length > 0) {
    entries.push({ iconPath: HEADER_ICON_PATHS.requirements, title: "Requirements", texts: model.requirements });
  }

  for (const { iconPath, title, texts } of entries) {
    const icon = safePath(iconPath);
    if (!icon) continue;
    const img = document.createElement("img");
    img.src = icon;
    await addTooltip(container, img, title, texts, icon);
    headerIcons.appendChild(img);
  }
};

const loadName = async (container, name, sobriquet) => {
  const nameContainer = container.querySelector(".card-vertical-name");
  nameContainer.innerText = name;
  await addTooltip(container, nameContainer, name, sobriquet ? sobriquet : "");
};

/**
 * Only standard-kind units carry a rank; the trapezoid stays empty for every
 * other kind and card type.
 */
const loadRank = (container, model) => {
  const rank = container.querySelector(".card-vertical-rank");
  const visible = model.type === "unit" && model.kind === "standard" && model.rank;
  rank.innerText = visible ? model.rank : "";
};

/**
 * The affiliations trapezoid shows the first affiliation's name; standard and
 * landmark units keep the "Affiliations" placeholder when empty, the other
 * kinds show nothing. With more than one affiliation, hovering the trapezoid
 * (or the overlay itself) opens the overlay below the artwork listing the
 * rest. mouseenter/mouseleave don't refire on the inner text span, and the
 * short hide delay is cancelled by re-entry, so the overlay can't flicker
 * while the pointer stays inside.
 */
const loadAffiliations = (container, model) => {
  const affiliations = model.affiliations ?? [];
  const trapezoid = container.querySelector(".card-vertical-affiliations-trapezoid");
  const text = container.querySelector(".card-vertical-affiliation");
  const placeholder =
    model.type === "unit" && (model.kind === "standard" || model.kind === "landmark");
  text.innerText = affiliations.length > 0 ? affiliations[0].name : placeholder ? "Affiliations" : "";
  if (affiliations.length <= 1) return;

  const tooltipFrame = container.querySelector(".card-vertical-affiliations-tooltip-frame");
  let hideTimeout = null;
  const show = () => {
    clearTimeout(hideTimeout);
    tooltipFrame.classList.add("show");
  };
  const hide = () => {
    clearTimeout(hideTimeout);
    hideTimeout = setTimeout(() => tooltipFrame.classList.remove("show"), 200);
  };
  trapezoid.addEventListener("mouseenter", show);
  trapezoid.addEventListener("mouseleave", hide);
  tooltipFrame.addEventListener("mouseenter", show);
  tooltipFrame.addEventListener("mouseleave", hide);

  const tooltip = container.querySelector(".card-vertical-affiliations-tooltip");
  tooltip.replaceChildren(
    ...affiliations.slice(1).map((affiliation) => {
      const p = document.createElement("p");
      p.textContent = affiliation.name;
      return p;
    })
  );
};

/**
 * Shared icon-strip renderer for traits and conditions: up to four icons,
 * an ellipsis overflow opening the paged tooltip, and the strip's own label
 * when it has no entries.
 */
const loadIconStrip = async (
  container,
  { stripSelector, tooltipFrameSelector, tooltipSelector, rowClass, fallbackIcon },
  entries,
  emptyText
) => {
  const strip = container.querySelector(stripSelector);
  const tooltipFrame = container.querySelector(tooltipFrameSelector);
  strip.innerHTML = "";

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const img = document.createElement("img");
    if (i + 1 >= STRIP_ROW_SIZE && entries.length > STRIP_ROW_SIZE) {
      img.src = OVERFLOW_ICON;
      let hideTimeout = null;
      img.addEventListener("mouseenter", () => {
        clearTimeout(hideTimeout);
        tooltipFrame.classList.add("show");
      });
      img.addEventListener("mouseleave", () => {
        clearTimeout(hideTimeout);
        hideTimeout = setTimeout(() => tooltipFrame.classList.remove("show"), 200);
      });
      strip.appendChild(img);
      break;
    }
    const icon = safePath(entry.iconPath, fallbackIcon);
    img.src = icon;
    await addTooltip(container, img, entry.name, entry.description, icon);
    strip.appendChild(img);
  }
  if (entries.length === 0) strip.innerText = emptyText;

  const tooltip = container.querySelector(tooltipSelector);
  tooltip.innerHTML = "";
  let tooltipRow = document.createElement("div");
  tooltipRow.classList.add(rowClass, "container-horizontal");
  for (let i = STRIP_ROW_SIZE - 1; i < entries.length; i++) {
    const entry = entries[i];
    const img = document.createElement("img");
    const icon = safePath(entry.iconPath, fallbackIcon);
    img.src = icon;
    await addTooltip(container, img, entry.name, entry.description, icon);
    tooltipRow.appendChild(img);
    if ((i - (STRIP_ROW_SIZE - 1)) % STRIP_ROW_SIZE === STRIP_ROW_SIZE - 1 || i === entries.length - 1) {
      tooltip.appendChild(tooltipRow);
      tooltipRow = document.createElement("div");
      tooltipRow.classList.add(rowClass, "container-horizontal");
    }
  }
};

/**
 * The text area carries the card's printed content: unit abilities,
 * landmark rules, and skill/equipment effects. Abilities stay clickable
 * where the page wired them (your own units); effects and rules render as
 * plain paragraphs. The text box owns a fixed flex share of the card, so
 * the fit loop only has to make the content fit its own box: it shrinks
 * the font until the content height matches the box height.
 */
const loadText = (container, model, unit, onAbilityClick) => {
  const list = container.querySelector(".card-vertical-text");
  list.innerHTML = "";
  const listItems = [];

  const abilityClick = unit && onAbilityClick ? (code) => onAbilityClick(unit.id, code) : null;
  const addItem = (text, { code = null, isGranted = false } = {}) => {
    const li = document.createElement("li");
    li.innerText = text;
    if (isGranted) li.classList.add("card-vertical-granted-ability");
    if (abilityClick && code) {
      li.classList.add("clickable");
      li.addEventListener("click", () => abilityClick(code));
    }
    list.appendChild(li);
    listItems.push(li);
  };

  const isUnit = model.type === "unit";
  const isLandmark = isUnit && model.kind === "landmark";
  if (isUnit && !isLandmark) {
    for (const ability of model.abilities) addItem(ability.text, { code: ability.code });
  }
  for (const granted of unit ? unit.grantedAbilities : []) {
    addItem(granted.text, { code: granted.abilityCode, isGranted: true });
  }
  const paragraphs = isLandmark ? model.rules : isUnit ? [] : model.effects;
  for (const text of paragraphs) addItem(text);

  const contentOverflows = () => list.scrollHeight > list.clientHeight + 1;
  for (const item of listItems) item.style.fontSize = "2em";
  while (list.clientHeight > 0 && contentOverflows()) {
    const fontSize = parseFloat(listItems[0].style.fontSize) - 0.2;
    if (fontSize < 0.8) break;
    for (const item of listItems) item.style.fontSize = `${fontSize}em`;
  }
};

const loadPositions = async (container, model, unit) => {
  const positionsList = container.querySelector(".card-vertical-positions");
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
const load = async (container, { card = null, unit = null, isSmall = false, onAbilityClick = null }) => {
  if ((unit && card) || (!unit && !card)) return displayCardBack(container);
  const model = unit ?? card;

  // hidden card
  if (model.cardId == null) return displayCardBack(container);

  // size
  const cardFrame = container.querySelector(".card-vertical-frame");
  cardFrame.classList.remove("card-vertical-small", "card-vertical-big", "no-hover");
  cardFrame.classList.add(isSmall ? "card-vertical-small" : "card-vertical-big");
  if (isSmall) {
    cardFrame.addEventListener("contextmenu", async (event) => {
      event.preventDefault();
      const cardComponent = document.createElement("div");
      cardComponent.classList.add("card-vertical-component");
      container.appendChild(cardComponent);
      await loadComponent(cardComponent, "card-vertical", {
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

  // type letter
  loadTypeLetter(container, model);
  // header icons
  await loadHeaderIcons(container, model);
  // name
  await loadName(container, model.name, model.sobriquet);
  // artwork (use fallback when missing)
  const artworkPath = safePath(model.artworkPath, DEFAULT_ARTWORK);
  container.querySelector(".card-vertical-artwork").style.backgroundImage = `url("${artworkPath}")`;
  // rank trapezoid
  loadRank(container, model);
  // affiliations trapezoid
  loadAffiliations(container, model);

  // trait and condition strips (units only)
  const isUnitCard = model.type === "unit";
  container.querySelector(".card-vertical-strips").classList.toggle("hidden", !isUnitCard);
  await loadIconStrip(
    container,
    {
      stripSelector: ".card-vertical-traits",
      tooltipFrameSelector: ".card-vertical-traits-tooltip-frame",
      tooltipSelector: ".card-vertical-traits-tooltip",
      rowClass: "card-vertical-traits-tooltip-row",
      fallbackIcon: DEFAULT_TRAIT_ICON,
    },
    model.printedTraits,
    "Traits"
  );
  await loadIconStrip(
    container,
    {
      stripSelector: ".card-vertical-conditions",
      tooltipFrameSelector: ".card-vertical-conditions-tooltip-frame",
      tooltipSelector: ".card-vertical-conditions-tooltip",
      rowClass: "card-vertical-conditions-tooltip-row",
      fallbackIcon: DEFAULT_CONDITION_ICON,
    },
    unit?.conditions ?? [],
    "Conditions"
  );

  // text area
  loadText(container, model, unit, onAbilityClick);

  // shinsu
  const shinsuContainer = container.querySelector(".card-vertical-shinsu");
  shinsuContainer.innerText = model.cost;
  await addTooltip(container, shinsuContainer, "Shinsu", "The cost of playing this card");

  // positions and hp exist for units only
  container.querySelector(".card-vertical-positions").classList.toggle("hidden", !isUnitCard);
  const hpContainer = container.querySelector(".card-vertical-hp");
  hpContainer.classList.toggle("hidden", !isUnitCard);
  await loadPositions(container, model, unit);

  // hp
  hpContainer.innerText = unit ? unit.currentHp : model.maxHp ?? "";
  const hpText = unit
    ? "The current hit points of this unit card"
    : "The maximum hit points of this unit card";
  await addTooltip(container, hpContainer, "HP", hpText);
};

export default load;
