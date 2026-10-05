import * as IdFactory from "../../game/IdFactory.js";
import GiveConditionHandler from "../../game/handlers/GiveConditionHandler.js";
import { buildStateView } from "../../game/net/protocol.js";
import CombatSlotService from "../../game/services/CombatSlotService.js";
import ZoneService from "../../game/services/ZoneService.js";
import { setupGameWithHands } from "../../game/tests/utils.js";
import { moveKey, projectTurnOptions } from "../turnOptions.js";

/**
 * The projection's contract with the engine.
 *
 * Each scenario builds a real game through the fixture catalog, reads the
 * seat's own `buildStateView`, projects the pool, and feeds every projected
 * move back to `processAction` with the seat stamped. A projection that drifts
 * from a validator fails here — naming the refused move and the engine's own
 * message — rather than at a bot's turn.
 *
 * Every move is fed to a fresh game in the identical state, because one move
 * changes the state the next would be validated against (a slot spent, a turn
 * ended). `IdFactory.resetAll()` before every build is what makes "identical"
 * true: instance ids are module-global counters, so a rebuild would otherwise
 * mint different unit ids and no `unitId`-bearing move could be replayed.
 */

const SEAT = "Alice";
const OPPONENT = "Bob";

/** Deploy a named hand card for `seat`, leaving the turn with the seat. */
function deployByName(game, name, positionCode, seat = SEAT) {
  game.currentTurn = seat;
  const handId = game.playerStates[seat].hand.findIndex((card) => card.name === name);
  if (handId < 0) throw new Error(`"${name}" is not in ${seat}'s hand`);
  game.processAction({
    type: "deploy-unit-action",
    data: { source: "player", username: seat, handId, placedPositionCode: positionCode },
  });
  game.currentTurn = seat;
}

/** Run one action as the seat; the engine's error, or null when accepted. */
function runMove(game, move, seat = SEAT) {
  try {
    game.processAction({ type: move.type, data: { ...move.data, source: "player", username: seat } });
    return null;
  } catch (error) {
    return error;
  }
}

/**
 * A game whose seat holds `hand`, has `deploy` on the field, `shinsu` to
 * spend, and the turn. The dealt hand is narrowed to the requested names — the
 * opening deal fills the rest of the hand from the generic filler pool — so a
 * scenario's pool is the scenario's own cards. `emptyHand` clears the hand
 * afterwards; `extraDraw` pulls a further card off the deck, which is how a
 * scenario asks for more cards than the five-card opening deal. `opponentHand`
 * and `opponentDeploy` do the same for the other seat, which is how a scenario
 * asks for a board the seat does not own.
 */
function seatFor({
  hand = [],
  deploy = [],
  shinsu = 10,
  extraDraw = 0,
  emptyHand = false,
  opponentHand = [],
  opponentDeploy = [],
} = {}) {
  const game = setupGameWithHands({ [SEAT]: hand, [OPPONENT]: opponentHand });
  game.round = 15;
  game.currentTurn = SEAT;
  game.playerStates[SEAT].shinsu = { normalSpent: 0, normalAvailable: 15, recharged: 0 };

  const requested = new Set(hand);
  game.playerStates[SEAT].hand = game.playerStates[SEAT].hand.filter((card) => requested.has(card.name));

  const requestedByOpponent = new Set(opponentHand);
  game.playerStates[OPPONENT].hand = game.playerStates[OPPONENT].hand.filter((card) =>
    requestedByOpponent.has(card.name)
  );

  for (let drawn = 0; drawn < extraDraw; drawn++) ZoneService.draw(game.playerStates[SEAT], 1, game);
  // The other seat deploys at a round the seat itself is not playing, so it
  // needs its own shinsu the way `deployUnit` grants a deploying seat one.
  game.playerStates[OPPONENT].shinsu = { normalSpent: 0, normalAvailable: 15, recharged: 0 };
  for (const [name, positionCode] of deploy) deployByName(game, name, positionCode);
  for (const [name, positionCode] of opponentDeploy) deployByName(game, name, positionCode, OPPONENT);

  if (emptyHand) game.playerStates[SEAT].hand = [];
  game.currentTurn = SEAT;
  game.playerStates[SEAT].shinsu = { normalSpent: 0, normalAvailable: shinsu, recharged: 0 };
  return game;
}

/**
 * Project the seat's own view and feed every projected move to the engine,
 * one fresh game per move.
 *
 * @returns {{ view: object, moves: object[], replays: Map<string, object>, refusals: Array }}
 *   `replays` holds the game each move was fed to, keyed by `moveKey`.
 */
function projectAndFeed(build, { seat = SEAT } = {}) {
  IdFactory.resetAll();
  const probe = build();
  const view = buildStateView({ game: probe, revision: 1, username: seat });
  const moves = projectTurnOptions(view);

  const replays = new Map();
  const refusals = [];
  for (const move of moves) {
    IdFactory.resetAll();
    const game = build();
    const error = runMove(game, move, seat);
    replays.set(moveKey(move), game);
    if (error) refusals.push({ move, error });
  }

  return { view, moves, replays, refusals };
}

