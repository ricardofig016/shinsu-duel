import GameState from "../GameState.js";

const PVP_CONFIG = {
  opponent: "friend",
  difficulty: null,
  usernames: ["Alice", "Bob"],
};

function advanceToRound(game, round) {
  const firstPlayer = game.currentTurn;
  const secondPlayer = firstPlayer === "Alice" ? "Bob" : "Alice";
  let safety = 0;
  while (game.round < round) {
    if (++safety > 1000) throw new Error("advanceToRound safety limit hit");
    game.processAction({ type: "pass-turn", username: firstPlayer });
    game.processAction({ type: "pass-turn", username: secondPlayer });
  }
}

function expectShinsuState(playerState, normalSpent, normalAvailable, recharged) {
  expect(playerState.shinsu.normalSpent).toBe(normalSpent);
  expect(playerState.shinsu.normalAvailable).toBe(normalAvailable);
  expect(playerState.shinsu.recharged).toBe(recharged);
}

describe.each([1, 3, 10, 25])("core rules at round %i", (round) => {
  let game, firstPlayer, secondPlayer;
  const roomCode = "TEST";

  beforeEach(() => {
    game = new GameState(roomCode, PVP_CONFIG);
    firstPlayer = game.currentTurn;
    secondPlayer = firstPlayer === "Alice" ? "Bob" : "Alice";
    advanceToRound(game, round);
  });

  test(`game.round should be ${round}`, () => {
    expect(game.round).toBe(round);
  });

  test("round increments after both players pass their turn", () => {
    game.processAction({ type: "pass-turn", username: firstPlayer }); // Alice -> Bob
    game.processAction({ type: "pass-turn", username: secondPlayer }); // Bob -> round should increment
    expect(game.round).toBe(round + 1);
  });

  test("turn alternates between players", () => {
    expect(game.currentTurn).toBe(firstPlayer);
    game.processAction({ type: "pass-turn", username: firstPlayer });
    expect(game.currentTurn).toBe(secondPlayer);
    game.processAction({ type: "pass-turn", username: secondPlayer });
    expect(game.currentTurn).toBe(firstPlayer);
  });

  test("amount of shinsu", () => {
    const aliceState = game.playerStates.Alice;
    const bobState = game.playerStates.Bob;
    const sumOfAllUnspentShinsu = ((game.round - 1) * (game.round - 1 + 1)) / 2;
    const expectedRecharged = Math.min(sumOfAllUnspentShinsu, game.MAX_RECHARGED_SHINSU);
    const expectedNormalAvailable = Math.min(game.round, game.MAX_NORMAL_SHINSU);
    expectShinsuState(aliceState, 0, expectedNormalAvailable, expectedRecharged);
    expectShinsuState(bobState, 0, expectedNormalAvailable, expectedRecharged);
  });

  test("number of cards in hand", () => {
    const aliceState = game.playerStates.Alice;
    const bobState = game.playerStates.Bob;
    const expectedHandSize = game.INIT_HAND_SIZE + (game.round - 1);
    expect(aliceState.hand.length).toBe(expectedHandSize);
    expect(bobState.hand.length).toBe(expectedHandSize);
  });

  test("number of cards in deck", () => {
    const aliceState = game.playerStates.Alice;
    const bobState = game.playerStates.Bob;
    const expectedDeckSize = game.INIT_DECK_SIZE - (game.INIT_HAND_SIZE + (game.round - 1));
    expect(aliceState.deck.length).toBe(expectedDeckSize);
    expect(bobState.deck.length).toBe(expectedDeckSize);
  });
});
