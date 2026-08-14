import SeededRng, { generateSeed } from "../../utils/SeededRng.js";

describe("SeededRng", () => {
  test("same seed produces the identical sequence", () => {
    const a = new SeededRng(42);
    const b = new SeededRng(42);
    for (let i = 0; i < 100; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  test("different seeds produce different sequences", () => {
    const a = new SeededRng(1);
    const b = new SeededRng(2);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  test("values are within [0, 1)", () => {
    const rng = new SeededRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test("getState returns seed and calls count", () => {
    const rng = new SeededRng(9);
    rng.next();
    rng.next();
    expect(rng.getState()).toEqual({ seed: 9, calls: 2 });
  });

  test("restoreState reproduces the identical continuation", () => {
    const original = new SeededRng(123);
    // Advance a few draws, then capture state.
    original.next();
    original.next();
    original.next();
    const state = original.getState();
    const expected = Array.from({ length: 10 }, () => original.next());

    const restored = new SeededRng(0);
    restored.restoreState(state);
    const actual = Array.from({ length: 10 }, () => restored.next());

    expect(actual).toEqual(expected);
  });

  test("restoreState validates its argument", () => {
    const rng = new SeededRng(1);
    expect(() => rng.restoreState(null)).toThrow("requires { seed, calls }");
    expect(() => rng.restoreState({})).toThrow("requires { seed, calls }");
  });
});

describe("generateSeed", () => {
  test("returns an integer in [0, 2^32 - 1]", () => {
    for (let i = 0; i < 100; i++) {
      const seed = generateSeed();
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(0x100000000);
    }
  });
});
