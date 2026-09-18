# Unit Card Horizontal Component

`public/components/unit-card-horizontal/` renders the compact card face a
deployed unit shows on the battlefield. It is a landscape card: artwork, a
single row of live-state icons, and the unit's stats. The vertical card
(`docs/CARD_VERTICAL_COMPONENT.md`) is the full card face for every card type;
this one exists because a board line shows many units at once at roughly
one-sixth the width.

## Usage

Loaded through the component registry in `public/utils/component-util.js`:

```js
loadComponent(container, "unit-card-horizontal", { unit, interactive, onAbilityClick });
```

- `unit` is a `buildUnitViewModel` view (`public/game/viewModels.js`) — a
  deployed unit, never a bare card. A missing or malformed view renders the
  card back and nothing else.
- `interactive` and `onAbilityClick` are passed only for the viewer's own
  units: clicking an ability line in the artwork tooltip then emits the use
  action. An opponent's card omits both and its ability lines are inert.
- Right-clicking the card opens the card detail overlay focused on the unit,
  with its attached equipment to the left and its related cards to the right
  (see `docs/CARD_VERTICAL_COMPONENT.md`).

## Data contract

The component consumes the flattened unit view only; it never reads the wire
payload or the card catalog, and it never mutates the view. Everything it
draws is either a printed card field, the unit's runtime state, or a catalog
entry the view already carries:

- `artworkPath`, `name`, `abilities`, `grantedAbilities` — the artwork and its
  hover tooltip (the unit's abilities, then its equipment-granted ones in
  italic; see `docs/TOOLTIP_SYSTEM.md`).
- `equipmentAttachments`, `attributes`, `evolveTriggers`, `igniteTriggers`,
  `passiveAbilities`, `requirements` — the header ribbons.
- `runtimeTraits`, `conditions` — the live-state strip.
- `placedPositionCode`, `chosenPositionCode`, `positions` — the position stat.
- `currentHp`, `maxHp` — the hp stat.

Both icon rows and the position stat degrade to a catalog placeholder icon
when an entry carries no `iconPath` (`/assets/icons/traits/placeholder.png`,
`/assets/icons/conditions/placeholder.png`,
`/assets/icons/positions/placeholder.png`).

## Layout

The card splits into three vertical parts, in this order:

- **Header ribbon (overlay):** the unit's printed features and its equipment,
  one icon per feature, right-aligned and reading outward in the same order
  and with the same tooltips as the vertical card's header row — equipment,
  attributes (canonical attribute order), evolve, ignition, passives,
  requirements — with the equipment attachment icon leftmost. Any number of
  attachments draws exactly one equipment icon, whose tooltip lists them. The
  ribbon is absolutely positioned against the card's top edge, so it paints
  over the artwork's top sliver and takes no space in the card's flow: an
  icon-free card's artwork and stats sit exactly where a fully featured card's
  do. Icons past the card's width are clipped; the vertical card carries the
  full list. The icon list itself is built by
  `public/utils/unit-header-icons.js`, shared with the vertical card.
- **Artwork:** fills the space the other parts leave (flex `1`, `min-height:
  0`), so missing or extra content on other cards in a line can never move it.
- **Live-state strip:** the unit's traits and conditions as bare icons in one
  row between the artwork and the stats — every trait, then every condition,
  in the order the unit view delivers them — built by
  `public/utils/unit-trait-strip.js`. A numeric entry floats its number in the
  icon's bottom-right corner, exactly as the vertical card's strips do. The
  row is centered, clips what does not fit the card's width (which varies with
  the line's occupancy), and reserves its height on every card, so a unit with
  no traits and no conditions keeps the same artwork and stats geometry as its
  neighbours.
- **Stats:** the position the unit stands in, plus the position a landmark
  choice moved it to when that differs (outlined), and its hp. The two are one
  flex share each, so neither can take width from the other as the card's own
  width changes. The hp stat draws only the unit's current hp; below its
  maximum the number renders in the card faces' accent yellow, and the
  tooltip titles itself with the current and maximum ("3/5 HP") over the
  glossary's hp copy.

## Sizing the icons, and equal widths in a line

Both icon rows state their size in one place each, in ems on the card root:

| Variable                   | Current | What it sizes                                            |
| -------------------------- | ------- | -------------------------------------------------------- |
| `--unit-card-strip-height` | `2em`   | The live-state strip's row, and so the height it reserves |
| `--unit-card-icon-size`    | `1.3em` | The trait and condition icons in that row                 |

The header ribbon's height (`2.4em` on `.unit-card-horizontal-ribbon`) and its
icons (`1.35em` on `.unit-card-horizontal-ribbon-icon img`) are the same kind of
value for the top row. Raise any of them to enlarge; the artwork absorbs the
change, and every card in a line absorbs it identically. The strip's row height
is reserved on every card, which is what keeps the artwork and the stats at the
same geometry whether or not a card has traits or conditions.

Both rows hang inside the card's padding: the ribbon clears the top and right
edges (`top: 0.25em`, `right: 0.5em`) so the card's own highlight, the yellow
outline the drop-target glow draws on the card, stays visible around it, and it
carries `z-index: 1` so the card can never paint over the bands.

The icons must stay definite ems, never a percentage of their row. A percentage
height is unresolvable while the card itself is being sized, and the browser
then falls back to the icon file's natural width, which once made a card
carrying two trait icons demand a thousand pixels, overflow its line, and
squeeze its icon-free neighbours to a sliver.

The component's host (`.unit-card-horizontal-component`, the flex item the page
puts in the line) and the card's own parts also carry `min-width: 0`, which
overrides the automatic content-based minimum a flex item otherwise has, so no
card's content can ever decide its width. Every card in a line is the width its
line gives it.

## Testing

The two icon-list modules are pure and covered by
`public/tests/utils/unit-header-icons.test.js` and
`public/tests/utils/unit-trait-strip.test.js`. The component script itself is
DOM code without a test harness, like the other card faces.
