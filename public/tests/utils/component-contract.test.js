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

/**
 * Tooltip lifetime has two halves: the rule (pure, in `tooltip-lifetime.js`) and
 * the observation that feeds it. A host that removes its subtree never fires the
 * `mouseout` that hides the frame, so a body-mounted tooltip stays painted over
 * the page; pruning only inside the next mount left a closed overlay's tooltip
 * on screen until something else mounted one. The layer must therefore watch the
 * document itself — and still keep a loading tooltip alive, because removing it
 * aborts the stylesheet its renderer waits on.
 */
describe("tooltip lifetime trigger", () => {
  test("the layer prunes on the document's changes, not only on mount", () => {
    expect(source).toMatch(/new MutationObserver\(schedulePrune\)/);
    expect(source).toMatch(/\.observe\(document\.body, \{ childList: true, subtree: true \}\)/);
    // changes in one task share a pass: a card mounts about ten tooltips and each
    // one changes the document, so a pass per change walked the mounted set once
    // per tooltip that was mounting
    expect(source).toMatch(/if \(pruneScheduled\) return;/);
    expect(source).toMatch(/queueMicrotask\(\(\) => \{/);
  });

  test("a tooltip that settles after its target left is dropped then", () => {
    const settledAt = source.indexOf("mounted.settled = true");
    expect(settledAt).toBeGreaterThan(-1);
    const settleHandler = source.slice(settledAt, settledAt + 320);
    // the drop is decided for the tooltip that was still loading, and a pass the
    // settle latch deferred is run
    expect(settleHandler).toMatch(/if \(!mounted\.target\.isConnected\) \{/);
    expect(settleHandler).toMatch(/mountedTooltips\.delete\(mounted\)/);
    expect(settleHandler).toMatch(/if \(pruneDeferred\) pruneTooltips\(\)/);
  });

  test("a mount does not walk the whole mounted set", () => {
    // pruning on every mount is what made a ten-card row pay for every tooltip
    // already on the page, about a hundred times over
    const mountAt = source.indexOf("export const mountTooltip");
    const mountBody = source.slice(mountAt, source.indexOf("export const releaseTooltip"));
    expect(mountBody).not.toMatch(/pruneTooltips\(\);\s*\n\s*const element/);
  });
});

/**
 * The card's back face and the click that turns it over. The card is DOM code
 * without a harness, so the wiring is pinned here: the markup the back renders
 * into, the module that owns the turn, and the hosts that must not turn a card
 * over because they already own the left click.
 */
/**
 * The card's back face and the click that turns it over. The card is DOM code
 * without a harness, so the wiring is pinned here: the markup the back renders
 * into, how its sections are divided into faces, the module that owns the turn,
 * and the hosts that must not turn a card over because they already own the left
 * click.
 */
describe("card flip", () => {
  const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf-8");
  const flip = read("public/utils/card-flip.js");
  const cardScript = read("public/components/card-vertical/script.js");
  const markup = read("public/components/card-vertical/index.html");
  const styles = read("public/components/card-vertical/styles.css");

  test("the card markup carries a back face that mirrors the front's header row", () => {
    expect(markup).toContain("card-vertical-back-type-letter");
    expect(markup).toContain("card-vertical-back-name");
    expect(markup).toContain("card-vertical-back-pages");
    expect(markup).toContain("card-vertical-back-sections");
    // the back is the front's panel system again, so both faces are one card
    expect(styles).toMatch(/\.card-vertical-back-frame \{\n  display: none;/);
    expect(styles).toMatch(/\.card-vertical-back \{[\s\S]*?background-image: url\("\/assets\/images\/card\/background\.png"\)/);
  });

  test("the back divides the card's sections into faces instead of fitting them to one", () => {
    // a break only ever lands between two sections, and no face is empty
    expect(cardScript).toMatch(/if \(!fits && page\.length > 0\) \{/);
    expect(cardScript).toContain("paginateBack(list, sections)");
    // the count the turn reads is written where the turn can see it
    expect(cardScript).toMatch(/frame\.dataset\.backPages = String\(breaks\.length\)/);
  });

  test("nothing on the back is resized to force a fit", () => {
    const back = cardScript.slice(cardScript.indexOf("const renderBack ="));
    // the fit's floor is for a box whose size must not move the card's geometry;
    // a face is never shrunk to a floor and clipped instead of opening another
    expect(back).not.toContain("fitFontSize");
    expect(back).not.toMatch(/min\s*:/);
    // a section and a line keep their natural height and are never clipped
    const rule = (selector) => styles.slice(styles.indexOf(`${selector} {`), styles.indexOf("}", styles.indexOf(`${selector} {`)));
    expect(rule(".card-vertical-back-section")).not.toContain("overflow: hidden");
    expect(rule(".card-vertical-back-line")).not.toContain("overflow: hidden");
  });

  test("the turn is motion the host cannot switch off, and respects reduced motion", () => {
    // a CSS transition on the frame is inherited from the host: the card detail
    // overlay sets `transition: none` on its cards, which is what left the big
    // card snapping edge-on while the small one animated
    expect(flip).toContain("frame.animate(");
    expect(flip).toContain("rotate:");
    expect(flip).toContain("EDGE_ON");
    expect(flip).toContain("prefersReducedMotion()");
    expect(styles).not.toMatch(/transition:[^;]*rotate/);
  });

  test("the click advances to the next face and returns to the front past the last", () => {
    expect(flip).toMatch(/const nextPage = showingBack \? currentBackPage\(container\) \+ 1 : currentBackPage\(container\)/);
    expect(flip).toMatch(/frame\.classList\.toggle\("card-vertical-flipped", back\)/);
  });

  test("returning to the front starts the back again from its first face", () => {
    // without this the face index kept the last page it had read, so the next
    // turn landed on the last face and every earlier face was unreachable
    expect(flip).toMatch(/stayingOnBack\s*\n?\s*\? \{ page: nextPage, back: true \}\s*\n?\s*: \{ page: 1, back: false \}/);
    expect(flip).toMatch(/container\.__backPage = page;\s*\n\s*container\.__renderBackPage\?\.\(page, true\)/);
  });

  test("a click that is not on a turned card puts that card's back away", () => {
    expect(flip).toMatch(/resetAllCardFlips\(event\.target\?\.closest\?\.\("\.card-vertical-frame"\) \?\? null\)/);
    expect(flip).toMatch(/export const resetAllCardFlips = \(except = null\)/);
  });

  test("a host that lays cards out tells the card where the pointer is", () => {
    // a card that turns paints nothing while edge-on, so the browser's own hover
    // is cleared on the way through and a card clicked under a motionless cursor
    // came to rest at its un-hovered size
    expect(flip).toContain("export const trackCardHover = (container)");
    expect(flip).toMatch(/closest\.classList\.add\("card-vertical-hovered"\)/);
    // the card already marked keeps the mark while the pointer is inside it, or a
    // grown card hands it to a neighbour underneath and stays stuck grown
    expect(flip).toMatch(/if \(current && inside\(current\.rect, event\)\) return;/);
    // and the cards' boxes are read when the mark moves, not on every pointer
    // event, or a grid of a hundred cards pays a hundred layout reads per move
    expect(flip).toMatch(/boxes = measure\(\);/);
    expect(read("public/utils/card-grid.js")).toMatch(/trackCardHover\(gridElement\)/);
    expect(read("public/pages/game/script.js")).toMatch(/classList\.toggle\("card-vertical-hovered", card === closestCard\)/);
    // and the stylesheet reads that class as the hover it stands in for
    expect(styles).toMatch(/\.card-vertical-component\.card-vertical-hovered \.card-vertical-frame\.card-vertical-small:not\(\.no-hover\)/);
  });

  test("the turned card shows one frame, not a frame inside a frame", () => {
    // the back face is a panel inside the frame's own border; giving the face
    // wrapper its own frame drew a second border inside the first
    const rule = styles.slice(styles.indexOf(".card-vertical-back-frame {"), styles.indexOf("}", styles.indexOf(".card-vertical-back-frame {")));
    expect(rule).not.toContain("background-image");
    expect(rule).not.toContain("padding");
    expect(rule).not.toContain("border-radius");
  });

  test("the big card's centring is not part of its transform", () => {
    // a `translate()` inside `transform` shifts the centre the card's turn
    // rotates about, so the card swung around its left edge; as the frame's own
    // `translate` property it composes ahead of the rotation and the turn pivots
    // on the card's middle
    const overlayStyles = read("public/components/card-detail-overlay/styles.css");
    const rule = overlayStyles.slice(
      overlayStyles.indexOf(".card-detail-slot .card-vertical-frame.card-vertical-big {"),
      overlayStyles.indexOf("}", overlayStyles.indexOf(".card-detail-slot .card-vertical-frame.card-vertical-big {"))
    );
    expect(rule).toMatch(/translate: 50% 50%;/);
    expect(rule).toMatch(/transform: scale\(var\(--s, 1\)\)/);
    expect(rule).not.toMatch(/transform:[^;]*translate\(/);
    // and the entrance zoom states the same placement, so nothing is doubled or
    // left offset when its animation ends
    expect(read("public/components/card-detail-overlay/script.js")).toMatch(/const BASE_TRANSFORM = "scale\(1\)";/);
  });

  test("the card renders the back from the header list and wires its own click", () => {
    expect(cardScript).toContain("buildCardBackSections(model, glossary)");
    expect(cardScript).toContain("wireCardFlipClick(container)");
    expect(cardScript).toContain("setCardFlipClickable(container, flipOnClick !== false)");
    // both faces draw the type icon and fit the name through one renderer each
    expect(cardScript).toMatch(/loadTypeLetter\(backFrame, model, glossary\)/);
    expect(cardScript).toMatch(/loadName\(backFrame, "\.card-vertical-back-name", model\.name, model\.sobriquet\)/);
  });

  test("a click on an ability line is a play, not a card turn", () => {
    expect(flip).toMatch(/closest\?\.\("\.card-vertical-text li\.clickable"\)/);
  });

  test("a host that owns the left click turns the card's own click off", () => {
    // the deck builder's pool (a click adds a copy), a deck-table fan (its row
    // opens or locks the deck), and a link preview (a transient hover surface)
    expect(read("public/utils/deck-table.js")).toContain("flipOnClick: false");
    expect(read("public/utils/card-text-dom.js")).toContain("flipOnClick: false");
    expect(read("public/pages/decks/script.js")).toContain("flipOnClick: false");
    // the shared grid passes the caller's choice through to the card
    expect(read("public/utils/card-grid.js")).toMatch(/loadComponent\(element, "card-vertical", \{ card: view, isSmall: true, flipOnClick \}\)/);
  });

  test("the overlay lets only the card in focus turn over, and returns the rest to the front", () => {
    const overlay = read("public/components/card-detail-overlay/script.js");

    expect(overlay).toMatch(/setCardFlipClickable\(slot, focused\)/);
    // placing a card is not a turn: a card that is not in focus goes back to its
    // front without animating there
    expect(overlay).toMatch(/if \(!focused\) resetCardFlip\(slot\)/);
    expect(overlay).not.toContain("setCardFlipped");
  });

  test("the page's own scripts name no removed interaction class", () => {
    // the board used to take pointer events off the whole page for the length of
    // a drag, which cancelled hover everywhere until the pointer moved again
    for (const file of ["public/pages/game/script.js", "public/pages/game/styles.css", "public/global.css"]) {
      expect(read(file)).not.toContain("no-interaction");
    }
    expect(read("public/global.css")).toMatch(/body\.dragging \{/);
  });

  test("the card states its own heading scale, so no page can set it", () => {
    // the cards page styles `.cards-section h2` (specificity 0,1,1), which beat
    // `.card-vertical-back-label` (0,1,0) and drew the back's section labels at
    // the page's heading size inside a card whose own type is a fraction of that
    for (const selector of [
      ".card-vertical-frame .card-vertical-back-label",
      ".card-vertical-frame .card-vertical-back-line",
      ".card-vertical-frame .card-vertical-back-name",
      ".card-vertical-frame .card-vertical-back-pages",
      ".card-vertical-frame .card-vertical-shinsu",
      ".card-vertical-frame .card-vertical-hp",
    ]) {
      expect(styles).toContain(selector);
    }
    // The face's own headings are what a page's h2 rule would otherwise reach:
    // the markup's page counter is an h2, and the section labels the renderer
    // builds for each section are h2 as well.
    expect(markup).toContain('<h2 class="card-vertical-back-pages">');
    expect(cardScript).toMatch(/document\.createElement\("h2"\)/);
  });

  test("a hand card is hidden only once the drag actually starts", () => {
    const game = read("public/pages/game/script.js");

    // hiding it on mousedown took it out of hit testing, so a card clicked in
    // the hand came to rest at its un-hovered size under a motionless cursor
    expect(game).toMatch(/if \(!moved && Math\.hypot\([\s\S]{0,160}cardDiv\.classList\.add\("invisible"\)/);
    expect(game).toMatch(/if \(!moved\) toggleCardFlip\(cardDiv\)/);
  });
});

/**
 * An ability clicked in the card detail overlay is an action on the board the
 * overlay covers: the page's handler plays it, and the overlay then has to get
 * out of the way of the target the player picks next.
 */
describe("overlay ability clicks", () => {
  const overlay = fs.readFileSync(path.join(root, "public/components/card-detail-overlay/script.js"), "utf-8");

  test("run the page's handler and dismiss the overlay", () => {
    const wrapper = /const abilityClick = onAbilityClick([\s\S]*?)\n    : null;/.exec(overlay);
    expect(wrapper).not.toBeNull();
    expect(wrapper[1]).toMatch(/onAbilityClick\(/);
    expect(wrapper[1]).toMatch(/close\(\)/);
  });

  test("the focus unit is rendered with that handler", () => {
    expect(overlay).toMatch(/onAbilityClick: abilityClick/);
  });
});
