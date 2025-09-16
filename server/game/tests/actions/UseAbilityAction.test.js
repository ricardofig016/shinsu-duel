import { advanceToRound, setupGameWithCardsInHand } from "../utils.js";

const USERNAMES = ["Alice", "Bob"];

describe("use simple ability (khun's create-one-lighthouse)", () => {
  let game;
  let abilityAction;

  beforeEach(() => {
    game = setupGameWithCardsInHand([2, 2, 2, 2]);
    advanceToRound(game, 2);

    // Deploy Khun
    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: USERNAMES[0], handId: 0, placedPositionCode: "lightbearer" },
    });

    // Bob passes turn
    game.processAction({ type: "pass-turn-action", data: { source: "player", username: USERNAMES[1] } });

    abilityAction = {
      type: "use-ability-action",
      data: {
        source: "player",
        username: USERNAMES[0],
        unitId: game.playerStates[USERNAMES[0]].field.backline[0].id,
        abilityCode: "create-one-lighthouse",
      },
    };
  });

  test("ability alters lighthouse amount", () => {
    // we start with 20 lighthouses
    expect(game.playerStates[USERNAMES[0]].lighthouses.amount).toBe(20);

    game.processAction(abilityAction);

    // the ability created a lighthouse
    expect(game.playerStates[USERNAMES[0]].lighthouses.amount).toBe(21);
  });

  test("ability turn ends after use", () => {
    // Initial turn should be Alice
    expect(game.currentTurn).toBe(USERNAMES[0]);
    game.processAction(abilityAction);
    // Turn should switch to Bob
    expect(game.currentTurn).toBe(USERNAMES[1]);
  });

  test("alice use ablity + bob pass turn does not advance round", () => {
    // Initial round should be 2
    expect(game.round).toBe(2);
    game.processAction(abilityAction);
    // Round should still be 2
    expect(game.round).toBe(2);
    game.processAction({ type: "pass-turn-action", data: { source: "player", username: USERNAMES[1] } });
    // Round should still be 2
    expect(game.round).toBe(2);
  });

  test("using ability with invalid unitId throws error", () => {
    const badAction = { ...abilityAction, data: { ...abilityAction.data, unitId: "9999" } };
    expect(() => game.processAction(badAction)).toThrow(/Unit 9999 not found in your field/);
  });

  test("using ability with invalid abilityCode throws error", () => {
    const badAction = {
      ...abilityAction,
      data: { ...abilityAction.data, abilityCode: "not-a-real-ability" },
    };
    expect(() => game.processAction(badAction)).toThrow(/does not have ability/);
  });

  test("using ability not on your turn throws error", () => {
    // It's Alice's turn now, try to have Bob use ability
    const badAction = { ...abilityAction, data: { ...abilityAction.data, username: USERNAMES[1] } };
    expect(() => game.processAction(badAction)).toThrow(/not your turn/);
  });

  test("using ability from opponent's unit throws error", () => {
    game.processAction({ type: "pass-turn-action", data: { source: "player", username: USERNAMES[0] } });
    // Try to have Bob use Alice's Khun's ability
    const badAction = {
      ...abilityAction,
      data: { ...abilityAction.data, username: USERNAMES[1] },
    };
    expect(() => game.processAction(badAction)).toThrow(/not found in your field/);
  });

  test("missing fields in ability action data throws error", () => {
    const unitId = game.playerStates[USERNAMES[0]].field.backline[0].id;
    expect(() =>
      game.processAction({ type: "use-ability-action", data: { source: "player", username: USERNAMES[0] } })
    ).toThrow(/Missing required field/);
    expect(() =>
      game.processAction({ type: "use-ability-action", data: { unitId: unitId, username: USERNAMES[0] } })
    ).toThrow(/Missing required field/);
    expect(() =>
      game.processAction({ type: "use-ability-action", data: { source: "player", unitId: unitId } })
    ).toThrow(/Missing required field/);
  });

  test("too many fields in ability action data throws error", () => {
    const unitId = game.playerStates[USERNAMES[0]].field.backline[0].id;
    expect(() =>
      game.processAction({
        ...abilityAction,
        data: {
          ...abilityAction.data,
          extraField: "extraValue",
        },
      })
    ).toThrow(/Unexpected field: extraField/);
  });
});
