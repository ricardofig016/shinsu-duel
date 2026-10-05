import { loadComponent, addTooltip, fitFontSize } from "/utils/component-util.js";
import { getGlossary } from "/utils/glossary.js";
import { renderSegments } from "/utils/card-text-dom.js";
import { setCardFlipClickable, wireCardFlipClick } from "/utils/card-flip.js";
import { openCardDetail } from "/components/card-detail-overlay/script.js";
import { buildCardBackSections, buildUnitHeaderIcons } from "/utils/unit-header-icons.js";
import { getPlacementSlots } from "/utils/positions.js";
import {
  buildEntryTitle,
  buildPositionTooltipEntries,
  buildRankTooltip,
  buildTypeLetterTooltip,
  proseEntries,
} from "/utils/tooltip-entries.js";

const TYPE_LETTER_ICONS = Object.freeze({
  skill: "/assets/icons/types/skill.png",
  equipment: "/assets/icons/types/equipment.png",
  unit: "/assets/icons/types/unit.png",
});
const LANDMARK_TYPE_LETTER_ICON = "/assets/icons/types/landmark.png";
const DEFAULT_ARTWORK = "/assets/images/placeholder.png";
const DEFAULT_TRAIT_ICON = "/assets/icons/traits/placeholder.png";
const DEFAULT_CONDITION_ICON = "/assets/icons/conditions/placeholder.png";
const DEFAULT_POSITION_ICON = "/assets/icons/positions/placeholder.png";
const OVERFLOW_ICON = "/assets/icons/other/ellipsis.png";
const STRIP_ROW_SIZE = 4;
// The faces the card's fitted text renders with (global.css declarations):
// the fits must measure the final metrics, and fonts.ready alone is not
// enough because a face first requested by this card is not in flight yet.
const CARD_FONT_FAMILIES = Object.freeze(["Roboto", "New Rocker"]);
// How far a face's title may shrink to fit its row. The back fits its title to
// the same bounds, so the two faces state the card's name at the same size.
const NAME_FIT = Object.freeze({ max: 2.4, min: 1.2 });
// The size the back divides its sections at, matching `.card-vertical-small`.
// Dividing at one fixed size is what makes a card's faces the same whichever
// size it is shown at: the measurement is then a property of the card's content,
// not of the layout it happens to be sitting in.
const SMALL_FACE_FONT_SIZE = "0.3rem";

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
 * their dedicated letter. Its tooltip is the type's (or, for units, the
 * kind's) server-owned summary. Both faces draw it from this one renderer, at
 * the left of their title row, so the card states its type the same way
 * whichever side is showing.
 */
const loadTypeLetter = async (root, model, glossary) => {
  const letter = root.querySelector(".card-vertical-type-letter, .card-vertical-back-type-letter");
  if (!letter) return;
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
  const tooltip = buildTypeLetterTooltip(model, glossary);
  if (tooltip) await addTooltip(letter, tooltip.title, tooltip.texts);
  // The name's fit measurement depends on the letter's rendered width; an
  // undecoded image has none. A broken icon resolves the wait instead of
  // blocking.
  await letter.decode().catch(() => {});
};

/**
 * Header icons surface the card's printed features: attributes, evolve/ignition
 * triggers, passive abilities, requirements, and the unit's equipment
 * attachments. The display list is shared with the horizontal card face
 * (`/utils/unit-header-icons.js`), so both state the same features in the same
 * canonical order and explain each one through the same tooltip. Each icon is
 * hover-only.
 */
const loadHeaderIcons = async (container, model, glossary) => {
  const headerIcons = container.querySelector(".card-vertical-header-icons");
  headerIcons.replaceChildren();

  for (const { iconPath, title, texts } of buildUnitHeaderIcons(model, glossary)) {
    const img = document.createElement("img");
    img.src = iconPath;
    // The name's fit measurement depends on the icons' rendered widths;
    // an undecoded image has none, so each icon must be ready before the
    // name is fitted. A broken icon resolves the wait instead of blocking.
    await img.decode().catch(() => {});
    // Append before mounting the tooltip: the tooltip layer drops tooltips
    // whose hover target has left the document, and an element still being
    // built is not in it yet.
    headerIcons.appendChild(img);
    await addTooltip(img, title, texts, iconPath);
  }
};

/**
 * A face's title row has one flexible element: the name shrinks until it fits
 * the room left by the type icon and whatever ends the row (the front's header
 * icons, the back's page counter), falling back to the CSS ellipsis for
 * pathological names that overflow even at the chosen size. Content and box are
 * measured fractionally through a Range: scrollWidth/clientWidth are
 * integer-rounded, which erases sub-pixel overflow on the small card scale and
 * leaves the ellipsis painted on a "fits" verdict.
 *
 * Both faces fit their title through here and from the same bounds, so one
 * cannot render its title at a different size than the other.
 */
