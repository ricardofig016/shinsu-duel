import BaseHandler from "./BaseHandler.js";
import ZoneService from "../services/ZoneService.js";
import EVT from "../EventCatalog.js";

/**
 * Resolves Fire Core's effect: consumes Fire Charges to create
 * the highest affordable Incinerate card in the owner's hand.
 *
 * DSL type: create_incinerate
 *
 * Delegates charge consumption and card generation to the
 * authoritative HwayeomsaEngine.
 */
export default class CreateIncinerateHandler extends BaseHandler {
  validate(payload) {
    if (!payload.owner) throw new Error("CreateIncinerateHandler: payload.owner is required");
  }

  execute(payload, context, gameState) {
    const { owner } = payload;
    const engine = gameState._attributeRegistry.get("hwayeomsa");
    if (!engine) throw new Error("CreateIncinerateHandler: Hwayeomsa engine not registered");

    const levels = engine.getAvailableLevels(owner, gameState);
    if (levels.length === 0) {
      context.emitChild(EVT.HWAYEOMSA_INCINERATE_CREATED, {
        username: owner,
        level: 0,
        chargesRemaining: gameState.playerStates[owner]?.fireCharges ?? 0,
        skipped: true,
        reason: "not enough fire charges",
      });
      return { created: false, reason: "Not enough Fire Charges to create an Incinerate." };
    }

    const highest = levels.at(-1);
    const incinerate = engine.consumeCharges(owner, highest.level, gameState);
    return { created: true, incinerate, level: highest.level, name: highest.name };
  }
}
