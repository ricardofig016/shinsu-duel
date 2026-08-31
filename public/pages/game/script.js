import { loadComponent, addTooltip } from "/utils/component-util.js";
import { EVENTS } from "/game/protocol.js";
import { createGameStore } from "/game/store.js";
import {
  buildCardViewModel,
  buildDecisionPromptViewModel,
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
  buildPassTurnAction,
  buildPlaySkillAction,
  buildSwitchPositionAction,
  buildUseAbilityAction,
} from "/game/actions.js";

const store = createGameStore();

let draggedCardHandId = null;
let armedEquipmentHandId = null;
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
  return { positions };
};

const findYourUnit = (state, unitId) => {
  for (const line of ["frontline", "backline"]) {
    const unit = state.you.field[line].find((candidate) => candidate.id === unitId);
    if (unit) return unit;
  }
  return null;
};

/* ── overlays ─────────────────────────────────────────────────────────── */

const showWaiting = (payload) => {
  const overlay = document.querySelector("#waiting-overlay");
  document.querySelector("#waiting-overlay-message").textContent = payload?.message ?? "";
  overlay.classList.remove("hidden");
};

const showPeekReveal = (payload) => {
  const overlay = document.querySelector("#peek-overlay");
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

const setArmedEquipment = (handId) => {
  armedEquipmentHandId = handId;
  document
    .querySelectorAll("#you-container .unit-card-horizontal-component")
    .forEach((div) => div.classList.toggle("equip-target", handId !== null));
};

/** Keep the hand cards aligned across the container width. */
const alignHandCards = () => {
  document.querySelectorAll(".hand-container").forEach((handContainer) => {
    const handContainerWidth = window.innerWidth - handContainer.getBoundingClientRect().left;
    const cards = handContainer.querySelectorAll(".unit-card-vertical-component");
    if (cards.length === 0) return;
    const cardWidth = cards[0].offsetWidth;
    if (cards.length * cardWidth < handContainerWidth) handContainer.style.justifyContent = "center";
    else {
      const cardOffset = (handContainerWidth - cardWidth) / (cards.length - 1);
      cards.forEach((card, index) => {
        if (index !== 0) card.style.marginLeft = `${-cardWidth + cardOffset}px`;
      });
    }
  });
};

/* ── renderers ────────────────────────────────────────────────────────── */

const renderRound = (state) => {
  const model = buildRoundViewModel(state);
  document.querySelector("#round-indicator h2").textContent = model.round;
};

const renderCombatSlots = (state, positions) => {
  for (let player of ["you", "opponent"]) {
    const slotsContainer = document.querySelector(`#${player}-container .combat-slots-container`);
    slotsContainer.innerHTML = "";
    for (let code of state[player].combatSlotCodes) {
      const newImg = document.createElement("img");
      newImg.src = `/assets/icons/positions/${code}.png`;
      newImg.alt = code;
      slotsContainer.appendChild(newImg);
      addTooltip(
        slotsContainer,
        newImg,
        positions[code]?.name ?? code,
        positions[code]?.description ?? "",
        newImg.src
      );
    }
  }
};

const renderDecks = async (state) => {
  const basePosition = [0, 50];
  const positionOffset = 0.2;
  const maxDeckSize = 20;
  for (let player of ["you", "opponent"]) {
    const outerDiv = document.querySelector(`#${player}-container .deck-outer-container`);
    const deckContainer = outerDiv.querySelector(`.deck-container`);
    deckContainer.innerHTML = "";
    const cardAmount = Math.min(state[player].deckSize, maxDeckSize);
    for (let i = 0; i < cardAmount; i++) {
      const newDiv = document.createElement("div");
      newDiv.classList.add("unit-card-vertical-component", "deck-card");
      deckContainer.appendChild(newDiv);
      await loadComponent(newDiv, "unit-card-vertical", {});
      newDiv.style.bottom = `${basePosition[0] + i * positionOffset}%`;
      newDiv.style.left = `${basePosition[1] - i * positionOffset}%`;
      if (i === cardAmount - 1)
        await addTooltip(outerDiv, newDiv, "Deck", `${state[player].deckSize} cards remaining`);
    }
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
      const existingDivs = lineContainer.querySelectorAll(".unit-card-horizontal-component");
      existingDivs.forEach((div) => div.remove());
      // units are prepended so the position drop zones stay at the end
      const units = [...state[player].field[line]].reverse();
      for (let unitView of units) {
        const newDiv = document.createElement("div");
        newDiv.classList.add("unit-card-horizontal-component");
        newDiv.dataset.unitId = unitView.id;
        if (interactive && armedEquipmentHandId !== null) newDiv.classList.add("equip-target");
        lineContainer.prepend(newDiv);
        await loadComponent(newDiv, "unit-card-horizontal", {
          unit: buildUnitViewModel(unitView),
          interactive,
          onAbilityClick: interactive
            ? (unitId, abilityCode) => socket.emit(EVENTS.GAME_ACTION, buildUseAbilityAction(unitId, abilityCode))
            : null,
        });
      }
    }
  }
};

