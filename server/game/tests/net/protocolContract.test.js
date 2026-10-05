import { jest } from "@jest/globals";
import { EVENTS, buildStateView } from "../../net/protocol.js";
import { createNetHarness } from "./harness.js";
import { deployUnit } from "../utils.js";
import ModifierService from "../../services/ModifierService.js";
import CombatSlotService from "../../services/CombatSlotService.js";

jest.setTimeout(15000);

const PASS_TURN = { type: "pass-turn-action", data: {} };
const WAITING_PAYLOAD = { message: "Waiting for the other player to join." };

let harness;

beforeEach(async () => {
  harness = await createNetHarness();
});

afterEach(async () => {
  await harness.close();
});

/** Ask a seat for its current view and read the state the gateway sends back. */
async function requestView(seat) {
  const received = seat.next(EVENTS.GAME_INIT);
  seat.emit(EVENTS.GAME_STATE_REQUEST);
  return received;
}

/** Create a pending target-selection decision for Alice on the live game. */
function createTargetDecision(session) {
  const decisionId = session.game.createPendingDecision({
    owner: "Alice",
    type: "target_selection",
    candidates: [{ id: 77, name: "Candidate", hp: 4 }],
    minChoices: 1,
    maxChoices: 1,
    resolve: () => {},
  });
  // The engine stores its own metadata alongside the candidate fields.
  return { decisionId, expected: { decisionId, type: "target_selection", candidates: [{ id: 77, name: "Candidate", hp: 4, _isUnit: false }], minChoices: 1, maxChoices: 1, lockedIds: [] } };
}

describe("game-init: the exact per-player projection on start", () => {
  test("each seat receives exactly the protocol view of the started game", async () => {
    const { roomCode, alice, bob } = await harness.seatPlayers();
    const session = harness.registry.get(roomCode);

    expect(alice.lastPayloadOf(EVENTS.GAME_INIT)).toEqual(
      buildStateView({ game: session.game, revision: session.revision, username: "Alice" })
    );
    expect(bob.lastPayloadOf(EVENTS.GAME_INIT)).toEqual(
      buildStateView({ game: session.game, revision: session.revision, username: "Bob" })
    );
    expect(session.revision).toBe(1);
  });

  test("opponent hands are hidden and own hands are readable", async () => {
    const { alice, bob } = await harness.seatPlayers();
    const aliceInit = alice.lastPayloadOf(EVENTS.GAME_INIT);
    const bobInit = bob.lastPayloadOf(EVENTS.GAME_INIT);

    expect(aliceInit.you.hand.length).toBeGreaterThan(0);
    for (const card of aliceInit.you.hand) {
      expect(card).toEqual(expect.objectContaining({ name: expect.any(String) }));
    }
    expect(aliceInit.opponent.hand).toHaveLength(bobInit.you.hand.length);
    for (const card of aliceInit.opponent.hand) {
      expect(card).toEqual({});
    }
    for (const card of bobInit.opponent.hand) {
      expect(card).toEqual({});
    }
  });

  test("the initial view carries round, turn, game-over, and pass-button state", async () => {
    const { alice, bob } = await harness.seatPlayers();
    const aliceInit = alice.lastPayloadOf(EVENTS.GAME_INIT);
    const bobInit = bob.lastPayloadOf(EVENTS.GAME_INIT);

    expect(aliceInit.round).toBe(1);
    expect(aliceInit.currentTurn).toBe("Alice");
    expect(aliceInit.gameOver).toBeNull();
    expect(aliceInit.you.username).toBe("Alice");
    expect(aliceInit.opponent.username).toBe("Bob");
    expect(aliceInit.you.passButton).toEqual({ isEnabled: true, text: "Pass Turn" });
    expect(aliceInit.opponent.passButton).toEqual({ isEnabled: false, text: "Bob" });

    expect(bobInit.currentTurn).toBe("Alice");
    expect(bobInit.you.passButton).toEqual({ isEnabled: false, text: "Bob" });
    expect(bobInit.opponent.passButton).toEqual({ isEnabled: false, text: "Alice" });
  });

  // RULES.md §Combat Slots: the Shinheuh slot exists only while an Anima
  // created it. `{ available: false, used: false }` is no slot, `available` is
  // an existing unspent slot, `used` is an existing spent slot. A client can
  // only tell those apart if the pair survives the wire for both seats.
  test("the Shinheuh slot reaches both seats over the wire in every state", async () => {
    const { roomCode, alice, bob } = await harness.seatPlayers();
    const game = harness.registry.get(roomCode).game;

    let aliceView = await requestView(alice);
    let bobView = await requestView(bob);
    expect(aliceView.you.shinheuhSlot).toEqual({ available: false, used: false });
    expect(aliceView.opponent.shinheuhSlot).toEqual({ available: false, used: false });
    expect(bobView.you.shinheuhSlot).toEqual({ available: false, used: false });
    expect(bobView.opponent.shinheuhSlot).toEqual({ available: false, used: false });

    CombatSlotService.grantShinheuhSlot(game.playerStates.Bob, game.eventBus, "Bob");
    aliceView = await requestView(alice);
    bobView = await requestView(bob);
    expect(aliceView.opponent.shinheuhSlot).toEqual({ available: true, used: false });
    expect(bobView.you.shinheuhSlot).toEqual({ available: true, used: false });
    expect(aliceView.you.shinheuhSlot).toEqual({ available: false, used: false });
    expect(bobView.opponent.shinheuhSlot).toEqual({ available: false, used: false });

    expect(CombatSlotService.consumeShinheuhSlot(game.playerStates.Bob)).toBe(true);
    aliceView = await requestView(alice);
    bobView = await requestView(bob);
    expect(aliceView.opponent.shinheuhSlot).toEqual({ available: false, used: true });
    expect(bobView.you.shinheuhSlot).toEqual({ available: false, used: true });
  });
});