/** The same, asserting the engine accepted every projected move. */
function expectAllAccepted(build, options) {
  const result = projectAndFeed(build, options);
  if (result.refusals.length > 0) {
    const [first] = result.refusals;
    const extra = result.refusals.length > 1 ? ` (and ${result.refusals.length - 1} more refused)` : "";
    throw new Error(`Projected ${moveKey(first.move)} was refused by the engine: ${first.error.message}${extra}`);
  }
  return result;
}

const ofType = (moves, type) => moves.filter((move) => move.type === type);

/** Every field unit of the seat, keyed by instance id, as the view shows it. */
function unitNamesById(view) {
  const units = [...(view.you.field?.frontline ?? []), ...(view.you.field?.backline ?? [])];
  return new Map(units.map((unit) => [unit.id, unit.card?.name]));
}

/**
 * Apply a condition to a unit through the engine's own condition path — the
 * same one a `give_condition` effect and a landmark's global grant use — so a
 * scenario conditions a unit exactly as the board would. The condition view the
 * projection reads (`{ key, magnitude }`) is what `applyCondition` produces.
 */
function applyCondition(game, unit, condition, amount) {
  GiveConditionHandler.applyCondition(
    { sourceId: unit.id, condition, targetId: unit.id, amount },
    game
  );
}

/** The seat's hand index of a card, as the projection's `handId` payload names it. */
function handCardId(view, cardName) {
  const handId = (view.you.hand ?? []).findIndex((card) => card?.name === cardName);
  if (handId < 0) throw new Error(`"${cardName}" is not in the seat's hand`);
  return handId;
}

/** The instance id of one of the seat's own field units, as the view shows it. */
function ownUnitId(view, unitName) {
  const unit = [...(view.you.field?.frontline ?? []), ...(view.you.field?.backline ?? [])].find(
    (entry) => entry.card?.name === unitName
  );
  if (!unit) throw new Error(`"${unitName}" is not on the seat's field`);
  return unit.id;
}

/** Whether the view's copy of a hand card carries a readable requirement check. */
function requirementChecksReadable(view, cardName) {
  const card = (view.you.hand ?? []).find((entry) => entry?.name === cardName);
  return (card?.requirements ?? []).some((entry) => typeof entry?.check?.type === "string");
}

