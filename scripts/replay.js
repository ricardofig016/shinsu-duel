import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import ReplayDriver from "../server/game/replay/ReplayDriver.js";
import productionCards from "../server/data/cards.json" with { type: "json" };

/**
 * Replay-artifact debugger.
 *
 * Turns a live-capture artifact (`<roomCode>.<startedAt>.replay.jsonl`,
 * written by `GameFileLogger` for TESTROOM dev rooms) into a debugging view.
 * Output is JSON only; errors are emitted as JSON with exit code 1.
 *
 *   npm run replay -- <file>              listing of every recorded step
 *   npm run replay -- <file> --step 13    full detail for the entry on line 13
 *
 * Every invocation replays the artifact through `ReplayDriver`, which asserts
 * the reconstructed state byte-for-byte after every step. A reconstruction
 * that diverges is reported as an error and is itself the primary finding;
 * unverified event views are never produced.
 *
 * Step addressing is by FILE LINE NUMBER (the address a reporter quotes);
 * the entry's `sequence` is its identity and is echoed in every view.
 * A step's events are the reconstructed root-event/EventFailure entries
 * strictly between the previous recorded entry's sequence and its own: all
 * of an input's events fire inside its beginUserInput/endUserInput window,
 * which closes before the entry itself is stamped. Step 1's window starts at
 * the construction boundary, so the game-start cascade (game:started,
 * round:started, ...) is excluded even though it precedes the first input.
 */

const INITIAL_STATE_TYPE = "InitialState";
const USER_INPUT_TYPES = new Set(["UserAction", "UserDecision"]);

/** Parsed artifact: every recorded entry paired with its 1-based file line. */
function parseReplayFile(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    throw new Error(`Replay file not found: ${filePath}`);
  }

  const lines = raw.split(/\r?\n/);
  const entries = [];
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].trim();
    if (!text) continue;
    let entry;
    try {
      entry = JSON.parse(text);
    } catch {
      throw new Error(`Line ${i + 1} is not valid JSON.`);
    }
    if (!entry || typeof entry !== "object" || typeof entry.type !== "string") {
      throw new Error(`Line ${i + 1} is not a replay entry (missing a string "type").`);
    }
    entries.push({ entry, line: i + 1 });
  }

  if (entries.length === 0) throw new Error("Replay file is empty.");
  if (entries[0].entry.type !== INITIAL_STATE_TYPE) {
    throw new Error(`Line 1 must be an ${INITIAL_STATE_TYPE} entry, got "${entries[0].entry.type}".`);
  }
  for (const { entry, line } of entries.slice(1)) {
    if (!USER_INPUT_TYPES.has(entry.type)) {
      throw new Error(`Line ${line} has unknown replay entry type "${entry.type}".`);
    }
  }
  return entries;
}

/** Compact summary of one recorded step for the listing view. */
function summarizeStep({ entry, line }) {
  const summary = { line, sequence: entry.sequence, kind: entry.type, ok: entry.ok, error: entry.error?.message ?? null };
  if (entry.type === "UserAction") {
    summary.input = entry.action?.type ?? null;
    summary.username = entry.action?.data?.username ?? null;
  } else {
    summary.input = "decision";
    summary.username = entry.decision?.username ?? null;
    summary.choices = entry.decision?.choices ?? null;
  }
  return summary;
}

function buildListing(entries) {
  return {
    roomCode: entries[0].entry.meta?.roomCode ?? null,
    usernames: entries[0].entry.meta?.usernames ?? null,
    rngSeed: entries[0].entry.meta?.rngSeed ?? null,
    stepCount: entries.length - 1,
    steps: entries.slice(1).map(summarizeStep),
  };
}

/**
 * Analyze a replay artifact.
 *
 * @param {string} filePath path to a `.replay.jsonl` artifact
 * @param {object} [options]
 * @param {number|null} [options.step] 1-based file line of the step to expand
 * @param {object|null} [options.cards] card catalog to reconstruct with;
 *   defaults to the production compiled catalog
 * @returns {object} JSON-serializable debug view
 */
export function analyzeReplayFile(filePath, { step = null, cards = productionCards } = {}) {
  const entries = parseReplayFile(filePath);
  const lastLine = entries[entries.length - 1].line;

  const replayed = ReplayDriver.replay(
    { initial: entries[0].entry, actions: entries.slice(1).map((e) => e.entry) },
    { cards }
  );

  const result = { file: filePath, verified: true, ...buildListing(entries) };

  if (step === null) return result;

  if (!Number.isInteger(step)) {
    throw new Error(`--step must be an integer file line between 2 and ${lastLine}.`);
  }
  if (step === 1) {
    throw new Error(`Line 1 is the ${INITIAL_STATE_TYPE} entry; pass a line between 2 and ${lastLine}.`);
  }
  const stepIndex = entries.findIndex((e) => e.line === step);
  if (stepIndex === -1) {
    throw new Error(`Line ${step} does not exist; the artifact has ${lastLine} lines.`);
  }
  return { ...result, step: expandStep(entries, replayed, stepIndex, cards) };
}

/**
 * Full view of one step: the recorded entry verbatim plus the root-event and
 * EventFailure entries the reconstruction attributes to it.
 */
function expandStep(entries, replayed, stepIndex, cards) {
  const { entry, line } = entries[stepIndex];

  // All of an input's events fire inside its user-input window, which closes
  // before the input entry itself is stamped, so the window opens right after
  // the previous recorded action — or, for the first action, right after the
  // game's construction cascade.
  let windowStart;
  if (stepIndex > 1) {
    windowStart = entries[stepIndex - 1].entry.sequence;
  } else {
    const constructed = ReplayDriver.replay({ initial: entries[0].entry, actions: [] }, { cards });
    windowStart = constructed.logger.getLogs().length;
  }

  const logs = replayed.logger.getLogs();
  const events = logs.filter((e) => e.sequence > windowStart && e.sequence < entry.sequence);

  const stamped = logs.find((e) => USER_INPUT_TYPES.has(e.type) && e.sequence === entry.sequence);
  if (!stamped) {
    throw new Error(
      `Replay reconstruction is misaligned at line ${line}: no user-input entry carries sequence ${entry.sequence}.`
    );
  }

  return { line, sequence: entry.sequence, entry, events };
}

function usage() {
  throw new Error("usage: npm run replay -- <path/to/replay.jsonl> [--step <fileLine>]");
}

function main() {
  const args = process.argv.slice(2);
  const positional = [];
  let step = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--step") {
      const raw = args[++i];
      if (raw === undefined) usage();
      const parsed = Number(raw);
      step = Number.isInteger(parsed) ? parsed : raw;
    } else if (args[i].startsWith("--")) {
      usage();
    } else {
      positional.push(args[i]);
    }
  }
  if (positional.length !== 1) usage();

  console.log(JSON.stringify(analyzeReplayFile(positional[0], { step }), null, 2));
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  try {
    main();
  } catch (error) {
    console.log(JSON.stringify({ error: error.message }, null, 2));
    process.exitCode = 1;
  }
}
