# Card Relations

Every compiled card carries an optional **`relatedCards`** list — the
deduplicated, recursively closed, deterministically ordered set of cards it
relates to. It is stamped at compile time (`scripts/lib/card-relations.js`,
stamped after cardId/slug assignment in both compile pipelines) and is the
data contract behind the card detail overlay's related-card carousel. The
segment format the mentions derive from is defined in
[COMPILED_CARD_DSL.md](./COMPILED_CARD_DSL.md#display-text-and-links); this
document owns the relation contract itself.

---

## Relation kinds

Entries are `{ cardId, kind }` — the runtime `cardId` is a name-sorted
compile-time index, resolved against the catalog on the client, never stored
(see [DECK_COLLECTION.md](./DECK_COLLECTION.md)). Where each kind's data
comes from:

| Kind           | Source                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `evolution`    | The compiler's resolved evolution pair: `evolvedFrom` on the later stage, `evolveInto.cardId` on the root (both directions are stamped).                  |
| `ignition`     | The resolved ignition pair: `ignitedFrom` / `igniteInto.cardId` (both directions).                                                                       |
| `mention`      | This card's text points at the target — explicit `card`/`series` link segments plus the machine-readable references the DSL already carries: the `name`/`series` fields of the target descriptors under `card`, `target`, `targets`, and `source`, `cardName`, `cardNames`, and `unit_on_board` requirement names. A series reference counts as a mention of every card in that series. |
| `mentioned-by` | The reverse of `mention`, computed from every card's forward references.                                                                                  |
| `series`       | Cards sharing the card's authored `series` code, with no reference between them.                                                                          |

The overlay adds one runtime-only column outside this stamp: a deployed
unit's attached equipment (the wire's name-only `equipmentAttachments`,
resolved through the catalog) renders as equipment cards to the left of the
focus, tagged "Equipment" — that is client-side assembly
(`public/utils/card-detail-row.js`), not part of the compiled stamp.

## Order

The list is a breadth-first traversal over all edge kinds until closure.
Edges are examined from each card in a fixed priority — evolution/ignition,
then mentions, then reverse mentions, then series siblings — with ties broken
by `cardId` (the name-sorted index). The resulting order is a data contract:
the carousel renders it as-is.

## Dedup

A card is never repeated: the first edge kind that reaches it wins its
relation kind. This also makes reference cycles safe — traversal stops at
already-seen cards.

## Sparse contract

A card that relates to nothing carries no `relatedCards` field at all;
references that resolve to no compiled card (an unlinked machine reference
the compiler never validated) contribute nothing. Link targets, by contrast,
are compile errors when unresolvable.

## Client consumption

The card detail overlay assembles its row from the focus card's stamp plus
runtime attachments (`public/utils/card-detail-row.js`): equipment left,
then the focus card, then the stamp's order — each attached equipment's own
closure folds into the right-hand list at open time under the same
never-repeat rule, so a card both attached and statically related stays in
the equipment column. Relation kinds map to the carousel's tags
("Evolves from", "Ignited", "Mentions this", "Mentioned in",
"Series: <code>", "Equipment").
