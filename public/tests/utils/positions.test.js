import { jest } from "@jest/globals";
import { buildPlacementSlots, fetchPositions, getPlacementSlots, getPositions } from "../../utils/positions.js";

/**
 * The positions payload as the route serves it: the combat-position catalog
 * keyed by position code, plus `placement` — one entry per line, position slots
 * first and the line's kind slots after them.
 *
 * The pure narrowing is pinned against this registry. The accessor's cache
 * lives on the module instance, so the test that pins the failure path takes an
 * instance of its own through `jest.resetModules()`; the success path is pinned
 * on the page's own instance.
 */
const REGISTRY = {
  frontline: [
    {
      code: "scout",
      kind: "standard",
      lines: ["frontline"],
      name: "Scout",
      iconPath: "/assets/icons/positions/scout.png",
    },
    {
      code: "shinheuh",
      kind: "shinheuh",
      lines: ["frontline"],
      name: "Shinheuh",
      iconPath: "/assets/icons/positions/frontline-shinheuh.png",
    },
  ],
  backline: [
    {
      code: "light-bearer",
      kind: "standard",
      lines: ["backline"],
      name: "Light Bearer",
      iconPath: "/assets/icons/positions/light-bearer.png",
    },
    {
      code: "shinheuh",
      kind: "shinheuh",
      lines: ["backline"],
      name: "Shinheuh",
      iconPath: "/assets/icons/positions/backline-shinheuh.png",
    },
    {
      code: "landmark",
      kind: "landmark",
      lines: ["backline"],
      name: "Landmark",
      iconPath: "/assets/icons/positions/landmark.png",
    },
  ],
};

const PAYLOAD = {
  scout: { code: "scout", name: "Scout", line: "frontline", iconPath: "/assets/icons/positions/scout.png" },
  placement: REGISTRY,
};

const LANDMARK = { kind: "landmark", deployLines: ["backline"] };
const FRONTLINE_SHINHEUH = { kind: "shinheuh", line: "frontline", deployLines: ["frontline"] };
const TWO_LINE_SHINHEUH = { kind: "shinheuh", line: ["backline", "frontline"], deployLines: ["backline", "frontline"] };
const STANDARD = { kind: "standard", deployLines: ["frontline", "backline"], positions: { scout: {} } };

const originalFetch = globalThis.fetch;

/** Stub the page's fetch for one test and put the real one back afterwards. */
const withFetch = async (fetchMock, run) => {
  globalThis.fetch = fetchMock;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
};

describe("buildPlacementSlots", () => {
  test("shows a landmark the landmark slot, not the positions beside it", () => {
    expect(buildPlacementSlots(REGISTRY, LANDMARK)).toEqual([
      {
        code: "landmark",
        kind: "landmark",
        lines: ["backline"],
        name: "Landmark",
        iconPath: "/assets/icons/positions/landmark.png",
        line: "backline",
      },
    ]);
  });

  test("paints a shinheuh with its line's own icon", () => {
    // The per-line icons are why the slot is the only source: there is no
    // backline-landmark.png to derive from the kind and the line.
    expect(buildPlacementSlots(REGISTRY, FRONTLINE_SHINHEUH).map((slot) => slot.iconPath)).toEqual([
      "/assets/icons/positions/frontline-shinheuh.png",
    ]);
  });

  test("offers a hand card one slot per line it may deploy to, in that order", () => {
    expect(buildPlacementSlots(REGISTRY, TWO_LINE_SHINHEUH).map((slot) => slot.line)).toEqual([
      "backline",
      "frontline",
    ]);
    expect(buildPlacementSlots(REGISTRY, TWO_LINE_SHINHEUH).map((slot) => slot.iconPath)).toEqual([
      "/assets/icons/positions/backline-shinheuh.png",
      "/assets/icons/positions/frontline-shinheuh.png",
    ]);
  });

  test("narrows a deployed unit to the line it occupies", () => {
    expect(buildPlacementSlots(REGISTRY, TWO_LINE_SHINHEUH, { line: "frontline" })).toEqual([
      {
        code: "shinheuh",
        kind: "shinheuh",
        lines: ["frontline"],
        name: "Shinheuh",
        iconPath: "/assets/icons/positions/frontline-shinheuh.png",
        line: "frontline",
      },
    ]);
  });

  test("answers a standard unit with nothing: its printed positions are its own", () => {
    expect(buildPlacementSlots(REGISTRY, STANDARD)).toEqual([]);
    expect(buildPlacementSlots(REGISTRY, {})).toEqual([]);
    expect(buildPlacementSlots(REGISTRY, null)).toEqual([]);
  });

  test("answers a kind the registry carries no slot for with nothing", () => {
    expect(buildPlacementSlots(REGISTRY, { kind: "conduit", deployLines: ["backline"] })).toEqual([]);
    expect(buildPlacementSlots(REGISTRY, LANDMARK, { line: "frontline" })).toEqual([]);
    expect(buildPlacementSlots(REGISTRY, { kind: "landmark" })).toEqual([]);
    expect(buildPlacementSlots(undefined, LANDMARK)).toEqual([]);
  });

  test("copies the slot rather than aliasing the registry", () => {
    const [slot] = buildPlacementSlots(REGISTRY, LANDMARK);

    expect(slot).not.toBe(REGISTRY.backline[2]);
    expect(REGISTRY.backline[2]).not.toHaveProperty("line");
  });
});

describe("fetchPositions", () => {
  test("resolves the payload whole, `placement` included", async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, json: async () => PAYLOAD }));

    const payload = await withFetch(fetchMock, () => fetchPositions());

    expect(payload).toBe(PAYLOAD);
    expect(payload.placement).toBe(REGISTRY);
    expect(fetchMock).toHaveBeenCalledWith("/positions/");
  });

  test("fails loudly on a response that carries no catalog", async () => {
    const fetchMock = jest.fn(async () => ({ ok: false, status: 503 }));

    await withFetch(fetchMock, async () => {
      await expect(fetchPositions()).rejects.toThrow("GET /positions/ failed: 503");
    });
  });
});

describe("the page's shared positions fetch", () => {
  test("answers every caller from one payload", async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, json: async () => PAYLOAD }));

    await withFetch(fetchMock, async () => {
      // The board splits this by name, so `placement` has to survive whole.
      const payload = await getPositions();
      expect(payload).toBe(PAYLOAD);
      expect(payload.placement).toBe(REGISTRY);
      expect(await getPositions()).toBe(payload);

      // The card faces read the same cached registry: no second request.
      expect(await getPlacementSlots(LANDMARK, { line: "backline" })).toEqual([
        { ...REGISTRY.backline[2], line: "backline" },
      ]);
      expect(await getPlacementSlots(STANDARD)).toEqual([]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  test("costs the chip, not the card face, when the catalog is unavailable", async () => {
    // A failure is cached on the module instance, so this path needs its own.
    jest.resetModules();
    const positions = await import("../../utils/positions.js");
    const fetchMock = jest.fn(async () => ({ ok: false, status: 500 }));
    const errors = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      await withFetch(fetchMock, async () => {
        await expect(positions.getPositions()).rejects.toThrow("GET /positions/ failed: 500");
        expect(await positions.getPlacementSlots(LANDMARK, { line: "backline" })).toEqual([]);
        // A cached failure is not refetched either.
        expect(fetchMock).toHaveBeenCalledTimes(1);
      });
    } finally {
      errors.mockRestore();
    }
  });
});
