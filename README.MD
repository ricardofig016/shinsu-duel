# Shinsu Duel: A Tower of God CCG

Shinsu Duel is a 1vs1 collectible card game (CCG) inspired by SIU's _Tower of God_. The game offers both Player vs. Player (PvP) and Campaign (PvE) modes. Players strategize by building decks, deploying units, and using abilities to destroy their opponent’s lighthouses while protecting their own.

## Game Logic

Below is an in-depth explanation on how the `GameState` class handles each game.

### User Actions

The player may use certain actions, such as deploying a unit, using an ability, or passing the turn. `GameState` redirects these action request to their respective `ActionHandler` (`DeployUnitAction`, `UseAbilityAction`, `PassTurnAction`). `GameState` asks the handler to validate the action request, and then to execute it, performing the necessary changes.
