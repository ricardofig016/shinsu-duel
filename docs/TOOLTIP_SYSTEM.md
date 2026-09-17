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
- **The shared data catalogs** (`server/data/conditions.json`, `traits.json`,
  `attributes.json`, `positions.json`, `affiliations.json`) — the condition,
  trait, attribute, position, and affiliation vocabularies every part of the
  game resolves codes against: the engine and card views server-side, and the
  content routes `GET /conditions`, `/traits`, `/attributes`, `/positions`,
  `/affiliations` for client lookups such as inline-link hover copy. These
  files are engine data too (conditions and attributes drive mechanics), not
  only tooltip copy.

When the glossary is unavailable, tooltips degrade to what the card views
still carry: glossary-only tooltips (type letter, rank, header concepts, HUD)
are skipped, and no copy is substituted from the frontend.

---

## Styled entries

The shared tooltip component (`public/components/tooltip/`) renders a list of
entries. An entry is a plain string, or `{ text, style }` with one of:

| Style    | Used for                                              |
| -------- | ----------------------------------------------------- |
| `italic` | Descriptions and concept lines (context, muted); equipment-granted ability lines on a deployed unit |
| `strong` | Emphasis (the card's own rank in the rank tooltip)    |
| `label`  | The battlefield line label (uppercase, small)         |

Two further entry shapes serve card-prose tooltips:

- `{ segments }` — compiled display segments (see
  [COMPILED_CARD_DSL.md](./COMPILED_CARD_DSL.md)); the linked-text renderer
  (`public/utils/card-text-dom.js`) turns them into DOM so inline links keep
  working inside tooltips.
- `{ node }` — a pre-built DOM element. Callers build elements; nothing renders markup strings. This is how a card link's hover shows a card face.

Rendering stays injection-safe either way: styled entries only add a class,
string entries render as text content, and segment/node entries render
through the element-building renderer. Entry assembly helpers live in
`public/utils/tooltip-entries.js` (pure, unit-tested in
`public/tests/utils/tooltip-entries.test.js`); the glossary is fetched once
per page load by `public/utils/glossary.js`.

A tooltip mounts on the body through the shared layer in
`public/utils/component-util.js` rather than inside the component that owns the
hover target. Two reasons: it has to paint above whatever hosts it (a tooltip
inside a card-detail-overlay slot would sit in that card's stacking context and
lose to any card with a higher z-index), and it is positioned against the
containing block it lands in, which the layer keeps at the page origin. The
tooltip component measures that block from the frame itself, so a host that
still positions or transforms its subtree places the tooltip correctly anyway.

The layer also owns the tooltip's lifetime, because a host that removes its own
subtree cannot take a body-mounted tooltip with it. A tooltip is dropped once it
has loaded and its hover target has left the document, and those two conditions
are both load-bearing:

- a tooltip that is still loading is never removed, because its renderer waits
  on its own stylesheet and removing the element aborts that load, which leaves
  the caller that mounted it waiting forever. One card's tooltip could deadlock
  another card's render, and with it a page's whole setup;
- a target that has never been in the document has not left it, because callers
  build an element and then append it. Mounting a tooltip on an element that has
  not joined the tree yet is still wrong for the first reason's sake: put the
  element in its parent first, as `card-vertical` does for its header icons,
  strip icons, paged tooltip rows, and position icons.

The tooltip's stylesheet only ever targets the tooltip's own classes. Its
frame can host a whole component as an entry node, so an element selector such
as `.tooltip-frame h1` reaches into that component's markup; that is how a
preview card's cost circle once took the tooltip title's size.

A card-link preview is a real card, so it is built in an off-screen host
(`.card-text-preview-host`): a card fits its own text as it renders, and a
detached card measures zero everywhere, keeps its text at full size, and shows
the last lines clipped. The tooltip that receives the preview takes the element
out of that host.

---

## Inline text links

Compiled display segments may carry links (`[[type:ref]]`, see
[CARD_AUTHORING.md](./CARD_AUTHORING.md)); the linked-text renderer
(`public/utils/card-text-dom.js`) turns them into highlighted spans at the
text choke points (card-vertical text area and header tooltips, unit-card
horizontal ability tooltips, tooltip entries). Each link span carries a lazy
hover tooltip built from server-owned data:

| Link type                                | Hover shows                                                                 |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| `card`                                   | A card preview: the card face rendered through card-vertical, shown bare (the card is the whole tooltip, no frame chrome or title) |
| `condition`, `trait`, `attribute`, `position` | The catalog entry's name, description, and effect lines (`GET /conditions`, `/traits`, `/attributes`, `/positions`) |
| `keyword`, `rule`                        | The glossary `keywords`/`terms` copy (`GET /glossary`)                      |
| `series`, `affiliation`                  | The names of every card in that group, computed from the card catalog (`GET /cards/data`) |

Card links are also clickable: clicking moves the card detail overlay's focus
when it is open, and opens the overlay for that card everywhere else. The
data catalogs fetch once per page load inside the renderer; a failed fetch
degrades to no hover tooltip, never to missing text.

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
| Deployed unit artwork (`unit-card-horizontal`) | Unit name | The unit's own abilities as segment entries, then its equipment-granted abilities in italic — both keep their inline links |
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
