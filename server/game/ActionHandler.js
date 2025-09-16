export default class ActionHandler {
  validateSchema(data) {
    if (!this.constructor.schema) throw new Error("No schema defined for this action.");

    const schemaErrorMessage = `\nExpected schema: ${JSON.stringify(this.constructor.schema)}`;

    for (const [key, type] of Object.entries(this.constructor.schema)) {
      // Check for missing fields
      if (!(key in data)) {
        throw new Error(`Missing required field: ${key}${schemaErrorMessage}`);
      }
      // Check for type mismatches
      if (typeof data[key] !== type) {
        throw new Error(`Invalid type for field: ${key}. Expected ${type}, got ${typeof data[key]}`);
      }
    }

    // Check for extra fields
    for (const key of Object.keys(data)) {
      if (!(key in this.constructor.schema)) {
        throw new Error(`Unexpected field: ${key}${schemaErrorMessage}`);
      }
    }

    return true;
  }

  validate(data, gameState) {
    this.validateSchema(data);
    if (!this.constructor.sourceAccess[data.source]) {
      throw new Error(`Source ${data.source} is not allowed to perform this action.`);
    }
    return true;
  }

  execute(data, gameState) {
    throw new Error("execute() must be implemented in subclasses");
  }
}
