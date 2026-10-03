import { loadComponent, addTooltip, releaseTooltip } from "/utils/component-util.js";
import { redirectToLogin } from "/utils/auth-redirect.js";
import { EVENTS, ERROR_CODES } from "/game/protocol.js";
import { createGameStore } from "/game/store.js";
import {
  buildCombatSlotViewModel,
  buildDecisionPromptViewModel,
  buildFireChargeViewModel,
  buildGameOverViewModel,
  buildHandCardViewModel,
  buildRoundViewModel,
  buildShinsuViewModel,
  buildUnitViewModel,
  canSubmitDecision,
} from "/game/viewModels.js";
import {
  buildDeployUnitAction,
  buildDecision,
  buildEquipEquipmentAction,
  buildGenerateFireChargeAction,
  buildPassTurnAction,
  buildPlaySkillAction,
  buildSwitchPositionAction,
  buildUseAbilityAction,
} from "/game/actions.js";
import { STEP, roomCodeFromPath, followRoomStep } from "/game/steps.js";
import { getGlossary } from "/utils/glossary.js";
import { getCardCatalog } from "/utils/card-catalog.js";
import { toggleCardFlip } from "/utils/card-flip.js";
import {
  buildDeckTooltipEntries,
  buildPositionTooltipEntries,
} from "/utils/tooltip-entries.js";

const store = createGameStore();

// How far the pointer may travel before a press counts as a drag rather than a
// click; a click on a hand card turns it over.
const DRAG_THRESHOLD_PX = 4;

let draggedCardHandId = null;
let draggedSkillHandId = null;
let draggedEquipmentHandId = null;
let activeDecisionId = null;
let selectedDecisionChoices = [];
let activeDecisionPrompt = null;

const fetchFromPath = async (path) => {
  const response = await fetch(`/${path}/`);
  if (!response.ok) {
    console.error(`Failed to fetch /${path}/: ${await response.text()}`);
    return null;
  }
  return await response.json();
};

const prepareData = async () => {
  const positions = await fetchFromPath("positions");
  // Tooltip copy is server-owned; the HUD tooltips degrade silently without it.
  const glossary = await getGlossary().catch((error) => {
    console.error(`Tooltip glossary unavailable: ${error.message}`);
    return null;
  });
  // The full card catalog powers card detail views: relation stamps and the
  // name-only equipment-attachment wire entries resolve against it. The
  // page-level cache shares one request with the card detail overlay, and
  // failure degrades like the glossary.
  const catalog = await getCardCatalog().catch((error) => {
    console.error(`Card catalog unavailable: ${error.message}`);
    return null;
  });
  return { positions, glossary, catalog };
};

const findUnit = (state, player, unitId) => {
  for (const line of ["frontline", "backline"]) {
    const unit = state[player].field[line].find((candidate) => candidate.id === unitId);
    if (unit) return unit;
  }
  return null;
};

/* ── reveals ──────────────────────────────────────────────────────────── */

const showPeekReveal = (payload) => {  const overlay = document.querySelector("#peek-overlay");
  const cards = document.querySelector("#peek-overlay-cards");
  cards.replaceChildren(
    ...(payload?.cards ?? []).map((card) => {
      const li = document.createElement("li");
      li.textContent = card.cost != null ? `${card.name} (${card.cost})` : card.name;
      return li;
    })
  );
  overlay.classList.remove("hidden");
};

const hidePositionChooser = () => {
  document.querySelector("#position-chooser").classList.add("hidden");
};

/** Keep the hand cards aligned across the container width. */
const alignHandCards = () => {
  document.querySelectorAll(".hand-container").forEach((handContainer) => {
    const handContainerWidth = window.innerWidth - handContainer.getBoundingClientRect().left;
    const cards = handContainer.querySelectorAll(".card-vertical-component");
    if (cards.length === 0) return;
    const cardWidth = cards[0].offsetWidth;
    // the fan's overlap is rebuilt from scratch: cards are reused now, so an
    // offset left over from a larger hand would keep the fan spread
    cards.forEach((card) => {
      card.style.marginLeft = "";
    });
    if (cards.length * cardWidth < handContainerWidth) handContainer.style.justifyContent = "center";
    else {
      const cardOffset = (handContainerWidth - cardWidth) / (cards.length - 1);
      cards.forEach((card, index) => {
        if (index !== 0) card.style.marginLeft = `${-cardWidth + cardOffset}px`;
      });
    }
  });
};

