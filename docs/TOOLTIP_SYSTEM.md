# Tooltip System

How tooltip copy is owned, served, and rendered. `RULES.md` remains the source
of truth for game text; this document covers only the pipeline that carries it
to the screen.

---

## Ownership

All tooltip copy is server-owned. The frontend never authors descriptive text;
it only arranges server-provided fields into styled entries. Copy reaches the
client through two channels:

- **Card views** (`Card.toSanitizedObject`, `server/game/Card.js`) — positions
  (name, description, verbose description, line), traits, conditions, and
  attributes (tooltip title, description, effect lines, icon path).
- **The glossary route** (`GET /glossary`, `server/routes/glossary.js`) —
  everything outside the card views: type and kind summaries, rank entries,
  header concept descriptions (passives, evolve, ignition, requirements), HUD
  strings (shinsu, HP, lighthouses, fire charges, deck), line labels, and the
  chosen suffix. Data lives in `server/data/glossary.json`.

When the glossary is unavailable, tooltips degrade to what the card views
still carry: glossary-only tooltips (type letter, rank, header concepts, HUD)
are skipped, and no copy is substituted from the frontend.

---

## Styled entries

The shared tooltip component (`public/components/tooltip/`) renders a list of
entries. An entry is a plain string, or `{ text, style }` with one of:

| Style    | Used for                                              |
| -------- | ----------------------------------------------------- |
| `italic` | Descriptions and concept lines (context, muted)       |
| `strong` | Emphasis (the card's own rank in the rank tooltip)    |
| `label`  | The battlefield line label (uppercase, small)         |

Rendering stays `textContent`-based: styled entries only add a class, so no
server text can inject markup. Entry assembly helpers live in
`public/utils/tooltip-entries.js` (pure, unit-tested in
`public/tests/utils/tooltip-entries.test.js`); the glossary is fetched once
per page load by `public/utils/glossary.js`.

---

## Rank ranges: single source

Rank cost ranges live in `server/game/ranks.js` and are consumed by both the
build-time card validator (`scripts/card-validate.js`) and the glossary route,
which composes the served rank list from it. The displayed ranges cannot drift
from the enforced ones.

---

## Tooltip copy map

| Tooltip                            | Title                       | Text                                                        |
| ---------------------------------- | --------------------------- | ----------------------------------------------------------- |
| Board combat slot, card positions  | Position name               | Line label, description, italic verbose description; the chosen variant appends the glossary chosen suffix |
| Type letter (card-vertical)        | Kind name (standard shows "Unit") or type name | Kind or type summary from the glossary  |
| Rank trapezoid                     | "Rank"                      | Italic concept, then every rank with cost range and description; the card's own rank is strong |
| Attribute header icon              | Server-composed (guide attributes get "Guide - <name>") | Italic prose description, then the attribute's effect lines (the RULES.md core-mechanic block) |
| Evolve / Ignition / Passives / Requirements header icons | Glossary concept name | Italic concept description, then the card's printed texts |
| HUD (shinsu, recharged, HP, lighthouses, fire charges, deck) | Glossary name | Glossary texts; the deck count fills the `{count}` template |

---

## RULES.md alignment

`server/game/tests/integration/DataDescriptionsAudit.test.js` verifies that
every shipped condition, trait, and position description, every attribute
description and effect line, and the glossary rank descriptions appear
verbatim in `RULES.md` (markdown stripped, compared sentence by sentence). A
rule change must update the display data in the same change as `RULES.md`, or
the audit fails.