describe("game-update: broadcasts after accepted actions", () => {
  test("an accepted action broadcasts the exact per-player view with a bumped revision", async () => {
    const { roomCode, alice, bob } = await harness.seatPlayers();
    const session = harness.registry.get(roomCode);

    const aliceReceives = alice.next(EVENTS.GAME_UPDATE);
    const bobReceives = bob.next(EVENTS.GAME_UPDATE);
    alice.emit(EVENTS.GAME_ACTION, PASS_TURN);
    const [aliceUpdate, bobUpdate] = await Promise.all([aliceReceives, bobReceives]);

    expect(aliceUpdate).toEqual(buildStateView({ game: session.game, revision: session.revision, username: "Alice" }));
    expect(bobUpdate).toEqual(buildStateView({ game: session.game, revision: session.revision, username: "Bob" }));
    expect(aliceUpdate.revision).toBe(2);
    expect(aliceUpdate.currentTurn).toBe("Bob");
    // Alice passed, so Bob's pass would end the round and the button says so.
    expect(bobUpdate.you.passButton).toEqual({ isEnabled: true, text: "End Round" });
  });

  test("revision increments across consecutive actions and rounds advance", async () => {
    const { alice, bob } = await harness.seatPlayers();

    const pass1 = Promise.all([alice.next(EVENTS.GAME_UPDATE), bob.next(EVENTS.GAME_UPDATE)]);
    alice.emit(EVENTS.GAME_ACTION, PASS_TURN);
    const [aliceUpdate, bobUpdate] = await pass1;

    const pass2 = Promise.all([alice.next(EVENTS.GAME_UPDATE), bob.next(EVENTS.GAME_UPDATE)]);
    bob.emit(EVENTS.GAME_ACTION, PASS_TURN);
    const [aliceSecondUpdate, bobSecondUpdate] = await pass2;

    expect(aliceUpdate.revision).toBe(2);
    expect(bobUpdate.revision).toBe(2);
    expect(aliceUpdate.round).toBe(1);
    expect(aliceUpdate.currentTurn).toBe("Bob");
    expect(aliceSecondUpdate.revision).toBe(3);
    expect(bobSecondUpdate.revision).toBe(3);
    expect(aliceSecondUpdate.round).toBe(2);
    expect(aliceSecondUpdate.currentTurn).toBe("Alice");
  });
});

