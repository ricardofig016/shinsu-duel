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
 * The overlay's two relation tiers. The primary tier is the row; the secondary
 * one sits behind a slot the reader clicks. Both halves are wiring that a
 * mistake would hide until someone opened the right card, so the shape is
 * pinned here: the row builder splits the tiers, the overlay substitutes the
 * slot for the cards it stood for, and the slot is a card's footprint or the
 * row's centring arithmetic stops describing the row.
 */
describe("overlay relation tiers", () => {
  const script = fs.readFileSync(path.join(root, "public/components/card-detail-overlay/script.js"), "utf-8");
  const styles = fs
    .readFileSync(path.join(root, "public/components/card-detail-overlay/styles.css"), "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = (selector) => {
    const start = styles.indexOf(`${selector} {`);
    return start === -1 ? "" : styles.slice(start, styles.indexOf("}", start));
  };

  test("the row builder hands back both tiers", () => {
    const row = fs.readFileSync(path.join(root, "public/utils/card-detail-row.js"), "utf-8");
    expect(row).toMatch(/return \{ left, right, more, focusIndex: left\.length \}/);
    // an entry with no tier is held back rather than shown, so a stamp written
    // before the field existed cannot add a card to the default tier
    expect(row).toMatch(/const sinkFor = \(tier\) => \(tier === "primary" \? right : more\)/);
  });

  test("the button is not a slot", () => {
    // A slot is a place a card can be, and the button holds no card. Making it a
    // slot is what put it in reach of the focus, made the row's centering count
    // it, and left a slot-shaped hole in `slots` after the reveal that every
    // later index had to be corrected for.
    expect(script).not.toMatch(/kind: "reveal"/);
    expect(script).not.toMatch(/card-detail-reveal"\s*:/);
    expect(script).not.toMatch(/slots\[revealIndex\]/);
    expect(script).toMatch(/const entries = \[\.\.\.left, \{ kind: "focus", card: model \}, \.\.\.right\];/);
    // it is one element of its own, appended to the overlay rather than to the
    // row, so the row's layout cannot see it
    expect(script).toMatch(/const buildReveal = \(\) => \{[\s\S]{0,700}?root\.appendChild\(button\);/);
    expect(script).toMatch(/const revealButton = more\.length > 0 \? buildReveal\(\) : null;/);
    expect(script).not.toMatch(/row\.appendChild\(button\)/);
    // and nothing classifies slots by whether they hold a card any more
    expect(script).not.toMatch(/isCardSlot/);
    expect(script).not.toMatch(/revealSlotIndex/);
    expect(script).not.toMatch(/nearestCardSlot/);
  });

  test("a step of the focus is a step of one card", () => {
    // A revealed card keeps its true row index, so there is one index space and
    // no translation between the two tiers: this is what the previous version
    // got wrong, where one scroll step from the card before the button landed
    // one card backwards.
    expect(script).toMatch(/const setFocus = \(index\) => \{[\s\S]{0,260}?focusSlotIndex = Math\.max\(0, Math\.min\(slots\.length - 1, index\)\);/);
    expect(script).toMatch(/const secondary = more\.map\(\(entry, offset\) => \(\{ entry, index: revealIndex \+ offset \}\)\)/);
    expect(script).toMatch(/const revealIndex = left\.length \+ right\.length \+ 1;/);
  });

  test("the control is a full-height fade over the right edge", () => {
    // It read as one more card that did not fit, then as a button with a visible
    // left border and the page's own button colour. It is neither: a fade from
    // fully transparent at its left to opaque at the screen edge, top to bottom,
    // with no border and no corner for the eye to read as an edge of its own.
    const rule = (selector) => {
      const at = styles.indexOf(`${selector} {`);
      return at === -1 ? "" : styles.slice(at, styles.indexOf("}", at));
    };
    const fade = rule(".card-detail-reveal");
    expect(fade).toMatch(/position: fixed;/);
    expect(fade).toMatch(/top: 0;/);
    expect(fade).toMatch(/bottom: 0;/);
    expect(fade).toMatch(/right: 0;/);
    expect(fade).toMatch(/linear-gradient\(to right, rgba\(0, 0, 0, 0\), rgba\(0, 0, 0, 0?\.[0-9]+\)\)/);
    expect(fade).toMatch(/cursor: pointer;/);
    // The page styles every `button`, so this must be a div and must reset the
    // chrome either way: the colour and the corner both leaked in once.
    expect(script).toMatch(/const button = document\.createElement\("div"\);\s*\n\s*button\.className = "card-detail-reveal";/);
    expect(fade).toMatch(/all: unset;/);
    expect(fade).toMatch(/background-color: transparent;/);
    expect(fade).not.toMatch(/border-radius/);
    // no card footprint, no card panel, no graded scale
    expect(fade).not.toMatch(/30rem|45rem/);
    expect(fade).not.toMatch(/--s/);
    expect(fade).not.toMatch(/card\/background\.png/);
  });

  test("the button's click opens the tier instead of closing the overlay", () => {
    // the row's click handler closes the overlay for a click that is not on a
    // slot, so the button's own handler has to stop the event there
    expect(script).toMatch(/revealButton\.addEventListener\("click", \(event\) => \{\s*\n\s*event\.stopPropagation\(\);\s*\n\s*void revealMore\(\);/);
  });

  test("the button leaves the row in the frame its click arrives in", () => {
    // Removing it after the cards mount left it on screen beside its own answer
    // for as long as the mounts took, and a guard that could return early in
    // between left it there for good, with nothing left to press.
    expect(script).toMatch(/revealButton\.remove\(\);/);
    expect(script).not.toMatch(/const origin = revealButton/);
    // and nothing between the click and the removal waits on anything
    const beforeMount = script.slice(script.indexOf("revealButton.remove()"), script.indexOf("await Promise.all("));
    expect(beforeMount).not.toMatch(/await /);
  });

  test("opening the tier leaves the focus on the card that took the button's place", () => {
    // the first revealed card stands exactly where the button stood, so the
    // reader keeps their place and the focus lands on a card
    expect(script).toMatch(/revealButton\.remove\(\);[\s\S]*?setFocus\(revealIndex\)/);
    // and the cards come in from beyond the screen edge the fade covers, which is
    // what makes it read as the row continuing into that space
    expect(script).toMatch(/const entryEdge = \(\) => window\.innerWidth;/);
  });

  test("the focus can only ever name a card", () => {
    // every index in the row is a card, so nothing has to be skipped or
    // corrected: the click handler is the only caller of the reveal
    const revealCalls = script.match(/revealMore\(\)/g) ?? [];
    expect(revealCalls).toHaveLength(1);
    expect(script).not.toMatch(/if \(index === revealIndex/);
  });

  test("the button takes no part in the row's layout", () => {
    // It used to be appended to the row, which meant a revealed slot had to be
    // inserted in front of it and the row's order depended on creation order.
    // Outside the row there is no order to get wrong.
    expect(script).not.toMatch(/insertBefore/);
    expect(script).not.toMatch(/row\.appendChild\(button\)/);
    expect(script).toMatch(/row\.appendChild\(slot\);/);
    // and the row's geometry is the stylesheet's declaration, not a slot position
    expect(script).not.toMatch(/unscaledSlot/);
  });

  test("the park and the travel walk the row's own slots", () => {
    // No slot is ever detached, so no walk over the slots skips one for being
    // gone, and the button is not in these sets to begin with.
    const parkBlock = script.slice(script.indexOf("const sideSlots ="), script.indexOf("const gatherSides"));
    expect(parkBlock).not.toMatch(/isConnected/);
    expect(script).toMatch(/const sideSlots = slots\.filter\(\(slot, index\) => index !== focusIndex\);/);
  });

  test("no row position is ever built twice", () => {
    // A slot is appended to the row by `buildSlot`, and the array it lands in is
    // keyed by row index. Building the tier's slots up front and then building
    // them again at the same indices on the reveal appended a second element for
    // every position, so each secondary card was in the row twice while `slots`
    // showed only the newer one. `buildSlot` runs once for the row's own entries
    // and once per secondary entry on the reveal, and nowhere else.
    const calls = script.match(/buildSlot\b/g) ?? [];
    // the definition, the initial pass over the row's entries, and the one
    // inside the reveal
    expect(calls).toHaveLength(3);
    expect(script).toMatch(/entries\.forEach\(buildSlot\);/);
    expect(script).toMatch(/const secondary = more\.map\(\(entry, offset\) => \(\{ entry, index: revealIndex \+ offset \}\)\);\s*\n\s*const fresh = secondary\.map\(\(\{ entry, index \}\) => \{\s*\n\s*const slot = buildSlot\(entry, index\);/);
    // the tier is not in the entries the first pass walks
    expect(script).not.toMatch(/\.\.\.more,\s*\n\s*\];/);
  });

  test("nothing in the row has to survive a slot being gone", () => {
    // the slot array keeps its shape after the reveal because nothing is
    // detached from it: the button was never in it
    expect(script).not.toMatch(/slots\[revealIndex\] = null/);
    expect(script).toMatch(/const slots = \[\];/);
    // and the graded scale applies to every slot, because every slot is a card
    expect(script).toMatch(/slot\.style\.setProperty\("--s", scale\.toFixed\(3\)\);/);
  });

  test("the row's geometry is read in pixels, never converted by hand", () => {
    // The overlay's arithmetic runs on pixels. Reading a declaration that the
    // browser has already resolved and multiplying it by the root font size a
    // second time is what put the focused card off centre on every card of a
    // machine whose numbers did not line up that way, so nothing here converts
    // units and nothing assumes the slot's font size is the root's.
    expect(styles).toMatch(/--card-slot-width: 30;/);
    expect(styles).toMatch(/--card-slot-overlap: 2\.5;/);
    expect(styles).toMatch(/width: calc\(var\(--card-slot-width, 30\) \* 1rem \* var\(--s, 1\)\);/);
    expect(styles).toMatch(/margin-inline: calc\(var\(--card-slot-overlap, 2\.5\) \* -1rem\);/);
    expect(script).not.toMatch(/rootFontSize/);
    expect(script).not.toMatch(/getPropertyValue\("--card-slot-width"\)/);
    expect(script).not.toMatch(/getPropertyValue\("--card-slot-height"\)/);
    // the footprint is the width the browser resolved, divided by the scale it
    // applied, so a slot that is mid-transition cannot skew it
    expect(script).toMatch(/const slotWidth = slots\[0\]\.getBoundingClientRect\(\)\.width;/);
    expect(script).toMatch(/const cardWidth = slotWidth > 0 \? slotWidth \/ slotScale : 0;/);
    expect(script).not.toMatch(/unscaledSlot/);
    expect(script).not.toMatch(/slots\[1\]\.getBoundingClientRect/);
  });

  test("the overlap counts both sides of the slot's margin", () => {
    // `margin-inline` is negative and applies to the slot's start and its end, so
    // two neighbours overlap by twice the margin. Counting one side is a silent
    // error in every offset, and it put the focused card off the middle of the
    // screen on every card at once.
    expect(script).toMatch(/const inlineMarginOf = \(element\) => \{/);
    expect(script).toMatch(/const marginPerSide = Math\.abs\(inlineMarginOf\(slots\[0\]\)\);/);
    expect(script).toMatch(/const slotOverlap = marginPerSide \* 2;/);
    expect(script).toMatch(/const slotInset = -marginPerSide;/);
    expect(script).toMatch(/const baseAdvance = cardWidth - slotOverlap;/);
    // margin-inline is shorthand for two longhands, and which one a browser
    // reports is not something to build arithmetic on
    expect(script).toMatch(/Math\.abs\(px\(style\.marginInlineStart\) \|\| px\(style\.marginLeft\)\)/);
    expect(script).toMatch(/Math\.abs\(px\(style\.marginInlineEnd\) \|\| px\(style\.marginRight\)\)/);
  });

  test("the fade over the right edge stays narrow", () => {
    // It was a quarter of the viewport wide, which read as a panel laid over the
    // row rather than as the screen's edge.
    const at = styles.indexOf(".card-detail-reveal {");
    const fade = at === -1 ? "" : styles.slice(at, styles.indexOf("}", at));
    expect(fade).toMatch(/width: min\(12rem, 14vw\);/);
  });
});

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
