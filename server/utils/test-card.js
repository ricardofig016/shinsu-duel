/**
 * Test-card classification for the compiled catalog. Test cards are the
 * `_Test*` entries authored under `data/cards/test/`; the name prefix is the
 * only marker they carry, so it lives here where both the engine and the
 * catalog utilities can reach it without import cycles.
 */

export const TEST_CARD_NAME_PATTERN = /^_test/i;

export function isTestCard(card) {
  return typeof card?.name === "string" && TEST_CARD_NAME_PATTERN.test(card.name);
}