const loadName = async (root, selector, name, sobriquet) => {
  const nameContainer = root.querySelector(selector);
  if (!nameContainer) return;
  nameContainer.innerText = name;
  const range = document.createRange();
  range.selectNodeContents(nameContainer);
  const nameOverflows = () =>
    range.getBoundingClientRect().width > nameContainer.getBoundingClientRect().width + 0.25;
  fitFontSize([nameContainer], nameOverflows, NAME_FIT);
  await addTooltip(nameContainer, name, sobriquet ? sobriquet : "");
};

/**
 * The rank trapezoid renders only when the card carries a rank; every other
 * card leaves the artwork uncovered. The tooltip lists every rank with its
 * cost range and description, the card's own rank emphasized.
 */
const loadRank = async (container, model, glossary) => {
  const trapezoid = container.querySelector(".card-vertical-rank-trapezoid");
  trapezoid.classList.toggle("hidden", !model.rank);
  container.querySelector(".card-vertical-rank").innerText = model.rank ?? "";
  if (!model.rank) return;
  const tooltip = buildRankTooltip(model.rank, glossary?.ranks ?? null);
  if (tooltip) await addTooltip(trapezoid, tooltip.title, tooltip.texts);
};

/**
 * The affiliations trapezoid renders only when the card carries at least one
 * affiliation and shows the first affiliation's name. With more than one
 * affiliation, hovering the trapezoid (or the overlay itself) opens the
 * overlay below the artwork listing the rest. mouseenter/mouseleave don't
 * refire on the inner text span, and the short hide delay is cancelled by
 * re-entry, so the overlay can't flicker while the pointer stays inside.
 */