describe("per-player decision and condition projections", () => {
  test("conditions carry effective magnitudes in both seats' views", async () => {
    const { roomCode, alice, bob } = await harness.seatPlayers({
      hands: { Alice: ["Test Scout"], Bob: ["Test Shinheuh"] },
    });
    const session = harness.registry.get(roomCode);
    const game = session.game;
    const scout = deployUnit(game, "Alice", "Test Scout", "scout");
    game.modifierStack.apply({
      sourceId: scout.id,
      sourceType: "unit",
      targetId: scout.id,
      type: "condition",
      key: "poisoned",
      value: 2,
      operation: "add",
    });

    alice.emit(EVENTS.GAME_STATE_REQUEST);
    const aliceView = await alice.next(EVENTS.GAME_INIT);
    const projected = aliceView.you.field.frontline.find((unit) => unit.id === scout.id);
    expect(projected.conditions).toEqual([
      {
        key: "poisoned",
        magnitude: 2,
        numeric: true,
        name: "Poisoned",
        description: {
          segments: [
            "I take ",
            { type: "value", ref: "condition", text: "x" },
            " damage when I use an ",
            { type: "rule", ref: "ability", text: "Ability" },
          ],
        },
        iconPath: "/assets/icons/conditions/poisoned.png",
      },
    ]);

    bob.emit(EVENTS.GAME_STATE_REQUEST);
    const bobView = await bob.next(EVENTS.GAME_INIT);
    const fromOpponentSide = bobView.opponent.field.frontline.find((unit) => unit.id === scout.id);
    expect(fromOpponentSide.conditions).toEqual([
      {
        key: "poisoned",
        magnitude: 2,
        numeric: true,
        name: "Poisoned",
        description: {
          segments: [
            "I take ",
            { type: "value", ref: "condition", text: "x" },
            " damage when I use an ",
            { type: "rule", ref: "ability", text: "Ability" },
          ],
        },
        iconPath: "/assets/icons/conditions/poisoned.png",
      },
    ]);
  });

  test("derived unit keywords, runtime affiliations and attributes survive the wire in both seats", async () => {
    const { roomCode, alice, bob } = await harness.seatPlayers({ hands: { Alice: ["Test Scout"] } });
    const session = harness.registry.get(roomCode);
    const game = session.game;
    const scout = deployUnit(game, "Alice", "Test Scout", "scout");
    game.modifierStack.apply({
      sourceId: "Equip#free",
      sourceType: "equipment",
      targetId: scout.id,
      type: "keyword",
      key: "free",
      value: 1,
      meta: { first: false },
    });
    game.modifierStack.apply({
      sourceId: "Passive#aff",
      sourceType: "passive",
      targetId: scout.id,
      type: "affiliation",
      key: "wolhaiksong",
      value: 1,
    });
    game.modifierStack.apply({
      sourceId: "Passive#attr",
      sourceType: "passive",
      targetId: scout.id,
      type: "attribute",
      key: "anima",
      value: 1,
    });

    alice.emit(EVENTS.GAME_STATE_REQUEST);
    const aliceView = await alice.next(EVENTS.GAME_INIT);
    const ownUnit = aliceView.you.field.frontline.find((unit) => unit.id === scout.id);
    expect(ownUnit.keywords).toEqual(["free"]);
    expect(ownUnit.runtimeAffiliations).toEqual([
      { key: "wolhaiksong", name: "Wolhaiksong", type: "organization", iconPath: "/assets/icons/affiliations/wolhaiksong.png" },
    ]);
    expect(ownUnit.runtimeAttributes).toEqual([
      expect.objectContaining({ key: "anima", name: "Anima", iconPath: "/assets/icons/attributes/anima.png" }),
    ]);
    expect([...ownUnit.runtimeAttributes[0].description.segments]).toEqual(expect.any(Array));

    bob.emit(EVENTS.GAME_STATE_REQUEST);
    const bobView = await bob.next(EVENTS.GAME_INIT);
    const opponentUnit = bobView.opponent.field.frontline.find((unit) => unit.id === scout.id);
    expect(opponentUnit.keywords).toEqual(ownUnit.keywords);
    expect(opponentUnit.runtimeAffiliations).toEqual(ownUnit.runtimeAffiliations);
    expect(opponentUnit.runtimeAttributes).toEqual(ownUnit.runtimeAttributes);
    expect(opponentUnit).not.toHaveProperty("grantedAbilities");

    // Removing the granting sources clears the projected fields on the wire too.
    game.modifierStack.removeBySource("Equip#free");
    game.modifierStack.removeBySource("Passive#aff");
    game.modifierStack.removeBySource("Passive#attr");
    alice.emit(EVENTS.GAME_STATE_REQUEST);
    const afterRemoval = await alice.next(EVENTS.GAME_INIT);
    const removedUnit = afterRemoval.you.field.frontline.find((unit) => unit.id === scout.id);
    expect(removedUnit.keywords).toEqual([]);
    expect(removedUnit.runtimeAffiliations).toEqual([]);
    expect(removedUnit.runtimeAttributes).toEqual([]);
  });

  test("the seat's own cards carry the engine-resolved cost on the wire", async () => {
    const { roomCode, alice } = await harness.seatPlayers({ hands: { Alice: ["Test Scout"] } });
    const session = harness.registry.get(roomCode);
    const game = session.game;

    let view = await requestView(alice);
    let handCard = view.you.hand.find((card) => card.name === "Test Scout");
    expect(handCard.effectiveCost).toBe(handCard.cost);

    game.modifierStack.apply({
      sourceId: "Passive#cost",
      sourceType: "passive",
      targetId: "Alice",
      type: "stat",
      key: "cost",
      value: -1,
    });
    expect(ModifierService.getEffectiveCost(game.playerStates.Alice.hand[0], "Alice", game)).toBe(0);

    view = await requestView(alice);
    handCard = view.you.hand.find((card) => card.name === "Test Scout");
    expect(handCard.cost).toBe(1);
    expect(handCard.effectiveCost).toBe(0);
  });

  test("the pending decision is exposed to its owner only", async () => {
    const { roomCode, alice, bob } = await harness.seatPlayers();
    const session = harness.registry.get(roomCode);
    const { expected } = createTargetDecision(session);

    alice.emit(EVENTS.GAME_STATE_REQUEST);
    const aliceView = await alice.next(EVENTS.GAME_INIT);
    expect(aliceView.you.pendingDecision).toEqual(expected);

    bob.emit(EVENTS.GAME_STATE_REQUEST);
    const bobView = await bob.next(EVENTS.GAME_INIT);
    expect(bobView.you.pendingDecision).toBeNull();
    expect(bobView.opponent).not.toHaveProperty("pendingDecision");
  });

  test("a decision resolved over the wire clears for both seats and bumps the revision", async () => {
    const { roomCode, alice, bob } = await harness.seatPlayers();
    const session = harness.registry.get(roomCode);
    const { decisionId } = createTargetDecision(session);

    alice.emit(EVENTS.GAME_DECISION, { decisionId, choices: [77] });
    const [aliceUpdate, bobUpdate] = await Promise.all([alice.next(EVENTS.GAME_UPDATE), bob.next(EVENTS.GAME_UPDATE)]);

    expect(session.game.pendingDecision).toBeNull();
    expect(session.revision).toBe(2);
    expect(aliceUpdate.revision).toBe(2);
    expect(aliceUpdate.you.pendingDecision).toBeNull();
    expect(bobUpdate.revision).toBe(2);
  });
});

