/**
 * Pure view models for the game client.
 *
 * Builders turn the server payload into plain objects the DOM layer renders
 * directly: board units with their runtime state (conditions, equipment,
 * granted abilities, runtime and printed traits, chosen positions), hand
 * cards, shinsu circles, the round, the game-over result, and pending
 * decisions rendered into prompt models. No DOM access here.
 */

export const MAX_NORMAL_SHINSU = 10;
export const MAX_RECHARGED_SHINSU = 2;

const DECISION_TITLES = Object.freeze({
  target_selection: "Choose a target",
  card_selection: "Choose cards",
});

const flattenCard = (card) => ({
  cardId: card.cardId ?? null,
  type: card.type ?? null,
  kind: card.kind ?? null,
  name: card.name ?? "",
  sobriquet: card.sobriquet ?? null,
  artworkPath: card.artworkPath ?? null,
  cost: card.cost ?? 0,
  effectiveCost: card.effectiveCost ?? card.cost ?? 0,
  maxHp: card.maxHp ?? null,
  // Native abilities are addressed by their hand index on the wire
  // (abilityCode "0", "1", ...); the display text is the compiled `raw`.
  abilities: (card.abilities ?? []).map((ability, index) => ({
    code: String(index),
    text: ability.raw ?? ability.text ?? "",
  })),
  passiveAbilities: (card.passiveAbilities ?? []).map((passive) => ({
    text: passive.raw ?? passive.text ?? "",
  })),
  printedTraits: Object.entries(card.traits ?? {}).map(([code, trait]) => ({
    code,
    name: trait.name,
    description: trait.description ?? null,
    iconPath: trait.iconPath ?? null,
  })),
  attributes: [...(card.attributes ?? [])],
  affiliations: Object.entries(card.affiliations ?? {}).map(([code, affiliation]) => ({
    code,
    name: affiliation.name,
  })),
  positions: Object.fromEntries(Object.entries(card.positions ?? {}).map(([code, position]) => [code, { ...position }])),
});

/**
 * Flatten one server card view (a hand card) for rendering. Hidden cards
 * (empty views) flatten to a model whose null cardId marks them hidden.
 */
export function buildCardViewModel(card) {
  if (!card || typeof card !== "object" || Array.isArray(card)) {
    throw new TypeError("buildCardViewModel needs a card view object.");
  }
  return flattenCard(card);
}

/**
 * Flatten one board unit view: the card fields plus everything the unit
 * gained at runtime.
 */
export function buildUnitViewModel(unit) {
  if (!unit || typeof unit !== "object" || !unit.card || typeof unit.card !== "object") {
    throw new TypeError("buildUnitViewModel needs a unit view with a card.");
  }
  return {
    ...flattenCard(unit.card),
    id: unit.id,
    owner: unit.owner ?? null,
    currentHp: unit.currentHp ?? 0,
    line: unit.line ?? null,
    placedPositionCode: unit.placedPositionCode ?? null,
    chosenPositionCode: unit.chosenPositionCode ?? null,
    conditions: (unit.conditions ?? []).map((condition) => ({
      key: condition.key,
      magnitude: condition.magnitude,
    })),
    equipmentAttachments: [...(unit.equipmentAttachments ?? [])],
    // Granted abilities are addressed by their registry code on the wire
    // ("granted:<source>:<type>"); the display text is the compiled `raw`.
    grantedAbilities: (unit.grantedAbilities ?? []).map((granted) => ({
      abilityCode: granted.abilityCode,
      sourceId: granted.sourceId,
      text: granted.ability?.raw ?? granted.ability?.text ?? granted.abilityCode,
    })),
    runtimeTraits: [...(unit.traits ?? [])],
  };
}

/** Mark a hand card hidden or readable, keeping its hand position. */
export function buildHandCardViewModel(card, index) {
  const model = buildCardViewModel(card);
  if (!Number.isInteger(index) || index < 0) {
    throw new TypeError("index must be a non-negative integer.");
  }
  return { index, isHidden: model.cardId == null, card: model };
}

/**
 * Project the shinsu counters into circle states for the fixed UI rows.
 * Normal circles fill available, then spent, then unavailable; recharged
 * circles fill available first.
 */
