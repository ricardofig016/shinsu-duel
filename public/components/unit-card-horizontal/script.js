import { addTooltip } from "/utils/component-util.js";
import { getGlossary } from "/utils/glossary.js";
import { openCardDetail } from "/components/card-detail-overlay/script.js";
import { buildPositionTooltipEntries, buildUnitAbilityTooltipEntries } from "/utils/tooltip-entries.js";

const DEFAULT_ARTWORK = "/assets/images/placeholder.png";
const DEFAULT_POSITION_ICON = "/assets/icons/positions/placeholder.png";

const safePath = (p, fallback) => {
  if (typeof p === "string" && p.trim() !== "" && p !== "undefined" && p !== "null") return p;
  return fallback;
};

/**
 * A status badge's text: the raw code, with the entry's number only where the
 * catalog marks it numeric. Every condition carries a magnitude whether or not
 * it has one to state, so the flag is what keeps a non-numeric condition
 * ("blinded") from claiming a number.
 */
const badgeLabel = (code, value) => (value === null || value === undefined ? code : `${code} ${value}`);

/**
 * Compact runtime-state badges: conditions with magnitudes, equipment
 * attachments, granted abilities, and runtime traits. Text content only.
 */
const loadStatus = (container, unit) => {
  const statusContainer = container.querySelector(".unit-card-horizontal-status");
  const badges = [
    ...unit.conditions.map((condition) => ({
      text: badgeLabel(condition.key, condition.numeric === true ? condition.magnitude : null),
      kind: "condition",
    })),
    ...unit.equipmentAttachments.map((name) => ({ text: name, kind: "equipment" })),
    ...unit.grantedAbilities.map((granted) => ({ text: granted.abilityCode, kind: "granted-ability" })),
    ...unit.runtimeTraits.map((trait) => ({
      text: badgeLabel(trait.code, trait.numeric === true ? trait.value : null),
      kind: "runtime-trait",
    })),
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

  // Tooltip copy lives on the server (card views + glossary); without the
  // glossary the tooltips degrade to the data the card views still carry.
  const glossary = await getGlossary().catch((error) => {
    console.error(`Tooltip glossary unavailable: ${error.message}`);
    return null;
  });

  // right-click opens the card detail overlay for the unit: attached
  // equipment to the left of the focus card, its relations to the right;
  // ability clicks stay wired for your own units only
  cardElement.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    openCardDetail({
      source: cardElement,
      unit,
      onAbilityClick: interactive ? onAbilityClick : null,
    });
  });

  // artwork (use fallback if missing)
  const artworkContainer = container.querySelector(".unit-card-horizontal-artwork");
  artworkContainer.style.backgroundImage = `url("${safePath(unit.artworkPath, DEFAULT_ARTWORK)}")`;
  await addTooltip(artworkContainer, unit.name, buildUnitAbilityTooltipEntries(unit));

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
    await addTooltip(
      positionContainer,
      placedPosition.name,
      buildPositionTooltipEntries(placedPosition, glossary),
      positionIcon
    );
  } else {
    positionContainer.style.backgroundImage = `url("${DEFAULT_POSITION_ICON}")`;
  }
  if (chosenPosition) {
    const chosenIcon = safePath(chosenPosition.iconPath, DEFAULT_POSITION_ICON);
    chosenContainer.classList.remove("hidden");
    chosenContainer.style.backgroundImage = `url("${chosenIcon}")`;
    await addTooltip(
      chosenContainer,
      chosenPosition.name,
      buildPositionTooltipEntries(chosenPosition, glossary, { chosen: true }),
      chosenIcon
    );
  } else {
    chosenContainer.classList.add("hidden");
  }

  // hp (use 0 if missing)
  const hpContainer = container.querySelector(".unit-card-horizontal-hp");
  const hpHeader = hpContainer.querySelector("h1");
  if (hpHeader) hpHeader.innerText = unit.currentHp ?? 0;
  const hpTooltip = glossary?.hud?.hpCurrent;
  if (hpTooltip) {
    await addTooltip(hpContainer, hpTooltip.name, hpTooltip.texts);
  }
};

export default load;
