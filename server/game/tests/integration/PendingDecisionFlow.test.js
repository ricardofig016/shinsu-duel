import GameState from "../../GameState.js";
import SeededRng from "../../utils/SeededRng.js";
import { createLegalDeck, getCardIdByName } from "../utils.js";
import Card from "../../Card.js";
import { resolveEffect } from "../../EffectResolver.js";

const players = ["Alice", "Bob"];

function createGame() {
  return new GameState("TEST", players, {
    Alice: createLegalDeck(),
    Bob: createLegalDeck(),
  }, null, { rng: new SeededRng(1) });
}

function addUnit(game, owner, name, position = "fisherman") {
  const cardId = getCardIdByName(name);
  const card = new Card(cardId, game.constructor.cards[cardId], owner, game.eventBus);
  const unit = {
    id: `Unit#${owner}#${name}#${Math.random()}`,
    owner,
    card,
    currentHp: card.maxHp,
    placedPositionCode: position,
    equipment: null,
    isAlive() { return this.currentHp > 0; },
    toSanitizedObject() { return { id: this.id, currentHp: this.currentHp, owner: this.owner }; },
  };
  game.playerStates[owner].field.frontline.push(unit);
  return unit;
}

describe("pending decision continuations", () => {
  test("overflow deployment keeps the card and cost pending until a field unit is destroyed", () => {
    const game = createGame();
    game.round = 10;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 10, recharged: 0 };
    const unitId = getCardIdByName("Monkeyman");
    const pendingCard = new Card(unitId, game.constructor.cards[unitId], "Alice", game.eventBus);
    game.playerStates.Alice.hand = [pendingCard];

    for (let index = 0; index < 5; index++) addUnit(game, "Alice", "Rachel");

    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "scout" },
    });

    expect(game.pendingDecision?.type).toBe("line_overflow");
    expect(game.currentTurn).toBe("Alice");
    expect(game.playerStates.Alice.field.frontline).toHaveLength(5);
    expect(game.playerStates.Alice.hand).toEqual([pendingCard]);
    expect(game.getTotalShinsu("Alice")).toBe(10);

    const [chosen] = game.pendingDecision.candidates;
    game.resolveDecision({ decisionId: game.pendingDecision.decisionId, username: "Alice", choices: [chosen.id] });

    expect(game.playerStates.Alice.field.frontline).toHaveLength(5);
    expect(game.playerStates.Alice.field.frontline.some((unit) => unit.card.name === "Monkeyman")).toBe(true);
    expect(game.playerStates.Alice.hand).toHaveLength(0);
    expect(game.getTotalShinsu("Alice")).toBe(9);
    expect(game.currentTurn).toBe("Bob");
  });

  test("choosing the pending card for overflow pays for and discards it without exceeding capacity", () => {
    const game = createGame();
    game.round = 10;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 10, recharged: 0 };
    const unitId = getCardIdByName("Monkeyman");
    const pendingCard = new Card(unitId, game.constructor.cards[unitId], "Alice", game.eventBus);
    game.playerStates.Alice.hand = [pendingCard];

    for (let index = 0; index < 5; index++) addUnit(game, "Alice", "Rachel");

    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "scout" },
    });

    const pendingCandidate = game.pendingDecision.candidates.find((candidate) => candidate.name === "Monkeyman");
    game.resolveDecision({
      decisionId: game.pendingDecision.decisionId,
      username: "Alice",
      choices: [pendingCandidate.id],
    });

    expect(game.playerStates.Alice.field.frontline).toHaveLength(5);
    expect(game.playerStates.Alice.field.frontline.some((unit) => unit.card.name === "Monkeyman")).toBe(false);
    expect(game.playerStates.Alice.hand).toHaveLength(0);
    expect(game.playerStates.Alice.discard).toContain(pendingCard);
    expect(game.getTotalShinsu("Alice")).toBe(9);
    expect(game.currentTurn).toBe("Bob");
  });

  test("a target choice resolves before the next effect in its sequence", () => {
    const game = createGame();
    const firstTarget = addUnit(game, "Bob", "Rachel");
    const secondTarget = addUnit(game, "Bob", "Rachel");
    const context = { emitChild: (eventName, payload) => game.eventBus.emit(eventName, payload) };

    resolveEffect({ type: "deal_damage", amount: 1, target: "enemy", raw: "deal 1 to an enemy" }, context, game, {
      owner: "Alice",
      sourceOwner: "Alice",
    });
    let continuationRan = false;
    game.completeActionAfterDecision(() => {
      continuationRan = true;
    });

    expect(game.pendingDecision).not.toBeNull();
    expect(firstTarget.currentHp).toBe(firstTarget.card.maxHp);
    expect(secondTarget.currentHp).toBe(secondTarget.card.maxHp);
    expect(continuationRan).toBe(false);

    game.resolveDecision({
      decisionId: game.pendingDecision.decisionId,
      username: "Alice",
      choices: [firstTarget.id],
    });

    expect(firstTarget.currentHp).toBe(firstTarget.card.maxHp - 1);
    expect(secondTarget.currentHp).toBe(secondTarget.card.maxHp);
    expect(continuationRan).toBe(true);
  });
});
