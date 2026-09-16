import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Component registry contract.
 *
 * `component-util.js` imports every component module statically and calls its
 * default export. A single module without a default export therefore takes the
 * whole graph down: the browser rejects the module, and every component on the
 * page stops rendering, not just the broken one (a missing navbar was the
 * symptom). This contract reads the real files so that class of wiring mistake
 * fails here instead of in the browser.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const utilPath = path.join(root, "public/utils/component-util.js");
const source = fs.readFileSync(utilPath, "utf-8");

const registry = [...source.matchAll(/["']?([a-z][a-z-]*)["']?:\s*\{\s*load:/g)].map((m) => m[1]);

describe("component registry", () => {
  test("registers the components the pages load", () => {
    expect(registry.length).toBeGreaterThan(0);
    expect(new Set(registry).size).toBe(registry.length);
  });

  test.each(registry)("%s has a default-exporting module and markup", (component) => {
    const folder = path.join(root, "public/components", component);
    expect(fs.existsSync(path.join(folder, "index.html"))).toBe(true);

    const scriptPath = path.join(folder, "script.js");
    expect(fs.existsSync(scriptPath)).toBe(true);
    const script = fs.readFileSync(scriptPath, "utf-8");
    expect(script).toMatch(/export\s+default\s/);
  });

  test("every import in the registry is a default import", () => {
    for (const line of source.split(/\r?\n/)) {
      const match = /^import\s+(.+?)\s+from\s+"\/components\/([a-z-]+)\/script\.js";/.exec(line.trim());
      if (!match) continue;
      // no braces means a default import, which is what the registry stores
      expect(match[1]).not.toContain("{");
      expect(registry).toContain(match[2]);
    }
  });
});
