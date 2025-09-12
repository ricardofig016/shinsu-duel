import GameState from "../GameState.js";

describe("GameState core rules", () => {
  let game, firstPlayer, secondPlayer;
  const roomCode = "TEST";
  const config = {
    opponent: "friend",
    difficulty: null,
    usernames: ["Alice", "Bob"],
  };

  beforeEach(() => {
    game = new GameState(roomCode, config);
    firstPlayer = game.currentTurn;
    secondPlayer = firstPlayer === "Alice" ? "Bob" : "Alice";
  });

  test("initial state has round = 1", () => {
    expect(game.round).toBe(1);
  });

  test("round increments after both players pass their turn", () => {
    game.processAction({ type: "pass-turn", username: firstPlayer }); // Alice -> Bob
    game.processAction({ type: "pass-turn", username: secondPlayer }); // Bob -> round should increment
    expect(game.round).toBe(2);
  });

  test("turn alternates between players", () => {
    expect(game.currentTurn).toBe(firstPlayer);
    game.processAction({ type: "pass-turn", username: firstPlayer });
    expect(game.currentTurn).toBe(secondPlayer);
    game.processAction({ type: "pass-turn", username: secondPlayer });
    expect(game.currentTurn).toBe(firstPlayer);
  });

  test("players start with 1 available shinsu", () => {
    const aliceState = game.playerStates.Alice;
    const bobState = game.playerStates.Bob;
    // Alice
    expect(aliceState.shinsu.normalSpent).toBe(0);
    expect(aliceState.shinsu.normalAvailable).toBe(1);
    expect(aliceState.shinsu.recharged).toBe(0);
    // Bob
    expect(bobState.shinsu.normalSpent).toBe(0);
    expect(bobState.shinsu.normalAvailable).toBe(1);
    expect(bobState.shinsu.recharged).toBe(0);
  });

  test("players gain 2 shinsu at start of round 2 and recharge 1 shinsu from the previous round", () => {
    game.processAction({ type: "pass-turn", username: firstPlayer }); // Alice -> Bob
    game.processAction({ type: "pass-turn", username: secondPlayer }); // Bob -> round 2
    const aliceState = game.playerStates.Alice;
    const bobState = game.playerStates.Bob;
    // Alice
    expect(aliceState.shinsu.normalSpent).toBe(0);
    expect(aliceState.shinsu.normalAvailable).toBe(2);
    expect(aliceState.shinsu.recharged).toBe(1);
    // Bob
    expect(bobState.shinsu.normalSpent).toBe(0);
    expect(bobState.shinsu.normalAvailable).toBe(2);
    expect(bobState.shinsu.recharged).toBe(1);
  });

  test("players start with 4 cards in hand", () => {
    const aliceState = game.playerStates.Alice;
    const bobState = game.playerStates.Bob;
    expect(aliceState.hand.length).toBe(4);
    expect(bobState.hand.length).toBe(4);
  });

  test("players draw a card at the start of their turn", () => {
    game.processAction({ type: "pass-turn", username: firstPlayer }); // Alice -> Bob
    game.processAction({ type: "pass-turn", username: secondPlayer }); // Bob -> round 2
    const aliceState = game.playerStates.Alice;
    const bobState = game.playerStates.Bob;
    expect(aliceState.hand.length).toBe(5);
    expect(bobState.hand.length).toBe(5);
  });

  test("players start with 26 cards in deck (after drawing 4)", () => {
    const aliceState = game.playerStates.Alice;
    const bobState = game.playerStates.Bob;
    expect(aliceState.deck.cards.length).toBe(26);
    expect(bobState.deck.cards.length).toBe(26);
  });
});
