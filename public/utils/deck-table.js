import { loadComponent } from "./component-util.js";
import { deckFanTransforms } from "./deck-model.js";

/**
 * The deck table shared by the decks page and the pre-game deck step.
 *
 * `deck-model.js` owns what a row says (its columns, values, and fan order);
 * this module owns the DOM for those values and nothing else. A page passes
 * its own column list and the cells for the keys this module does not build,
 * so one row shape serves both pages while the columns stay the page's.
 */

/** Classes a column's header carries on top of the plain `th`. */
const HEADER_CLASSES = { fan: "deck-fan-column" };

const textCell = (text, className = null) => {
  const cell = document.createElement("td");
  if (className) cell.classList.add(className);
  cell.innerText = text;
  return cell;
};

/** One cell builder per column key this module owns. */
const BUILT_IN_CELLS = {
  fan: () => {
    const cell = document.createElement("td");
    cell.classList.add("deck-fan-cell");
    return cell;
  },
  name: (row) => textCell(row.name),
  size: (row) => textCell(row.sizeLabel, "deck-size-cell"),
  composition: (row) => textCell(row.compositionLabel),
  averageCost: (row) => textCell(row.averageCostLabel),
  status: (row) => {
    const cell = document.createElement("td");
    const flag = document.createElement("span");
    flag.classList.add("deck-flag", row.isLegal ? "legal" : "problems");
    flag.innerText = row.isLegal ? row.label : `${row.label}: ${row.problemLabel}`;
    flag.title = row.problems.join("\n");
    cell.appendChild(flag);
    return cell;
  },
  updatedAt: (row) => textCell(row.updatedAtLabel),
};

/**
 * Build the table header from the frame's columns.
 * @param {HTMLTableRowElement} headerRow
 * @param {Array<{ key: string, label: string }>} columns
 */
export function buildDeckTableHeader(headerRow, columns) {
  headerRow.replaceChildren(
    ...columns.map((column) => {
      const th = document.createElement("th");
      th.innerText = column.label;
      const className = HEADER_CLASSES[column.key];
      if (className) th.classList.add(className);
      return th;
    })
  );
}

/**
 * Build one deck row.
 * @param {object} args
 * @param {object} args.row the model from buildDeckTableRow (deck-model.js)
 * @param {object} args.deck the raw deck record the row was built from
 * @param {Array<{ key: string, label: string }>} args.columns
 * @param {Record<string, (context: { row: object, deck: object }) => HTMLTableCellElement>} [args.extraCells]
 *   cells for column keys this module does not own (the decks page passes
 *   `actions`, the deck step passes none). A column whose key is neither
 *   built-in nor present in `extraCells` is a programming error: throw.
 * @returns {{ element: HTMLTableRowElement, cells: Map<string, HTMLTableCellElement> }}
 */
export function buildDeckRowElement({ row, deck, columns, extraCells = {} }) {
  const element = document.createElement("tr");
  element.classList.add("deck-row");

  const cells = new Map();
  for (const column of columns) {
    if (cells.has(column.key)) throw new Error(`Deck table column "${column.key}" is declared twice.`);
    const builtIn = BUILT_IN_CELLS[column.key];
    const extra = extraCells[column.key];
    if (builtIn) cells.set(column.key, builtIn(row));
    else if (typeof extra === "function") cells.set(column.key, extra({ row, deck }));
    else throw new Error(`Unknown deck table column "${column.key}": no built-in cell and no extra cell given.`);
  }

  element.append(...cells.values());
  return { element, cells };
}

/**
 * Mount the fan cards into a fan cell. Slugs missing from the pool simply do
 * not appear; an empty fan leaves the cell empty (the shared stylesheet draws
 * the "No units" placeholder with an `:empty` rule).
 * @param {HTMLTableCellElement} cell
 * @param {object[]} fanEntries pool entries, cheapest first, from buildDeckFan
 * @returns {Promise<void>}
 */
export async function mountDeckFan(cell, fanEntries) {
  const transforms = deckFanTransforms(fanEntries.length);
  await Promise.all(
    fanEntries.map(async (entry, index) => {
      const element = document.createElement("div");
      element.classList.add("card-vertical-component", "deck-fan-card");
      element.style.transform = transforms[index].transform;
      element.style.zIndex = String(transforms[index].zIndex);
      cell.appendChild(element);
      await loadComponent(element, "card-vertical", { card: entry.view, isSmall: true });
    })
  );
}
