---
name: debug-replay
description: Reconstruct and root-cause a reported game bug from a live-capture replay artifact. Use when the user references a server/logs/games/*.replay.jsonl file and describes unexpected behavior.
disable-model-invocation: true
argument-hint: "Provide the replay artifact path, the line in that file the issue appears on, and the observed symptom."
---

Debug a reported game issue from its replay artifact. A complete request is one sentence: the artifact path, the file line the player acted on, and the observed symptom ("played skill X on line Y and it didn't produce the correct behaviour"). Expected behavior isn't requested from the reporter: derive it from `RULES.md` (the authority) and the card YAML in `server/data/cards` (the source) if absent; come back with a question only when the rules themselves are ambiguous.

## Method

1. Run `npm run replay -- <file>` (no step). The output is JSON: a per-step listing (`line`, `sequence`, action type, player, `ok`, error message) plus `verified`.
2. If `verified` is `false`, the reconstruction diverged from the recorded diffs and the divergence is the primary finding (engine behavior changed since capture, or determinism broke). Debug that first; never interpret events from an unverified reconstruction.
3. Run `npm run replay -- <file> --step <line>` for the reported line. `--step` takes the file line number the reporter quotes; the entry's `sequence` is its identity and is echoed back. The step view carries the recorded entry verbatim plus `events`: the reconstructed root-event and `EventFailure` entries attributable to that input, each with before/after state snapshots, diffs, and causation trees.
4. Branch on `ok`:
   - `ok: false` — the symptom is an authoritative rejection, not a wrong effect. The entry's `error.message` and `error.stack` name the failing validator; `events` is empty because nothing changed. Root-cause by comparing the validator's requirement against `RULES.md` and the card's YAML.
   - `ok: true` — the symptom is a wrong effect. Read `events` in order: each root event shows what actually happened and why (payload, state delta, causation tree). For the first step of a game, the window also contains the game-start cascade (`game:started`, `round:started`, `turn:started`); those are construction events, not the step's doing.
5. Fix the underlying cause — engine service, action, or card YAML — never a symptom patch. 
6. Hand-author a regression test that would have failed before the fix, using the test-owned fixture catalog per `docs/TESTING.md` (tests never depend on shipped card data). Run the focused tests, then the full suite.

## Boundaries

- The artifact is the server-authoritative input stream. It cannot prove anything about client rendering: if the symptom is what the UI showed versus what the server did, the request is incomplete — ask for the client-side observation.
- Only seeded games produce artifacts, and every game is seeded by construction; a missing `rngSeed` in an artifact is corruption, report it as such.