const renderHands = async (state, socket) => {
  for (let player of ["you", "opponent"]) {
    const handContainer = document.querySelector(`#${player}-container .hand-container`);
    handContainer.innerHTML = "";
    for (let i = 0; i < state[player].hand.length; i++) {
      const handCard = buildHandCardViewModel(state[player].hand[i], i);
      const newDiv = document.createElement("div");
      newDiv.classList.add("unit-card-vertical-component");
      if (handCard.isHidden) newDiv.classList.add("no-focus");
      if (player === "you") newDiv.dataset.handId = i;
      handContainer.appendChild(newDiv);
      await loadComponent(newDiv, "unit-card-vertical", {
        card: handCard.card,
        isSmall: true,
      });

      // only your own unit cards deploy by dragging onto a position zone
      if (player !== "you" || handCard.isHidden || handCard.card.type !== "unit") continue;
      newDiv.addEventListener("mousedown", (event) => {
        if (event.button !== 0) return; // left click
        // create dragging card
        const cardDrag = newDiv.cloneNode(true);
        const innerCard = cardDrag.querySelector(".unit-card-vertical-component");
        if (innerCard) cardDrag.removeChild(innerCard);
        cardDrag.classList.add("card-dragging");
        document.body.appendChild(cardDrag);
        // position dragging card
        cardDrag.style.left = `${event.clientX - cardDrag.offsetWidth / 2}px`;
        cardDrag.style.top = `${event.clientY - cardDrag.offsetHeight / 2}px`;
        document.body.classList.add("no-interaction");
        // hide original card
        newDiv.classList.add("invisible");
        // show drop zones for the positions this card can be placed in
        const positionCodes = Object.keys(handCard.card.positions);
        const dropZones = document.querySelectorAll(`.position-drop-zone`);
        dropZones.forEach((zone) => {
          if (positionCodes.includes(zone.dataset.positionCode)) zone.classList.remove("hidden");
        });
        draggedCardHandId = handCard.index;
        // events
        const onMouseMove = (event) => {
          cardDrag.style.left = `${event.clientX - cardDrag.offsetWidth / 2}px`;
          cardDrag.style.top = `${event.clientY - cardDrag.offsetHeight / 2}px`;
        };
        const onMouseUp = () => {
          // remove dragging card
          document.body.removeChild(cardDrag);
          document.removeEventListener("mousemove", onMouseMove);
          document.removeEventListener("mouseup", onMouseUp);
          document.body.classList.remove("no-interaction");
          newDiv.classList.remove("invisible");
          // hide drop zones
          dropZones.forEach((zone) => zone.classList.add("hidden"));
        };
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
      });
    }
  }

  // align cards
  setTimeout(alignHandCards, 0);
  setTimeout(alignHandCards, 300); // very rarely the cards dont align late enough
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
  const range = prompt.minChoices === prompt.maxChoices ? `${prompt.minChoices}` : `${prompt.minChoices} to ${prompt.maxChoices}`;
  document.querySelector("#decision-prompt-hint").textContent = `Select ${range}.`;

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
  renderCombatSlots(state, positions);
  await renderDecks(state);
  renderLighthouses(state);
  await renderFields(state, socket);
  await renderHands(state, socket);
  renderShinsu(state);
  renderPassButton(state);
  renderDecisionPrompt(state, socket);
  const gameOver = buildGameOverViewModel(state.gameOver, state.you?.username);
  document.querySelector("#game-over-overlay").classList.toggle("hidden", gameOver === null);
  if (gameOver) {
    document.querySelector("#game-over-headline").textContent = gameOver.headline;
    document.querySelector("#game-over-detail").textContent = `${gameOver.winner} wins: ${gameOver.reason}`;
  }
  document.querySelector("#waiting-overlay").classList.add("hidden");
};

/* ── one-time board setup ─────────────────────────────────────────────── */

