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
 * symptom). Each component's markup must also load its own stylesheet, because
 * `loadComponent` injects only `index.html`: a component that forgets the
 * `<link>` renders unstyled (the card detail overlay once stacked its cards
 * vertically and ignored every pointer and key interaction as a result). This
 * contract reads the real files so those wiring mistakes fail here instead of
 * in the browser.
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

  test.each(registry)("%s markup links its own stylesheet", (component) => {
    const folder = path.join(root, "public/components", component);
    if (!fs.existsSync(path.join(folder, "styles.css"))) return;
    const markup = fs.readFileSync(path.join(folder, "index.html"), "utf-8");
    expect(markup).toContain(`/components/${component}/styles.css`);
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

/**
 * A tooltip can carry another component's markup as an entry node: a card
 * link's hover shows a whole card face. Element selectors in the tooltip
 * stylesheet reach into that markup, so `.tooltip-frame h1` once sized the
 * preview card's cost circle from the tooltip's own title: the circle took
 * 2rem, grew until it filled the card, and squeezed the card's text area to
 * zero height. Every tooltip rule must therefore end in a class the tooltip
 * itself owns.
 */
describe("tooltip stylesheet scope", () => {
  const styles = fs
    .readFileSync(path.join(root, "public/components/tooltip/styles.css"), "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors = [...styles.matchAll(/([^{}]+)\{/g)]
    .map((match) => match[1].trim())
    .flatMap((selectorList) => selectorList.split(",").map((selector) => selector.trim()))
    .filter((selector) => selector !== "" && !selector.startsWith("@"));

  test("finds the stylesheet's rules", () => {
    expect(selectors.length).toBeGreaterThan(5);
  });

  test.each(selectors)("%s targets a tooltip class", (selector) => {
    const rightmost = selector.split(/[\s>+~]+/).filter(Boolean).pop() ?? "";
    expect(rightmost).toContain(".");
  });
});

/**
 * The overlay row must not keep itself promoted. With `will-change: transform`
 * on the row the browser rasterized the cards inside it at whatever scale the
 * graded animation last asked for and never re-rasterized them, so a card that
 * had animated its scale stayed at 74% of the sharpness of a freshly rendered
 * copy of itself (measured pixel for pixel against a byte-identical reference).
 * The transition promotes the row for its own duration, which is all it needs.
 */
describe("overlay row rendering", () => {
  const styles = fs
    .readFileSync(path.join(root, "public/components/card-detail-overlay/styles.css"), "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  test("the row does not promote itself", () => {
    expect(styles).not.toMatch(/will-change/);
  });
});

/**
 * Wiring order that the browser depends on, checked here because a mistake is
 * invisible until the page is slow or a stylesheet is cold.
 */
describe("render order", () => {
  test("a component renders only after its own stylesheet is applied", () => {
    // Markup is laid out unstyled until its <link> loads, and renderers measure
    // geometry: the overlay once read a full-width unstyled slot as its card
    // width and opened every row off center.
    const stylesheets = source.indexOf("await awaitStylesheets(container)");
    const render = source.indexOf("components[component].load(container, data)");
    expect(stylesheets).toBeGreaterThan(-1);
    expect(render).toBeGreaterThan(-1);
    expect(stylesheets).toBeLessThan(render);
  });

  test("a card preview is built in a rendered host", () => {
    // A card fits its own text while it renders, so the preview must be laid
    // out before the card loads: detached, every fit inside it measures zero
    // and the card shows its text at full size with the last lines clipped.
    const dom = fs.readFileSync(path.join(root, "public/utils/card-text-dom.js"), "utf-8");
    const host = dom.indexOf("offscreenHost().appendChild(host)");
    const load = dom.indexOf('loadComponent(host, "card-vertical"');
    expect(host).toBeGreaterThan(-1);
    expect(load).toBeGreaterThan(-1);
    expect(host).toBeLessThan(load);
  });
});
