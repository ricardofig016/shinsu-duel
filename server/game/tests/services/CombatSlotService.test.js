import { createTestGame } from "../utils.js";
import CombatSlotService from "../../services/CombatSlotService.js";
import EventBus from "../../EventBus.js";
import GameClock from "../../GameClock.js";
import EVT from "../../EventCatalog.js";

describe("CombatSlotService", () => {
  let game;

  beforeEach(() => {
    game = createTestGame();
  });

  // ── Position slots ──────────────────────────────────────────────────────

  test("isAvailable returns true for fresh slots", () => {
    const player = game.playerStates.Alice;
    expect(CombatSlotService.isAvailable(player, "fisherman")).toBe(true);
  });

  test("consume marks slot unavailable", () => {
    const player = game.playerStates.Alice;
    expect(CombatSlotService.consume(player, "fisherman")).toBe(true);
    expect(CombatSlotService.isAvailable(player, "fisherman")).toBe(false);
  });

  test("consume returns false when slot already spent", () => {
    const player = game.playerStates.Alice;
    CombatSlotService.consume(player, "fisherman");
    expect(CombatSlotService.consume(player, "fisherman")).toBe(false);
  });

  test("consume returns false for non-existent slot", () => {
    const player = game.playerStates.Alice;
    expect(CombatSlotService.consume(player, "nonexistent")).toBe(false);
  });

  test("resetAll restores all slots", () => {
    const player = game.playerStates.Alice;
    CombatSlotService.consume(player, "fisherman");
    CombatSlotService.consume(player, "scout");

    CombatSlotService.resetAll(player);

    expect(CombatSlotService.isAvailable(player, "fisherman")).toBe(true);
    expect(CombatSlotService.isAvailable(player, "scout")).toBe(true);
  });

  // ── Shinheuh slot ───────────────────────────────────────────────────────

  test("shinheuh slot starts unavailable", () => {
    expect(CombatSlotService.isShinheuhSlotAvailable(game.playerStates.Alice)).toBe(false);
  });

  test("grantShinheuhSlot makes it available and emits event", () => {
    const clock = new GameClock();
    const bus = new EventBus(clock);
    const emitted = [];
    bus.on(EVT.SHINHEUH_SLOT_GRANTED, (p) => emitted.push(p), { phase: "post" });

    const player = game.playerStates.Alice;
    CombatSlotService.grantShinheuhSlot(player, bus, "Alice");
    expect(CombatSlotService.isShinheuhSlotAvailable(player)).toBe(true);
    expect(emitted.length).toBe(1);
  });

  test("grantShinheuhSlot is no-op when already available", () => {
    const player = game.playerStates.Alice;
    player.shinheuhSlot = { available: true, used: false };
    CombatSlotService.grantShinheuhSlot(player, null, "Alice");
    // Should still be available, not changed
    expect(CombatSlotService.isShinheuhSlotAvailable(player)).toBe(true);
  });

  test("consumeShinheuhSlot marks used and returns true", () => {
    const player = game.playerStates.Alice;
    player.shinheuhSlot = { available: true, used: false };
    expect(CombatSlotService.consumeShinheuhSlot(player)).toBe(true);
    expect(player.shinheuhSlot.available).toBe(false);
    expect(player.shinheuhSlot.used).toBe(true);
  });

  test("consumeShinheuhSlot returns false when unavailable", () => {
    const player = game.playerStates.Alice;
    expect(CombatSlotService.consumeShinheuhSlot(player)).toBe(false);
  });

  test("revokeShinheuhSlot sets available to false", () => {
    const player = game.playerStates.Alice;
    player.shinheuhSlot = { available: true, used: false };
    CombatSlotService.revokeShinheuhSlot(player);
    expect(player.shinheuhSlot.available).toBe(false);
  });

  test("resetShinheuhSlot clears both flags", () => {
    const player = game.playerStates.Alice;
    player.shinheuhSlot = { available: true, used: true };
    CombatSlotService.resetShinheuhSlot(player);
    expect(player.shinheuhSlot.available).toBe(false);
    expect(player.shinheuhSlot.used).toBe(false);
  });
});
