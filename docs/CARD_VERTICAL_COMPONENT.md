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

The container must be attached to the document, and the renderer runs only
after the component's own stylesheet is applied: the renderer fits fonts and
measures geometry, and freshly inserted markup is laid out unstyled until its
`<link>` loads.

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
  Runtime conditions and traits are stamped the same way by the GameState
  projections, and both carry the catalog's `numeric` flag with the value to
  show for it (`magnitude` on a condition, `value` on a trait); a printed
  trait carries its own value on the card view.
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
  requirements, and the unit's equipment attachments (one icon for any number
  of them). The list is built by `public/utils/unit-header-icons.js`, which
  the horizontal card face draws its own header ribbons from, so both faces
  state the same features in the same order. Header icons render only when the
  card has the feature and are hover-only; each explains itself through the
  shared tooltip component.
  The compact deployed-unit face is documented in
  [UNIT_CARD_HORIZONTAL_COMPONENT.md](./UNIT_CARD_HORIZONTAL_COMPONENT.md).
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
  tooltip, and the strip label ("Traits" / "Conditions") when empty. Both
  strips state what is true on the board, because both are handed the unit's
  runtime state: a deployed unit shows the traits it actually has (printed
  ones plus anything granted, minus anything silenced) and the conditions on
  it, while a card that is not on the field has no runtime state and shows
  what it prints. A numeric entry carries its number as a badge in its icon's
  bottom-right corner, and the tooltip titles the entry with it ("Resilient
  3"). The badge is positioned absolutely, so it floats over the artwork
  without adding to the strip's flex layout or changing any measured box.
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

**Layout and sizing:** the focus slot sits at the middle of the viewport, with
the equipment column to its left. Every card is a full-size card-vertical in a
slot; non-focus slots shrink by a slight graded scale per step of distance from
the focus (−5% per step with a 0.65 floor), neighbors overlap their slots
slightly, and z-index falls off with distance from the focus — both recomputed
on every focus change. The scale falloff, overlap, and focus position are
component constants tuned in the browser.

**Opening order:** the slots are created first and the focus card is mounted
before anything else, because the focus card is what the entrance zoom flies from
the source card and it hides every side card while they are parked behind it. The
rest of the row mounts once the row is already on screen, behind the focus card
and invisible there. Slot footprints come from the stylesheet rather than from
the cards inside them, so the row's geometry — and therefore the entrance — does
not wait on the side cards at all. Building the whole row first cost the reader
the length of about eleven card mounts (each fits two blocks of text and mounts
about ten tooltips) before the first frame could paint.

The row is deliberately not kept promoted: `will-change: transform` on it made
the browser rasterize the cards inside at whatever scale the graded animation
last asked for and never re-rasterize them, leaving every card that had
animated its scale permanently soft.

Centering is arithmetic, not measurement (`public/utils/card-detail-layout.js`):
the slot footprint at scale 1 is read once when the row is built, and every
row offset is derived from the scales the overlay applied. Slot footprints and
the cards inside them transition to their new scale, so a card measured
immediately after a focus change reports the scale it is leaving, and the row
would land short by exactly the distance still in flight.

**Interactions:**

- wheel/trackpad scroll steps the focus one card at a time (snapped, no wrap),
- clicking a card focuses it,
- left/right arrow keys move the focus while the overlay is open,
- clicking an ability line of the focus card runs the page's ability handler and
  closes the overlay: the ability is played on the board underneath, which the
  overlay would otherwise hide while the player picks its target,
- Escape, a right-click anywhere in the overlay, or a click outside a card
  closes it.

Opening and closing FLIP-zoom the focus card between its slot and the source
card the overlay was opened from (reduced motion renders without zoom), and
opening again while open replaces the open overlay. The opening placement lands
without transition, in the frame the overlay appears in, and motion is enabled
only afterwards: an animated initial transform slides the row in from the
overlay's left edge, and the entrance zoom would measure a card that is still
travelling. Card links inside the rendered text navigate: clicking one moves
the row's focus when the target is in it, and otherwise opens the overlay for
that card (see [TOOLTIP_SYSTEM.md](./TOOLTIP_SYSTEM.md) for the link hover
sources).

## Card back and flipping

A vertical card turns over on a left click. Its back is the card's other face:
the same frame, the same panel, and a title row of the same height and bounds as
the front's, carrying the type icon on the left, the card's name, and the face
counter (`2/3`) on the right. Under that title row it shows the card's sections,
one per header icon, in the same canonical order the icons are drawn, each
labeled with that icon's own tooltip title and carrying **only** the card's
game-relevant text: an attribute's effect lines, evolve and ignite triggers,
passive abilities, and requirements. The attribute's lore and the glossary
concept lines stay in the tooltips; the back is for playing, the tooltip is for
reading. Equipment attachments describe runtime state, not the card, so they
stay off the back, as do the artwork, the stats, the trait and condition strips,
and the rank. The sections come from the same list the header icons use
(`public/utils/unit-header-icons.js`), so a card states the same features either
way.

**A back face holds whole sections.** The card's information does not have to
fit one face: the component measures its sections against the face's own content
box and breaks between two of them, so the reader meets a labelled block and
never half of one. A break is only ever placed between sections — that is the
rule, and it is why a face is never filled with the tail of a block. A section
too tall for an empty face still gets a face of its own rather than being cut.
Every click turns the card again to the next face, and the click after the last
face returns it to the front; the counter states which face is showing. Because
the whole card is laid out in `em`, the same card divides in exactly the same
places at both card sizes — one size can never disagree with the other about
what a face holds.

**No face, and nothing on one, has a minimum size.** A face is never made to fit
by shrinking its text to a floor and clipping the rest: that silently loses
information and is what makes two sizes of the same card disagree. The fit's
`min` is a floor for a box that must not change the card's geometry (the front's
text area), and it has no place on the back. Content that does not fit opens
another face.

