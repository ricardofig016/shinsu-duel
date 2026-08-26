# TODO List

## Tasks

- [ ] frontend: change board background to something from the webtoon
- [ ] plan: audit phase 2 again
- [ ] public: plan how image artworks should be matched to cards
- [ ] rules: add contracts from `todo\contracts.md`
- [ ] rules: reaudit ambiguities in RULES.md (`plans\prompts\find_ambiguities_in_rules.md`)
- [ ] game: add support for position:`any`
- [ ] rules: create a `RULES_TLDR.md` that are the default rules shown in the rules page
- [ ] units: rethink `conduit` kind - maybe generalize as `construct`
- [ ] cards: dynamically mark all cards in `data\cards\test` as unreachable

## In Progress


## Completed

- [x] rules: revisit action switch position - it now costs the combat slot of the position it leaves
- [x] rules: add `steal` keyword
- [x] rules: rename `create` keyword to `light up` - "create" is overloaded with 2 meanings
- [x] LifecycleEngine: the LIW check in `attachEquipment` compares against the spaced string "living ignition weapon" while compiled card attributes are the dashed "living-ignition-weapon"
- [x] data: add yml files for new cards in `todo\cards_to_add.md`
- [x] scripts: fix lookup after yml structure changes
- [x] tests: add more to increase coverage
- [x] tests: organize server\game\tests better - there's too many tests directly in tests\
- [x] docs: fix newline based line wrapping - switch to single line paragraphs
- [x] game: remove `Math.random()` as fallback if no seed is provided. all games must be seeded
- [x] rules: think about max copies of a card during deckbuilding (maybe 3) - revisit Baang
- [x] data/cards: support folders for organization
- [x] rules: update jeonsulsa attribute in RULES.md
- [x] data: implement Disabled, Blinded, and Undying
- [x] data: change Creator and Dealer from `When I am deployed` to `Round start`
- [x] lookup: sending results in duplicated `>npm run lookup living ignition weapon: Twenty-Fifth Baam (attributes=living ignition weapon, attributes=living ignition weapon, attributes=living ignition weapon)`
- [x] data: rename all ` (evolved)`/` (ignited)` cards to ` - Evolved`/` - Ignited`
- [x] rules: add Disabled condtion - passives turned off
- [x] rules: add Blinded condtion - targeted abilities are instead chosen at random
- [x] rules: add Undying trait - when i would die, i survive with 1hp instead
- [x] data: make Conduit card pass validation
- [x] generic: irregular attribute is being confused with living ignition weapon
- [x] targetting engine: make sure taunt enforces first target on mass-target effects
- [x] targetting engine: sharpshooter bypasses taunt when it should not
- [x] targetting engine: enemy lighthouses should be targetable when no non-ghost enemies are on the board
- [x] ZoneService: should not skip draw on Unreachable cards, this is the job of the deck validator. unreachable cards may be created in deck during the game
- [x] ZoneService: what is compressAmount and why is it stored in `playerState`?
- [x] LifecycleEngine: deployUnit on full line (5 units) destroys oldest instead of player choice (should choose between the 5 or cancel)
- [x] GameState: Event Catalog legacy events (PascalCase `OnGameStart`) should be removed, only canonical events should be used (EVT `game:started`)
- [x] write rules regarding shinheuh and animas
- [x] add passives to cards (this is in the notebook)
- [x] add a new negative trait around silencing
- [x] add unit test for too many fields in ActionHandler.validateSchema
- [x] refactor GameState processAction method to an ActionHandler interface class
- [x] refactor 'abilityCodes' to 'abilities' in cards.json (flattened all *Code(s) suffixes)
- [x] refactor "combat indicator" everywhere to "combat slots"
- [x] change how turn switching works at round end to align with new rules: players should always alternate turns, even after round end
- [x] switch places of the position indicators from the beggining of the line to the end of the line, to align with the unit card when it is played, as new units are placed after the existing units on that line
- [x] change GameState file name to the class name
- [x] update trait descriptions to follow the rules page
