import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The decks page's list ordering.
 *
 * `compareDecks` reads `name`, `averageCost`, and `id` off the objects it is
 * handed. The page once ordered its DOM wrappers instead of the row models they
 * carry, so every comparison tied on `undefined` and the list kept whatever
 * order it was built in, whatever the sort select said. The page is DOM code
 * without a test harness, so the wiring is checked here, the way the shared
 * component contracts are (see `component-contract.test.js`).
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const source = fs.readFileSync(path.join(root, "public/pages/decks/script.js"), "utf-8");
const syncTable = source.slice(source.indexOf("const syncDeckTable"), source.indexOf("const duplicateDeck"));

describe("deck list ordering", () => {
  // the field a collected entry carries its row model under, read from the
  // comparator itself so a rename follows instead of breaking the test
  const comparator = /compareDecks\(([^)]*)\)\(\s*a\.(\w+)\s*,\s*b\.(\w+)\s*\)/.exec(syncTable);
  const rowField = comparator?.[2] ?? "row";

  test("orders the row model the table renders", () => {
    expect(comparator).not.toBeNull();
    expect(comparator[2]).toBe(comparator[3]);
    expect(comparator[2]).toBe("row");
  });

  test("keeps that row model beside the element it renders", () => {
    expect(source).toMatch(/deckRows\.set\(deck\.id, \{[^}]*\brow\b[^}]*\}\)/);
  });

  test("collects the visible rows with their row model", () => {
    expect(syncTable).toMatch(new RegExp(`visible\\.push\\(\\{\\s*${rowField}\\s*,\\s*tr\\s*\\}\\)`));
  });

  test("builds no second object to sort by", () => {
    // the parallel sort view was the bug: a shape nothing rendered or tested,
    // and the comparator could not read a field off it
    expect(source).not.toMatch(/sortView/);
  });
});
