import * as IdFactory from "./IdFactory.js";

/**
 * Represents a unit placed on the battlefield.
 *
 * Ability and passive resolution is owned by the event/handler pipeline;
 * Unit only emits lifecycle intents and stores instance state.
 */
export default class Unit {
  constructor(card, placedPositionCode, line = null) {
    if (!card) throw new Error("Card instance is required to create a Unit");
    if (card.type !== "unit") throw new Error(`Invalid card type: expected 'unit', got '${card.type}'`);

    this.id = IdFactory.unitInstance(card.cardId); // deterministic instance id
    this.card = card;
    this.currentHp = card.maxHp;
    this.kind = card.kind ?? "standard";
    this.placedPositionCode = placedPositionCode; // main position for standard, null otherwise
    this.line = line; // field line (frontline | backline)

    this.owner = card.owner; // player username
    this.bus = card.bus;

    // Canonical equipment attachment tracking. Every attached card is kept
    // individually so its modifiers and ignition subscriptions remain scoped.
    this.equipmentAttachments = [];
  }

  isAlive() {
    return this.currentHp > 0;
  }

  toSanitizedObject() {
    return {
      id: this.id,
      card: this.card.toSanitizedObject(),
      currentHp: this.currentHp,
      placedPositionCode: this.placedPositionCode,
      line: this.line,
      owner: this.owner,
    };
  }
}