const showGameOver = (gameOver) => {
  const model = buildGameOverViewModel(gameOver, store.state?.you?.username);
  document.querySelector("#game-over-overlay").classList.toggle("hidden", model === null);
  if (model) {
    document.querySelector("#game-over-headline").textContent = model.headline;
    document.querySelector("#game-over-detail").textContent = `${model.winner} wins: ${model.reason}`;
  }
};

/* ── mounted elements ─────────────────────────────────────────────────── */

/**
 * The board reconciles what it shows instead of rebuilding it. Mounting a card
 * measures layout (text fitting) and mounts about ten tooltips, so recreating
 * the whole board per snapshot made every update flash: the hand was even
 * painted half-built, briefly showing fewer cards than the player holds, and a
 * turn change delivers several snapshots in a row. Elements are kept per
 * container, keyed by what they show, so something that is still there keeps
 * its element and whatever state it carries, and only what changed is
 * remounted.
 */
const mountedElements = new WeakMap();

/** The element registry of one board container, created on first use. */
const elementsOf = (container) => {
  let registry = mountedElements.get(container);
  if (!registry) {
    registry = new Map();
    mountedElements.set(container, registry);
  }
  return registry;
};

/** Drop every mounted element whose key is no longer wanted. */
const dropUnwanted = (registry, wanted) => {
  for (const [key, mounted] of [...registry]) {
    if (wanted.has(key)) continue;
    mounted.element.remove();
    registry.delete(key);
  }
};

/**
 * Put `elements`, then `trailing`, in the container in that order. Only moves
 * what is out of place: a reorder must not remount anything, and `trailing`
 * keeps elements that belong after the cards (the position drop zones) last.
 */
const orderChildren = (container, elements, trailing = []) => {
  const desired = [...elements, ...trailing];
  const current = [...container.children];
  if (current.length === desired.length && desired.every((element, index) => current[index] === element)) return;
  for (const element of desired) container.appendChild(element);
};

/* ── renderers ────────────────────────────────────────────────────────── */

const renderRound = (state) => {
  const model = buildRoundViewModel(state);
  document.querySelector("#round-number").textContent = model.round;
};

/**
 * Combat slots are reconciled like every other mounted element: a slot keeps
 * its element and its tooltip (position copy does not change), and only its
 * used state and its place are updated.
 */
const renderCombatSlots = (state, positions, glossary) => {
  for (let player of ["you", "opponent"]) {
    const slotsContainer = document.querySelector(`#${player}-container .combat-slots-container`);
    const registry = elementsOf(slotsContainer);
    const wanted = new Set();
    const order = [];
    for (let code of state[player].combatSlotCodes) {
      const key = `slot-${code}`;
      wanted.add(key);
      let mounted = registry.get(key);
      if (!mounted) {
        const position = positions[code];
        const iconPath = position?.iconPath ?? `/assets/icons/positions/${code}.png`;
        const slot = document.createElement("div");
        slot.classList.add("combat-slot");
        slot.dataset.positionCode = code;
        const icon = document.createElement("div");
        icon.classList.add("combat-slot-icon");
        icon.style.backgroundImage = `url(${iconPath})`;
        slot.appendChild(icon);
        slotsContainer.appendChild(slot);
        mounted = { element: slot };
        registry.set(key, mounted);
        addTooltip(slot, position?.name ?? code, buildPositionTooltipEntries(position, glossary), iconPath);
      }
      mounted.element.classList.toggle("used", buildCombatSlotViewModel(state[player], code).used);
      order.push(mounted.element);
    }
    dropUnwanted(registry, wanted);
    orderChildren(slotsContainer, order);
  }
};

/* ── the deck stack ───────────────────────────────────────────────────── */

/** One deck back: a styled frame, so a stack of them costs no component mount. */
const buildDeckBack = () => {
  const element = document.createElement("div");
  element.classList.add("card-vertical-component", "deck-card");
  const frame = document.createElement("div");
  frame.classList.add("card-vertical-frame", "card-vertical-small", "no-hover");
  frame.style.backgroundImage = `url("/assets/images/card/back.png")`;
  element.appendChild(frame);
  return element;
};