export function buildShinsuViewModel(shinsu) {
  if (!shinsu || typeof shinsu !== "object") {
    throw new TypeError("buildShinsuViewModel needs a shinsu object.");
  }
  const { normalAvailable = 0, normalSpent = 0, recharged = 0 } = shinsu;

  const normal = [];
  for (let i = 0; i < MAX_NORMAL_SHINSU; i++) {
    if (i < normalAvailable) normal.push("available");
    else if (i < normalAvailable + normalSpent) normal.push("spent");
    else normal.push("unavailable");
  }
  const rechargedStates = [];
  const availableRecharged = Math.min(recharged, MAX_RECHARGED_SHINSU);
  for (let i = 0; i < MAX_RECHARGED_SHINSU; i++) {
    rechargedStates.push(i < availableRecharged ? "available" : "spent");
  }
  return { normal, recharged: rechargedStates };
}

/** The round indicator state. */
export function buildRoundViewModel(state) {
  if (!state || typeof state !== "object") {
    throw new TypeError("buildRoundViewModel needs the game state.");
  }
  return {
    round: state.round,
    currentTurn: state.currentTurn,
    isYourTurn: state.currentTurn === state.you?.username,
  };
}

/**
 * One combat slot icon state. Slots the player state marks unavailable have
 * been consumed this round; unknown slots count as available.
 */
export function buildCombatSlotViewModel(playerState, code) {
  if (!playerState || typeof playerState !== "object") {
    throw new TypeError("buildCombatSlotViewModel needs a player state.");
  }
  if (typeof code !== "string" || code === "") {
    throw new TypeError("buildCombatSlotViewModel needs a position code.");
  }
  return {
    code,
    used: playerState.combatSlots?.[code]?.available === false,
  };
}

/**
 * The fire charge panel state. The core Hwayeomsa ability needs one of your
 * field units carrying the `hwayeomsa` attribute; charges accumulate on your
 * player state.
 */
export function buildFireChargeViewModel(state) {
  if (!state || typeof state !== "object") {
    throw new TypeError("buildFireChargeViewModel needs the game state.");
  }
  const you = state.you;
  const hasHwayeomsaUnit = ["frontline", "backline"].some((line) =>
    (you?.field?.[line] ?? []).some((unit) => (unit.card?.attributes ?? []).includes("hwayeomsa"))
  );
  return {
    charges: you?.fireCharges ?? 0,
    canGenerate: hasHwayeomsaUnit && state.currentTurn === you?.username,
  };
}

/** The game-over overlay state, or null while the game runs. */
export function buildGameOverViewModel(gameOver, username) {
  if (!gameOver) return null;
  return {
    headline: gameOver.winner === username ? "Victory" : "Defeat",
    winner: gameOver.winner,
    reason: gameOver.reason,
  };
}

/**
 * Render a pending decision into a prompt model, or null when the player has
 * nothing to decide. `lockedIds` are engine-committed picks (e.g. mandatory
 * Taunt targets) rendered pre-selected and disabled; they sit outside the
 * candidates list and are never submitted.
 */
export function buildDecisionPromptViewModel(pendingDecision) {
  if (!pendingDecision) return null;
  return {
    decisionId: pendingDecision.decisionId,
    type: pendingDecision.type,
    title: DECISION_TITLES[pendingDecision.type] ?? "Choose",
    candidates: (pendingDecision.candidates ?? []).map((candidate) => ({
      id: candidate.id,
      name: candidate.name,
      hp: candidate.hp ?? null,
    })),
    minChoices: pendingDecision.minChoices ?? 1,
    maxChoices: pendingDecision.maxChoices ?? pendingDecision.minChoices ?? 1,
    lockedIds: [...(pendingDecision.lockedIds ?? [])],
  };
}

/**
 * Whether the current selection may be submitted. Locked candidates are
 * engine-committed and rendered pre-selected; they are not part of the
 * candidates list and are not submitted. The engine validates the free
 * selections against the min/max range and the candidate list.
 */
export function canSubmitDecision(prompt, selectedIds) {
  if (!prompt) return false;
  const selected = [...new Set(selectedIds ?? [])];
  const candidateIds = new Set(prompt.candidates.map((candidate) => candidate.id));
  if (selected.some((id) => !candidateIds.has(id))) return false;
  return selected.length >= prompt.minChoices && selected.length <= prompt.maxChoices;
}