describe("game-error: rejections are exact and leave state untouched", () => {
  const stateSnapshot = (session) => ({
    revision: session.revision,
    round: session.game.round,
    currentTurn: session.game.currentTurn,
    pendingDecision: session.game.pendingDecision,
  });

  test.each([
    ["null payload", null],
    ["missing type", { data: {} }],
    ["empty type", { type: "", data: {} }],
    ["data of the wrong field type", { type: "pass-turn-action", data: "nope" }],
  ])("rejects %s with the exact malformed-action error", async (_label, action) => {
    const { roomCode, alice } = await harness.seatPlayers();
    const session = harness.registry.get(roomCode);
    const before = stateSnapshot(session);

    alice.emit(EVENTS.GAME_ACTION, action);

    expect(await alice.next(EVENTS.GAME_ERROR)).toEqual({ message: "Malformed action payload." });
    expect(stateSnapshot(session)).toEqual(before);
  });

  test("an unknown action type is rejected by the engine and changes nothing", async () => {
    const { roomCode, alice } = await harness.seatPlayers();
    const session = harness.registry.get(roomCode);
    const before = stateSnapshot(session);

    alice.emit(EVENTS.GAME_ACTION, { type: "nope-action", data: {} });

    expect((await alice.next(EVENTS.GAME_ERROR)).message).toMatch(/invalid action type/);
    expect(stateSnapshot(session)).toEqual(before);
  });

  test.each([
    ["null payload", null],
    ["missing decision id", { choices: [77] }],
    ["decision id of the wrong field type", { decisionId: 42, choices: [77] }],
    ["choices of the wrong field type", { decisionId: "d1", choices: "77" }],
  ])("rejects %s with the exact malformed-decision error", async (_label, decision) => {
    const { roomCode, alice } = await harness.seatPlayers();
    const session = harness.registry.get(roomCode);
    const before = stateSnapshot(session);

    alice.emit(EVENTS.GAME_DECISION, decision);

    expect(await alice.next(EVENTS.GAME_ERROR)).toEqual({ message: "Malformed decision payload." });
    expect(stateSnapshot(session)).toEqual(before);
  });

  test("a wrong decision id is rejected and leaves the decision open", async () => {
    const { roomCode, alice } = await harness.seatPlayers();
    const session = harness.registry.get(roomCode);
    createTargetDecision(session);
    const before = stateSnapshot(session);

    alice.emit(EVENTS.GAME_DECISION, { decisionId: "nope", choices: [77] });

    expect((await alice.next(EVENTS.GAME_ERROR)).message).toMatch(/Decision ID does not match/);
    expect(stateSnapshot(session)).toEqual(before);
    expect(session.game.pendingDecision).not.toBeNull();
  });

  test("a foreign decision id cannot be resolved by the non-owner", async () => {
    const { roomCode, alice, bob } = await harness.seatPlayers();
    const session = harness.registry.get(roomCode);
    const { decisionId } = createTargetDecision(session);
    const before = stateSnapshot(session);

    bob.emit(EVENTS.GAME_DECISION, { decisionId, choices: [77] });

    expect((await bob.next(EVENTS.GAME_ERROR)).message).toMatch(/Only the decision owner/);
    expect(stateSnapshot(session)).toEqual(before);
    expect(session.game.pendingDecision).not.toBeNull();
    expect(alice.payloadsOf(EVENTS.GAME_UPDATE)).toEqual([]);
  });
});

