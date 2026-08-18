import { jest } from "@jest/globals";
import EventBus from "../../EventBus.js";
import GameClock from "../../GameClock.js";
import ModifierStack from "../../ModifierStack.js";
import DrawCardHandler from "../../handlers/DrawCardHandler.js";
import EVT from "../../EventCatalog.js";

describe("DrawCardHandler", () => {
  let clock, bus, stack, gameState, handler;

  beforeEach(() => {
    clock = new GameClock();
    bus = new EventBus(clock);
    stack = new ModifierStack(bus, clock);
    handler = new DrawCardHandler();
    gameState = {
      eventBus: bus,
      modifierStack: stack,
      playerStates: {
        Alice: {
          username: "Alice",
          deck: [
            { cardId: 1, name: "Card A" },
            { cardId: 2, name: "Card B" },
            { cardId: 3, name: "Card C" },
          ],
          hand: [],
        },
      },
    };
  });

  test("draws cards from deck to hand", () => {
    bus.on("Test", (p, ctx) => {
      handler.execute({ owner: "Alice", amount: 2 }, ctx, gameState);
    }, { phase: "execute" });

    bus.emit("Test");

    expect(gameState.playerStates.Alice.hand.length).toBe(2);
    expect(gameState.playerStates.Alice.deck.length).toBe(1);
  });

  test("emits card:drawn for each card", () => {
    const listener = jest.fn();
    bus.on(EVT.CARD_DRAWN, listener, { phase: "post" });

    bus.on("Test", (p, ctx) => {
      handler.execute({ owner: "Alice", amount: 2 }, ctx, gameState);
    }, { phase: "execute" });

    bus.emit("Test");

    expect(listener).toHaveBeenCalledTimes(2);
  });

  test("emits game:deck:empty when deck is exhausted", () => {
    gameState.playerStates.Alice.deck = [{ cardId: 99, name: "Last" }];

    const listener = jest.fn();
    bus.on(EVT.GAME_DECK_EMPTY, listener, { phase: "post" });

    bus.on("Test", (p, ctx) => {
      handler.execute({ owner: "Alice", amount: 3 }, ctx, gameState);
    }, { phase: "execute" });

    bus.emit("Test");

    // Drew 1 card, then deck empty
    expect(gameState.playerStates.Alice.hand.length).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].username).toBe("Alice");
  });

  test("drawing from already empty deck emits deck:empty immediately", () => {
    gameState.playerStates.Alice.deck = [];

    const listener = jest.fn();
    bus.on(EVT.GAME_DECK_EMPTY, listener, { phase: "post" });

    bus.on("Test", (p, ctx) => {
      handler.execute({ owner: "Alice", amount: 1 }, ctx, gameState);
    }, { phase: "execute" });

    bus.emit("Test");

    expect(gameState.playerStates.Alice.hand.length).toBe(0);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("filtered draw searches the deck and draws the pre-resolved target card", () => {
    gameState.playerStates.Alice.deck = [
      { id: "card#1", cardId: 1, name: "Card A" },
      { id: "card#2", cardId: 2, name: "Card B" },
    ];
    gameState.playerStates.Alice.hand = [];

    bus.on("Test", (p, ctx) => {
      handler.execute({ owner: "Alice", amount: 1, targetCardId: "card#2" }, ctx, gameState);
    }, { phase: "execute" });

    bus.emit("Test");

    expect(gameState.playerStates.Alice.hand.map((c) => c.name)).toEqual(["Card B"]);
    expect(gameState.playerStates.Alice.deck.map((c) => c.name)).toEqual(["Card A"]);
  });

  test("filtered draw throws when the target card is no longer in the deck", () => {
    gameState.playerStates.Alice.deck = [{ id: "card#1", cardId: 1, name: "Card A" }];
    gameState.playerStates.Alice.hand = [];

    expect(() =>
      handler.execute({ owner: "Alice", amount: 1, targetCardId: "card#missing" }, {}, gameState)
    ).toThrow(/no longer in the owner's deck/);
  });
});
