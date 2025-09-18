# TODO List

## Tasks

- [ ] check if landmark information complies with information on the notebook
- [ ] write rules regarding shinheuh and animas
- [ ] add passives to cards (this is in the notebook)
- [ ] add unit stat recalculation when sending game state data to users
- [ ] add a new negative trait around silencing
- [ ] add 'message' field to every event payload

## In Progress

## Completed

- [x] add unit test for too many fields in ActionHandler.validateSchema
- [x] refactor GameState processAction method to an ActionHandler interface class
- [x] refactor 'abilities' to 'abilityCodes' from cards.json
- [x] refactor "combat indicator" everywhere to "combat slots"
- [x] change how turn switching works at round end to align with new rules: players should always alternate turns, even after round end
- [x] switch places of the position indicators from the beggining of the line to the end of the line, to align with the unit card when it is played, as new units are placed after the existing units on that line
- [x] change GameState file name to the class name
- [x] update trait descriptions to follow the rules page