describe("game-over: exact delivery to both seats", () => {
  const exhaustAliceDeckAndPass = async () => {
    const seated = await harness.seatPlayers();
    const session = harness.registry.get(seated.roomCode);
    session.game.playerStates.Alice.deck = [];
    seated.alice.emit(EVENTS.GAME_ACTION, PASS_TURN);
    await seated.alice.next(EVENTS.GAME_UPDATE);
    seated.bob.emit(EVENTS.GAME_ACTION, PASS_TURN);
    return seated;
  };

  test("the ending action broadcasts the exact result and final state", async () => {
    const { roomCode, alice, bob } = await exhaustAliceDeckAndPass();
    const session = harness.registry.get(roomCode);

    // The result and the final state are broadcast back to back, so wait for
    // presence instead of consuming the stream event by event.
    await harness.waitFor(
      () =>
        alice.payloadsOf(EVENTS.GAME_OVER).length >= 1 &&
        alice.payloadsOf(EVENTS.GAME_UPDATE).length >= 2 &&
        bob.payloadsOf(EVENTS.GAME_OVER).length >= 1 &&
        bob.payloadsOf(EVENTS.GAME_UPDATE).length >= 2,
      "the ending broadcast never reached both seats."
    );

    for (const client of [alice, bob]) {
      expect(client.lastPayloadOf(EVENTS.GAME_OVER)).toEqual({ winner: "Bob", reason: "deck exhausted" });
      expect(client.lastPayloadOf(EVENTS.GAME_UPDATE).gameOver).toEqual({ winner: "Bob", reason: "deck exhausted" });
    }
    expect(session.game.gameOver).toEqual({ winner: "Bob", reason: "deck exhausted" });
  });

  test("actions after game over return the result without touching state", async () => {
    const { roomCode, alice } = await exhaustAliceDeckAndPass();
    const session = harness.registry.get(roomCode);

    await harness.waitFor(
      () => alice.payloadsOf(EVENTS.GAME_OVER).length >= 1 && alice.payloadsOf(EVENTS.GAME_UPDATE).length >= 2,
      "the ending broadcast never reached Alice."
    );
    const revision = session.revision;

    const lateOver = alice.next(EVENTS.GAME_OVER);
    alice.emit(EVENTS.GAME_ACTION, PASS_TURN);

    expect(await lateOver).toEqual({ winner: "Bob", reason: "deck exhausted" });
    expect(alice.payloadsOf(EVENTS.GAME_ERROR)).toEqual([]);
    expect(session.revision).toBe(revision);
  });
});

