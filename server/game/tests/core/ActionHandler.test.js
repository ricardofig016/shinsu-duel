import ActionHandler from "../../ActionHandler.js";

class TestAction extends ActionHandler {
  static schema = { source: "string", username: "string" };
  static sourceAccess = { player: true, system: false };
}

class SchemaLessAction extends ActionHandler {
  static schema = undefined;
}

describe("ActionHandler", () => {
  let handler;

  beforeEach(() => {
    handler = new TestAction();
  });

  test("validateSchema accepts matching fields", () => {
    expect(handler.validateSchema({ source: "player", username: "Alice" })).toBe(true);
  });

  test("validateSchema throws when schema is missing", () => {
    const schemaLess = new SchemaLessAction();
    expect(() => schemaLess.validateSchema({})).toThrow("No schema defined");
  });

  test("validateSchema throws on missing required field", () => {
    expect(() => handler.validateSchema({ source: "player" })).toThrow("Missing required field: username");
  });

  test("validateSchema throws on type mismatch", () => {
    expect(() => handler.validateSchema({ source: "player", username: 42 })).toThrow("Invalid type for field: username");
  });

  test("validateSchema throws on unexpected extra field", () => {
    expect(() => handler.validateSchema({ source: "player", username: "Alice", extra: true })).toThrow("Unexpected field: extra");
  });

  test("validate rejects disallowed source", () => {
    expect(() => handler.validate({ source: "system", username: "Alice" }, {})).toThrow("is not allowed");
  });

  test("validate accepts allowed source", () => {
    expect(handler.validate({ source: "player", username: "Alice" }, {})).toBe(true);
  });

  test("base execute throws not-implemented", () => {
    expect(() => handler.execute({}, {})).toThrow("execute() must be implemented");
  });
});
