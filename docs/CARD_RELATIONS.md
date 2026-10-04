# Card Relations

Every compiled card carries an optional **`relatedCards`** list, the
deduplicated, recursively closed, deterministically ordered set of cards it
relates to. It is stamped at compile time (`scripts/lib/card-relations.js`,
stamped after cardId/slug assignment in both compile pipelines) and is the
data contract behind the card detail overlay's related-card carousel. The
segment format the mentions derive from is defined in
[COMPILED_CARD_DSL.md](./COMPILED_CARD_DSL.md#display-text-and-links); this
document owns the relation contract itself.

---

## Entries

An entry is `{ cardId, kind, peerCardId, tier }`, plus `seriesCode` on the two
series kinds. `cardId` is the related card the carousel renders in a side
slot, `peerCardId` is the card on the other end of the relation, and `kind`
is directional: it states the tagged card's own relation to the peer, never
the reverse. `tier` says whether the card is a relation the stamped card owns
(see [The relation graph](#the-relation-graph)). Both ids are runtime `cardId`s:
name-sorted compile-time indexes the client resolves against the catalog and
never stores (see [DECK_COLLECTION.md](./DECK_COLLECTION.md)).

| Kind               | The tagged card ...                                      | Rendered tag                   |
| ------------------ | -------------------------------------------------------- | ------------------------------ |
| `evolves-into`     | is the earlier stage of an evolution pair with the peer   | `Evolves into <peer>`          |
| `evolves-from`     | is the later stage of an evolution pair with the peer     | `Evolves from <peer>`          |
| `ignites-into`     | is the base of an ignition pair with the peer             | `Ignites into <peer>`          |
| `ignited-from`     | is the ignited form of the peer                           | `Ignited from <peer>`          |
| `mentions`         | names the peer in its own copy                            | `Mentions <peer>`              |
| `mentioned-in`     | is named in the peer's copy                               | `Mentioned in <peer>`          |
| `series-mentioned` | belongs to a series the peer's copy names (`seriesCode`)  | `<Series> series mentioned by <peer>` |
| `same-series-as`   | shares its series with the peer                           | `Same series as <peer>`        |

`relationTag` (`public/utils/card-detail-row.js`) renders those tags. It
resolves the peer's display name per entry from the row (the focused card,
another row card, or an attachment) and derives the series display name from
the code, so `jeonsul-baang` reads as `Jeonsul Baang`. The overlay's
equipment column is client-side only. A deployed unit's attached equipment
(the wire's name-only `equipmentAttachments`, resolved through the catalog)
renders as equipment cards to the left of the focus, tagged
`Equipped to <focus>`. It is never stamped into the artifact.

## Sources

Where each kind's data comes from:

- **Evolution and ignition.** The compiler's resolved pair: `evolvedFrom` on
  the later stage and `evolveInto.cardId` on the root, mirrored by
  `ignitedFrom` and `igniteInto.cardId` for equipment. A pair is stamped from
  both sides, so the root's entry for the later stage reads `evolves-into`
  and the later stage's entry for the root reads `evolves-from`.
- **Mentions.** This card's text: explicit `card`/`series` link segments plus
  the machine-readable references the DSL already carries (the `name`/`series`
  fields of the target descriptors under `card`, `target`, `targets`, and
  `source`, `cardName`, `cardNames`, and `unit_on_board` requirement names).
  Naming a card puts `mentioned-in` on the namer's own entry for the named
  card, and `mentions` on the named card's entry for the namer. Naming a
  series names each of its members: the namer carries one `series-mentioned`
  entry per member, with the code, and each member carries the namer as
  `mentions`.
- **Inherited mentions.** The shared catalog copy a card **carries or names**
  (`scripts/lib/catalog-mentions.js`). Carries: its attributes, printed
  traits, and positions. Names: a shared-catalog reference anywhere in its
  nodes, machine-readable (`card: { attribute: hwayeomsa }`) or as a link
  segment (`[[attribute:Hwayeomsa]]`), a condition it applies, or a glossary
  entry it links. Each inherited mention is recorded as if the copy were the
  card's own copy, so its peer is the card itself: the card gains the peer's
  `mentioned-in` entry, and the peer gains a `mentions` entry naming the card.
  This is why Fiery Elephant and Healing Flames, which name the Hwayeomsa
  attribute rather than carrying it, carry the same Fire Core entry as
  Evankhell and Yeon Yihwa, which carry the attribute. Inherited references
  join the card's own at the same mention edge, after them.
- **Series.** A card's authored `series` code. A member reached through a
  peer's `series` field is tagged `same-series-as` with that peer.

## Order

The list is a breadth-first traversal from the card over all edge kinds until
closure. Each card's edges are examined in a fixed priority: evolution,
ignition, card mentions, series mentions, reverse mentions, then series
siblings. Ties break by `cardId`, the name-sorted index. The resulting order
is a data contract: the carousel renders it as-is.

Series mentions have precedence inside a step: a card whose copy names a
series expands that reference to every member there and then, before the
traversal recurses into any of them. Every member keeps the series mention
instead of being claimed one at a time by the `same-series-as` edges of a
sibling processed first. Sibling entries therefore arise only where a single
member is reached by name and that member's own `series` field pulls in the
others, with the member as the peer.

## Dedup

A card is never repeated: the first edge kind that reaches it wins its `kind`
and `peerCardId`. This also makes reference cycles safe: traversal stops at
already-seen cards.

Two edges can reach the same card, and only one of them survives, so an entry
states how the list reached a card and not everything true of it. A card whose
earlier stage is also in its series carries one entry for it, under whichever
edge the traversal examined first, and the entry's `tier` follows from that
edge.

## The relation graph

The closure is a directed graph. An arrow runs from a card to each card **its own
copy names**: an explicit card link, a machine-readable reference, a series code,
and the stage its evolve or ignite block names. A card that is named in someone
else's copy does not get an arrow out of that. The arrow points from the namer to
the named, so being named is something that happens to a card, never something it
does.

Each kind's direction, read on a card F's own list. Every entry there has F as
its peer, so the kind states which way the arrow runs between the two:

| Kind | Arrow | The tagged card is |
| --- | --- | --- |
| `mentioned-in` | F to card | named in F's copy |
| `series-mentioned` | F to series to card | a member of a series F's copy names |
| `evolves-from` | F to card | the stage F's evolve block names |
| `ignited-from` | F to card | the form F's ignite block names |
| `mentions` | card to F | a card whose copy names F |
| `evolves-into` | card to F | a card whose evolve block names F |
| `ignites-into` | card to F | a card whose ignite block names F |
| `same-series-as` | neither | a card that shares F's series code |

`tier` says whether the card is a relation **F owns**, and the direction of the
walk decides it, not the kind:

- `primary` is every card reachable from F by following arrows forward, however
  many steps that takes. A card three arrows away is as primary as one arrow
  away, because F's copy leads to it.
- `secondary` is everything else the closure holds, which is every card reached
  by travelling against an arrow.

Three consequences follow, and all of them are load-bearing:

- A kind's arrow does not decide the tier. The entry and the reach are computed
  independently, and the entry keeps the kind of whichever edge claimed the card
  first, so an entry can carry a kind whose arrow points the other way and still
  be primary because another reference of the same card reaches it forward.
- As a rule the two ends of a pair land in opposite tiers: a card that names F is
  primary on its own list and secondary on F's, because from F the arrow into it
  points the wrong way. It is a rule and not a law, because a card can name the
  other end twice: Khun Ran II's copy names Khun Ran, so the evolution pair is
  primary from both ends and neither entry is secondary. Only the reach decides.
- Naming a series reaches every member in one forward walk, because the arrow
  goes from the namer to the code and from the code to each member. The members
  are primary, and the cards that name F are not.

### Example: Rak Wraithraiser

Its copy names Rak Wraithraiser II, and Rak Wraithraiser II's own copy names Rak
Wraithraiser III. The arrows run one way, in that order.

| Card | Kind | Tier | Why |
| --- | --- | --- | --- |
| Rak Wraithraiser II | `evolves-from` | primary | the evolve block names it |
| Rak Wraithraiser III | `evolves-from` | primary | reached through Rak Wraithraiser II, which the evolve block names |

Rak Wraithraiser III is two arrows away and still primary. A single-step rule
would put it behind the reveal, which is wrong: the card's own copy leads to it.

### Example: Narumada - Ignited

The arrow between the ignition pair runs from the base card to its ignited form,
because the base card's ignite block names it. Narumada - Ignited has an ignite
block too, but an empty one: it names nothing.

| Card | Kind | Tier | Why |
| --- | --- | --- | --- |
| Narumada | `ignites-into` | secondary | the arrow runs from Narumada into this card, so it is reached against it |

From Narumada - Ignited, Narumada is one step away and secondary, because the
only arrow between them points the other way.

### Example: Fire Core

Fire Core names the `incinerate` series. The `hwayeomsa` attribute's effect line
is `create [[card:Fire Core]] in your hand`, so every card that carries the
attribute, and every card that merely names it in a condition it applies, gains
that mention of Fire Core: Evankhell and Yeon Yihwa carry it, and Fiery Elephant
and Healing Flames name it. All four inherit the same mention.

| Card | Kind | Tier | Why |
| --- | --- | --- | --- |
| Incinerate I to IV | `series-mentioned` | primary | the copy names the `incinerate` series, whose members these are |
| Yeon Yihwa, Evankhell, Fiery Elephant, Healing Flames | `mentions` | secondary | each names Fire Core, an arrow pointing into this card |

The four units all inherit the same mention, whether they carry the attribute or
only name it, and an inherited mention is treated exactly like one the card makes
itself. What makes them secondary is the direction, not the inheritance.

Fire Core is primary on each of those four lists, and secondary on Incinerate I's,
which names nothing and whose whole list is therefore reached against an arrow. A
card's tier is a fact about that card's own copy.

### Example: Twenty-Fifth Baam

| Card | Kind | Tier | Why |
| --- | --- | --- | --- |
| Twenty-Fifth Baam II | `evolves-from` | primary | the evolve block names it |
| Enryu's Thorn | `mentioned-in` | primary | the copy names it |
| First to Fourth Thorn Fragment | `series-mentioned` | primary | the copy names the `thorn-fragment` series |
| Baang | `mentioned-in` | primary | Baam II's copy names Baang, so the walk reaches it two arrows out |
| Quaetro Blitz, Yu Han Sung | `mentions` | secondary | their copy names Baang, reached through Baang and against an arrow |
| Submerged Fish | `mentioned-in` | secondary | Yu Han Sung's copy names it, likewise against an arrow |

### Example: Baang

Baang's copy names nothing at all. Every card on its list is a card that names
Baang, or a card reached through one of those, so the whole list is secondary and
the row opens with nothing but the focus card and the button.

## Sparse contract

A card that relates to nothing carries no `relatedCards` field at all;
references that resolve to no compiled card (an unlinked machine reference
the compiler never validated) contribute nothing. Link targets, by contrast,
are compile errors when unresolvable.

## Test cards

Test cards (`_Test*`, see `server/utils/test-card.js`) are outside the graph:
`stampRelatedCards` builds it over the public pool only. The served catalog
filters test cards out (`GET /cards/data`), so a relation naming one could
never render — it would list a card the client cannot find, or leave a slot
whose tag names a peer it cannot resolve. Their copy must also not route a
real card into a closure it has nothing to do with, which is how a dev card
naming another card once pulled that card, and everything it relates to, into
a real card's carousel. Filtering inside the stamp leaves `cardId`s untouched
(they are assigned first), so an excluded card simply carries no relations in
either direction.

## Client consumption

The card detail overlay assembles its row from the focus card's stamp plus
runtime attachments (`public/utils/card-detail-row.js`): equipment left, then
the focus card, then the stamp's order split by `tier`. `right` holds the
primary tier, which is what the row shows; `more` holds the secondary tier,
which sits behind the reveal slot until the reader asks for it. Each attached
equipment's own closure folds into the same two lists at open time under the
same never-repeat rule, so a card both attached and statically related stays
in the equipment column. An attachment is a second root, so its entries are
tiered against the attachment rather than against the focus: a card the
attachment names is primary even though it is two steps from the focus.

Peer names are resolved once when the row is built, and each side slot's tag
comes from its entry's kind through `relationTag`. A revealed card is a row
card in every respect: same tag, same graded scale, same focus behaviour, and
no mark of which tier it came from.

Every rendered slot carries a tag: an entry whose tag cannot be produced — an
unknown kind, a peer the catalog does not name, a series entry with no series
code — is dropped, and the next edge that reaches that card takes the slot.
That is what keeps a stamp/catalog mismatch from showing as a related card
claiming nothing. An entry carrying no `tier` at all is held in `more` rather
than dropped: a stamp written before the field existed has no claim to the
default tier, but dropping it would lose a relation the overlay used to show.
