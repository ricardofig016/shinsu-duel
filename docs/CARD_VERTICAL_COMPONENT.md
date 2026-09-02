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
- `isSmall` scales the card for hand rendering and enables right-click zoom
  into a big copy. `onAbilityClick(code)` wires unit ability clicks; the page
  passes it only where clicking is meaningful (its own field units).

## Data contract

The component consumes only the flattened view models from
`public/game/viewModels.js`, which mirror the server card view produced by
`Card.toSanitizedObject()` (`server/game/Card.js`):

- Printed content arrives as display-ready strings: `rank`, `requirements`,
  `effects`, `rules`, `evolveTriggers`, `igniteTriggers`.
- Looked-up metadata arrives as code-keyed dictionaries stamped with
  `name`, `description`, and `iconPath`: traits, positions, affiliations,
  attributes. Runtime conditions are stamped the same way by the GameState
  projections.

The component renders placeholders for missing artwork/icons but never
mutates the view models.

## Layout per card type

- **Name row:** the type letter (`assets/icons/types/`; landmarks carry
  `landmark.png` despite being units), the name (left-aligned after the
  letter), and the header icons — requirements, passive abilities, evolve,
  ignition, and one icon per attribute. Header icons render only when the
  card has the feature and are hover-only; each explains itself through the
  shared tooltip component.
- **Artwork:** two opaque trapezoids textured with the card's
  `background.png` overlay the top and
  bottom. Both have a wide (base) edge of 2/3 of the artwork width and a
  narrow edge of 1/2, with a height of 9% of the artwork; the top one is
  flush with the artwork's top edge, the bottom one with its bottom edge.
  Their text renders at the card's base size (1em). The top one
  shows the rank of standard-kind units only. The bottom one shows the
  first affiliation; standard and landmark units keep the "Affiliations"
  placeholder when empty, other kinds show nothing. With more than one
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

## Testing

The view models and wire projections behind the component are covered by
`public/tests/game/viewModels.test.js` and the server suites around
`Card.toSanitizedObject()` and the GameState condition projections. The
component script itself is DOM code without a test harness.
