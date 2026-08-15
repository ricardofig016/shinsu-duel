import BaseHandler from "./BaseHandler.js";

/**
 * Explicit no-op effect (test placeholders and identity stubs).
 *
 * DSL type: noop
 *
 * Resolves successfully without mutating state. Used by placeholder cards
 * (e.g. `_test_Skill`, `_test_Equipment`) that carry no real mechanic.
 */
export default class NoopHandler extends BaseHandler {
  execute() {
    return { resolved: true };
  }
}