describe("projectTurnOptions — contract with the engine's validators", () => {
  test("pass is offered first and accepted, and a seat with no legal move projects it alone", () => {
    const empty = () => seatFor({ emptyHand: true, shinsu: 0 });
    const { view, moves } = expectAllAccepted(empty);

    expect(moves).toHaveLength(1);
    expect(moves[0]).toEqual({ type: "pass-turn-action", data: {} });
    expect(view.you.passButton.isEnabled).toBe(true);
  });

  test("a spend_shinsu ability is offered and accepted with the shinsu to pay it", () => {
    const build = () => seatFor({ hand: ["Test Stone Doll"], deploy: [["Test Stone Doll", "fisherman"]], shinsu: 5 });
    const { view, moves } = expectAllAccepted(build);

    const abilities = ofType(moves, "use-ability-action");
    expect(abilities).toHaveLength(1);
    expect(abilities[0].data.abilityCode).toBe("0");
    expect(abilities[0].data.unitId).toBe(view.you.field.frontline[0].id);
  });

  test("a spend_shinsu ability is left out when its cost is not affordable", () => {
    const build = () => seatFor({ hand: ["Test Stone Doll"], deploy: [["Test Stone Doll", "fisherman"]], shinsu: 0 });
    const { moves } = expectAllAccepted(build);

    expect(ofType(moves, "use-ability-action")).toHaveLength(0);
  });

  test("an ability's printed position gates it against the unit's placed position", () => {
    const atScout = () => seatFor({ hand: ["Test Scout"], deploy: [["Test Scout", "scout"]], shinsu: 5 });
    const scoutRun = expectAllAccepted(atScout);
    expect(ofType(scoutRun.moves, "use-ability-action").map((move) => move.data.abilityCode)).toEqual(["0"]);

    const atFisherman = () => seatFor({ hand: ["Test Scout"], deploy: [["Test Scout", "fisherman"]], shinsu: 5 });
    const fishermanRun = expectAllAccepted(atFisherman);
    expect(ofType(fishermanRun.moves, "use-ability-action").map((move) => move.data.abilityCode)).toEqual(["1"]);
  });

  test("a non-Free ability is left out once its position's combat slot is spent", () => {
    const build = () => {
      const game = seatFor({ hand: ["Test Multi Position"], deploy: [["Test Multi Position", "fisherman"]], shinsu: 5 });
      CombatSlotService.consume(game.playerStates[SEAT], "fisherman");
      return game;
    };

    IdFactory.resetAll();
    const probe = build();
    const view = buildStateView({ game: probe, revision: 1, username: SEAT });
    expect(view.you.combatSlots.fisherman.available).toBe(false);
    expect(ofType(projectTurnOptions(view), "use-ability-action")).toHaveLength(0);
    expectAllAccepted(build);
  });

  test("a first: true Free grant carries the ability before the unit's first use and not after", () => {
    const beforeUse = () => {
      const game = seatFor({ hand: ["Test Free Keyword Unit"], deploy: [["Test Free Keyword Unit", "scout"]], shinsu: 5 });
      // The slot is spent so the Free keyword is the only thing keeping the
      // ability usable: the engine and the projection must agree on it.
      CombatSlotService.consume(game.playerStates[SEAT], "scout");
      return game;
    };

    const before = expectAllAccepted(beforeUse);
    expect(before.view.you.field.frontline[0].keywords).toContain("free");
    expect(ofType(before.moves, "use-ability-action")).toHaveLength(2);

    const afterUse = () => {
      const game = beforeUse();
      const unit = game.playerStates[SEAT].field.frontline[0];
      game.markAbilityUsed(unit.id);
      return game;
    };

    IdFactory.resetAll();
    const probe = afterUse();
    const afterView = buildStateView({ game: probe, revision: 1, username: SEAT });
    expect(afterView.you.field.frontline[0].keywords).not.toContain("free");
    expect(ofType(projectTurnOptions(afterView), "use-ability-action")).toHaveLength(0);
    expectAllAccepted(afterUse);
  });

  test("an ability granted by an equipment is offered and accepted", () => {
    const build = () => {
      const game = seatFor({
        hand: ["Test Grant Ability Equip", "Test Scout"],
        deploy: [["Test Scout", "scout"]],
        shinsu: 10,
      });
      const unitId = game.playerStates[SEAT].field.frontline[0].id;
      const handId = game.playerStates[SEAT].hand.findIndex((card) => card.name === "Test Grant Ability Equip");
      game.currentTurn = SEAT;
      game.processAction({
        type: "equip-equipment-action",
        data: { source: "player", username: SEAT, handId, targetUnitId: unitId },
      });
      game.currentTurn = SEAT;
      game.playerStates[SEAT].shinsu = { normalSpent: 0, normalAvailable: 10, recharged: 0 };
      return game;
    };

    const { view, moves } = expectAllAccepted(build);
    const granted = view.you.field.frontline[0].grantedAbilities;
    expect(granted).toHaveLength(1);

    const abilityCodes = ofType(moves, "use-ability-action").map((move) => move.data.abilityCode);
    expect(abilityCodes).toContain(granted[0].abilityCode);
  });

  test("a Shinheuh's non-Free ability needs the Shinheuh slot", () => {
    const withoutSlot = () => seatFor({ hand: ["Test Shinheuh"], deploy: [["Test Shinheuh", "frontline"]], shinsu: 5 });
    const without = expectAllAccepted(withoutSlot);
    expect(without.view.you.shinheuhSlot.available).toBe(false);
    expect(ofType(without.moves, "use-ability-action")).toHaveLength(0);

    const withSlot = () => {
      const game = withoutSlot();
      game.playerStates[SEAT].shinheuhSlot = { available: true, used: false };
      return game;
    };
    const withGranted = expectAllAccepted(withSlot);
    expect(ofType(withGranted.moves, "use-ability-action")).toHaveLength(1);
  });

  test("an affordable skill is offered and an unaffordable one is not", () => {
    const build = () => seatFor({ hand: ["Test Damage Skill", "Test Expensive Skill"], shinsu: 2 });
    const { view, moves } = expectAllAccepted(build);

    const played = ofType(moves, "play-skill-action").map((move) => view.you.hand[move.data.handId].name);
    expect(played).toEqual(["Test Damage Skill"]);
  });

  test("an equipment's deployed_as requirement is read from the view", () => {
    const build = () =>
      seatFor({
        hand: ["Test Armor", "Test Fisherman Unit", "Test Scout"],
        deploy: [
          ["Test Fisherman Unit", "fisherman"],
          ["Test Scout", "scout"],
        ],
        shinsu: 10,
      });

    IdFactory.resetAll();
    const probe = build();
    const view = buildStateView({ game: probe, revision: 1, username: SEAT });

    // The projection attempts a requirement entry it cannot read; a card view
    // that ships the readable `check` is what lets it filter instead, so the
    // strict reading below is asserted only once the check is there.
    expect(requirementChecksReadable(view, "Test Armor")).toBe(true);

    const names = unitNamesById(view);
    const targets = ofType(projectTurnOptions(view), "equip-equipment-action").map((move) =>
      names.get(move.data.targetUnitId)
    );
    expect(targets).toEqual(["Test Fisherman Unit"]);

    const { refusals } = projectAndFeed(build);
    expect(refusals).toHaveLength(0);
  });

  test("a skill's target_side requirement is read from the board", () => {
    const withAlly = () =>
      seatFor({ hand: ["Test Poison Skill", "Test Fisherman Unit"], deploy: [["Test Fisherman Unit", "fisherman"]], shinsu: 5 });
    const allyRun = expectAllAccepted(withAlly);
    expect(ofType(allyRun.moves, "play-skill-action")).toHaveLength(1);

    const withoutAlly = () => seatFor({ hand: ["Test Poison Skill"], shinsu: 5 });
    const bareRun = expectAllAccepted(withoutAlly);
    expect(ofType(bareRun.moves, "play-skill-action")).toHaveLength(0);
  });

  test("an equipment's bearer_has requirement is read from the target unit", () => {
    const build = () =>
      seatFor({
        hand: ["Test Modify Ability Equip", "Test Multi Position", "Test Scout"],
        deploy: [
          ["Test Multi Position", "fisherman"],
          ["Test Scout", "scout"],
        ],
        shinsu: 10,
      });

    const { view, moves } = expectAllAccepted(build);
    const names = unitNamesById(view);
    const targets = ofType(moves, "equip-equipment-action").map((move) => names.get(move.data.targetUnitId));
    expect(targets).toEqual(["Test Multi Position"]);
  });

  test("a landmark deploys through its kind's placement slot", () => {
    const build = () => seatFor({ hand: ["Test Landmark Unit"], shinsu: 5 });
    const { moves } = expectAllAccepted(build);

    const deploys = ofType(moves, "deploy-unit-action");
    expect(deploys).toHaveLength(1);
    expect(deploys[0].data.placedPositionCode).toBe("landmark");
  });

  test("a shinheuh deploys through its kind's placement slot", () => {
    const build = () => seatFor({ hand: ["Test Shinheuh"], shinsu: 5 });
    const { moves } = expectAllAccepted(build);

    const deploys = ofType(moves, "deploy-unit-action");
    expect(deploys).toHaveLength(1);
    expect(deploys[0].data.placedPositionCode).toBe("shinheuh");
  });

  test("a standard unit deploys to each position it prints", () => {
    const build = () => seatFor({ hand: ["Test Multi Position"], shinsu: 5 });
    const { moves } = expectAllAccepted(build);

    const codes = ofType(moves, "deploy-unit-action").map((move) => move.data.placedPositionCode).sort();
    expect(codes).toEqual(["fisherman", "spear-bearer"]);
  });

  test("a position switch is offered for every other printed position", () => {
    const build = () => seatFor({ hand: ["Test Multi Position"], deploy: [["Test Multi Position", "fisherman"]], shinsu: 5 });
    const { view, moves } = expectAllAccepted(build);

    const switches = ofType(moves, "switch-position-action");
    expect(switches).toHaveLength(1);
    expect(switches[0].data).toEqual({ unitId: view.you.field.frontline[0].id, positionCode: "spear-bearer" });
  });

  test("a switch is projected while its departure slot is available and dropped once it is spent", () => {
    const atFisherman = () =>
      seatFor({ hand: ["Test Multi Position"], deploy: [["Test Multi Position", "fisherman"]], shinsu: 5 });

    // A spent destination is irrelevant (RULES.md §Combat Slots 6): the move
    // stays in the pool and the engine accepts it.
    const spentDestination = () => {
      const game = atFisherman();
      CombatSlotService.consume(game.playerStates[SEAT], "spear-bearer");
      return game;
    };
    expect(ofType(expectAllAccepted(spentDestination).moves, "switch-position-action")).toHaveLength(1);

    // A spent departure is not: the projection drops the move, and the engine
    // refuses the very move it dropped — which is what makes dropping it right.
    const spentDeparture = () => {
      const game = atFisherman();
      CombatSlotService.consume(game.playerStates[SEAT], "fisherman");
      return game;
    };

    IdFactory.resetAll();
    const probe = spentDeparture();
    const view = buildStateView({ game: probe, revision: 1, username: SEAT });
    expect(view.you.combatSlots.fisherman.available).toBe(false);
    const unitId = view.you.field.frontline[0].id;
    expect(ofType(projectTurnOptions(view), "switch-position-action")).toHaveLength(0);

    IdFactory.resetAll();
    const refusal = runMove(spentDeparture(), {
      type: "switch-position-action",
      data: { unitId, positionCode: "spear-bearer" },
    });
    expect(refusal?.message).toMatch(/combat slot/i);
  });

  test("a full line keeps the deploy in the pool and asks the engine's line_overflow decision", () => {
    const build = () =>
      seatFor({
        hand: [
          "Test Fisherman Unit",
          "Test Scout",
          "Test Filler Unit",
          "Test Stone Doll",
          "Test Free Keyword Unit",
          "Test Hwayeomsa",
        ],
        deploy: [
          ["Test Fisherman Unit", "fisherman"],
          ["Test Scout", "scout"],
          ["Test Filler Unit", "wave-controller"],
          ["Test Stone Doll", "fisherman"],
          ["Test Free Keyword Unit", "scout"],
        ],
        extraDraw: 1,
        shinsu: 15,
      });

    const { view, moves, replays } = expectAllAccepted(build);

    expect(view.you.field.frontline).toHaveLength(5);
    const overflow = ofType(moves, "deploy-unit-action").find(
      (move) => view.you.hand[move.data.handId]?.name === "Test Hwayeomsa"
    );
    expect(overflow).toBeDefined();

    const deferred = replays.get(moveKey(overflow));
    expect(deferred.pendingDecision?.type).toBe("line_overflow");
    expect(deferred.pendingDecision.owner).toBe(SEAT);
    expect(deferred.playerStates[SEAT].hand.some((card) => card.name === "Test Hwayeomsa")).toBe(true);
  });

  test("a fire charge is offered only with a Hwayeomsa on the field and a shinsu to spend", () => {
    const ready = () => seatFor({ hand: ["Test Hwayeomsa"], deploy: [["Test Hwayeomsa", "fisherman"]], shinsu: 5 });
    const readyRun = expectAllAccepted(ready);
    expect(ofType(readyRun.moves, "generate-fire-charge-action")).toHaveLength(1);

    const noHwayeomsa = () => seatFor({ emptyHand: true, shinsu: 5 });
    const noneRun = expectAllAccepted(noHwayeomsa);
    expect(ofType(noneRun.moves, "generate-fire-charge-action")).toHaveLength(0);

    const noShinsu = () => seatFor({ hand: ["Test Hwayeomsa"], deploy: [["Test Hwayeomsa", "fisherman"]], shinsu: 0 });
    const poorRun = expectAllAccepted(noShinsu);
    expect(ofType(poorRun.moves, "generate-fire-charge-action")).toHaveLength(0);
  });

  test("one seat holding a unit of each shape projects every action type the engine admits", () => {
    const build = () =>
      seatFor({
        hand: [
          "Test Hwayeomsa",
          "Test Multi Position",
          "Test Damage Skill",
          "Test Armor",
          "Test Landmark Unit",
          "Test Shinheuh",
          "Test Filler Unit",
        ],
        deploy: [
          ["Test Hwayeomsa", "fisherman"],
          ["Test Multi Position", "fisherman"],
        ],
        extraDraw: 2,
        shinsu: 15,
      });

    const { moves } = expectAllAccepted(build);
    const types = new Set(moves.map((move) => move.type));
    expect([...types].sort()).toEqual([
      "deploy-unit-action",
      "equip-equipment-action",
      "generate-fire-charge-action",
      "pass-turn-action",
      "play-skill-action",
      "switch-position-action",
      "use-ability-action",
    ]);
  });

  test("a seat whose turn is not open projects pass alone", () => {
    const build = () => {
      const game = seatFor({ hand: ["Test Multi Position", "Test Damage Skill"], shinsu: 5 });
      game.currentTurn = OPPONENT;
      return game;
    };

    IdFactory.resetAll();
    const view = buildStateView({ game: build(), revision: 1, username: SEAT });
    expect(view.you.passButton.isEnabled).toBe(false);
    expect(projectTurnOptions(view)).toEqual([{ type: "pass-turn-action", data: {} }]);
  });

  test("a malformed view projects pass rather than throwing", () => {
    for (const broken of [null, undefined, {}, { you: null }]) {
      expect(projectTurnOptions(broken)).toEqual([{ type: "pass-turn-action", data: {} }]);
    }
  });

  test("a condition is read through the condition view's key and magnitude", () => {
    // The projection reads a unit's conditions from the view's per-condition
    // `{ key, magnitude }` entries. This pins that shape: a projection that
    // starts looking for another field would stop excluding anything here.
    const build = () => {
      const game = seatFor({ hand: ["Test Copy Ability Unit"], deploy: [["Test Copy Ability Unit", "wave-controller"]], shinsu: 15 });
      applyCondition(game, game.playerStates[SEAT].field.frontline[0], "heavy", 2);
      return game;
    };

    IdFactory.resetAll();
    const view = buildStateView({ game: build(), revision: 1, username: SEAT });
    expect(view.you.field.frontline[0].conditions).toEqual([
      expect.objectContaining({ key: "heavy", magnitude: 2 }),
    ]);
  });

  test("a Stunned unit's abilities are left out while the same unit's are offered without the condition", () => {
    // `Test Copy Ability Unit` prints an untargeted ability and a
    // `spend_shinsu` ability, neither gated by position, so the only thing
    // that can remove them is the Stunned condition.
    const stunned = () => {
      const game = seatFor({ hand: ["Test Copy Ability Unit"], deploy: [["Test Copy Ability Unit", "wave-controller"]], shinsu: 15 });
      applyCondition(game, game.playerStates[SEAT].field.frontline[0], "stunned");
      return game;
    };

    const stunnedRun = expectAllAccepted(stunned);
    expect(stunnedRun.view.you.field.frontline[0].conditions).toEqual([
      expect.objectContaining({ key: "stunned" }),
    ]);
    expect(ofType(stunnedRun.moves, "use-ability-action")).toEqual([]);

    // The engine refuses the very moves the projection dropped, which is what
    // makes dropping them correct rather than merely observed: the unit is in
    // position with an unspent slot and enough shinsu, so only Stunned can.
    for (const abilityCode of ["0", "1"]) {
      IdFactory.resetAll();
      const refusal = runMove(stunned(), {
        type: "use-ability-action",
        data: { unitId: ownUnitId(stunnedRun.view, "Test Copy Ability Unit"), abilityCode },
      });
      expect(refusal?.message).toMatch(/stunned/i);
    }

    // The control: the identical unit without the condition keeps both.
    const untouched = () => seatFor({ hand: ["Test Copy Ability Unit"], deploy: [["Test Copy Ability Unit", "wave-controller"]], shinsu: 15 });
    const controlRun = expectAllAccepted(untouched);
    expect(ofType(controlRun.moves, "use-ability-action").map((move) => move.data.abilityCode)).toEqual(["0", "1"]);
  });

  test("Heavy raises an ability's effective cost by its magnitude", () => {
    // `Test Burn Passive Unit` prints `spend_shinsu 3`; the engine charges
    // `amount + Heavy`, so 4 shinsu buys it bare and 5 shinsu buys it at the
    // Heavy 2 boundary.
    const withShinsu = (shinsu, heavy = 0) => {
      const game = seatFor({ hand: ["Test Burn Passive Unit"], deploy: [["Test Burn Passive Unit", "wave-controller"]], shinsu });
      if (heavy > 0) applyCondition(game, game.playerStates[SEAT].field.frontline[0], "heavy", heavy);
      return game;
    };

    IdFactory.resetAll();
    const view = buildStateView({ game: withShinsu(4), revision: 1, username: SEAT });
    const unitId = ownUnitId(view, "Test Burn Passive Unit");
    const abilityMove = { type: "use-ability-action", data: { unitId, abilityCode: "0" } };

    // Affordable without the condition: offered, and the engine accepts it.
    const bare = expectAllAccepted(() => withShinsu(4));
    expect(ofType(bare.moves, "use-ability-action")).toEqual([abilityMove]);

    // The magnitude alone removes it: the same 4 shinsu no longer covers 3+2.
    const loaded = withShinsu(4, 2);
    expect(projectTurnOptions(buildStateView({ game: loaded, revision: 1, username: SEAT }))).not.toContainEqual(abilityMove);

    IdFactory.resetAll();
    const refusal = runMove(withShinsu(4, 2), abilityMove);
    expect(refusal?.message).toMatch(/not enough shinsu/i);

    // The boundary is where the magnitude still fits: 3 + 2 against 5 shinsu.
    const atBoundary = expectAllAccepted(() => withShinsu(5, 2));
    expect(ofType(atBoundary.moves, "use-ability-action")).toEqual([abilityMove]);
  });
});

