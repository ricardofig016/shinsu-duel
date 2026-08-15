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
    karaka.passiveAbilities = [{
      type: "deal_damage",
      amount: 3,
      target: "all_enemies",
      condition: "rooted",
      raw: "round end: deal 3 to all Rooted enemies",
      trigger: { type: "round_end" },
    }];

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

  test("emits an observable event when an unregistered effect type is skipped", () => {
    const game = createGame();
    const events = [];
    game.eventBus.on("effect:unsupported", (payload) => events.push(payload));

    const result = resolveEffect(
      { type: "slay", target: { side: "enemy" }, raw: "Slay an enemy" },
      { emitChild: (eventName, payload) => game.eventBus.emit(eventName, payload) },
      game,
      { owner: "Alice", sourceId: "System" }
    );

    expect(result).toEqual(expect.objectContaining({ reason: "unsupported_effect" }));
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: "unsupported_effect", sourceId: "System" }),
    ]));
  });

  test("resolves a registered noop effect without error", () => {
    const game = createGame();
    const result = resolveEffect(
      { type: "noop", raw: "test" },
      { emitChild: () => {} },
      game,
      { owner: "Alice" }
    );

    expect(result).toEqual({ resolved: true });
  });

  test("_parseTrigger maps structured round triggers and skips unknown ones", () => {
    const game = createGame();
    const manager = game._passiveManager;

    const roundStart = manager._parseTrigger({
      type: "deal_damage", amount: 1, target: { side: "enemy" }, trigger: { type: "round_start" },
    });
    expect(roundStart.eventName).toBe(EVT.ROUND_START);
    expect(roundStart.effect.trigger).toEqual({ type: "round_start" });

    const roundEnd = manager._parseTrigger({
      type: "heal", amount: 1, target: { side: "self" }, trigger: { type: "round_end" },
    });
    expect(roundEnd.eventName).toBe(EVT.ROUND_END);

    expect(manager._parseTrigger({
      type: "modify_stat", stat: "damage", amount: 1, target: { side: "self" },
    })).toBeNull();
    expect(manager._parseTrigger({
      type: "deal_damage", amount: 1, trigger: { type: "attack" },
    })).toBeNull();
    expect(manager._parseTrigger({ type: "deal_damage", amount: 1 })).toBeNull();
  });
});