const prepareBoard = async (positionData, socket) => {
  for (let player of ["you", "opponent"]) {
    // lighthouses
    const lighthouseContainer = document.querySelector(`#${player}-container .lighthouse-container`);
    await addTooltip(
      lighthouseContainer,
      lighthouseContainer.querySelector("img"),
      "Lighthouses",
      "If you run out of lighthouses, you lose the game"
    );

    // shinsu
    const shinsuContainer = document.querySelector(`#${player}-container .shinsu-container`);
    const normalContainer = shinsuContainer.querySelector(".normal-shinsu");
    await addTooltip(
      shinsuContainer,
      normalContainer,
      "Shinsu",
      "The resource that lets you play cards and use certain abilities"
    );
    const rechargedContainer = shinsuContainer.querySelector(".recharged-shinsu");
    await addTooltip(
      shinsuContainer,
      rechargedContainer,
      "Recharged Shinsu",
      "The shinsu that wasn't used last turn"
    );
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

  // pass button
  const passButtonFrame = document.querySelector(`#you-container .pass-button-frame`);
  passButtonFrame.addEventListener("click", () => {
    socket.emit(EVENTS.GAME_ACTION, buildPassTurnAction());
  });

  // hand focus follows the cursor; attached once so re-renders never stack listeners
  for (let player of ["you", "opponent"]) {
    const handContainer = document.querySelector(`#${player}-container .hand-container`);
    handContainer.addEventListener("mousemove", (event) => {
      let closestCard = null;
      let closestDistance = Infinity;
      handContainer.querySelectorAll(".unit-card-vertical-component").forEach((card) => {
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
    });
    handContainer.addEventListener("mouseleave", () => {
      handContainer
        .querySelectorAll(".unit-card-vertical-component")
        .forEach((card) => card.classList.remove("focused"));
    });
  }

  // keep the hands aligned when the window resizes
  window.addEventListener("resize", alignHandCards);

  // hand clicks: play skills, arm equipment for targeting
  const yourHandContainer = document.querySelector(`#you-container .hand-container`);
  yourHandContainer.addEventListener("click", (event) => {
    const cardDiv = event.target.closest(".unit-card-vertical-component");
    if (!cardDiv || cardDiv.dataset.handId === undefined) return;
    const state = store.state;
    const handId = Number(cardDiv.dataset.handId);
    const handCard = state?.you.hand[handId];
    if (!handCard) return;
    const model = buildCardViewModel(handCard);
    if (state.currentTurn !== state.you.username) return; // player actions need your turn
    if (model.type === "skill") {
      socket.emit(EVENTS.GAME_ACTION, buildPlaySkillAction(handId));
    } else if (model.type === "equipment") {
      setArmedEquipment(armedEquipmentHandId === handId ? null : handId);
    }
  });

  // board clicks on your units: equip the armed card, else switch position
  for (let line of ["frontline", "backline"]) {
    const lineContainer = document.querySelector(`#you-container .${line}-container`);
    lineContainer.addEventListener("click", (event) => {
      const unitDiv = event.target.closest(".unit-card-horizontal-component");
      if (!unitDiv || !unitDiv.dataset.unitId) return;
      // clicks on an expanded card view are not board interactions
      if (event.target.closest(".unit-card-vertical-component")) return;
      const state = store.state;
      if (!state) return;
      const unitView = findYourUnit(state, unitDiv.dataset.unitId);
      if (!unitView) return;
      const unit = buildUnitViewModel(unitView);
      if (armedEquipmentHandId !== null) {
        socket.emit(EVENTS.GAME_ACTION, buildEquipEquipmentAction(armedEquipmentHandId, unit.id));
        setArmedEquipment(null);
        return;
      }
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

  const roomCode = window.location.pathname.split("/").pop();
  const isValidRoomCode = (code) =>
    typeof code === "string" && code.trim() !== "" && code !== "undefined" && code !== "null";
  if (!isValidRoomCode(roomCode)) {
    alert("Invalid or missing room code. Redirecting to Play page.");
    window.location.href = "/play";
    return;
  }

  const socket = io("/game", {
    query: { roomCode },
  });

  // Renders are serialized: each snapshot rebuilds the whole page, so
  // overlapping deliveries must not interleave half-finished rebuilds.
  let renderChain = Promise.resolve();
  const scheduleRender = (payload) => {
    renderChain = renderChain
      .then(() => render(payload, data, socket))
      .catch((error) => console.error(`Game render failed: ${error.message}`));
  };

  socket.on(EVENTS.GAME_INIT, scheduleRender);
  socket.on(EVENTS.GAME_UPDATE, scheduleRender);
  socket.on(EVENTS.GAME_ERROR, (payload) => alert(payload?.message ?? "Something went wrong."));
  socket.on(EVENTS.GAME_WAITING, (payload) => showWaiting(payload));
  socket.on(EVENTS.GAME_HAND_PEEK, (payload) => showPeekReveal(payload));
  // after a transport reconnect the server treats the socket as new, so ask
  // for the current state view
  socket.on("connect", () => socket.emit(EVENTS.GAME_STATE_REQUEST));

  await prepareBoard(data.positions ?? {}, socket);
});