describe("generate-fire-charge-action: the hwayeomsa core mechanic over the wire", () => {
  test("a qualifying player gains a charge and a Fire Core through the exact client payload", async () => {
    const { roomCode, alice } = await harness.seatPlayers({ hands: { Alice: ["Test Hwayeomsa"] } });
    const session = harness.registry.get(roomCode);
    deployUnit(session.game, "Alice", "Test Hwayeomsa", "fisherman");
    // deploying ends the deployer's turn; the core ability needs it back
    session.game.currentTurn = "Alice";

    // the exact payload the client builder emits
    alice.emit(EVENTS.GAME_ACTION, { type: "generate-fire-charge-action", data: {} });
    const update = await alice.next(EVENTS.GAME_UPDATE);

    expect(update.you.fireCharges).toBe(1);
    expect(update.you.hand.some((card) => card.name === "Fire Core")).toBe(true);
    const deployed = [...update.you.field.frontline, ...update.you.field.backline].find(
      (candidate) => candidate.card.name === "Test Hwayeomsa"
    );
    expect(Object.keys(deployed.card.attributes)).toEqual(["hwayeomsa"]);
  });

  test("a player with no hwayeomsa unit is rejected and the revision stays put", async () => {
    const { roomCode, alice } = await harness.seatPlayers();
    const session = harness.registry.get(roomCode);
    const revisionBefore = session.revision;

    alice.emit(EVENTS.GAME_ACTION, { type: "generate-fire-charge-action", data: {} });
    const error = await alice.next(EVENTS.GAME_ERROR);

    expect(error).toEqual({ message: "No Hwayeomsa on field" });
    expect(session.revision).toBe(revisionBefore);
  });
});

describe("game-waiting: the lone player is not left in silence", () => {
  test("a player alone in an unfinished room receives the exact waiting payload", async () => {
    const roomCode = harness.createRoom();
    harness.joinRoom(roomCode, "Alice");
    const alice = await harness.connectPlayer({ username: "Alice", roomCode });

    await harness.waitFor(
      () => alice.lastPayloadOf(EVENTS.GAME_WAITING) !== null,
      "the lone player never received the waiting payload."
    );
    expect(alice.lastPayloadOf(EVENTS.GAME_WAITING)).toEqual(WAITING_PAYLOAD);
    expect(alice.payloadsOf(EVENTS.GAME_INIT)).toEqual([]);
    expect(harness.registry.get(roomCode)).toBeNull();
  });

  test("the parked player reaches the selection phase and then game-init once the room completes", async () => {
    const roomCode = harness.createRoom();
    harness.joinRoom(roomCode, "Alice");
    const alice = await harness.connectPlayer({ username: "Alice", roomCode });

    harness.joinRoom(roomCode, "Bob");
    const bob = await harness.connectPlayer({ username: "Bob", roomCode });

    await harness.waitFor(
      () => alice.lastPayloadOf(EVENTS.GAME_DECK_STATUS) !== null,
      "parked player never entered the deck-selection phase."
    );
    expect(harness.registry.get(roomCode).isStarted).toBe(false);

    await harness.selectDecks({ alice, bob });
    expect(harness.registry.get(roomCode).isStarted).toBe(true);
  });
});

describe("game-hand-peek: targeted delivery through a real action", () => {
  test("the reveal reaches the observer's connection only", async () => {
    const { roomCode, alice, bob } = await harness.seatPlayers({
      hands: { Alice: ["Test Scout"], Bob: ["Test Shinheuh"] },
    });
    const session = harness.registry.get(roomCode);
    const scout = deployUnit(session.game, "Alice", "Test Scout", "scout");
    session.game.currentTurn = "Alice";

    const peek = alice.next(EVENTS.GAME_HAND_PEEK);
    alice.emit(EVENTS.GAME_ACTION, {
      type: "use-ability-action",
      data: { unitId: scout.id, abilityCode: "0" },
    });

    expect(await peek).toEqual({
      owner: "Bob",
      observer: "Alice",
      cards: [expect.objectContaining({ name: expect.any(String), cost: expect.any(Number) })],
    });

    // The action cycle completes for both seats before asserting absence, so
    // a misplaced delivery could no longer be in flight.
    await harness.waitFor(
      () => alice.payloadsOf(EVENTS.GAME_UPDATE).length >= 1 && bob.payloadsOf(EVENTS.GAME_UPDATE).length >= 1,
      "the ability action never completed for both seats."
    );
    expect(bob.payloadsOf(EVENTS.GAME_HAND_PEEK)).toEqual([]);
  });
});
