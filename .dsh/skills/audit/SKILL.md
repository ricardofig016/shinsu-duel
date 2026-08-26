---
name: audit
description: Audit whether a plan was completed in the codebase and whether the result follows rules and guidelines. Use when an agent or human asks for an implementation audit of a specific plan file.
---

Audit the plan file named by the user. Treat the plan as the scope boundary. The audit is a reconstruction of what happened, not a checklist comparison: understand the intended outcome, verify the rules and architecture against the implementation, and explain material differences.

## Method

1. Read the entire plan and extract its intended architecture, outcomes, constraints, acceptance criteria, named files and systems, dependencies, and explicit out-of-scope work.
2. Read `AGENTS.md`, `RULES.md`, and every relevant file in `docs/`. Treat `RULES.md` as the game-behavior authority. Treat the other documents as claims about the system, not truth. Check those claims against the real state of the codebase. Flag stale or contradicted documentation.
3. Inspect the project deeply enough to follow each material plan item through its real integration points. Follow behavior across module boundaries instead of accepting a file's name, a plan assertion, or a passing test as proof.
4. Investigate every mismatch between the plan and the code. Decide whether it is a real non-compliance, a deliberate and coherent change that still meets the plan's intent, or unresolved uncertainty. Record deliberate changes and uncertainty in `Other findings`; never hide them because the code appears reasonable. Do not turn harmless wording, naming, or similarly low-impact issues into a failing grade.

## Report

Keep the report concise enough for a coding agent to act on, but make each finding specific. Start with exactly one result line:

`Audit result: PASS` or `Audit result: FAIL`

Determine the binary result from material outcome, not from the count of findings. Use `Audit result: PASS` when the plan's substantive outcomes were achieved and its intended behavior exists, is integrated through the correct boundaries, and obeys the applicable rules. Use `Audit result: FAIL` when a material outcome is missing, incorrectly implemented, broken, or violates a rule that matters to the design. Minor non-compliances may remain under a `PASS` result, but they still belong in the report.

Then use these sections in this order:

### Non-compliances

Include only actual failures against the plan, `AGENTS.md`, `RULES.md`, or verified architecture. Present findings by criticality, most severe first. Use this shape for each finding:

`<criticality>: <scope> <short title>`

Describe the exact requirement, what the code does instead, where the mismatch lives, why it matters, and the concrete fix or decision needed. A finding can remain here under a `completed` grade when it is real but immaterial to the plan's substantive outcome. Do not include code snippets.

### Other findings

Record relevant context that is not itself a non-compliance: coherent deviations from the plan, decisions that changed the design, stale or conflicting documentation, unresolved questions, and evidence that limits confidence. For each item, explain whether the change preserves the plan's intent and whether anyone should follow up. Use the same criticality label when urgency matters, but do not mislabel a deliberate change as a failure.

Omit empty sections. Do not include praise, a tour of the codebase, test output as proof, or a restatement of completed plan items. End after the actionable findings.

Findings unrelated to this audit but that deserve a mention (ie. unrelated bugs) belong here.

## Done

The audit is complete when every material plan item has a checked conclusion, every implementation mismatch has been classified, every actual non-compliance has a specific proposed fix, and the opening grade follows from those conclusions.
