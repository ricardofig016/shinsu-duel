import { loadComponent, addTooltip } from "/utils/component-util.js";

let draggedCardHandId = null;

const prepareData = async () => {
  const positions = await fetchFromPath("positions");
  return { positions };
};

const fetchFromPath = async (path) => {
  const response = await fetch(`/${path}/`);
  if (!response.ok) return console.error(await response.text());
  return await response.json();
};

const addBorderToDivs = () => {
  const divs = document.querySelectorAll("div");
  divs.forEach((div) => {
    const randomColor = `#${Math.floor(Math.random() * 16777215).toString(16)}`;
    div.style.border = `1px solid ${randomColor}`;
  });
};

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
      dropZoneContainer.addEventListener("mouseup", (event) => {
        socket.emit("game-action", {
          type: "deploy-unit-action",
          data: { handId: draggedCardHandId, placedPositionCode: code },
        });
        draggedCardHandId = null;
      });
      lineContainer.appendChild(dropZoneContainer);
    }
  }

  // pass button
  const passButtonFrame = document.querySelector(`#you-container .pass-button-frame`);
  passButtonFrame.addEventListener("click", () => {
    socket.emit("game-action", {
      type: "pass-turn-action",
      data: {},
    });
  });
};

const load = async (gameState, data, socket) => {
  const loadCombatSlots = async () => {
    for (let player of ["you", "opponent"]) {
      const slotsContainer = document.querySelector(`#${player}-container .combat-slots-container`);
      slotsContainer.innerHTML = "";
      for (let code of gameState[player].combatSlotCodes) {
        const newImg = document.createElement("img");
        newImg.src = `/assets/icons/positions/${code}.png`;
        newImg.alt = code;
        slotsContainer.appendChild(newImg);
        await addTooltip(
          slotsContainer,
          newImg,
          data.positions[code].name,
          data.positions[code].description,
          newImg.src
        );
      }
    }
  };

  const loadDecks = async () => {
    const basePosition = [0, 50];
    const positionOffset = 0.2;
    const maxDeckSize = 20;
    for (let player of ["you", "opponent"]) {
      const outerDiv = document.querySelector(`#${player}-container .deck-outer-container`);
      const deckContainer = outerDiv.querySelector(`.deck-container`);
      deckContainer.innerHTML = "";
      const cardAmount = Math.min(gameState[player].deckSize, maxDeckSize);
      for (let i = 0; i < cardAmount; i++) {
        const newDiv = document.createElement("div");
        newDiv.classList.add("unit-card-vertical-component", "deck-card");
        deckContainer.appendChild(newDiv);
        await loadComponent(newDiv, "unit-card-vertical", {});
        newDiv.style.bottom = `${basePosition[0] + i * positionOffset}%`;
        newDiv.style.left = `${basePosition[1] - i * positionOffset}%`;
        if (i === cardAmount - 1)
          await addTooltip(outerDiv, newDiv, "Deck", `${gameState[player].deckSize} cards remaining`);
      }
    }
  };

  const loadLightHouses = async () => {
    for (let player of ["you", "opponent"]) {
      const lighthouseContainer = document.querySelector(`#${player}-container .lighthouse-container`);
      const lighthouseAmount = gameState[player].lighthouses.amount;
      lighthouseContainer.querySelector("h1").textContent = lighthouseAmount;
    }
  };

  const loadFields = async () => {
    for (let player of ["you", "opponent"]) {
      for (let line in gameState[player].field) {
        // delete existing divs
        const lineContainer = document.querySelector(`#${player}-container .${line}-container`);
        const existingDivs = lineContainer.querySelectorAll(".unit-card-horizontal-component");
        existingDivs.forEach((div) => div.remove());
        // we reverse the order of the cards in the line beacuse we're going to prepend them to the container,
        // this is because we need to keep the position drop zones at the end of the line
        const units = [...gameState[player].field[line]].reverse();
        for (let unit of units) {
          // create div
          const newDiv = document.createElement("div");
          newDiv.classList.add("unit-card-horizontal-component");
          // add div to the beggining of the line container
          lineContainer.prepend(newDiv);
          // load card component
          await loadComponent(newDiv, "unit-card-horizontal", {
            unit,
            socket: socket,
          });
        }
      }
    }
  };

  const loadHands = async () => {
    for (let player of ["you", "opponent"]) {
      const handContainer = document.querySelector(`#${player}-container .hand-container`);
      handContainer.innerHTML = "";
      // load cards
      for (let i = 0; i < gameState[player].hand.length; i++) {
        let card = gameState[player].hand[i];
        // create div
        const newDiv = document.createElement("div");
        newDiv.classList.add("unit-card-vertical-component");
        if (!card.cardId) newDiv.classList.add("no-focus");
        handContainer.appendChild(newDiv);
        // load card component
        await loadComponent(newDiv, "unit-card-vertical", {
          card: card,
          isSmall: true,
          socket: null,
        });
        // drag and drop
        if (player === "opponent") continue;
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
          // show drop zones
          const dropZones = document.querySelectorAll(`.position-drop-zone`);
          const positionCodes = Object.keys(card.positions);
          dropZones.forEach((zone) => {
            if (positionCodes.includes(zone.dataset.positionCode)) zone.classList.remove("hidden");
          });
          // save card id
          draggedCardHandId = i;
          // events
          const onMouseMove = (event) => {
            cardDrag.style.left = `${event.clientX - cardDrag.offsetWidth / 2}px`;
            cardDrag.style.top = `${event.clientY - cardDrag.offsetHeight / 2}px`;
          };
          const onMouseUp = (event) => {
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
      // focused card
      const cardComponents = handContainer.querySelectorAll(".unit-card-vertical-component");
      handContainer.addEventListener("mousemove", (event) => {
        let closestCard = null;
        let closestDistance = Infinity;
        cardComponents.forEach((card) => {
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
        cardComponents.forEach((card) => card.classList.remove("focused"));
      });
    }

    // align cards
    const alignCards = () => {
      const handContainers = document.querySelectorAll(".hand-container");
      handContainers.forEach((handContainer) => {
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
    setTimeout(alignCards, 0);
    setTimeout(alignCards, 300); // very rarelly the cards dont align late enough
    window.addEventListener("resize", alignCards);
  };

  const loadShinsu = async () => {
    const maxNormalShinsu = 10;
    const maxRechargedShinsu = 2;
    for (let player of ["you", "opponent"]) {
      const shinsu = gameState[player].shinsu;
      const shinsuContainer = document.querySelector(`#${player}-container .shinsu-container`);
      let shinsuCircles = Array.from(shinsuContainer.querySelectorAll(".shinsu-circle"));
      // reset classes
      shinsuCircles.forEach((c) => c.classList.remove("available", "spent", "unavailable"));
      // normal shinsu
      for (let i = 0; i < shinsu.normalAvailable; i++) shinsuCircles[i].classList.add("available");
      for (let i = shinsu.normalAvailable; i < shinsu.normalAvailable + shinsu.normalSpent; i++)
        shinsuCircles[i].classList.add("spent");
      for (let i = shinsu.normalAvailable + shinsu.normalSpent; i < maxNormalShinsu; i++)
        shinsuCircles[i].classList.add("unavailable");
      // recharged shinsu
      for (let i = maxNormalShinsu; i < maxNormalShinsu + shinsu.recharged; i++) {
        try {
          shinsuCircles[i].classList.add("available");
        } catch (error) {
          console.log("shinsu.recharged", shinsu.recharged);
        }
      }
      for (let i = maxNormalShinsu + shinsu.recharged; i < maxNormalShinsu + maxRechargedShinsu; i++)
        shinsuCircles[i].classList.add("spent");
    }
  };

  const loadPassButton = async () => {
    for (let player of ["you", "opponent"]) {
      const passButtonFrame = document.querySelector(`#${player}-container .pass-button-frame`);
      passButtonFrame.querySelector("h2").textContent = gameState[player].passButton.text;
      // turn
      if (gameState[player].username === gameState.currentTurn) passButtonFrame.classList.add("current-turn");
      else passButtonFrame.classList.remove("current-turn");
    }
  };

  await loadCombatSlots();
  await loadDecks();
  await loadLightHouses();
  await loadFields();
  await loadHands();
  await loadShinsu();
  await loadPassButton();
};

document.addEventListener("DOMContentLoaded", async () => {
  let data = await prepareData();
  let gameState;

  // addBorderToDivs();

  // socket
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
  socket.on("game-init", async (initialState) => {
    gameState = initialState;
    await load(gameState, data, socket);
  });
  socket.on("game-update", async (newState) => {
    gameState = newState;
    console.dir(gameState);
    await load(gameState, data, socket);
  });
  socket.on("game-error", async (errorMessage) => {
    console.error("errorMessage: ", errorMessage);
    alert(`Error: ${errorMessage}`);
  });

  await prepareBoard(data.positions, socket);
});
