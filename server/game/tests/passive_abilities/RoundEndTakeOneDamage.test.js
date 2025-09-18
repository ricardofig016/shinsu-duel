import { advanceToRound, setupGameWithCardsInHand } from "../utils.js";

const USERNAMES = ["Alice", "Bob"];

describe("khun's passive: take 1 damage at the end of each round", () => {
  let game;

  beforeEach(() => {
    game = setupGameWithCardsInHand([2, 2, 2, 2]);
    advanceToRound(game, 2);
    // Deploy Khun
    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: USERNAMES[0], handId: 0, placedPositionCode: "lightbearer" },
    });
  });

  test("khun takes 1 damage after 1 round", () => {
    const khun = game.playerStates[USERNAMES[0]].field.backline[0];
    expect(khun.card.maxHp - khun.currentHp).toBe(0);
    advanceToRound(game, 3);
    expect(khun.card.maxHp - khun.currentHp).toBe(1);
  });

  test("khun takes 4 damage after 4 rounds", () => {
    const khun = game.playerStates[USERNAMES[0]].field.backline[0];
    expect(khun.card.maxHp - khun.currentHp).toBe(0);
    advanceToRound(game, 6);
    expect(khun.card.maxHp - khun.currentHp).toBe(4);
  });
});