/**
 * The deck tooltip of one container. Its copy carries the remaining count, so
 * it is mounted once and replaced only when that count changes; the replaced
 * one is released, because its hover target (the deck) stays on the page.
 */
const deckTooltips = new WeakMap();

const syncDeckTooltip = async (deckContainer, deckSize, deckTooltip) => {
  const mounted = deckTooltips.get(deckContainer);
  if (mounted?.size === deckSize) return;
  if (mounted) releaseTooltip(mounted.element);
  deckTooltips.delete(deckContainer);
  if (!deckTooltip) return;
  const entries = buildDeckTooltipEntries(deckSize, deckTooltip);
  if (entries.length === 0) return;
  deckTooltips.set(deckContainer, { size: deckSize, element: await addTooltip(deckContainer, deckTooltip.name, entries) });
};

const renderDecks = async (state, glossary) => {
  const basePosition = [0, 50];
  const positionOffset = 0.2;
  const maxDeckSize = 20;
  const deckTooltip = glossary?.hud?.deck ?? null;
  for (let player of ["you", "opponent"]) {
    const deckContainer = document.querySelector(`#${player}-container .deck-outer-container .deck-container`);
    const registry = elementsOf(deckContainer);
    const cardAmount = Math.min(state[player].deckSize, maxDeckSize);
    const wanted = new Set();
    const order = [];
    for (let i = 0; i < cardAmount; i++) {
      const key = `back-${i}`;
      wanted.add(key);
      let mounted = registry.get(key);
      if (!mounted) {
        const element = buildDeckBack();
        deckContainer.appendChild(element);
        mounted = { element };
        registry.set(key, mounted);
      }
      mounted.element.style.bottom = `${basePosition[0] + i * positionOffset}%`;
      mounted.element.style.left = `${basePosition[1] - i * positionOffset}%`;
      order.push(mounted.element);
    }
    dropUnwanted(registry, wanted);
    orderChildren(deckContainer, order);
    await syncDeckTooltip(deckContainer, state[player].deckSize, deckTooltip);
  }
};

const renderLighthouses = (state) => {
  for (let player of ["you", "opponent"]) {
    const lighthouseContainer = document.querySelector(`#${player}-container .lighthouse-container`);
    lighthouseContainer.querySelector("h1").textContent = state[player].lighthouses.amount;
  }
};

const renderFields = async (state, socket) => {
  for (let player of ["you", "opponent"]) {
    const interactive = player === "you";
    for (let line in state[player].field) {
      const lineContainer = document.querySelector(`#${player}-container .${line}-container`);
      const registry = elementsOf(lineContainer);
      const trailing = [...lineContainer.children].filter(
        (child) => !child.classList.contains("unit-card-horizontal-component")
      );
      const wanted = new Set();
      const order = [];
      for (let unitView of state[player].field[line]) {
        const key = `unit-${unitView.id}`;
        wanted.add(key);
        // A unit's element is remounted only when what it shows changed; the
        // signature is the whole view, so hp, conditions, and chosen positions
        // all count.
        const unit = buildUnitViewModel(unitView);
        const signature = JSON.stringify({ unit, interactive });
        let mounted = registry.get(key);
        if (!mounted) {
          const element = document.createElement("div");
          element.classList.add("unit-card-horizontal-component");
          element.dataset.unitId = unitView.id;
          mounted = { element, signature: null };
          registry.set(key, mounted);
        }
        if (mounted.signature !== signature) {
          await loadComponent(mounted.element, "unit-card-horizontal", {
            unit,
            interactive,
            onAbilityClick: interactive
              ? (unitId, abilityCode) => socket.emit(EVENTS.GAME_ACTION, buildUseAbilityAction(unitId, abilityCode))
              : null,
          });
          mounted.signature = signature;
        }
        order.push(mounted.element);
      }
      dropUnwanted(registry, wanted);
      // units lead the line container so the position drop zones stay at the end
      orderChildren(lineContainer, order, trailing);
    }
  }
};

/* ── card dragging ────────────────────────────────────────────────────── */

/**
 * Shared ghost-drag for hand cards. Each card type reveals its own drop
 * targets and stamps its module-level hand id; the targets themselves own
 * the mouseup handlers that emit actions (guarded by that hand id).
 */
