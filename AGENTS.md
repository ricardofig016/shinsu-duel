# Agent Guidelines

All agents must strictly follow the instructions and guidelines in this file.

## Mission

Treat every change as part of the long-term resurrection and evolution of this project. Preserve the project's rules, architectural integrity, and ability to support increasingly complex cards, interactions, and game mechanics.

## Engineering Principles

- Prefer correct, clean architecture over backward compatibility with obsolete or flawed implementations.
- Fix underlying design imperfections instead of adding patches, compatibility shims, duplicated paths, or special cases.
- Favor enterprise-quality design: clear ownership, strong invariants, separation of concerns, explicit contracts, maintainability, extensibility, observability, and deterministic behavior.
- Design for future mechanics that may involve nested effects, chained triggers, transformations, delayed resolution, replacement effects, simultaneous events, player decisions, dynamic targets, and interactions between any existing or future systems.
- Do not introduce isolated components. Integrate new behavior through the project's established services, registries, event system, lifecycle, state model, and data contracts.
- Keep authoritative state mutation behind the appropriate service or engine. Avoid direct mutation when an existing authoritative boundary exists.
- Avoid hidden coupling, duplicated sources of truth, ambiguous ownership, and APIs that accept multiple competing representations of the same concept.
- Prefer explicit, typed or schema-validated contracts and fail clearly when input cannot be modeled safely.
- Keep public behavior and documentation aligned with the actual implementation.
- Keep architecture documentation concise and practical. Document what a component is, why it has its design, how it integrates with related components, and how to use it. Do not write implementation history, phase reports, or unnecessary commentary.
- Before changing documentation, review all relevant files in `docs/`; update only the sections affected by the current contract or architecture, and add a new document only when an important complex component is not adequately covered.

## Rules and Project Context

- Treat `RULES.md` as the authoritative source for game behavior unless the user explicitly overrides it.
- Read the relevant architecture documents in `docs/` before making any changes to the codebase.
- Respect compiler/runtime boundaries: card YAML is source data, compiled card data is a build artifact, and runtime code must use the compiled contract.
- Preserve event ordering, lifecycle phases, ownership rules, targeting rules, and service boundaries.
- When a requirement or rule is ambiguous, do not guess. Ask for clarification before implementation.

## Planning and Implementation

Before coding a non-trivial change:

1. Identify the purpose of the change and its role in the project's broader goals.
2. Inspect existing implementations, contracts, tests, and documentation.
3. Identify gaps, risks, invariants, edge cases, and interactions with future mechanics.
4. Define clear acceptance criteria for the work.
5. Choose the smallest coherent architectural change that solves the underlying problem without limiting future extensibility.

During implementation:

- Keep components cohesive and APIs narrow.
- Use existing abstractions where they are sound; improve them rather than bypassing them when they are not.
- Preserve deterministic and reproducible behavior where possible.
- Handle failure, cancellation, stale state, re-entrancy, and repeated calls explicitly.
- Keep changes focused. Do not alter unrelated behavior or documentation unnecessarily.
- Update documentation when a component's contract, ownership, integration, or usage changes.

## Testing and Bug Discipline

- Every component and meaningful branch must be thoroughly tested.
- Every time a new bug is found, first fix the underlying cause, then add a regression test that would have failed before the fix.
- Regression tests must cover the specific failure mode, including edge cases where practical.
- Test successful behavior, invalid input, boundary conditions, lifecycle cleanup, repeated operations, failure paths, event ordering, and interactions with related systems.
- Run the relevant focused tests during development and the full test suite before finishing.

## Acceptance Criteria

A change is complete only when:

- Its purpose and architectural ownership are clear.
- It follows `RULES.md` and existing system contracts.
- Invariants and failure behavior are explicit and tested.
- New bugs discovered during the work have regression tests.
- Relevant documentation is accurate and concise.
- Focused and full validation pass, or remaining failures are clearly reported with their cause.