**The card states its own type scale.** Its text elements are scoped to the frame
(`.card-vertical-frame .card-vertical-back-label` and siblings) rather than left
as single classes, because a host page's typography can be more specific than one
class and would otherwise reach inside the card. The cards page styles
`.cards-section h2`, which is more specific than the back label's own class and
drew every section label at the page's heading size — 25.6px inside a card whose
own type is 4.8px — so the labels no longer fit the card and the two card sizes
stopped agreeing. A card renders its own type whatever page it is mounted on.

The turn (`public/utils/card-flip.js`) rotates the frame edge-on, draws the face
being turned to while it is edge-on, and rotates back, or lands instantly when
the reader prefers reduced motion. The turn is an animation on the frame's own
`rotate` property, not a CSS transition: the card detail overlay switches
transitions off on its cards so they land in place instead of sliding in from
the row's left edge on open, which a transition-based turn would silently inherit
and lose.

The turn pivots on the card's own centre at both sizes, and the overlay's big card
is what makes that worth stating: it centres the card with the frame's own
`translate` property rather than a `translate()` inside `transform`, because
`rotate` and `translate` compose as separate properties (translate, then rotate,
then scale) whereas a `translate()` in `transform` sits inside the rotation and
shifts the centre it turns about — a card centred that way swings around its left
edge. The entrance zoom (`BASE_TRANSFORM` in the overlay) is the scale alone for
the same reason: the frame's resting placement is its `translate`, so the
animation states the scale and the two never state the same offset twice. Every
turn, including the return to the front, uses the same motion.

A card is turned back to its front by a click anywhere else on the page: a back
is something the reader asked to see for a moment, not a state a card keeps.

Flipping is on by default for a clean left click, and the surfaces that own that
click turn it off: the deck builder's pool (a click adds a copy), a deck-table
fan (its row opens or locks the deck), and a link-hover preview card. Two
surfaces need more than a flag:

- the card detail overlay turns the card's own click on for the card in focus
  only, and returns a card that is not in focus to its front, so a back never
  ends up on a shrinking side card;
- a board hand card never receives a click: mousedown clones the drag ghost, so
  the page treats a press that never moved as the click and turns the card over
  itself (`DRAG_THRESHOLD_PX` in `public/pages/game/script.js`). The card it was
  pressed on is hidden once the drag actually starts, not on mousedown: a
  `visibility: hidden` card stops matching `:hover`, and the browser does not
  re-hit-test until the pointer moves again, so hiding it up front left a card
  clicked in the hand at its un-hovered size under a motionless cursor.

## Card hover

A small card grows while the pointer is on it. The surface that lays the cards
out owns that state: it marks the card under the pointer with
`card-vertical-hovered` (`trackCardHover` in `public/utils/card-flip.js`, and the
board hand's own cursor tracking), and the stylesheet reads that class alongside
`:hover`. The browser's own hover is not enough on its own, because a card being
turned paints nothing while it is edge-on — it stops being the element under the
pointer, its `:hover` is cleared on the way through, and the browser does not
hit-test again until the pointer moves.

Two rules make the mark behave on a grid of cards. The marked card keeps the mark
while the pointer is inside it, because a grown card overflows the space it has in
the layout and covers its neighbours: without that rule, moving the pointer within
a grown card handed the mark to a card underneath and left the first stuck at its
grown size. And the cards' resting boxes are read when the mark moves rather than
on every pointer event, because a grid of a hundred cards would otherwise pay a
hundred layout reads per movement.

## Testing

The view models and wire projections behind the component are covered by
`public/tests/game/viewModels.test.js` and the server suites around
`Card.toSanitizedObject()` and the GameState condition projections. The
overlay's row assembly and layout geometry are pure and unit-tested in
`public/tests/utils/card-detail-row.test.js` and
`public/tests/utils/card-detail-layout.test.js`; the component scripts
themselves are DOM code without a test harness.
