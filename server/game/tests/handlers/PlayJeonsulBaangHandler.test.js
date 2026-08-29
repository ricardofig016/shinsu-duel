import { jest } from "@jest/globals";
import Card from "../../Card.js";
import PlayJeonsulBaangHandler from "../../handlers/PlayJeonsulBaangHandler.js";
import EVT from "../../EventCatalog.js";
import { createTestGame, getCardIdByName } from "../utils.js";

const BAANG_CONDITIONS = {
  "Test Lightning Baang": "burned",
  "Test Thunder Baang": "exhausted",
  "Test Static Baang": "weak",
};

/**
 * Build a board with the Conduit on Bob's backline at the requested HP and a
 * set of other friendly units for the Baangs to land on.
 */
function buildScene({ conduitHp = 8, allyNames = ["Test Scout"] } = {}) {
  const game = createTestGame();
  const conduitCardId = getCardIdByName("Conduit");
  const conduit = {
    id: "Unit#conduit",
    owner: "Bob",
    card: new Card(conduitCardId, game.cards[conduitCardId], "Bob", game.eventBus),
    currentHp: conduitHp,
    placedPositionCode: null,
    isAlive() { return this.currentHp > 0; },
  };
  game.playerStates.Bob.field.backline.push(conduit);

  const allies = allyNames.map((name, index) => {
    const cardId = getCardIdByName(name);
    const ally = {
      id: `Unit#ally-${index}`,
      owner: "Bob",
      card: new Card(cardId, game.cards[cardId], "Bob", game.eventBus),
      currentHp: game.cards[cardId].hp ?? 3,
      placedPositionCode: "fisherman",
      isAlive() { return this.currentHp > 0; },
    };
    game.playerStates.Bob.field.frontline.push(ally);
    return ally;
  });

  return { game, conduit, allies };
}

// Fire the passive the way PassiveManager does: the payload is the passive
// node merged with the trigger extra (sourceUnit = the Conduit), and every
// child event lands on the real bus in emission order.
function runBaangPassive(game, conduit) {
  const events = [];
  game.eventBus.on(EVT.SKILL_APPLIED, (p) => events.push({ kind: "skill", cardName: p.cardName, owner: p.owner, card: p.card }), { phase: "post" });
  game.eventBus.on(EVT.CONDITION_APPLIED, (p) => events.push({ kind: "condition", condition: p.condition, targetId: p.targetId }), { phase: "post" });

  const context = { emitChild: (eventName, payload) => game.eventBus.emit(eventName, payload) };
  const handler = new PlayJeonsulBaangHandler();
  const result = handler.execute(
    { sourceId: "Passive#conduit#3", sourceUnit: conduit },
    context,
    game
  );
  return { result, events };
}

describe("PlayJeonsulBaangHandler", () => {
  test("a Conduit at 4 current HP plays floor(4/2) = 2 Baangs", () => {
    const { game, conduit, allies } = buildScene({ conduitHp: 4 });
    const { result, events } = runBaangPassive(game, conduit);

    expect(result).toEqual({ played: 2, skipped: 0 });
    expect(events.filter((e) => e.kind === "skill")).toHaveLength(2);
    expect(events.filter((e) => e.kind === "condition")).toHaveLength(2);
    for (const condition of events.filter((e) => e.kind === "condition")) {
      expect(condition.targetId).toBe(allies[0].id);
    }
  });

  test("a Conduit at 2 current HP plays exactly one Baang", () => {
    const { game, conduit } = buildScene({ conduitHp: 2 });
    const { result, events } = runBaangPassive(game, conduit);

    expect(result).toEqual({ played: 1, skipped: 0 });
    expect(events.filter((e) => e.kind === "skill")).toHaveLength(1);
  });

  test("a Conduit at 1 current HP plays nothing (floor(1/2) = 0)", () => {
    const { game, conduit } = buildScene({ conduitHp: 1 });
    const { result, events } = runBaangPassive(game, conduit);

    expect(result).toEqual({ played: 0, skipped: 0 });
    expect(events).toHaveLength(0);
  });

  test("every Baang skips when no other friendly unit exists", () => {
    const { game, conduit } = buildScene({ conduitHp: 4, allyNames: [] });
    const { result, events } = runBaangPassive(game, conduit);

    expect(result).toEqual({ played: 0, skipped: 2 });
    expect(events).toHaveLength(0);
  });

  test("the Conduit is never selected as a Baang target", () => {
    const { game, conduit, allies } = buildScene({ conduitHp: 8 });
    const { events } = runBaangPassive(game, conduit);

    expect(events.filter((e) => e.kind === "skill").length).toBeGreaterThan(0);
    for (const condition of events.filter((e) => e.kind === "condition")) {
      expect(condition.targetId).toBe(allies[0].id);
      expect(condition.targetId).not.toBe(conduit.id);
    }
    for (const key of Object.values(BAANG_CONDITIONS)) {
      expect(game.modifierStack.has(conduit.id, "condition", key)).toBe(false);
    }
  });

  test("each played Baang announces SKILL_APPLIED before its condition lands, with the Conduit's owner and a transient Card", () => {
    const { game, conduit } = buildScene({ conduitHp: 6 });
    const { events } = runBaangPassive(game, conduit);

    expect(events).toHaveLength(6); // 3 plays × (skill + condition)
    for (let i = 0; i < events.length; i += 2) {
      const skill = events[i];
      const condition = events[i + 1];
      expect(skill.kind).toBe("skill");
      expect(condition.kind).toBe("condition");
      expect(skill.owner).toBe("Bob");
      expect(skill.card).toBeInstanceOf(Card);
      expect(skill.card.name).toBe(skill.cardName);
      // The applied condition is the announced Baang's signature condition.
      expect(condition.condition).toBe(BAANG_CONDITIONS[skill.cardName]);
    }
  });

  test("synthetic plays never record a player card play", () => {
    const { game, conduit } = buildScene({ conduitHp: 4 });
    const recordSpy = jest.spyOn(game, "recordCardPlayed");

    runBaangPassive(game, conduit);

    expect(recordSpy).not.toHaveBeenCalled();
    expect(game._cardsPlayedThisRound.get("Bob") ?? 0).toBe(0);
  });

  test("validate requires the Conduit unit", () => {
    const handler = new PlayJeonsulBaangHandler();
    expect(() => handler.validate({})).toThrow("sourceUnit");
    expect(() => handler.validate({ sourceUnit: { id: "Unit#conduit" } })).not.toThrow();
  });

  test("the Baang and ally sequence is reproducible under a fixed seed", () => {
    const run = () => {
      const { game, conduit } = buildScene({ conduitHp: 8 });
      const { result, events } = runBaangPassive(game, conduit);
      return {
        result,
        sequence: events.map((e) =>
          e.kind === "skill" ? { kind: "skill", cardName: e.cardName, owner: e.owner } : { kind: "condition", condition: e.condition, targetId: e.targetId }
        ),
      };
    };

    const first = run();
    const second = run();
    expect(second).toEqual(first);
    expect(first.result.played).toBe(4);
  });
});
