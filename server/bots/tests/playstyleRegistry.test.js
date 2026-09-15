import { createPlaystyleRegistry } from "../playstyleRegistry.js";

describe("playstyleRegistry", () => {
  test("resolves every registered playstyle with the playstyle contract", () => {
    const registry = createPlaystyleRegistry();
    expect(registry.names()).toEqual(expect.arrayContaining(["whatever", "drunk"]));

    for (const id of registry.names()) {
      const playstyle = registry.get(id);
      expect(typeof playstyle.decideTurn).toBe("function");
      expect(typeof playstyle.resolveDecision).toBe("function");
    }
  });

  test("returns a single shared instance per id", () => {
    const registry = createPlaystyleRegistry();
    expect(registry.get("drunk")).toBe(registry.get("drunk"));
  });

  test("reports membership", () => {
    const registry = createPlaystyleRegistry();
    expect(registry.has("whatever")).toBe(true);
    expect(registry.has("nope")).toBe(false);
  });

  test("throws for an unknown playstyle", () => {
    const registry = createPlaystyleRegistry();
    expect(() => registry.get("easy")).toThrow('Unknown bot playstyle: "easy"');
  });
});