const beginCardDrag = (event, cardDiv, handCard, cardType) => {
  if (event.button !== 0) return; // left click
  // create dragging card
  const cardDrag = cardDiv.cloneNode(true);
  const innerCard = cardDrag.querySelector(".card-vertical-component");
  if (innerCard) cardDrag.removeChild(innerCard);
  cardDrag.classList.add("card-dragging");
  document.body.appendChild(cardDrag);
  // position dragging card
  cardDrag.style.left = `${event.clientX - cardDrag.offsetWidth / 2}px`;
  cardDrag.style.top = `${event.clientY - cardDrag.offsetHeight / 2}px`;
  document.body.classList.add("dragging");

  // reveal the drop targets this card type accepts
  let cleanupDropTargets = () => {};
  let onWindowResize = null;
  if (cardType === "unit") {
    const positionCodes = Object.keys(handCard.card.positions);
    const dropZones = document.querySelectorAll(".position-drop-zone");
    dropZones.forEach((zone) => {
      if (positionCodes.includes(zone.dataset.positionCode)) zone.classList.remove("hidden");
    });
    draggedCardHandId = handCard.index;
    cleanupDropTargets = () => dropZones.forEach((zone) => zone.classList.add("hidden"));
  } else if (cardType === "skill") {
    draggedSkillHandId = handCard.index;
    const opponentContainer = document.querySelector("#opponent-container");
    opponentContainer.classList.add("skill-drop-active");
    // veil over the whole opponent side, sized to its page rect so it floats
    // above the side's content without touching any tooltip containing blocks
    const overlay = document.querySelector("#skill-drop-overlay");
    const positionOverlay = () => {
      const rect = opponentContainer.getBoundingClientRect();
      overlay.style.left = `${rect.left}px`;
      overlay.style.top = `${rect.top}px`;
      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;
    };
    positionOverlay();
    overlay.classList.remove("hidden");
    onWindowResize = positionOverlay;
    cleanupDropTargets = () => {
      opponentContainer.classList.remove("skill-drop-active");
      overlay.classList.add("hidden");
    };
  } else {
    draggedEquipmentHandId = handCard.index;
    const dropTargets = document.querySelectorAll("#you-container .unit-card-horizontal-component");
    dropTargets.forEach((target) => target.classList.add("equip-drop-active"));
    cleanupDropTargets = () =>
      dropTargets.forEach((target) => target.classList.remove("equip-drop-active"));
  }

  // A press that never moves is a click, not a drag: the card it lands on turns
  // over, and until the pointer moves the card is left where it is. Hiding the
  // card it was pressed on is what the drag does once it starts — doing it on
  // mousedown instead made a `visibility: hidden` card stop matching `:hover`,
  // and the browser does not re-hit-test until the pointer moves again, so a
  // card clicked in the hand came to rest at its un-hovered size under a
  // motionless cursor.
  const startX = event.clientX;
  const startY = event.clientY;
  let moved = false;
  const onMouseMove = (moveEvent) => {
    if (!moved && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) > DRAG_THRESHOLD_PX) {
      moved = true;
      cardDiv.classList.add("invisible");
    }
    cardDrag.style.left = `${moveEvent.clientX - cardDrag.offsetWidth / 2}px`;
    cardDrag.style.top = `${moveEvent.clientY - cardDrag.offsetHeight / 2}px`;
  };
  const onMouseUp = () => {
    // remove dragging card
    document.body.removeChild(cardDrag);
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
    if (onWindowResize) window.removeEventListener("resize", onWindowResize);
    document.body.classList.remove("dragging");
    cardDiv.classList.remove("invisible");
    cleanupDropTargets();
    if (!moved) toggleCardFlip(cardDiv);
  };
  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onMouseUp);
  if (onWindowResize) window.addEventListener("resize", onWindowResize);
};