describe("requirement checks pinned against deck-legal fixtures", () => {
  // `unit_on_board` and `has_ally` are the two requirement checks the engine
  // evaluates that no deck-legal fixture reached: `Test Unreachable Skill` is
  // the only `has_ally` carrier and `unreachable` bars it (and every generated
  // deck) from play, and `unit_on_board` had no carrier at all. These scenarios
  // read the real card views the catalog compiles, so the check the projection
  // reads is the check the engine validates rather than a synthetic stand-in.

  test("unit_on_board offers a skill only while the named unit is on the board", () => {
    const build = (deploy) =>
      seatFor({
        hand: ["Test On Board Skill", "Test Fisherman Unit", "Test Scout"],
        deploy,
        shinsu: 5,
      });

    const withUnit = projectAndFeed(() => build([["Test Fisherman Unit", "fisherman"]]));
    expect(requirementChecksReadable(withUnit.view, "Test On Board Skill")).toBe(true);
    expect(ofType(withUnit.moves, "play-skill-action")).toEqual([
      { type: "play-skill-action", data: { handId: handCardId(withUnit.view, "Test On Board Skill") } },
    ]);
    expect(withUnit.refusals).toEqual([]);

    // The control deploys a unit the requirement does not name, so nothing on
    // the board satisfies it and the skill is not offered.
    const withOtherUnit = projectAndFeed(() => build([["Test Scout", "scout"]]));
    expect(requirementChecksReadable(withOtherUnit.view, "Test On Board Skill")).toBe(true);
    expect(unitNamesById(withOtherUnit.view).size).toBe(1);
    expect(ofType(withOtherUnit.moves, "play-skill-action")).toEqual([]);
  });

  test("has_ally offers a skill only while an ally carries the affiliation", () => {
    const build = (deploy) =>
      seatFor({
        hand: ["Test Ally Affiliation Skill", "Test Free Keyword Unit", "Test Scout"],
        deploy,
        shinsu: 5,
      });

    // `Test Free Keyword Unit` prints the team novick affiliation the
    // requirement names; `Test Scout` prints team chang instead, so it carries
    // neither the named affiliation nor any attribute the check could match.
    const withAlly = projectAndFeed(() => build([["Test Free Keyword Unit", "scout"]]));
    expect(requirementChecksReadable(withAlly.view, "Test Ally Affiliation Skill")).toBe(true);
    expect(ofType(withAlly.moves, "play-skill-action")).toEqual([
      { type: "play-skill-action", data: { handId: handCardId(withAlly.view, "Test Ally Affiliation Skill") } },
    ]);
    expect(withAlly.refusals).toEqual([]);

    const withoutAlly = projectAndFeed(() => build([["Test Scout", "scout"]]));
    expect(unitNamesById(withoutAlly.view).size).toBe(1);
    expect(ofType(withoutAlly.moves, "play-skill-action")).toEqual([]);
  });

  test("an enemy-targeted requirement leaves the move out of the pool, as the engine refuses it", () => {
    // `Test Enemy Target Skill` carries `target_side: enemy`, the side no
    // shipped card uses (the only published `target_side` is `ally`). A skill
    // play resolves its target after the play, so the validator sees no target
    // at all and refuses the play before any enemy could be named. The
    // projection mirrors that refusal, which is what keeps the pool honest.
    const build = () =>
      seatFor({
        hand: ["Test Enemy Target Skill", "Test Scout"],
        deploy: [["Test Scout", "scout"]],
        shinsu: 5,
      });

    const { view, moves } = projectAndFeed(build);
    expect(requirementChecksReadable(view, "Test Enemy Target Skill")).toBe(true);
    expect(ofType(moves, "play-skill-action")).toEqual([]);

    IdFactory.resetAll();
    const refusal = runMove(build(), {
      type: "play-skill-action",
      data: { handId: handCardId(view, "Test Enemy Target Skill") },
    });
    expect(refusal?.message).toMatch(/target must be an enemy/i);
  });

  test("an equipment the target_side mirror cannot satisfy is left out of the pool", () => {
    // `target_side` also gates an equipment against the bearer it would attach
    // to, and equip moves only ever target the seat's own units. A `side:
    // enemy` equipment is therefore never offered — and the engine would refuse
    // the same move, because the bearer's owner is the source's owner. No
    // shipped card names `side: "enemy"`, so the view is synthetic here.
    const bearing = (side) => ({
      type: "equipment",
      name: `Enemy-Side Equip ${side}`,
      cost: 0,
      effectiveCost: 0,
      requirements: [{ text: ["target is an enemy"], check: { type: "target_side", side } }],
    });
    const unit = {
      id: "Unit#Bearer",
      placedPositionCode: "fisherman",
      line: "frontline",
      currentHp: 3,
      conditions: [],
      keywords: [],
      grantedAbilities: [],
      runtimeAffiliations: [],
      runtimeAttributes: [],
      card: {
        type: "unit",
        kind: "standard",
        name: "Bearer",
        positions: { fisherman: { line: "frontline" } },
        deployLines: ["frontline"],
        affiliations: {},
        attributes: {},
        abilities: [],
      },
    };
    const seatView = (hand, field = []) => ({
      currentTurn: "Alice",
      you: {
        username: "Alice",
        hand,
        field: { frontline: field, backline: [] },
        shinsu: { normalSpent: 0, normalAvailable: 5, recharged: 0 },
        combatSlots: {},
        shinheuhSlot: { available: false, used: false },
        passButton: { isEnabled: true, text: "Pass Turn" },
        pendingDecision: null,
      },
    });

    expect(ofType(projectTurnOptions(seatView([bearing("enemy")], [unit])), "equip-equipment-action")).toHaveLength(0);
    expect(ofType(projectTurnOptions(seatView([bearing("ally")], [unit])), "equip-equipment-action")).toHaveLength(1);
  });
});

