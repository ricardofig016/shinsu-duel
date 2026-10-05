import * as IdFactory from "../../../game/IdFactory.js";
import { buildStateView } from "../../../game/net/protocol.js";
import ZoneService from "../../../game/services/ZoneService.js";
import { setupGameWithHands } from "../../../game/tests/utils.js";
import SeededRng from "../../../game/utils/SeededRng.js";
import DrunkPlaystyle from "../../playstyles/DrunkPlaystyle.js";
import { moveKey, projectTurnOptions } from "../../turnOptions.js";

/**
 * Drunk is selection only: the pool comes from `server/bots/turnOptions.js`,
 * so what this suite pins is the pool's shape as the projection composes it,
 * the uniform reach over every move in it, pass as the last resort, and the
 * `excluded` drain the controller's retry feeds it.
 *
 * The scenarios run against real seat views built from the fixture catalog, so
 * the pool the playstyle samples is the pool the engine accepts.
 */

const SEAT = "Alice";
const PASS = { type: "pass-turn-action", data: {} };

/** Deploy a named hand card as the seat, leaving the turn with the seat. */
function deployByName(game, name, positionCode) {
  game.currentTurn = SEAT;
  const handId = game.playerStates[SEAT].hand.findIndex((card) => card.name === name);
  if (handId < 0) throw new Error(`"${name}" is not in ${SEAT}'s hand`);
  game.processAction({
    type: "deploy-unit-action",
    data: { source: "player", username: SEAT, handId, placedPositionCode: positionCode },
  });
  game.currentTurn = SEAT;
}

/** A game whose seat holds `hand`, has `deploy` on the field, and `shinsu` to spend. */
function seatFor({ hand = [], deploy = [], shinsu = 15, extraDraw = 0 } = {}) {
  const game = setupGameWithHands({ [SEAT]: hand });
  game.round = 15;
  game.currentTurn = SEAT;
  game.playerStates[SEAT].shinsu = { normalSpent: 0, normalAvailable: 15, recharged: 0 };

  const requested = new Set(hand);
  game.playerStates[SEAT].hand = game.playerStates[SEAT].hand.filter((card) => requested.has(card.name));

  for (let drawn = 0; drawn < extraDraw; drawn++) ZoneService.draw(game.playerStates[SEAT], 1, game);
  for (const [name, positionCode] of deploy) deployByName(game, name, positionCode);

  game.currentTurn = SEAT;
  game.playerStates[SEAT].shinsu = { normalSpent: 0, normalAvailable: shinsu, recharged: 0 };
  return game;
}

/** The seat's own view of a scenario, with the ids its projection names. */
function viewFor(build) {
  IdFactory.resetAll();
  return buildStateView({ game: build(), revision: 1, username: SEAT });
}

const ofType = (moves, type) => moves.filter((move) => move.type === type);

/**
 * A seat holding a multi-ability, multi-position unit on the field and a
 * skill, an equipment, a landmark, a shinheuh, and a standard unit in hand:
 * every action type the engine's registry admits for it appears in the pool.
 */
const fullSeat = () =>
  seatFor({
    hand: [
      "Test Multi Position",
      "Test Damage Skill",
      "Test Armor",
      "Test Landmark Unit",
      "Test Shinheuh",
      "Test Fisherman Unit",
    ],
    deploy: [["Test Multi Position", "fisherman"]],
    extraDraw: 2,
    shinsu: 15,
  });

const decision = (overrides = {}) => ({
  decisionId: "d1",
  type: "target_selection",
  candidates: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }, { id: "d", name: "D" }],
  minChoices: 1,
  maxChoices: 1,
  lockedIds: [],
  ...overrides,
});

/**
 * Every distinct move a playstyle returns over `seeds` seeded picks. The two
 * selection entry points order their arguments differently: `decideTurn(view,
 * rng, excluded)` and `resolveRetry(view, excluded, rng)`.
 */