const renderHands = async (state) => {
  for (let player of ["you", "opponent"]) {
    const handContainer = document.querySelector(`#${player}-container .hand-container`);
    const registry = elementsOf(handContainer);
    const wanted = new Set();
    const order = [];
    for (let i = 0; i < state[player].hand.length; i++) {
      const handCard = buildHandCardViewModel(state[player].hand[i], i);
      // a readable card is keyed by the card itself, so it survives a draw or a
      // play that shifts the hand; a hidden card is one of several identical
      // backs and is keyed by its slot
      const key = `${player}:${handCard.isHidden ? `slot-${i}` : `card-${handCard.card.cardId}`}`;
      wanted.add(key);
      let mounted = registry.get(key);
      if (!mounted) {
        const element = document.createElement("div");
        element.classList.add("card-vertical-component");
        if (handCard.isHidden) element.classList.add("no-focus");
        handContainer.appendChild(element);
        mounted = { element };
        registry.set(key, mounted);
        await loadComponent(element, "card-vertical", {
          card: handCard.card,
          isSmall: true,
        });

        // your own cards drag: units deploy onto position zones, skills play
        // onto either board, equipments equip onto one of your deployed units
        const cardType = handCard.card.type;
        const draggable = player === "you" && !handCard.isHidden && ["unit", "skill", "equipment"].includes(cardType);
        if (draggable) {
          element.addEventListener("mousedown", (event) => {
            // the hand index moves as cards are played, so it is read from the
            // element at drag time rather than captured here
            beginCardDrag(event, element, { card: handCard.card, index: Number(element.dataset.handId) }, cardType);
          });
        }
      }
      if (player === "you") mounted.element.dataset.handId = String(i);
      order.push(mounted.element);
    }
    dropUnwanted(registry, wanted);
    orderChildren(handContainer, order);
  }

  alignHandCards();
};

const renderShinsu = (state) => {
  for (let player of ["you", "opponent"]) {
    const model = buildShinsuViewModel(state[player].shinsu);
    const circles = document.querySelectorAll(`#${player}-container .shinsu-circle`);
    const states = [...model.normal, ...model.recharged];
    circles.forEach((circle, i) => {
      circle.className = "shinsu-circle";
      if (states[i]) circle.classList.add(states[i]);
    });
  }
};

const renderPassButton = (state) => {
  for (let player of ["you", "opponent"]) {
    const passButtonFrame = document.querySelector(`#${player}-container .pass-button-frame`);
    passButtonFrame.querySelector("h2").textContent = state[player].passButton.text;
    if (state[player].username === state.currentTurn) passButtonFrame.classList.add("current-turn");
    else passButtonFrame.classList.remove("current-turn");
  }
};

const renderFireCharge = (state) => {
  const model = buildFireChargeViewModel(state);
  const container = document.querySelector("#fire-charge-container");
  // visible while the mechanic is live: charges held or generation available
  container.classList.toggle("hidden", !model.canGenerate && model.charges === 0);
  document.querySelector("#fire-charge-count").textContent = model.charges;
  document.querySelector("#fire-charge-generate").disabled = !model.canGenerate;
};

const renderDecisionPrompt = (state, socket) => {
  const promptEl = document.querySelector("#decision-prompt");
  const prompt = buildDecisionPromptViewModel(state.you?.pendingDecision ?? null);

  if (!prompt) {
    promptEl.classList.add("hidden");
    activeDecisionPrompt = null;
    activeDecisionId = null;
    selectedDecisionChoices = [];
    return;
  }

  // a new decision resets the selection; re-renders of the same decision keep it
  if (activeDecisionId !== prompt.decisionId) {
    activeDecisionId = prompt.decisionId;
    selectedDecisionChoices = [];
  }
  activeDecisionPrompt = prompt;
  promptEl.classList.remove("hidden");

  document.querySelector("#decision-prompt-title").textContent = prompt.title;
  // A fully committed decision (zero free slots) only asks for confirmation.
  document.querySelector("#decision-prompt-hint").textContent = prompt.maxChoices === 0
    ? "Confirm."
    : `Select ${prompt.minChoices === prompt.maxChoices ? prompt.minChoices : `${prompt.minChoices} to ${prompt.maxChoices}`}.`;

  const lockedIds = new Set(prompt.lockedIds);
  const candidatesEl = document.querySelector("#decision-prompt-candidates");
  candidatesEl.replaceChildren(
    ...prompt.candidates.map((candidate) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = candidate.hp != null ? `${candidate.name} (${candidate.hp})` : candidate.name;
      const isSelected = lockedIds.has(candidate.id) || selectedDecisionChoices.includes(candidate.id);
      if (isSelected) button.classList.add("selected");
      if (lockedIds.has(candidate.id)) button.disabled = true;
      button.addEventListener("click", () => {
        selectedDecisionChoices = selectedDecisionChoices.includes(candidate.id)
          ? selectedDecisionChoices.filter((id) => id !== candidate.id)
          : [...selectedDecisionChoices, candidate.id];
        renderDecisionPrompt(store.state, socket);
      });
      return button;
    })
  );

  document.querySelector("#decision-prompt-confirm").disabled = !canSubmitDecision(prompt, selectedDecisionChoices);
};

