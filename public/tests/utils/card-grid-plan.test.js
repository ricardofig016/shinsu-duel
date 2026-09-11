import { planGrid } from "../../utils/card-browse.js";

const view = (cardId, name, cost, type = "unit") => ({ cardId, name, cost, type });

const views = [view(1, "Ashen Knight", 7), view(2, "Brawn Idol", 5), view(3, "Cinder Skill", 2, "skill")];

describe("planGrid", () => {
  test("filters by criteria and orders by the standard sort key", () => {
    const visible = planGrid(views, { criteria: { type: "unit" }, sortKey: "name-asc" });
    expect(visible.map((entry) => entry.cardId)).toEqual([1, 2]);
  });

  test("applies the page predicate after the criteria", () => {
    const visible = planGrid(views, {
      criteria: null,
      sortKey: "name-asc",
      predicate: (entry) => entry.cost >= 5,
    });
    expect(visible.map((entry) => entry.cardId)).toEqual([1, 2]);
  });

  test("a caller comparator wins over the sort key", () => {
    const visible = planGrid(views, {
      sortKey: "name-asc",
      compare: (a, b) => b.cost - a.cost,
    });
    expect(visible.map((entry) => entry.cardId)).toEqual([1, 2, 3]);
  });

  test("a fixed sort key overrides the incoming sort key", () => {
    const visible = planGrid(views, { sortKey: "cost-asc", fixedSortKey: "cost-desc" });
    expect(visible.map((entry) => entry.cardId)).toEqual([1, 2, 3]);
  });
});
