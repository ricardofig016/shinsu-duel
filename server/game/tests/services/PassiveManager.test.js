import GameState from "../../GameState.js";
import SeededRng from "../../utils/SeededRng.js";
import Card from "../../Card.js";
import LifecycleEngine from "../../services/LifecycleEngine.js";
import EVT from "../../EventCatalog.js";
import { resolveEffect } from "../../EffectResolver.js";
import { createLegalDeck, getCardIdByName } from "../utils.js";

const players = ["Alice", "Bob"];

function createGame() {
  return new GameState("TEST", players, {
    Alice: createLegalDeck(),
    Bob: createLegalDeck(),
  }, null, { rng: new SeededRng(1) });
}

function putInHand(game, username, name) {
  const cardId = getCardIdByName(name);
  const card = new Card(cardId, game.constructor.cards[cardId], username, game.eventBus);
  game.playerStates[username].hand.push(card);
  return card;
}

describe("PassiveManager", () => {
  test("runs a structured round-end passive while its source unit remains deployed", () => {
    const game = createGame();
    game.round = 10;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 10, recharged: 0 };
    const karaka = putInHand(game, "Alice", "Karaka - Evolved");

    const handIndex = game.playerStates.Alice.hand.indexOf(karaka);
    const { unit } = LifecycleEngine.deployUnit(game, "Alice", handIndex, "wave-controller");
    const targetCardId = getCardIdByName("Yeon Yihwa");
    const targetCard = new Card(targetCardId, game.constructor.cards[targetCardId], "Bob", game.eventBus);
    const target = {
      id: "Unit#rooted-target",
      owner: "Bob",
      card: targetCard,
      currentHp: targetCard.maxHp,
      placedPositionCode: "fisherman",
      isAlive() { return this.currentHp > 0; },
    };
    game.playerStates.Bob.field.frontline.push(target);
    game.modifierStack.apply({
      sourceId: "System",
      sourceType: "system",
      targetId: target.id,
      type: "condition",
      key: "rooted",
      value: 1,
    });

    game.eventBus.emit(EVT.ROUND_END, { round: game.round });
    expect(target.currentHp).toBe(targetCard.maxHp - 3);

    LifecycleEngine.destroyUnit(game, unit);
    target.currentHp = targetCard.maxHp;
    game.eventBus.emit(EVT.ROUND_END, { round: game.round });
    expect(target.currentHp).toBe(targetCard.maxHp);
  });

  test("emits an observable event when an unsupported effect is skipped", () => {
    const game = createGame();
    const events = [];
    game.eventBus.on("effect:unsupported", (payload) => events.push(payload));

    const result = resolveEffect(
      { type: "custom", raw: "unimplemented card text", handler: null },
      { emitChild: (eventName, payload) => game.eventBus.emit(eventName, payload) },
      game,
      { owner: "Alice", sourceId: "System" }
    );

    expect(result).toEqual(expect.objectContaining({ reason: "unsupported_effect" }));
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: "unsupported_effect", sourceId: "System" }),
    ]));
  });
});