describe("projection preconditions the engine enforces outside validate()", () => {
  test("an equip a landmark rule prevents stays in the pool, because the view ships the rule as prose", () => {
    // `LifecycleEngine.attachEquipment` refuses a `prevent_equip` unit during
    // execute, after `EquipEquipmentAction.validate` passed. The pool is a
    // function of the view alone, and the view's card carries the landmark's
    // rules only as display segments (`Card.toSanitizedObject().rules`), so the
    // projection cannot test a rule and attempts the equip. `Test Prevent Equip
    // Landmark` blocks its own owner's board too (`GlobalRuleRegistry.matches`
    // never reads ownership), so Bob's landmark blocks Alice's Scout.
    const build = () =>
      seatFor({
        hand: ["Test Blue Thryssa", "Test Scout", "Test Fisherman Unit"],
        deploy: [
          ["Test Scout", "scout"],
          ["Test Fisherman Unit", "fisherman"],
        ],
        opponentHand: ["Test Prevent Equip Landmark"],
        opponentDeploy: [["Test Prevent Equip Landmark", "backline"]],
        shinsu: 15,
      });

    IdFactory.resetAll();
    const view = buildStateView({ game: build(), revision: 1, username: SEAT });
    const landmark = view.opponent.field.backline[0];
    expect(landmark.card.name).toBe("Test Prevent Equip Landmark");
    // The landmark's rule reaches the view as display segments, one list per
    // rule: the `type: "prevent_equip"` and `position: "scout"` the engine's
    // registry tests are gone by the time the view is built, so nothing here
    // answers "does this rule apply to that unit".
    expect(landmark.card.rules).toEqual([["units in Scout cannot be equipped"]]);

    const names = unitNamesById(view);
    const handId = handCardId(view, "Test Blue Thryssa");
    const targetsByMove = new Map(
      ofType(projectTurnOptions(view), "equip-equipment-action").map((move) => [
        moveKey(move),
        names.get(move.data.targetUnitId),
      ])
    );
    expect(targetsByMove.get(moveKey({ type: "equip-equipment-action", data: { handId, targetUnitId: ownUnitId(view, "Test Scout") } }))).toBe("Test Scout");
    expect(targetsByMove.get(moveKey({ type: "equip-equipment-action", data: { handId, targetUnitId: ownUnitId(view, "Test Fisherman Unit") } }))).toBe("Test Fisherman Unit");

    // Every projected move but the prevented one is accepted; the prevented one
    // is refused by the rule, which is the retry the projection's attempt costs.
    const { refusals } = projectAndFeed(build);
    expect(refusals.map((entry) => names.get(entry.move.data.targetUnitId))).toEqual(["Test Scout"]);
    expect(refusals[0].error.message).toMatch(/landmark rule prevents equipping this unit/i);

    // Without the landmark the same equip is accepted, so the refusal above is
    // attributable to the rule rather than to the equip itself.
    const withoutRule = projectAndFeed(() =>
      seatFor({
        hand: ["Test Blue Thryssa", "Test Scout", "Test Fisherman Unit"],
        deploy: [
          ["Test Scout", "scout"],
          ["Test Fisherman Unit", "fisherman"],
        ],
        shinsu: 15,
      })
    );
    expect(withoutRule.refusals).toEqual([]);
    expect(
      ofType(withoutRule.moves, "equip-equipment-action").some(
        (move) => withoutRule.view.you.field.frontline.find((unit) => unit.id === move.data.targetUnitId)?.card?.name === "Test Scout"
      )
    ).toBe(true);
  });
});