function reach(playstyle, view, { seeds = 400, method = "decideTurn", excluded = new Set() } = {}) {
  const seen = new Map();
  for (let seed = 0; seed < seeds; seed++) {
    const rng = new SeededRng(seed);
    const move = method === "decideTurn" ? playstyle.decideTurn(view, rng, excluded) : playstyle.resolveRetry(view, excluded, rng);
    seen.set(moveKey(move), move);
  }
  return seen;
}

describe("DrunkPlaystyle", () => {
  const playstyle = new DrunkPlaystyle();

  test("the seat's pool holds every action type the engine admits, standard and non-standard", () => {
    const view = viewFor(fullSeat);
    const moves = projectTurnOptions(view);

    expect(ofType(moves, "generate-fire-charge-action")).toHaveLength(0);
    expect(ofType(moves, "use-ability-action").length).toBeGreaterThanOrEqual(2);
    expect(ofType(moves, "play-skill-action")).toHaveLength(1);
    expect(ofType(moves, "equip-equipment-action")).toHaveLength(1);
    expect(ofType(moves, "switch-position-action")).toHaveLength(1);

    const codes = ofType(moves, "deploy-unit-action").map((move) => move.data.placedPositionCode).sort();
    // A standard card's printed position, a landmark's kind slot, and a
    // shinheuh's kind slot.
    expect(codes).toContain("fisherman");
    expect(codes).toContain("landmark");
    expect(codes).toContain("shinheuh");
  });

  test("over many seeds it reaches every move in the pool except the pass it holds back", () => {
    const view = viewFor(fullSeat);
    const pool = projectTurnOptions(view);
    const playable = pool.filter((move) => move.type !== "pass-turn-action");
    const reached = reach(playstyle, view);

    for (const move of playable) {
      expect(reached.has(moveKey(move))).toBe(true);
    }
    expect(reached.size).toBe(playable.length);
    expect(reached.has(moveKey(PASS))).toBe(false);
  });

  test("never passes while any other move is in the pool", () => {
    const view = viewFor(fullSeat);
    const pool = projectTurnOptions(view);
    expect(pool.length).toBeGreaterThan(1);

    for (let seed = 0; seed < 300; seed++) {
      expect(playstyle.decideTurn(view, new SeededRng(seed))).not.toEqual(PASS);
    }
  });

  test("is uniform over the pool rather than over its categories", () => {
    const view = viewFor(fullSeat);
    const playable = projectTurnOptions(view).filter((move) => move.type !== "pass-turn-action");
    const seeds = 4000;
    const counts = new Map();
    for (let seed = 0; seed < seeds; seed++) {
      const key = moveKey(playstyle.decideTurn(view, new SeededRng(seed)));
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    // A uniform pick over N moves lands inside a generous band of seeds/N for
    // every move; a category-weighted pick would push a move far outside it.
    const expected = seeds / playable.length;
    for (const move of playable) {
      expect(counts.get(moveKey(move))).toBeGreaterThan(expected * 0.6);
      expect(counts.get(moveKey(move))).toBeLessThan(expected * 1.4);
    }
    expect(counts.get(moveKey(PASS))).toBeUndefined();
    expect([...counts.values()].reduce((total, count) => total + count, 0)).toBe(seeds);
  });

  test("is deterministic for a fixed seed and view", () => {
    const view = viewFor(fullSeat);
    for (let seed = 0; seed < 20; seed++) {
      expect(playstyle.decideTurn(view, new SeededRng(seed))).toEqual(playstyle.decideTurn(view, new SeededRng(seed)));
    }
  });

  test("passes when the pool holds nothing else", () => {
    const view = viewFor(() => seatFor({ hand: ["Test Expensive Skill"], shinsu: 1 }));
    const pool = projectTurnOptions(view);
    expect(pool).toEqual([PASS]);

    for (let seed = 0; seed < 20; seed++) {
      expect(playstyle.decideTurn(view, new SeededRng(seed))).toEqual(PASS);
    }
  });

  test("passes on a missing or malformed view instead of crashing", () => {
    for (const brokenView of [null, undefined, {}, { you: null }]) {
      for (let seed = 0; seed < 5; seed++) {
        expect(playstyle.decideTurn(brokenView, new SeededRng(seed))).toEqual(PASS);
        expect(playstyle.resolveRetry(brokenView, new Set(), new SeededRng(seed))).toEqual(PASS);
      }
    }
  });

  describe("the excluded drain the controller's retry drives", () => {
    test("never returns a move it was told to exclude", () => {
      const view = viewFor(fullSeat);
      const pool = projectTurnOptions(view);
      const [dropped] = pool.filter((move) => move.type !== "pass-turn-action");
      const excluded = new Set([moveKey(dropped)]);

      for (let seed = 0; seed < 200; seed++) {
        const move = playstyle.decideTurn(view, new SeededRng(seed), excluded);
        expect(moveKey(move)).not.toBe(moveKey(dropped));
      }
    });

    test("drains to pass once every other move is excluded", () => {
      const view = viewFor(fullSeat);
      const pool = projectTurnOptions(view);
      const excluded = new Set(pool.filter((move) => move.type !== "pass-turn-action").map(moveKey));

      expect(playstyle.decideTurn(view, new SeededRng(1), excluded)).toEqual(PASS);
      expect(playstyle.resolveRetry(view, excluded, new SeededRng(2))).toEqual(PASS);
    });

    test("resolveRetry samples the same pool as decideTurn", () => {
      const view = viewFor(fullSeat);
      const playable = projectTurnOptions(view).filter((move) => move.type !== "pass-turn-action");
      const reached = reach(playstyle, view, { method: "resolveRetry" });

      for (const move of playable) expect(reached.has(moveKey(move))).toBe(true);
      expect(reached.size).toBe(playable.length);
    });

    test("accepts a missing exclusion set", () => {
      const view = viewFor(fullSeat);
      expect(playstyle.decideTurn(view, new SeededRng(4))).toEqual(playstyle.decideTurn(view, new SeededRng(4), new Set()));
      expect(playstyle.resolveRetry(view, undefined, new SeededRng(4))).toEqual(playstyle.decideTurn(view, new SeededRng(4)));
    });
  });

  describe("resolveDecision", () => {
    test("is deterministic for a fixed seed", () => {
      const d = decision({ minChoices: 2, maxChoices: 3 });
      expect(playstyle.resolveDecision(d, new SeededRng(3))).toEqual(playstyle.resolveDecision(d, new SeededRng(3)));
    });

    test("stays within the valid range and the free candidates", () => {
      const d = decision({ minChoices: 1, maxChoices: 3, lockedIds: ["a"] });
      const free = ["b", "c", "d"];
      for (let seed = 0; seed < 40; seed++) {
        const { choices } = playstyle.resolveDecision(d, new SeededRng(seed));
        expect(choices.length).toBeGreaterThanOrEqual(1);
        expect(choices.length).toBeLessThanOrEqual(3);
        for (const choice of choices) expect(free).toContain(choice);
        expect(new Set(choices).size).toBe(choices.length);
      }
    });

    test("picks exactly minChoices when the range is fixed", () => {
      const d = decision({ minChoices: 2, maxChoices: 2 });
      for (let seed = 0; seed < 10; seed++) {
        expect(playstyle.resolveDecision(d, new SeededRng(seed)).choices).toHaveLength(2);
      }
    });

    test("caps the count at the pool size instead of submitting an unresolvable decision", () => {
      const d = decision({ minChoices: 2, maxChoices: 2, candidates: [{ id: "only" }] });
      expect(playstyle.resolveDecision(d, new SeededRng(1))).toEqual({ decisionId: "d1", choices: ["only"] });
    });
  });
});