const loadAffiliations = (container, model) => {
  const affiliations = model.affiliations ?? [];
  const trapezoid = container.querySelector(".card-vertical-affiliations-trapezoid");
  trapezoid.classList.toggle("hidden", affiliations.length === 0);
  const text = container.querySelector(".card-vertical-affiliation");
  text.innerText = affiliations.length > 0 ? affiliations[0].name : "";
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
 * The number a strip entry states, or null when it states none. The catalog's
 * numeric flag is the gate: a condition's magnitude exists for every condition
 * (none is suppressed without one), so without the flag a non-numeric
 * condition would claim a number it does not have.
 */
const stripValue = (entry, readValue) => (entry.numeric === true ? readValue(entry) ?? null : null);

/**
 * One strip icon with its value badge. The badge is positioned absolutely in
 * the icon's bottom-right corner, so it floats over the artwork without
 * joining the strip's flex layout: gaps, alignment, and every measured box
 * stay exactly what they were without it.
 */
const buildStripIcon = (entry, { fallbackIcon, value }) => {
  const wrapper = document.createElement("span");
  wrapper.className = "card-vertical-strip-icon";
  const img = document.createElement("img");
  const icon = safePath(entry.iconPath, fallbackIcon);
  img.src = icon;
  wrapper.appendChild(img);
  if (value !== null) {
    const badge = document.createElement("span");
    badge.className = "card-vertical-strip-value";
    badge.textContent = String(value);
    wrapper.appendChild(badge);
  }
  return { wrapper, icon };
};

/**
 * Shared icon-strip renderer for traits and conditions: up to four icons, an
 * ellipsis overflow opening the paged tooltip, and the strip's own label when
 * it has no entries. `slot` names the value slot the entries' prose fills and
 * `readValue` reads an entry's number, so both strips state their numbers the
 * same way.
 */
const loadIconStrip = async (
  container,
  { stripSelector, tooltipFrameSelector, tooltipSelector, rowClass, fallbackIcon, slot, readValue },
  entries,
  emptyText
) => {
  const strip = container.querySelector(stripSelector);
  const tooltipFrame = container.querySelector(tooltipFrameSelector);
  strip.innerHTML = "";

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (i + 1 >= STRIP_ROW_SIZE && entries.length > STRIP_ROW_SIZE) {
      const img = document.createElement("img");
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
    const value = stripValue(entry, readValue);
    const { wrapper, icon } = buildStripIcon(entry, { fallbackIcon, value });
    // The element goes in before its tooltip: a hover target that is not in the
    // document yet reads as gone, and the tooltip layer drops those.
    strip.appendChild(wrapper);
    await addTooltip(
      wrapper,
      buildEntryTitle(entry, value),
      proseEntries(entry.description, value === null ? null : { [slot]: value }),
      icon
    );
  }
  if (entries.length === 0) strip.innerText = emptyText;

  const tooltip = container.querySelector(tooltipSelector);
  tooltip.innerHTML = "";
  let tooltipRow = document.createElement("div");
  tooltipRow.classList.add(rowClass, "container-horizontal");
  for (let i = STRIP_ROW_SIZE - 1; i < entries.length; i++) {
    const entry = entries[i];
    const value = stripValue(entry, readValue);
    const { wrapper, icon } = buildStripIcon(entry, { fallbackIcon, value });
    // The row joins the tooltip before its icons do, so every icon is in the
    // document when its tooltip mounts (see the strip above).
    if (!tooltipRow.isConnected) tooltip.appendChild(tooltipRow);
    tooltipRow.appendChild(wrapper);
    await addTooltip(
      wrapper,
      buildEntryTitle(entry, value),
      proseEntries(entry.description, value === null ? null : { [slot]: value }),
      icon
    );
    if ((i - (STRIP_ROW_SIZE - 1)) % STRIP_ROW_SIZE === STRIP_ROW_SIZE - 1 || i === entries.length - 1) {
      tooltipRow = document.createElement("div");
      tooltipRow.classList.add(rowClass, "container-horizontal");
    }
  }
};

/**
 * The text area carries the card's printed content: unit abilities,
 * landmark rules, and skill/equipment effects. Display text renders through
 * the linked-text renderer, so inline links highlight and navigate; abilities
 * stay clickable where the page wired them (your own units). The text box
 * owns a fixed flex share of the card, so the shared fit util only has to
 * make the content fit its own box: it shrinks the font until the content
 * height matches the box height.
 */
const loadText = (container, model, unit, onAbilityClick) => {
  const list = container.querySelector(".card-vertical-text");
  list.innerHTML = "";
  const listItems = [];

  const abilityClick = unit && onAbilityClick ? (code) => onAbilityClick(unit.id, code) : null;
  const addItem = (segments, { code = null, isGranted = false } = {}) => {
    const li = document.createElement("li");
    li.replaceChildren(renderSegments(segments));
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
  for (const segments of paragraphs) addItem(segments);

  fitFontSize(listItems, () => list.clientHeight > 0 && list.scrollHeight > list.clientHeight + 1);
};

/**
 * The card's position row: the position a deployed unit was placed in, the
 * position a landmark choice moved it to, and — for a unit that prints no
 * position of its own — the placement slot that stands for it.
 *
 * A special kind occupies no printed position: the placement registry states
 * the one it shows, being the line the unit occupies on the field or, while the
 * card is still in hand, every line it may deploy to. A standard unit's printed
 * positions are the whole answer, so the registry adds nothing to them.
 */
const loadPositions = async (container, model, unit, glossary) => {
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
  // Only a row the card prints nothing for can gain a slot, so a standard card
  // never waits on the registry for a position it already states itself.
  if (entries.length === 0) {
    for (const slot of await getPlacementSlots(model, { line: unit?.line ?? null })) {
      entries.push({ position: slot, chosen: false });
    }
  }
  for (const { position, chosen } of entries) {
    const li = document.createElement("li");
    const posIcon = safePath(position.iconPath, DEFAULT_POSITION_ICON);
    li.style.backgroundImage = `url("${posIcon}")`;
    if (chosen) li.classList.add("chosen-position");
    // The icon joins the list before its tooltip mounts, for the same reason as
    // the header icons.
    positionsList.appendChild(li);
    await addTooltip(li, position.name, buildPositionTooltipEntries(position, glossary, { chosen }), posIcon);
  }
};

/* ── the card's back face ─────────────────────────────────────────────── */

const frameOf = (container) => container.querySelector(".card-vertical-frame");

/** One section of the back: its label, then its lines of game text. */
const buildBackSection = (section) => {
  const item = document.createElement("li");
  item.classList.add("card-vertical-back-section");
  const label = document.createElement("h2");
  label.classList.add("card-vertical-back-label");
  label.innerText = section.title;
  item.appendChild(label);
  for (const entry of section.texts) {
    const line = document.createElement("p");
    line.classList.add("card-vertical-back-line");
    if (entry.segments) line.replaceChildren(renderSegments(entry.segments));
    else line.textContent = entry.text ?? "";
    item.appendChild(line);
  }
  return item;
};

/**
 * How the card's sections divide into back faces, as one array of sections per
 * face. A break only ever lands between two sections — a face holds whole
 * sections — so the reader meets a labelled block, never half of one. A section
 * too tall for an empty face still gets that face, because losing it would be
 * worse than a tight one, and an empty face is never produced.
 *
 * The measurement is of the list's own content box, so it holds at any size the
 * card is shown at: the whole card is laid out in em, so a smaller face is the
 * same layout with the same breaks at a smaller size.
 */
const paginateBack = (list, sections) => {
  if (sections.length === 0) return [[]];
  list.replaceChildren(...sections.map(buildBackSection));
  const available = list.clientHeight;
  const breaks = [];
  let page = [];
  for (const [index, section] of sections.entries()) {
    const element = list.children[index];
    const fits = element.getBoundingClientRect().bottom - list.getBoundingClientRect().top <= available + 0.5;
    // an empty face takes its first section whatever its height, so progress is
    // guaranteed; from then on a section that would not fit opens the next face
    if (!fits && page.length > 0) {
      breaks.push(page);
      page = [];
    }
    page.push(section);
  }
  if (page.length > 0) breaks.push(page);
  return breaks;
};

/** Whether the card is currently showing its back, and so can be measured. */
const backIsVisible = (container) =>
  frameOf(container)?.classList.contains("card-vertical-flipped") === true;

/**
 * Divide the card's sections at the card's small size, whatever size it is being
 * shown at, and hand the size back as it was.
 *
 * The division has to be one decision for the card, not one per size: text wraps
 * into a different number of lines at the small size than at the big one, so
 * measuring each size on its own gives the big card one face where the small
 * card needs two, and the two sizes of the same card then disagree about what a
 * face holds. The small size is the strictest layout the card has, so dividing
 * there and reusing it everywhere means both sizes state the same sections on
 * the same faces, and a face can only ever hold less than it could rather than
 * more than it can.
 *
 * @returns {object[][]} the sections of each face
 */
const divideAtSmallSize = (container, list, sections) => {
  const frame = frameOf(container);
  const previous = frame.style.fontSize;
  frame.style.fontSize = SMALL_FACE_FONT_SIZE;
  const breaks = paginateBack(list, sections);
  frame.style.fontSize = previous;
  return breaks;
};

/**
 * Draw one back face: as many whole sections as the face fits, continuing the
 * card's sections where the previous face left off. The face's header row
 * states the card's type, its name, and which face this is of how many.
 *
 * A face can only be divided by measurement while it is rendered, so a card
 * whose back is not showing yet draws its sections undivided; the division is
 * made on the first face the card actually shows and then kept, so the count is
 * settled before the reader can ask for a face beyond the first.
 *
 * @param {HTMLElement} container the card component's container
 * @param {number} page 1-based face to draw
 * @param {boolean} [measure] whether the face can be measured, which the caller
 *   knows: the turn draws the face while the card is turned over, but the class
 *   that shows the back is only applied in the same step
 */
const renderBackPage = (container, page, measure = false) => {
  const back = frameOf(container)?.querySelector(".card-vertical-back");
  if (!back) return;
  const list = back.querySelector(".card-vertical-back-sections");
  const sections = container.__backSections ?? [];
  const frame = frameOf(container);
  const measureOrVisible = measure || backIsVisible(container);
  const breaks = measureOrVisible ? divideAtSmallSize(container, list, sections) : [sections];
  const index = Math.max(0, Math.min(breaks.length - 1, page - 1));
  list.replaceChildren(...breaks[index].map(buildBackSection));
  // The face and its count are stated after the card is back at the size it is
  // being shown at, never while it is briefly divided at the small one. The
  // front is not a face of the back, so it carries no count: the card states its
  // name there, and the count belongs to the side that has faces.
  const counter = back.querySelector(".card-vertical-back-pages");
  const showingBack = frame.classList.contains("card-vertical-flipped");
  counter.innerText = `${index + 1}/${breaks.length}`;
  counter.classList.toggle("hidden", !showingBack || breaks.length <= 1);
  // the count the card-flip module reads to know whether the card may stay on
  // its back when asked for another face
  frame.dataset.backPages = String(breaks.length);
};

/**
 * The back face: the card's own type icon and title, then its sections — one
 * per header icon, in the same order the icons are drawn, labeled with that
 * icon's tooltip title and carrying only the card's game-relevant text. Keeping
 * the game text off the tooltips' flavor copy is deliberate: the back is for
 * playing, the tooltip is for reading.
 *
 * The sections are built once and then divided into faces by measurement. No
 * face has a minimum size, and nothing on one is resized to force a fit: a
 * floor plus clipping is exactly what silently loses information and what makes
 * one card size disagree with another.
 */
const renderBack = (container, model, glossary) => {
  const back = frameOf(container)?.querySelector(".card-vertical-back");
  if (!back) return;
  // a card always opens on its front, on the first face of its back
  container.__backPage = 1;
  container.__backSections = buildCardBackSections(model, glossary);
  container.__renderBackPage = (page) => renderBackPage(container, page);
  renderBackPage(container, 1);
};

// Need either unit or card, but not both; both are flattened view models.
const load = async (container, {
  card = null,
  unit = null,
  isSmall = false,
  onAbilityClick = null,
  flipOnClick = true,
}) => {
  if ((unit && card) || (!unit && !card)) return displayCardBack(container);
  const model = unit ?? card;

  // hidden card
  if (model.cardId == null) return displayCardBack(container);

  // Tooltip copy lives on the server (card views + glossary); without the
  // glossary the tooltips degrade to the data the card views still carry.
  const glossary = await getGlossary().catch((error) => {
    console.error(`Tooltip glossary unavailable: ${error.message}`);
    return null;
  });

  // The text fits below (name and text area) must measure against the final
  // font metrics or a late webfont swap re-overflows the fitted text. This
  // container must also be attached to the document: detached elements have
  // no layout and every fit would measure zero and never shrink.
  await Promise.all(CARD_FONT_FAMILIES.map((family) => document.fonts.load(`1em "${family}"`)));

  // size
  const cardFrame = container.querySelector(".card-vertical-frame");
  cardFrame.classList.remove("card-vertical-small", "card-vertical-big", "no-hover");
  cardFrame.classList.add(isSmall ? "card-vertical-small" : "card-vertical-big");
  if (isSmall) {
    // right-click opens the card detail overlay: the focused card plus its
    // relations and attachments, owned by the overlay component
    cardFrame.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      openCardDetail({ source: cardFrame, card: model });
    });
  }

  // type letter
  await loadTypeLetter(container, model, glossary);
  // header icons
  await loadHeaderIcons(container, model, glossary);
  // name
  await loadName(container, ".card-vertical-name", model.name, model.sobriquet);
  // the back states the card's type and name the same way the front does, so
  // both faces read as the same card
  const backFrame = container.querySelector(".card-vertical-back-frame");
  await loadTypeLetter(backFrame, model, glossary);
  await loadName(backFrame, ".card-vertical-back-name", model.name, model.sobriquet);
  // artwork (use fallback when missing)
  const artworkPath = safePath(model.artworkPath, DEFAULT_ARTWORK);
  container.querySelector(".card-vertical-artwork").style.backgroundImage = `url("${artworkPath}")`;
  // rank trapezoid
  await loadRank(container, model, glossary);
  // affiliations trapezoid
  loadAffiliations(container, model);

  // trait and condition strips (units only). Both state what is true on the
  // board: a deployed unit shows the traits and conditions it actually has,
  // with their effective values, while a card that is not on the field has no
  // runtime state and shows what it prints.
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
      slot: "trait",
      readValue: (entry) => entry.value,
    },
    unit ? model.runtimeTraits : model.printedTraits,
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
      slot: "condition",
      readValue: (entry) => entry.magnitude,
    },
    unit?.conditions ?? [],
    "Conditions"
  );

  // text area
  loadText(container, model, unit, onAbilityClick);

  // the back face, and the click that turns the card over
  renderBack(container, model, glossary);
  setCardFlipClickable(container, flipOnClick !== false);
  wireCardFlipClick(container);

  // shinsu
  const shinsuContainer = container.querySelector(".card-vertical-shinsu");
  shinsuContainer.innerText = model.cost;
  const shinsuTooltip = glossary?.hud?.shinsuCard;
  if (shinsuTooltip) {
    await addTooltip(shinsuContainer, shinsuTooltip.name, shinsuTooltip.texts);
  }

  // positions and hp exist for units only
  container.querySelector(".card-vertical-positions").classList.toggle("hidden", !isUnitCard);
  const hpContainer = container.querySelector(".card-vertical-hp");
  hpContainer.classList.toggle("hidden", !isUnitCard);
  await loadPositions(container, model, unit, glossary);

  // hp
  hpContainer.innerText = unit ? unit.currentHp : model.maxHp ?? "";
  const hpTooltip = glossary?.hud?.[unit ? "hpCurrent" : "hpMax"];
  if (hpTooltip) {
    await addTooltip(hpContainer, hpTooltip.name, hpTooltip.texts);
  }
};

export default load;