describe("requirement checks no deck-legal fixture reaches", () => {
  // The deck-legal scenarios above cover what a fixture can reach. These pin
  // the rest of the projection's requirement branches over a view shaped like
  // the one `buildStateView` emits: a condition a unit carries because the
  // `ModifierStack` granted it rather than because its card printed it, and the
  // name match `unit_on_board` performs.
  const unitView = (name, { affiliations = [], attributes = [], runtimeAffiliations = [], runtimeAttributes = [] } = {}) => ({
    id: `Unit#${name}`,
    placedPositionCode: "fisherman",
    line: "frontline",
    currentHp: 3,
    conditions: [],
    keywords: [],
    grantedAbilities: [],
    runtimeAffiliations: runtimeAffiliations.map((key) => ({ key })),
    runtimeAttributes: runtimeAttributes.map((key) => ({ key })),
    card: {
      type: "unit",
      kind: "standard",
      name,
      positions: { fisherman: { line: "frontline" } },
      deployLines: ["frontline"],
      affiliations: Object.fromEntries(affiliations.map((code) => [code, {}])),
      attributes: Object.fromEntries(attributes.map((code) => [code, {}])),
      abilities: [],
    },
  });

  const skillView = (check) => ({
    id: "Card#1#1",
    type: "skill",
    name: "Requirement Skill",
    cost: 0,
    effectiveCost: 0,
    requirements: [{ text: ["requirement"], check }],
  });

  const seatView = (hand, field = []) => ({
    currentTurn: "Alice",
    you: {
      username: "Alice",
      hand,
      field: { frontline: field, backline: [] },
      shinsu: { normalSpent: 0, normalAvailable: 5, recharged: 0 },
      combatSlots: {},
      shinheuhSlot: { available: false, used: false },
      passButton: { isEnabled: true, text: "Pass Turn" },
      pendingDecision: null,
    },
  });

  test("has_ally reads a printed code and a runtime-granted one", () => {
    const check = { type: "has_ally", attribute: "irregular" };

    expect(ofType(projectTurnOptions(seatView([skillView(check)], [unitView("Irregular", { attributes: ["irregular"] })])), "play-skill-action")).toHaveLength(1);
    expect(ofType(projectTurnOptions(seatView([skillView(check)], [unitView("Granted", { runtimeAttributes: ["irregular"] })])), "play-skill-action")).toHaveLength(1);
    expect(ofType(projectTurnOptions(seatView([skillView(check)], [unitView("Plain")])), "play-skill-action")).toHaveLength(0);
  });

  test("unit_on_board matches an owned unit's name case-insensitively", () => {
    const check = { type: "unit_on_board", name: "Test Fisherman Unit" };
    const field = [unitView("Test Fisherman Unit")];
    expect(ofType(projectTurnOptions(seatView([skillView(check)], field)), "play-skill-action")).toHaveLength(1);
    expect(ofType(projectTurnOptions(seatView([skillView(check)], [unitView("Test Scout")])), "play-skill-action")).toHaveLength(0);
  });

  test("an unreadable requirement entry leaves the move in the pool", () => {
    const entry = { text: ["requirement"] };
    const hand = [{ ...skillView({ type: "deployed_as", position: "fisherman" }), requirements: [entry] }];
    expect(ofType(projectTurnOptions(seatView(hand)), "play-skill-action")).toHaveLength(1);
  });

  test("an unknown requirement type fails loudly rather than deciding either way", () => {
    const check = { type: "not_a_real_check" };
    expect(() => projectTurnOptions(seatView([skillView(check)]))).toThrow(/Unsupported requirement type/);
  });
});

