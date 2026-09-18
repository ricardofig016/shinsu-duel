import { addTooltip } from "/utils/component-util.js";
import { getGlossary } from "/utils/glossary.js";
import { openCardDetail } from "/components/card-detail-overlay/script.js";
import { buildUnitHeaderIcons } from "/utils/unit-header-icons.js";
import { buildTraitStripEntries } from "/utils/unit-trait-strip.js";
import { buildPositionTooltipEntries, buildUnitAbilityTooltipEntries } from "/utils/tooltip-entries.js";

const DEFAULT_ARTWORK = "/assets/images/placeholder.png";
const DEFAULT_POSITION_ICON = "/assets/icons/positions/placeholder.png";

const safePath = (p, fallback) => {
  if (typeof p === "string" && p.trim() !== "" && p !== "undefined" && p !== "null") return p;
  return fallback;
};

/**
 * Draw one icon row. Each entry states its own icon and tooltip, and the row
 * is the same shape for the header ribbon and the trait strip: build the icon
 * element, put it in the document, then mount its tooltip — a hover target
 * that is not in the document yet reads as gone, and the tooltip layer drops
 * those.
 *
 * `badgeClass` is the optional number the entry states in its icon's corner,
 * drawn as a badge that floats over the icon without joining the row's flex
 * layout.
 */
const loadIconRow = async (container, entries, { iconClass, badgeClass = null }) => {
  container.replaceChildren();
  for (const { iconPath, title, texts, value = null } of entries) {
    const wrapper = document.createElement("span");
    wrapper.className = iconClass;
    const img = document.createElement("img");
    img.src = iconPath;
    wrapper.appendChild(img);
    if (badgeClass && value !== null) {
      const badge = document.createElement("span");
      badge.className = badgeClass;
      badge.textContent = String(value);
      wrapper.appendChild(badge);
    }
    container.appendChild(wrapper);
    await addTooltip(wrapper, title, texts, iconPath);
  }
};

/**
 * The unit's printed features and attachments as ribbons hung off the card's
 * top edge, over the artwork. The display list is shared with the vertical
 * card face, so both state the same features in the same canonical order.
 */
const loadRibbon = async (container, unit, glossary) => {
  const ribbon = container.querySelector(".unit-card-horizontal-ribbon");
  const entries = buildUnitHeaderIcons(unit, glossary);
  // An icon-less ribbon is hidden outright: it is already out of the card's
  // flow, and display: none keeps it from being hit-tested over the artwork.
  ribbon.classList.toggle("hidden", entries.length === 0);
  if (entries.length > 0) {
    await loadIconRow(ribbon, entries, { iconClass: "unit-card-horizontal-ribbon-icon" });
  }
};

/**
 * The unit's live state: every trait it has, then every condition on it, as
 * bare icons in one row. The row reserves its height whether or not it has
 * entries, so the artwork and stats keep the same geometry on every card of a
 * line.
 */
const loadStrip = async (container, unit) => {
  const strip = container.querySelector(".unit-card-horizontal-strip");
  await loadIconRow(strip, buildTraitStripEntries(unit), {
    iconClass: "unit-card-horizontal-strip-icon",
    badgeClass: "unit-card-horizontal-strip-value",
  });
};

/**
 * The card's two stats, one flex share each: the position the unit stands in,
 * plus the position a landmark choice moved it to when that differs, and the
 * unit's hp. Only the current hp is drawn; the tooltip states it out of the
 * unit's maximum and carries the glossary's hp copy.
 */
const loadStats = async (container, unit, glossary) => {
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

  const hpContainer = container.querySelector(".unit-card-horizontal-hp");
  const currentHp = unit.currentHp ?? 0;
  hpContainer.querySelector("h1").innerText = currentHp;
  hpContainer.classList.toggle("lowered", typeof unit.maxHp === "number" && currentHp < unit.maxHp);
  const hpTooltip = glossary?.hud?.hpCurrent;
  if (hpTooltip) {
    await addTooltip(
      hpContainer,
      typeof unit.maxHp === "number" ? `${currentHp}/${unit.maxHp} HP` : `${currentHp} HP`,
      hpTooltip.texts
    );
  }
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

  // header ribbons, then the live trait and condition strip
  await loadRibbon(container, unit, glossary);
  await loadStrip(container, unit);

  // stats
  await loadStats(container, unit, glossary);
};

export default load;
