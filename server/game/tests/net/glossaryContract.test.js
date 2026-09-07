import { createNetHarness } from "./harness.js";
import { RANKS } from "../../ranks.js";

/**
 * Contract test for the tooltip glossary route: the frontend's only source of
 * tooltip copy outside the card views. Booted through the real express app so
 * routing, composition, and status behave exactly as in the browser.
 */

describe("GET /glossary: the client tooltip copy contract", () => {
  let harness;

  beforeAll(async () => {
    harness = await createNetHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  test("serves every section and entry the frontend consumes", async () => {
    const response = await fetch(`${harness.baseUrl}/glossary/`);
    expect(response.ok).toBe(true);
    const glossary = await response.json();

    for (const code of ["unit", "skill", "equipment"]) {
      expect(glossary.types[code]).toEqual(
        expect.objectContaining({ name: expect.any(String), description: expect.any(String) })
      );
    }
    for (const code of ["standard", "shinheuh", "landmark", "conduit"]) {
      expect(glossary.kinds[code]).toEqual(
        expect.objectContaining({ name: expect.any(String), description: expect.any(String) })
      );
    }
    for (const code of ["passives", "evolve", "ignition", "requirements"]) {
      expect(glossary.concepts[code]).toEqual(
        expect.objectContaining({ name: expect.any(String), description: expect.any(String) })
      );
    }
    for (const code of [
      "shinsuCard",
      "shinsuBoard",
      "rechargedShinsu",
      "hpCurrent",
      "hpMax",
      "lighthouses",
      "fireCharges",
      "deck",
    ]) {
      expect(glossary.hud[code]).toBeTruthy();
    }
    expect(glossary.hud.deck.textTemplate).toContain("{count}");
    expect(typeof glossary.hud.chosenSuffix).toBe("string");
    for (const code of ["frontline", "backline"]) {
      expect(glossary.lines[code].label).toBeTruthy();
    }
  });

  test("composes rank entries from the canonical rank catalog", async () => {
    const response = await fetch(`${harness.baseUrl}/glossary/`);
    const { ranks } = await response.json();

    expect(ranks.title).toBe("Rank");
    expect(ranks.concept).toBeTruthy();
    expect(ranks.list.map((rank) => rank.code)).toEqual(Object.keys(RANKS));
    for (const rank of ranks.list) {
      expect(rank.name).toBe(RANKS[rank.code].name);
      expect(rank.minCost).toBe(RANKS[rank.code].minCost);
      expect(rank.maxCost).toBe(RANKS[rank.code].maxCost);
      expect(rank.description).toBeTruthy();
    }
  });
});