const render = async (state, data, socket) => {
  store.set(state);
  const positions = data.positions ?? {};
  renderRound(state);
  renderCombatSlots(state, positions, data.glossary);
  await renderDecks(state, data.glossary);
  renderLighthouses(state);
  await renderFields(state, socket);
  await renderHands(state);
  renderShinsu(state);
  renderPassButton(state);
  renderFireCharge(state);
  renderDecisionPrompt(state, socket);
  showGameOver(state.gameOver);
};

/* ── one-time board setup ─────────────────────────────────────────────── */

const prepareBoard = async (positionData, glossary, socket) => {
  for (let player of ["you", "opponent"]) {
    // lighthouses
    const lighthouseTooltip = glossary?.hud?.lighthouses;
    if (lighthouseTooltip) {
      const lighthouseContainer = document.querySelector(`#${player}-container .lighthouse-container`);
      await addTooltip(
        lighthouseContainer.querySelector("img"),
        lighthouseTooltip.name,
        lighthouseTooltip.texts
      );
    }

    // shinsu
    const shinsuTooltip = glossary?.hud?.shinsuBoard;
    const rechargedTooltip = glossary?.hud?.rechargedShinsu;
    if (shinsuTooltip && rechargedTooltip) {
      const shinsuContainer = document.querySelector(`#${player}-container .shinsu-container`);
      const normalContainer = shinsuContainer.querySelector(".normal-shinsu");
      await addTooltip(normalContainer, shinsuTooltip.name, shinsuTooltip.texts);
      const rechargedContainer = shinsuContainer.querySelector(".recharged-shinsu");
      await addTooltip(rechargedContainer, rechargedTooltip.name, rechargedTooltip.texts);
    }
  }

  // position drop zones
  for (let line of ["frontline", "backline"]) {
    const lineContainer = document.querySelector(`#you-container .${line}-container`);
    const positionCodes = Object.keys(positionData).filter((code) => positionData[code].line === line);
    for (let code of positionCodes) {
      const dropZoneContainer = document.createElement("div");
      dropZoneContainer.classList.add("position-drop-zone", "container-horizontal", "hidden");
      // only set background-image when iconPath is present and valid to avoid requesting invalid URLs
      const iconPath = positionData[code] && positionData[code].iconPath;
      const iconDiv = document.createElement("div");
      iconDiv.classList.add("position-drop-zone-icon");
      if (
        typeof iconPath === "string" &&
        iconPath.trim() !== "" &&
        iconPath !== "undefined" &&
        iconPath !== "null"
      ) {
        iconDiv.style.backgroundImage = `url(${iconPath})`;
      }
      dropZoneContainer.appendChild(iconDiv);
      dropZoneContainer.dataset.positionCode = code;
      dropZoneContainer.addEventListener("mouseup", () => {
        if (draggedCardHandId === null) return;
        socket.emit(EVENTS.GAME_ACTION, buildDeployUnitAction(draggedCardHandId, code));
        draggedCardHandId = null;
      });
      lineContainer.appendChild(dropZoneContainer);
    }
  }

  // dropping a skill anywhere on the opponent's side plays it
  document.querySelector("#opponent-container").addEventListener("mouseup", () => {
    if (draggedSkillHandId === null) return;
    socket.emit(EVENTS.GAME_ACTION, buildPlaySkillAction(draggedSkillHandId));
    draggedSkillHandId = null;
  });

  // dropping an equipment card on one of your deployed units equips it
  document.querySelector("#you-container").addEventListener("mouseup", (event) => {
    if (draggedEquipmentHandId === null) return;
    const unitDiv = event.target.closest(".unit-card-horizontal-component");
    if (!unitDiv || !unitDiv.dataset.unitId) return;
    const state = store.state;
    const unitView = state ? findUnit(state, "you", unitDiv.dataset.unitId) : null;
    if (!unitView) return;
    socket.emit(EVENTS.GAME_ACTION, buildEquipEquipmentAction(draggedEquipmentHandId, unitView.id));
    draggedEquipmentHandId = null;
  });

  // hovering a deployed unit highlights its position's combat slot
  for (let player of ["you", "opponent"]) {
    const sideContainer = document.querySelector(`#${player}-container`);
    let highlightedSlot = null;
    const clearHighlight = () => {
      highlightedSlot?.classList.remove("highlight-available", "highlight-used");
      highlightedSlot = null;
    };
    sideContainer.addEventListener("mouseover", (event) => {
      const unitDiv = event.target.closest(".unit-card-horizontal-component");
      if (!unitDiv || !unitDiv.dataset.unitId) return;
      const state = store.state;
      const unitView = state ? findUnit(state, player, unitDiv.dataset.unitId) : null;
      if (!unitView?.placedPositionCode) return;
      const slot = sideContainer.querySelector(
        `.combat-slots-container [data-position-code="${unitView.placedPositionCode}"]`
      );
      if (!slot || slot === highlightedSlot) return;
      clearHighlight();
      slot.classList.add(
        buildCombatSlotViewModel(state[player], unitView.placedPositionCode).used
          ? "highlight-used"
          : "highlight-available"
      );
      highlightedSlot = slot;
    });
    sideContainer.addEventListener("mouseout", (event) => {
      const unitDiv = event.target.closest(".unit-card-horizontal-component");
      if (!unitDiv) return;
      const relatedUnitDiv = event.relatedTarget?.closest?.(".unit-card-horizontal-component") ?? null;
      if (relatedUnitDiv === unitDiv) return; // still inside the same unit
      clearHighlight();
    });
  }

  // pass button
  const passButtonFrame = document.querySelector(`#you-container .pass-button-frame`);
  passButtonFrame.addEventListener("click", () => {
    socket.emit(EVENTS.GAME_ACTION, buildPassTurnAction());
  });

  // fire charges: the Hwayeomsa core ability
  const fireChargeTooltip = glossary?.hud?.fireCharges;
  if (fireChargeTooltip) {
    const fireChargeContainer = document.querySelector("#fire-charge-container");
    await addTooltip(
      fireChargeContainer.querySelector("h2"),
      fireChargeTooltip.name,
      fireChargeTooltip.texts
    );
  }
  document.querySelector("#fire-charge-generate").addEventListener("click", () => {
    socket.emit(EVENTS.GAME_ACTION, buildGenerateFireChargeAction());
  });

  // hand focus follows the cursor; attached once so re-renders never stack
  // listeners. The hover class the card styles itself from is set here too: the
  // hand is what knows which card the pointer is on, and it keeps knowing while
  // a card is turned, which the browser's own hover does not.
  for (let player of ["you", "opponent"]) {
    const handContainer = document.querySelector(`#${player}-container .hand-container`);
    handContainer.addEventListener("mousemove", (event) => {
      let closestCard = null;
      let closestDistance = Infinity;
      const cards = handContainer.querySelectorAll(".card-vertical-component");
      cards.forEach((card) => {
        card.classList.remove("focused");
        const cardRect = card.getBoundingClientRect();
        const cardCenterX = cardRect.left + cardRect.width / 2;
        const distance = Math.abs(event.clientX - cardCenterX);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestCard = card;
        }
      });
      if (closestCard) closestCard.classList.add("focused");
      cards.forEach((card) => card.classList.toggle("card-vertical-hovered", card === closestCard));
    });
    handContainer.addEventListener("mouseleave", () => {
      handContainer
        .querySelectorAll(".card-vertical-component")
        .forEach((card) => card.classList.remove("focused", "card-vertical-hovered"));
    });
  }

  // keep the hands aligned when the window resizes
  window.addEventListener("resize", alignHandCards);

  // board clicks on your units: switch position
  for (let line of ["frontline", "backline"]) {
    const lineContainer = document.querySelector(`#you-container .${line}-container`);
    lineContainer.addEventListener("click", (event) => {
      const unitDiv = event.target.closest(".unit-card-horizontal-component");
      if (!unitDiv || !unitDiv.dataset.unitId) return;
      const state = store.state;
      if (!state) return;
      const unitView = findUnit(state, "you", unitDiv.dataset.unitId);
      if (!unitView) return;
      const unit = buildUnitViewModel(unitView);
      if (state.currentTurn !== state.you.username) return;
      const codes = Object.keys(unit.positions).filter((code) => code !== unit.placedPositionCode);
      if (codes.length === 0) return;
      // keep the opening click from immediately closing the chooser
      event.stopPropagation();
      const chooser = document.querySelector("#position-chooser");
      chooser.replaceChildren(
        ...codes.map((code) => {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = unit.positions[code].name;
          button.addEventListener("click", (chooseEvent) => {
            chooseEvent.stopPropagation();
            socket.emit(EVENTS.GAME_ACTION, buildSwitchPositionAction(unit.id, code));
            hidePositionChooser();
          });
          return button;
        })
      );
      chooser.classList.remove("hidden");
      chooser.style.left = `${Math.min(event.clientX, window.innerWidth - chooser.offsetWidth - 8)}px`;
      chooser.style.top = `${Math.min(event.clientY, window.innerHeight - chooser.offsetHeight - 8)}px`;
    });
  }

  // clicking anywhere outside the chooser closes it
  document.addEventListener("click", (event) => {
    const chooser = document.querySelector("#position-chooser");
    if (!chooser.classList.contains("hidden") && !chooser.contains(event.target)) hidePositionChooser();
  });

  // the decision prompt confirms through one stable listener; locked
  // candidates are engine-committed, so only the free selections are sent
  document.querySelector("#decision-prompt-confirm").addEventListener("click", () => {
    const prompt = activeDecisionPrompt;
    if (!prompt || !canSubmitDecision(prompt, selectedDecisionChoices)) return;
    socket.emit(EVENTS.GAME_DECISION, buildDecision(prompt.decisionId, selectedDecisionChoices));
  });

  // overlays close on click
  document.querySelector("#peek-overlay").addEventListener("click", (event) => {
    event.currentTarget.classList.add("hidden");
  });
};

