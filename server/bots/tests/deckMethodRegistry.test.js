import { createDeckMethodRegistry } from "../deckMethodRegistry.js";

describe("deckMethodRegistry", () => {
  test("resolves every registered deck method with the method contract", () => {
    const registry = createDeckMethodRegistry();
    expect(registry.names()).toEqual(expect.arrayContaining(["mirror", "random-owned", "generated"]));

    for (const id of registry.names()) {
      const method = registry.get(id);
      expect(typeof method.resolve).toBe("function");
    }
  });

  test("returns a single shared instance per id", () => {
    const registry = createDeckMethodRegistry();
    expect(registry.get("mirror")).toBe(registry.get("mirror"));
  });

  test("reports membership", () => {
    const registry = createDeckMethodRegistry();
    expect(registry.has("generated")).toBe(true);
    expect(registry.has("specific")).toBe(false);
  });

  test("throws for an unknown deck method", () => {
    const registry = createDeckMethodRegistry();
    expect(() => registry.get("easy")).toThrow('Unknown bot deck method: "easy"');
  });
});
