import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { analyzeReplayFile } from "../replay.js";
import { setupGameWithHands, cards } from "../../server/game/tests/utils.js";

const USER_INPUT_SOURCE = { source: "player" };

/**
 * Generate a real artifact by playing a fixture game: two deploys, round
 * advance, a third deploy creating a second enemy unit, a zero-cost skill
 * play whose targeting produces a multi-candidate decision, the decision
 * resolution, and a failed deploy. Every input is applied through
 * `processAction`/`resolveDecision` only, so the artifact replays exactly.
 */
function generateArtifactFile() {
  const game = setupGameWithHands({
    Alice: ["Test Scout", "Test Damage Skill"],
    Bob: ["Test Scout", "Test Dies Passive Unit"],
  });

  const deploy = (username, cardName, positionCode) =>
    game.processAction({
      type: "deploy-unit-action",
      data: {
        ...USER_INPUT_SOURCE,
        username,
        handId: game.playerStates[username].hand.findIndex((c) => c.name === cardName),
        placedPositionCode: positionCode,
      },
    });
  const pass = (username) =>
    game.processAction({ type: "pass-turn-action", data: { ...USER_INPUT_SOURCE, username } });

  deploy("Alice", "Test Scout", "scout"); // line 2
  deploy("Bob", "Test Scout", "scout"); // line 3
  pass("Alice"); // line 4
  pass("Bob"); // line 5 — round 2 begins
  pass("Alice"); // line 6
  deploy("Bob", "Test Dies Passive Unit", "fisherman"); // line 7 — second enemy
  game.processAction({
    type: "play-skill-action",
    data: {
      ...USER_INPUT_SOURCE,
      username: "Alice",
      handId: game.playerStates.Alice.hand.findIndex((c) => c.name === "Test Damage Skill"),
    },
  }); // line 8 — target_selection decision with two candidates
  if (!game.pendingDecision) throw new Error("Test setup: skill play did not produce a decision");
  game.resolveDecision({
    decisionId: game.pendingDecision.decisionId,
    username: "Alice",
    choices: [game.pendingDecision.candidates[0].id],
  }); // line 9 — deferred turn-end passes to Bob

  try {
    game.processAction({
      type: "deploy-unit-action",
      data: { ...USER_INPUT_SOURCE, username: "Bob", handId: 99, placedPositionCode: "scout" },
    });
    throw new Error("Test setup: deploy with an invalid handId was expected to fail");
  } catch (error) {
    if (/Test setup/.test(error.message)) throw error;
  } // line 10

  const { initial, actions } = game.logger.getReplayLog();
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "replay-cli-")), "TEST.0.replay.jsonl");
  fs.writeFileSync(file, [initial, ...actions].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  return file;
}

function writeArtifact(name, text) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "replay-cli-")), name);
  fs.writeFileSync(file, text);
  return file;
}

describe("replay CLI", () => {
  let file;

  beforeAll(() => {
    file = generateArtifactFile();
  });

  test("listing verifies the artifact and summarizes every step", () => {
    const report = analyzeReplayFile(file, { cards });
    expect(report.verified).toBe(true);
    expect(report.file).toBe(file);
    expect(report.roomCode).toBe("TEST");
    expect(report.stepCount).toBe(9);
    expect(report.steps.map((s) => s.line)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(report.steps[0]).toMatchObject({
      sequence: expect.any(Number),
      kind: "UserAction",
      input: "deploy-unit-action",
      username: "Alice",
      ok: true,
      error: null,
    });
    expect(report.steps[6]).toMatchObject({ input: "play-skill-action", username: "Alice", ok: true });
    expect(report.steps[7]).toMatchObject({ kind: "UserDecision", input: "decision", username: "Alice", ok: true });
    expect(report.steps[7].choices).toHaveLength(1);
    expect(report.steps[8]).toMatchObject({ kind: "UserAction", ok: false });
    expect(report.steps[8].error).toMatch(/hand/i);
  });

  test("step view attributes only that step's events to it", () => {
    const report = analyzeReplayFile(file, { step: 2, cards });
    expect(report.step.line).toBe(2);
    expect(report.step.sequence).toBe(report.steps[0].sequence);
    expect(report.step.entry.action.type).toBe("deploy-unit-action");

    const eventNames = report.step.events.map((e) => e.rootEvent);
    expect(eventNames.length).toBeGreaterThan(0);
    expect(eventNames).not.toContain("game:started");
    expect(eventNames).not.toContain("round:started");
    for (const event of report.step.events) {
      expect(event.sequence).toBeLessThan(report.step.sequence);
    }
  });

  test("skill step view shows the effect events and the pending decision", () => {
    const report = analyzeReplayFile(file, { step: 8, cards });
    const eventNames = report.step.events.map((e) => e.rootEvent);
    expect(eventNames).toContain("skill:applied");
    expect(eventNames).toContain("pending-decision");
  });

  test("decision step view exposes the recorded resolution and its events", () => {
    const report = analyzeReplayFile(file, { step: 9, cards });
    expect(report.step.entry.type).toBe("UserDecision");
    expect(report.step.entry.decision.choices).toHaveLength(1);
    expect(report.step.events.length).toBeGreaterThan(0);
    for (const event of report.step.events) {
      expect(event.rootEvent).toBeDefined();
    }
  });

  test("failed step carries the authoritative error and no events", () => {
    const report = analyzeReplayFile(file, { step: 10, cards });
    expect(report.step.entry.ok).toBe(false);
    expect(report.step.events).toEqual([]);
    expect(report.step.entry.error.message).toMatch(/hand/i);
    expect(report.step.entry.error.stack).toBeTruthy();
  });

  test("rejects the InitialState line, out-of-range lines, and non-integer steps", () => {
    expect(() => analyzeReplayFile(file, { step: 1, cards })).toThrow(/InitialState/);
    expect(() => analyzeReplayFile(file, { step: 11, cards })).toThrow(/does not exist/);
    expect(() => analyzeReplayFile(file, { step: 2.5, cards })).toThrow(/integer/);
  });

  test("rejects a missing file", () => {
    expect(() => analyzeReplayFile(path.join(os.tmpdir(), "replay-cli-does-not-exist.jsonl"), { cards })).toThrow(
      /not found/
    );
  });

  test("rejects malformed and mis-typed artifact lines", () => {
    const invalidJson = writeArtifact("invalid.jsonl", '{"type":"InitialState"}\n{not json\n');
    expect(() => analyzeReplayFile(invalidJson, { cards })).toThrow(/Line 2 is not valid JSON/);

    const noInitial = writeArtifact("no-initial.jsonl", '{"type":"UserAction"}\n');
    expect(() => analyzeReplayFile(noInitial, { cards })).toThrow(/Line 1 must be an InitialState/);

    const unknownType = writeArtifact("unknown-type.jsonl", '{"type":"InitialState"}\n{"type":"Mystery"}\n');
    expect(() => analyzeReplayFile(unknownType, { cards })).toThrow(/unknown replay entry type/);
  });

  test("reports divergence instead of showing unverified views", () => {
    const lines = fs.readFileSync(file, "utf8").trim().split("\n");
    const firstStep = JSON.parse(lines[1]);
    firstStep.diff.changed.currentTurn = "nobody";
    lines[1] = JSON.stringify(firstStep);
    const tampered = writeArtifact("tampered.replay.jsonl", lines.join("\n") + "\n");

    expect(() => analyzeReplayFile(tampered, { cards })).toThrow(/Replay divergence/);
  });
});
