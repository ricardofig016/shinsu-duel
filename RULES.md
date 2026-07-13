# Shinsu Duel: A Tower of God CCG

Shinsu Duel is a 1vs1 collectible card game (CCG) inspired by SIU's _[Tower of God](https://www.webtoons.com/en/fantasy/tower-of-god/list?title_no=95)_. Players build decks, deploy units, and use abilities to destroy their opponent's lighthouses while protecting their own.

## Table of Contents

1. [Objective](#objective)
2. [Resources](#resources)
3. [Board](#board)
4. [Gameplay](#gameplay)
5. [Cards](#cards)
6. [Deck](#deck)
7. [Keywords](#keywords)
8. [Positions](#positions)
9. [Traits](#traits)
10. [Affiliations](#affiliations)
11. [Attributes](#attributes)
12. [Future Features](#future-features)

## Objective

Destroy your opponent's lighthouses. Each lighthouse represents one point of HP. You lose when you have **0 lighthouses**.

## Resources

### Shinsu

1. Required to play all cards
2. Start with 1 shinsu in round 1
3. Increases by 1 per round (max 10 at round 10)
4. After round 10: Stays at 10 per round
5. Up to 2 unspent shinsu carry over to next round
6. Max per round: 12 shinsu (10 + 2 carried over)
7. Abilities may cost shinsu

### Lighthouses

1. Start with 20 lighthouses
2. Can gain additional lighthouses (to a maximum of 40)
3. Losing all lighthouses loses you the game

### Combat Slots

1. Each player has 5 combat slots: one for each of the positions.
2. A unit deployed in a position can only use an ability if the combat slot for that position is available.
3. When a unit uses an ability, the combat slot for the position the unit was deployed in becomes unavailable until the end of the round.
4. This way, the same unit can't use an ability twice in the same round.
5. And if a player has 2 units on the same position on the board, only 1 of them can take an action during a round.

## Board

Each player's side is divided into the following zones:

1. Deck (left)
2. Lighthouses (left)
3. Combat Slots (left)
4. Hand (right)
5. Shinsu (right)
6. Battlefield (center)
   1. Frontline: Fisherman, Scout, Wave Controller
   2. Backline: Spear Bearer, Light Bearer

## Gameplay

### Round

1. **Round Start**:
   1. Shinsu recharges
   2. Each player draws one card
2. **Player Turns**: Players alternate actions (each action is a turn)
3. **Round End**: The round ends when both players pass consecutively

### Actions

During your turn, choose one of these actions:

1. Play a card
2. Use an ability
3. Pass the turn

## Cards

### Units

Represent characters, creatures or locations from Tower of God:

1. Deployed to the battlefield
2. Have HP and a shinsu cost to deploy
3. Have abilities that activate by using an action
4. Have one or more positions they can occupy on the board
5. May have traits that provide unique effects
6. May have affiliations that promote synergies with other units
7. May have an attribute that changes how the unit plays
8. May have a passive ability that is active while the unit is in play
9. Can only target backline enemies when the enemy frontline is empty
10. Can only target lighthouses when the enemy board is empty

### Consumables

Single-use items:

1. Provide immediate effect
2. May target units or have global effect
3. Playing a consumable ends your turn
4. Examples: Lightning Pill, Ignition spells

### Equipment

Attach to units for enhancements:

1. Apply to deployed allied units
2. Provide buffs or special abilities
3. Returns to hand when unit dies or when the unit is equiped with another equipment
4. Equipping ends your turn
5. Examples: Green April, Zahard's Ring

## Deck

1. A deck must have exactly 30 cards
2. Maximum 3 copies of same card
3. Starting hand: 4 cards
4. If at any point a player tries to draw and their deck is empty, they lose the game

## Keywords

Keywords are special terms that provide additional context to cards and abilities. Their purpose is to provide common language for effects and abilities, making each description less verbose.

1. **Cleanse**: Remove all negative traits
2. **Create <x>**: Regain <x> lighthouses
3. **Destroy <x>**: Destroy <x> enemy lighthouses
4. **Quick**: Doesn't end your turn
5. **Silence**: Remove all positive traits
6. **Slay**: Kill a unit
7. **Spend <x>**: Spend <x> shinsu
8. **<position>**: available only when played as <position>

## Positions

Each unit occupies one position on the battlefield. The position determines its role and playstyle. When you play a unit with more than 1 position you must choose a single position for it to take. 

### Main Positions

1. **Fisherman** (frontline): Durable units that tank damage and deal consistent damage to enemies
2. **Light Bearer** (backline): Strategic support units specializing in utility, buffs, and lighthouses
3. **Scout** (frontline): Disruptive units that excel at applying debuffs, breaking synergy, and compromising the enemy backline
4. **Spear Bearer** (backline): Long-range units designed to deal massive amounts of damage
5. **Wave Controller** (frontline): All rounder units that help their team by manipulating shinsu and providing shinsu-related buffs and debuffs

### Special Positions

1. **Shinheuh** (frontline): Special units summoned by Animas to attack on their behalf
2. **Landmark** (backline): Special units that apply continuous passive effects to the entire battlefield

## Traits

Traits are special effects that cards can have. They can be positive or negative and affect gameplay in various ways.

### Positive Traits

1. **Barrier**: Negate all damage the next time I take damage
2. **Bloodthirsty**: When I kill a unit, restore 1 HP
3. **Creator**: When I am deployed, create 1
4. **Dealer**: Draw 1 card at the start of every round
5. **Immune**: I am immune to negative effects
6. **Last One Standing**: If I am the only ally unit, I have +4 HP and deal +4 damage
7. **Lethal**: When I damage another unit, kill it
8. **Pierce**: When I deal damage, destroy 1 enemy lighthouse
9. **Reflect**: When I take damage, deal 1 damage to my attacker
10. **Regenerate**: Restore me to full HP at the end of the round
11. **Resilient**: I take -1 damage from all sources
12. **Ruthless**: I deal +1 damage for each lighthouse destroyed
13. **Sharpshooter**: I can target any enemy unit
14. **Strong**: I deal +1 damage
15. **Taunt**: Enemies are forced to target me if possible

### Negative Traits

1. **Burned**: I take 1 damage every turn until the end of the round
2. **Cursed**: I take 1 damage when I use an ability
3. **Doomed**: I will die at the end of this round
4. **Exhausted**: I deal -1 damage
5. **Ghost**: I don't prevent the enemy from targeting what's behind me
6. **Heavy**: My abilities cost +1 shinsu
7. **Poisoned**: I take 1 damage every round
8. **Rooted**: I can't switch positions or be substituted
9. **Stunned**: I can't use abilities
10. **Weak**: I take +1 damage from all sources

### Trait Colors

1. **Positive**:
   1. Defensive Buffs (Yellow)
   2. Damage Buffs (Orange)
   3. Utility Buffs/HP Gain (Blue)
2. **Negative**:
   1. Damage Debuffs (Red)
   2. Utility Debuffs (Purple)

## Affiliations

To be added

## Attributes

### Anima

When I'm deployed or round start: choose 1 of 3 random **Shinheuh** to create in your hand. Round start: gain a Shinheuh combat slot.

### Guide

You can always see you opponent's hand. The first time you draw a card in each round, look at the top 3 cards of your deck and choose one to add to your hand, then shuffle the rest. When I'm deployed or round start: draw a card.

### Hwayeomsa

Spend 1: charge 1 **Fire Charge** and create **Fire Core** in your hand if you don't already have it.
**Fire Core**: Consume your Fire Charges to create **Incinerate**.
**Incinerate I**: I am created by consuming 1 Fire Charge. Deal 1 to an enemy.
**Incinerate II**: I am created by consuming 3 Fire Charges. Deal 2 to 2 enemies.
**Incinerate III**: I am created by consuming 5 Fire Charges. Deal 2 to 3 enemies, and give them Burn.
**Incinerate IV**: I am created by consuming 7 Fire Charges. Deal 3 to all enemies, and give them Burn this round and the next.

### Irregular

Slay: choose 1 of 2 random **Outsider Powers** that I don't already have and grant it to me.
**Power of Fortitude**: Immune and Regenerate
**Power of Aegis**: Resilient and Barrier
**Power of Ruin**: Pierce and Ruthless
**Power of Vigor**: Bloodthirsty and Strong
**Power of Defiance**: Reflect and Taunt

### Jeonsulsa

When I'm deployed, summon a 1 HP **Conduit** on the enemy backline if they don't already have one. When I use an ability, grant the conduit 1 HP.
**Conduit**: Round start: For each HP that I have, activate 1 random **Jeonsul Baang**.
**Lightning Baang**: Deal 2 damage to a random enemy unit.
**Thunder Baang**: Stun a random enemy unit this round.
**Static Baang**: Give Weak to a random enemy unit this round.

### Living Ignition Weapon

You may equip me as many times as you want with unique equipments. When you equip me, grant a random trait to a random ally that is not me.

## Future Features

### Team Leader

1. Special passive effect when designated as leader
2. Only one leader per player

### Evolution

1. Units evolve under specific conditions
2. Improves stats/abilities and changes art
3. Example: Khun Ran evolves when given the Lightning Pill consumable

### Attributes

Add new attributes such as:
**Wonsulsa** - Circle Technician (Mule Love, Gran de Lee, Yu Han Sung)
**Dansulsa** - Breaker (Kurudan, Yu Han Sung)
**Defender** (Aka Williams, Hendo Lok Bloodmadder)