describe("moveKey", () => {
  test("names an action by its type and payload fields in a fixed order", () => {
    expect(moveKey({ type: "deploy-unit-action", data: { placedPositionCode: "scout", handId: 0 } })).toBe(
      moveKey({ type: "deploy-unit-action", data: { handId: 0, placedPositionCode: "scout" } })
    );
    expect(moveKey({ type: "deploy-unit-action", data: { handId: 0, placedPositionCode: "scout" } })).not.toBe(
      moveKey({ type: "deploy-unit-action", data: { handId: 0, placedPositionCode: "fisherman" } })
    );
    expect(moveKey({ type: "pass-turn-action", data: {} })).not.toBe(moveKey({ type: "generate-fire-charge-action", data: {} }));
  });

  test("ignores payload fields no action of that type carries", () => {
    expect(moveKey({ type: "play-skill-action", data: { handId: 2, username: SEAT } })).toBe(
      moveKey({ type: "play-skill-action", data: { handId: 2 } })
    );
  });

  test("identifies a decision resolution by its decision and its chosen ids", () => {
    const decision = { decisionId: "d1", choices: ["a", "b"] };
    expect(moveKey(decision)).toBe(moveKey({ decisionId: "d1", choices: ["b", "a"] }));
    expect(moveKey(decision)).not.toBe(moveKey({ decisionId: "d2", choices: ["a", "b"] }));
  });
});
