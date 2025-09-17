import { loadComponent, addTooltip } from "/utils/component-util.js";

let draggedCardHandId = null;

const prepareData = async () => {
  // init
  let data = {};
  data.gameState = {};
  data.gameState.opponent = {};
  data.gameState.you = {};

  // fetch data
  data.cards = await fetchFromPath("cards");
  data.traits = await fetchFromPath("traits");
  data.affiliations = await fetchFromPath("affiliations");
  data.positions = await fetchFromPath("positions");

  return data;
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

const getRandomGameData = (data) => {
  let gameData = {};
  for (let player of ["you", "opponent"]) {
    let playerData = {};

    // combat slots
    const positions = Object.keys(data.positions);
    const positionAmount = Math.floor(Math.random() * 7);
    playerData.combatSlotCodes = [];
    for (let i = 0; i < positionAmount; i++) {
      const randomIndex = Math.floor(Math.random() * positions.length);
      playerData.combatSlotCodes.push(positions[randomIndex]);
      positions.splice(randomIndex, 1);
    }
    playerData.combatSlotCodes.sort();

    // deck
    playerData.deck = {};
    playerData.deckSize = Math.floor(Math.random() * 21);

    // lighthouses
    playerData.lighthouses = {};
    playerData.lighthouses.amount = Math.floor(Math.random() * 21);

    // field
    playerData.field = { frontline: [], backline: [] };
    const traitCodes = Object.keys(data.traits);
    const maxId = 6;
    const maxTraitCodes = 15;
    for (let line of Object.keys(playerData.field)) {
      const cardAmount = Math.floor(Math.random() * 6);
      for (let i = 0; i < cardAmount; i++) {
        let card = {};
        card.id = Math.floor(Math.random() * (maxId + 1));
        const randomCodeNumber = Math.floor(Math.random() * (maxTraitCodes + 1));
        const shuffledTraitCodes = traitCodes.sort(() => 0.5 - Math.random());
        card.traitCodes = shuffledTraitCodes.slice(0, randomCodeNumber);
        const positionCodes = data.cards[card.id].positionCodes;
        card.placedPositionCode = positionCodes[Math.floor(Math.random() * positionCodes.length)];
        playerData.field[line].push(card);
      }
    }

    // hand
    playerData.hand = [];
    const cardAmount = Math.floor(Math.random() * 11);
    for (let i = 0; i < cardAmount; i++) {
      let card = {};
      card.id = Math.floor(Math.random() * (maxId + 1));
      const randomCodeNumber = Math.floor(Math.random() * (maxTraitCodes + 1));
      const shuffledTraitCodes = traitCodes.sort(() => 0.5 - Math.random());
      card.traitCodes = shuffledTraitCodes.slice(0, randomCodeNumber);
      if (player === "opponent" && Math.random() < 0.8) card = {}; // 80% chance of empty card
      playerData.hand.push(card);
    }

    // shinsu
    playerData.shinsu = {};
    playerData.shinsu.normalSpent = Math.floor(Math.random() * 11);
    playerData.shinsu.normalAvailable = Math.floor(Math.random() * (10 - playerData.shinsu.normalSpent + 1));
    playerData.shinsu.recharged = Math.floor(Math.random() * 3);

    gameData[player] = playerData;

    // username
    gameData[player].username = Math.random().toString(36).substring(2, 12);
  }
  // turn
  gameData.currentTurn = Math.random() < 0.5 ? "you" : "opponent";

  return gameData;
};

const prepareBoard = async (data, socket) => {
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
    const positionCodes = Object.keys(data.positions).filter((code) => data.positions[code].line === line);
    for (let code of positionCodes) {
      const dropZoneContainer = document.createElement("div");
      dropZoneContainer.classList.add("position-drop-zone", "container-horizontal", "hidden");
      dropZoneContainer.innerHTML = `<div class="position-drop-zone-icon" style="background-image: url(${data.positions[code].iconPath})"></div>`;
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

const load = async (data) => {
  const loadCombatSlots = async () => {
    for (let player of ["you", "opponent"]) {
      const slotsContainer = document.querySelector(`#${player}-container .combat-slots-container`);
      slotsContainer.innerHTML = "";
      for (let code of data.gameState[player].combatSlotCodes) {
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
      const cardAmount = Math.min(data.gameState[player].deckSize, maxDeckSize);
      for (let i = 0; i < cardAmount; i++) {
        const newDiv = document.createElement("div");
        newDiv.classList.add("unit-card-vertical-component", "deck-card");
        deckContainer.appendChild(newDiv);
        await loadComponent(newDiv, "unit-card-vertical", {});
        newDiv.style.bottom = `${basePosition[0] + i * positionOffset}%`;
        newDiv.style.left = `${basePosition[1] - i * positionOffset}%`;
        if (i === cardAmount - 1)
          await addTooltip(outerDiv, newDiv, "Deck", `${data.gameState[player].deckSize} cards remaining`);
      }
    }
  };

  const loadLightHouses = async () => {
    for (let player of ["you", "opponent"]) {
      const lighthouseContainer = document.querySelector(`#${player}-container .lighthouse-container`);
      const lighthouseAmount = data.gameState[player].lighthouses.amount;
      lighthouseContainer.querySelector("h1").textContent = lighthouseAmount;
    }
  };

  const loadFields = async () => {
    for (let player of ["you", "opponent"]) {
      for (let line in data.gameState[player].field) {
        // delete existing divs
        const lineContainer = document.querySelector(`#${player}-container .${line}-container`);
        const existingDivs = lineContainer.querySelectorAll(".unit-card-horizontal-component");
        existingDivs.forEach((div) => div.remove());
        // we reverse the order of the cards in the line beacuse we're going to prepend them to the container,
        // this is because we need to keep the position drop zones at the end of the line
        const lineCards = [...data.gameState[player].field[line]].reverse();
        for (let card of lineCards) {
          // create div
          const newDiv = document.createElement("div");
          newDiv.classList.add("unit-card-horizontal-component");
          // add div to the beggining of the line container
          lineContainer.prepend(newDiv);
          // load card component
          await loadComponent(newDiv, "unit-card-horizontal", {
            id: card.id,
            traitCodes: card.traitCodes,
            placedPositionCode: card.placedPositionCode,
            currentHp: null,
            isSmall: true,
            cardData: data.cards[card.id],
            traitData: data.traits,
            affiliationData: data.affiliations,
            positionData: data.positions,
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
      for (let i = 0; i < data.gameState[player].hand.length; i++) {
        let card = data.gameState[player].hand[i];
        // create div
        const newDiv = document.createElement("div");
        newDiv.classList.add("unit-card-vertical-component");
        if (card.cardId === undefined) newDiv.classList.add("no-focus");
        handContainer.appendChild(newDiv);
        // load card component
        await loadComponent(newDiv, "unit-card-vertical", {
          cardId: card.cardId,
          traitCodes: card.traitCodes,
          placedPositionCode: null,
          currentHp: null,
          isSmall: true,
          cardData: data.cards[card.cardId],
          traitData: data.traits,
          affiliationData: data.affiliations,
          positionData: data.positions,
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
          const positionCodes = data.cards[card.cardId].positionCodes;
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
      const shinsu = data.gameState[player].shinsu;
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
      passButtonFrame.querySelector("h2").textContent = data.gameState[player].passButton.text;
      // turn
      if (data.gameState[player].username === data.gameState.currentTurn)
        passButtonFrame.classList.add("current-turn");
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

  // debugging
  // addBorderToDivs();
  // data.gameState = getRandomGameData(data);
  // console.log(data.gameState);

  // socket
  const socket = io("/game", {
    query: {
      roomCode: window.location.pathname.split("/").pop(),
    },
  });
  socket.on("game-init", async (initialState) => {
    // console.log("initialState: ", initialState);
    data.gameState = initialState;
    await load(data);
  });
  socket.on("game-update", async (newState) => {
    data.gameState = newState;
    // console.log(data.gameState.you.field);
    await load(data);
  });
  socket.on("game-error", async (errorMessage) => {
    console.error("errorMessage: ", errorMessage);
    alert(`Error: ${errorMessage}`);
  });

  await prepareBoard(data, socket);

  // for (let player of ["you", "opponent"]) {
  //   console.log(data.gameState[player].field);
  // }
});
