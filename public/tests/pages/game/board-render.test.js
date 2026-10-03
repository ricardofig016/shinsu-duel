import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The board's render contract.
 *
 * Every snapshot is the whole board, and the board used to rebuild every card
 * for it: measured across a turn change, the hand was painted half-built (its
 * card count dipped below the real hand five times), the deck stack was
 * re-created 20 cards per side per update, and roughly 270 tooltips were
 * mounted per update. A turn change delivers several snapshots in a row, so the
 * screen flashed. The page is DOM code without a harness, so the two rules that
 * keep that from happening are pinned here.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const source = fs.readFileSync(path.join(root, "public/pages/game/script.js"), "utf-8");

/** The body of one renderer, from its declaration to its closing brace. */
const rendererBody = (name) => {
  const start = source.indexOf(`const ${name} = `);
  const end = source.indexOf("\n};", start);
  if (start < 0 || end < 0) throw new Error(`renderer ${name} not found`);
  return source.slice(start, end);
};

const RENDERERS = ["renderDecks", "renderFields", "renderHands", "renderCombatSlots"];

describe("board rendering", () => {
  test.each(RENDERERS)("%s never empties its container", (name) => {
    // clearing the container is what made the hand blink through a half-built
    // state and re-mounted every tooltip in it
    expect(rendererBody(name)).not.toMatch(/innerHTML\s*=\s*""/);
  });

  test.each(RENDERERS)("%s reconciles the elements it mounted", (name) => {
    const body = rendererBody(name);
    expect(body).toContain("elementsOf(");
    expect(body).toContain("dropUnwanted(");
  });

  test("a snapshot arriving mid-render replaces the pending one", () => {
    const schedule = source.slice(
      source.indexOf("let pendingState = null"),
      source.indexOf("socket.on(EVENTS.GAME_INIT, scheduleRender)")
    );

    expect(schedule).toContain("pendingState = payload");
    expect(schedule).toMatch(/if \(rendering\) return;/);
    expect(schedule).toMatch(/while \(pendingState\)/);
  });

  test("the deck stack costs no component mount", () => {
    expect(rendererBody("renderDecks")).not.toContain("loadComponent(");
  });

  test("a unit card is remounted only when what it shows changed", () => {
    expect(rendererBody("renderFields")).toMatch(/if \(mounted\.signature !== signature\)/);
  });

  test("a hand press that never moved turns the card over", () => {
    // mousedown clones the drag ghost, so the card itself never sees a click
    // event and the page is what turns it over
    expect(source).toContain("DRAG_THRESHOLD_PX");
    expect(source).toMatch(/if \(!moved\) toggleCardFlip\(cardDiv\)/);
  });

  test("the card the press landed on is hidden only once the drag starts", () => {
    // hiding it on mousedown took it out of hit testing: it stopped matching
    // `:hover`, and the browser does not re-hit-test until the pointer moves
    // again, so the card stayed at its un-hovered size under a motionless cursor
    const drag = source.slice(source.indexOf("const beginCardDrag ="), source.indexOf("const renderHands ="));
    expect(drag).toMatch(/if \(!moved && Math\.hypot\([^)]*\) > DRAG_THRESHOLD_PX\) \{[\s\S]{0,120}cardDiv\.classList\.add\("invisible"\)/);
    // the drag's own lock keeps text under the ghost unselectable, and no longer
    // takes pointer events off the whole page
    expect(source).toMatch(/document\.body\.classList\.add\("dragging"\)/);
    expect(source).not.toContain("no-interaction");
  });
});
