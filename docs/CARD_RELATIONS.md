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

An entry is `{ cardId, kind, peerCardId }`, plus `seriesCode` on the two
series kinds. `cardId` is the related card the carousel renders in a side
slot, `peerCardId` is the card on the other end of the relation, and `kind`
is directional: it states the tagged card's own relation to the peer, never
the reverse. Both ids are runtime `cardId`s: name-sorted compile-time indexes
the client resolves against the catalog and never stores (see
[DECK_COLLECTION.md](./DECK_COLLECTION.md)).

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
  Naming a card puts `mentioned-in` on the named card's entry and `mentions`
  on the naming card's. Naming a series names each of its members, so every
  member carries `series-mentioned` with the code, and each member sees the
  namer in reverse as `mentions`.
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

## Sparse contract

A card that relates to nothing carries no `relatedCards` field at all;
references that resolve to no compiled card (an unlinked machine reference
the compiler never validated) contribute nothing. Link targets, by contrast,
are compile errors when unresolvable.

## Client consumption

The card detail overlay assembles its row from the focus card's stamp plus
runtime attachments (`public/utils/card-detail-row.js`): equipment left,
then the focus card, then the stamp's order. Each attached equipment's own
closure folds into the right-hand list at open time under the same
never-repeat rule, so a card both attached and statically related stays in
the equipment column. Peer names are resolved once when the row is built,
and each side slot's tag comes from its entry's kind through `relationTag`.