/* ── boot ─────────────────────────────────────────────────────────────── */

document.addEventListener("DOMContentLoaded", async () => {
  const data = await prepareData();

  const roomCode = roomCodeFromPath(window.location.pathname);
  if (roomCode === null) {
    alert("Invalid or missing room code. Redirecting to Play page.");
    window.location.href = "/play";
    return;
  }

  const socket = io("/game", {
    query: { roomCode },
  });

  // The room moves back to the deck step when a dev room restarts, so the
  // board hands the browser over to whichever step the server names.
  followRoomStep(socket, roomCode, STEP.BOARD, { ignore: [EVENTS.GAME_INIT] });

  // Every snapshot is the whole board, so updates that arrive while a render is
  // running collapse into it: rendering each one would paint the same board
  // again, and a turn change delivers several in a row (its own action, then
  // the opponent's or the bot's), which is what made the board flash.
  let pendingState = null;
  let rendering = false;
  const scheduleRender = (payload) => {
    pendingState = payload;
    if (rendering) return;
    rendering = true;
    void (async () => {
      while (pendingState) {
        const next = pendingState;
        pendingState = null;
        try {
          await render(next, data, socket);
        } catch (error) {
          console.error(`Game render failed: ${error.message}`);
        }
      }
      rendering = false;
    })();
  };

  socket.on(EVENTS.GAME_INIT, scheduleRender);
  socket.on(EVENTS.GAME_UPDATE, scheduleRender);
  socket.on(EVENTS.GAME_ERROR, (payload) => {
    // A connection rejected for identity means the session is gone, which the
    // login page can fix; every other rejection is the player's to read.
    if (payload?.code === ERROR_CODES.UNAUTHENTICATED) {
      socket.disconnect();
      redirectToLogin();
      return;
    }
    alert(payload?.message ?? "Something went wrong.");
  });
  socket.on(EVENTS.GAME_OVER, (payload) => showGameOver(payload));
  socket.on(EVENTS.GAME_HAND_PEEK, (payload) => showPeekReveal(payload));
  // after a transport reconnect the server treats the socket as new, so ask
  // for the current state view
  socket.on("connect", () => socket.emit(EVENTS.GAME_STATE_REQUEST));

  await prepareBoard(data.positions ?? {}, data.glossary, socket);
});
