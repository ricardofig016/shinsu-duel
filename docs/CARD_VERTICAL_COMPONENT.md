# Card Vertical Component

`public/components/card-vertical/` renders the large vertical card face for
every card type (unit, skill, equipment — landmarks are unit `kind`). The
name and classes are generic on purpose: the component branches on the card
view's `type` and `kind`, never on the page that mounts it.

## Usage

Loaded through the component registry in `public/utils/component-util.js`:

```js
loadComponent(container, "card-vertical", { card, unit, isSmall, onAbilityClick });
```

- Pass either `card` (a `buildCardViewModel` view) or `unit` (a
  `buildUnitViewModel` view), never both; a missing view or a null `cardId`
  renders the card back.
- `isSmall` scales the card for hand/fan rendering; right-clicking a small
  card opens the card detail overlay (`public/components/card-detail-overlay/`),
  which renders the focus card at its big size with attached equipment to its
  left and its related cards to its right — the overlay owns every big-card
  render, so the component itself never mounts one. `onAbilityClick(code)`
  wires unit ability clicks; the page passes it only where clicking is
  meaningful (its own field units).

## Data contract

The component consumes only the flattened view models from
`public/game/viewModels.js`, which mirror the server card view produced by
`Card.toSanitizedObject()` (`server/game/Card.js`):

- Printed content arrives as compiled display segments: `rank`,
  `requirements`, `effects`, `rules`, `evolveTriggers`, `igniteTriggers`, and
  the ability/passive `text` lists. The text area and header tooltips render
  them through the linked-text renderer (`public/utils/card-text-dom.js`),
  which highlights inline links, gives card links hover previews, and keeps
  card links clickable — clicking moves the card detail overlay's focus or
  opens it.
- Looked-up metadata arrives as code-keyed dictionaries stamped with
  `name`, `description`, and `iconPath`: traits, positions, affiliations,
  attributes. Attribute views additionally carry the server-composed tooltip
  `title` (guide attributes get "Guide - <name>") and their `effect` lines.
  Runtime conditions are stamped the same way by the GameState projections.
- Tooltip copy outside the card views (type/kind summaries, rank entries,
  header concept descriptions, HUD strings) comes from the glossary route —
  see `docs/TOOLTIP_SYSTEM.md` for the copy map and the styled entry contract.

The component renders placeholders for missing artwork/icons but never
mutates the view models.

## Layout per card type

- **Name row:** the type letter (`assets/icons/types/`; landmarks carry
  `landmark.png` despite being units) with its own tooltip (the type's, or for
  units the kind's, server-owned summary), the name (left-aligned after the
  letter), and the header icons — one icon per attribute (in the canonical
  attribute order of the card view), evolve, ignition, passive abilities,
  and requirements. Header icons render only when the
  card has the feature and are hover-only; each explains itself through the
  shared tooltip component.
- **Artwork:** up to two opaque trapezoids textured with the card's
  `background.png` overlay the top and
  bottom. Both have a wide (base) edge of 2/3 of the artwork width and a
  narrow edge of 1/2, with a height of 9% of the artwork; the top one is
  flush with the artwork's top edge, the bottom one with its bottom edge.
  Their text renders at the card's base size (1em). Each trapezoid renders
  only when it carries information — the top one shows the card's `rank`
  (authored on standard-kind units) and carries the rank tooltip listing
  every rank with its cost range, the card's own rank emphasized; the bottom
  one shows the first
  affiliation; cards with neither rank nor affiliations show pure artwork.
  With more than one
  affiliation, hovering the trapezoid — or the overlay itself — opens a
  textured overlay in the same style (2/3 of the artwork width, centered)
  just below the
  artwork listing the rest; the overlay stays open while the pointer is
  inside either element.
- **Strips:** trait and condition icon strips, unit cards only, sharing one
  renderer: up to four icons, an ellipsis overflow that opens a paged
  tooltip, and the strip label ("Traits" / "Conditions") when empty.
- **Text area:** unit abilities (plus granted abilities, italic), landmark
  rules, and skill/equipment effects as paragraphs. The list owns a fixed
  flex share of the card (`overflow: hidden` and `min-height: 0`), and the
  font shrinks from 2em toward 0.8em until the content fits its own box, so
  missing or long content can never shift the artwork geometry.
- **Stats:** cost circle always; position icons and the hp circle for unit
  cards only.

The card frame is an isolated stacking context (`isolation: isolate`), so
positioned descendants (trapezoids, overlays) can never paint above
neighboring cards in the overlapping hand fan.

## Card detail overlay

`public/components/card-detail-overlay/` replaces the per-card big-copy
expansion: right-clicking any small card-vertical or a deployed
unit-card-horizontal opens one fixed, singleton overlay above every page
surface. The component owns every big-card render — nothing outside it
positions or mounts one.

**Row assembly** is pure (`public/utils/card-detail-row.js`): attached
equipment left of the focus (resolved from the wire's name-only
`equipmentAttachments` through the catalog), the focus card, then the
card's compiled `relatedCards` (see [CARD_RELATIONS.md](./CARD_RELATIONS.md)),
with each attachment's own closure folded in at open time under the same
never-repeat rule. The list is static for the overlay's lifetime — changing
focus never rebuilds it.

**Layout and sizing:** the focus slot sits slightly right of screen center
(55% of the viewport) so the equipment column has room on its left. Every
card is a full-size card-vertical in a slot; non-focus slots shrink by a
slight graded scale per step of distance from the focus (−5% per step with a
0.65 floor), neighbors overlap their slots slightly, and z-index falls off
with distance from the focus — both recomputed on every focus change. The
scale falloff, overlap, and focus position are component constants tuned in
the browser.

**Interactions:**

- wheel/trackpad scroll steps the focus one card at a time (snapped, no wrap),
- clicking a side card focuses it,
- horizontal drag with pointer capture pans the row and snaps back to card
  alignment on release; a press that never crosses the movement threshold
  stays a click, so drags neither close the overlay nor misfire card clicks,
- left/right arrow keys move the focus while the overlay is open,
- Escape and backdrop click close it.

Opening and closing FLIP-zoom the focus card between its slot and the source
card the overlay was opened from (reduced motion renders without zoom);
opening again while open replaces the open overlay. Card links inside the
rendered text navigate: clicking one moves the row's focus when the target
is in it, and otherwise opens the overlay for that card (see
[TOOLTIP_SYSTEM.md](./TOOLTIP_SYSTEM.md) for the link hover sources).

## Testing

The view models and wire projections behind the component are covered by
`public/tests/game/viewModels.test.js` and the server suites around
`Card.toSanitizedObject()` and the GameState condition projections. The
overlay's row assembly is pure and unit-tested in
`public/tests/utils/card-detail-row.test.js`; the component scripts
themselves are DOM code without a test harness.
