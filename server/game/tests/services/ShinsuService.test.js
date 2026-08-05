import ShinsuService from "../../services/ShinsuService.js";

describe("ShinsuService", () => {
  test("reset fills normal pool to round cap and carries over recharged", () => {
    const state = { shinsu: { normalAvailable: 3, recharged: 2, normalSpent: 0 } };
    ShinsuService.reset(state, 5);
    expect(state.shinsu.normalAvailable).toBe(5);
    expect(state.shinsu.recharged).toBe(2); // unspent was 5, carry max 2
  });

  test("reset caps normal pool at 10", () => {
    const state = { shinsu: { normalAvailable: 0, recharged: 0, normalSpent: 0 } };
    ShinsuService.reset(state, 12);
    expect(state.shinsu.normalAvailable).toBe(10);
  });

  test("spend deducts recharged first", () => {
    const state = { shinsu: { normalAvailable: 5, recharged: 2, normalSpent: 0 } };
    ShinsuService.spend(state, 3);
    expect(state.shinsu.recharged).toBe(0);
    expect(state.shinsu.normalAvailable).toBe(4);
  });

  test("getTotal sums both pools", () => {
    const state = { shinsu: { normalAvailable: 5, recharged: 2 } };
    expect(ShinsuService.getTotal(state)).toBe(7);
  });

  test("canAfford returns correct boolean", () => {
    const state = { shinsu: { normalAvailable: 3, recharged: 1 } };
    expect(ShinsuService.canAfford(state, 4)).toBe(true);
    expect(ShinsuService.canAfford(state, 5)).toBe(false);
  });

  test("gain caps at round max", () => {
    const state = { shinsu: { normalAvailable: 3, recharged: 0 } };
    ShinsuService.gain(state, 5, 5); // round 5, max normal = 5
    expect(state.shinsu.normalAvailable).toBe(5); // capped
  });
});
