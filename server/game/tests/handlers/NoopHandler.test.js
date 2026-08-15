import NoopHandler from "../../handlers/NoopHandler.js";

describe("NoopHandler", () => {
  const handler = new NoopHandler();

  test("executes as a benign no-op", () => {
    const result = handler.execute({ type: "noop", raw: "test" }, {}, {});
    expect(result).toEqual({ resolved: true });
  });

  test("validate is a pass-through", () => {
    expect(() => handler.validate({ type: "noop", raw: "test" }, {})).not.toThrow();
  });
});
