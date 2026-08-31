import { createGameStore } from "../../game/store.js";

describe("createGameStore", () => {
  test("starts empty", () => {
    const store = createGameStore();
    expect(store.state).toBeNull();
  });

  test("holds the latest payload and replaces previous ones", () => {
    const store = createGameStore();
    const init = { revision: 1, round: 1 };
    const update = { revision: 2, round: 2 };

    store.set(init);
    expect(store.state).toBe(init);
    store.set(update);
    expect(store.state).toBe(update);
  });

  test("rejects payloads that are not plain objects", () => {
    const store = createGameStore();
    expect(() => store.set(null)).toThrow(TypeError);
    expect(() => store.set([1, 2])).toThrow(TypeError);
  });

  test("clears the held payload", () => {
    const store = createGameStore();
    store.set({ revision: 1 });
    store.clear();
    expect(store.state).toBeNull();
  });
});
