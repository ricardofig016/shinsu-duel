# Shinsu Duel: A Tower of God CCG

Shinsu Duel is a 1vs1 collectible card game (CCG) inspired by SIU's _Tower of God_. The game offers both Player vs. Player (PvP) and Campaign (PvE) modes. Players strategize by building decks, deploying units, and using abilities to destroy their opponent’s lighthouses while protecting their own.

## Table of Contents

- [Shinsu Duel: A Tower of God CCG](#shinsu-duel-a-tower-of-god-ccg)
  - [Table of Contents](#table-of-contents)
  - [Overview](#overview)
  - [Card Types](#card-types)
    - [Unit Cards](#unit-cards)
    - [Support Cards](#support-cards)
  - [Objective](#objective)
  - [Game Resources](#game-resources)
    - [Shinsu](#shinsu)
    - [Lighthouses](#lighthouses)
  - [Board Layout](#board-layout)
  - [Gameplay](#gameplay)
    - [Turn Phases](#turn-phases)
    - [Actions and Free Actions](#actions-and-free-actions)
    - [Round End and Priority Token](#round-end-and-priority-token)
  - [Card Mechanics](#card-mechanics)
    - [Unit Cards Mechanics](#unit-cards-mechanics)
    - [Support Cards Mechanics](#support-cards-mechanics)
  - [Deck Building Rules](#deck-building-rules)
  - [Game Vocabulary](#game-vocabulary)
    - [List of Keywords](#list-of-keywords)
    - [Traits](#traits)
    - [List of Affiliations](#list-of-affiliations)
  - [Future Features](#future-features)
    - [Team Leader](#team-leader)
    - [Evolution](#evolution)

## Overview

Shinsu Duel is a tactical card game where players compete to destroy each other’s **lighthouses**. Players use **unit cards** to attack, defend, and control the battlefield, while **support cards** provide additional strategic depth. The game is inspired by the lore, characters, and objects from _Tower of God_.

## Card Types

### Unit Cards

Unit cards represent characters from _Tower of God_ (e.g., Zahard, Rak, Urek, Prince).

- **Key Features**:
  - Can be deployed to the battlefield.
  - Have stats like HP and shinsu cost.
  - Fill specific positions.
  - Have traits and affiliations
  - Can only target backline enemies when the enemy frontline is empty
  - Can only target the lighthouses when the enemy board is empty

### Support Cards

- Represent objects, spells, effects, and other elements from the webtoon.
- **Subtypes**:
  - **Equipment** (e.g., Green April, Androssi's Shield, Zahard’s Ring)
  - **Spells** (e.g., Ignition spells)
  - **Consumables** (e.g., Lightning Pill)
- Typically used to enhance or evolve units, manipulate the battlefield, or provide other strategic advantages.

## Objective

The primary objective is to **destroy the opponent’s lighthouses**. Each lighthouse represents one point of the player’s nexus HP. A player loses when they have **0 lighthouses**.

## Game Resources

### Shinsu

- The resource required to play cards.
- **Recharge Rules**:
  - Players start with 1 shinsu in round 1.
  - Shinsu increases by 1 per round until round 10 (maximum of 10 shinsu per round).
  - Up to 2 unspent shinsu can be recycled and used next round.
  - **Maximum Shinsu Cap**: 12 (10 round shinsu + 2 recycled shinsu).

### Lighthouses

- Each player starts with 20 lighthouses.
- Players can gain additional lighthouses with no upper limit.
- Losing all lighthouses ends the game.

## Board Layout

The board is divided into:

1. **Player Side**:
   - Hand (cards currently held).
   - Deck (remaining cards).
   - Lighthouse area (indicating nexus HP).
   - Shinsu counter (current shinsu).
2. **Battlefield**:
   - Divided into **Frontline** and **Backline** for each player.
     - **Frontline**: Fisherman, Scout, Wave Controller.
     - **Backline**: Spear Bearer, Light Bearer.

## Gameplay

### Turn Phases

1. **Start of Round**:
   - Shinsu recharges.
   - Each player draws one card.
2. **Player Turns**:
   - Players alternate actions.
   - Actions include playing cards, using abilities, or repositioning units.
3. **Round End**:
   - Both players must pass consecutively to end the round.

### Actions and Free Actions

- **Actions**:
  - Play a card.
  - Use an ability.
  - Change a unit's position.
  - Pass the turn.
- **Free Actions** (do not end the turn):
  - Remove equipment from a unit.
  - Play a "fast" support card.
  - Use a "fast" ability.

### Round End and Priority Token

- The player with the **priority token** starts the round.
- At the end of a round, the priority token passes to the other player.

## Card Mechanics

### Unit Cards Mechanics

- **Stats**:
  - Shinsu Cost (top-left circle).
  - HP (heart icon).
- **Abilities**:
  - Active abilities.
  - Passive effects (always active).
- **Positions** indicate where units can be deployed on the field. Each position generally has a role on the team:
  - **Fisherman**: tank damage and deal damage.
  - **Light Bearer**: provide support in the form of utility, buffs and lighthouses.
  - **Scout**: provide support in the form of debuffs, damaging protected enemy units and interfere with enemy synergy.
  - **Spear Bearer**: deal massive amounts of damage.
  - **Wave Controller**: deal area damage and provide shinsu related support and shinsu related debuffs.
- **Traits and Affiliations**: Additional modifiers and synergies.

### Support Cards Mechanics

- Simpler structure compared to unit cards.
- **Key Features**:
  - Background and rarity border.
  - Shinsu cost.
  - Effects vary based on subtype.

## Deck Building Rules

- Decks must contain **exactly 20 cards**.
- Players may include a maximum of **3 copies of the same card**.
- **Starting Hand**:
  - Players draw 5 cards and may mulligan any number of them.

## Game Vocabulary

### List of Keywords

- Cleanse: Remove every negative trait
- Destroy n: Remove n enemy lighthouses
- Fast: You can take another action after using this ability/spell
- Silence: Remove every positive trait
- Spend n: Spend n shinsu to play this ability

### Traits

1. **List of Traits**
   - **Positive**:
     - Barrier: Negate all damage the next time I take damage
     - Bloodthirsty: When I kill a unit, restore 2 HP
     - Creator: When I am deployed, create 1 lighthouse
     - Dealer: Draw a card at the start of every round
     - Immune: Cleanse and I am immune to negative effects
     - Last One Standing: If I am the only ally unit, I have +4 HP and deal +4 damage
     - Lethal: When I damage another unit, kill it
     - Pierce: Destroy 1 enemy lighthouse when I deal damage
     - Reflect: When I take damage, deal 1 damage to my attacker
     - Regenerate: Restore me to full HP at the end of each round
     - Resilient: Take -1 damage from all sources
     - Ruthless: I deal +1 damage for each lighthouse you have destroyed
     - Sharpshooter: Can target any enemy
     - Strong: I deal +1 damage
     - Taunt: Enemies are forced to target me, if I am targetable
   - **Negative**:
     - Burned: I take 1 damage every round end
     - Cursed: I take 1 damage when I use an ability
     - Doomed: Die at the end of this round
     - Exhausted: I deal -1 damage
     - Ghost: Don't prevent the enemy from targeting what's behind me
     - Heavy: Abilities that cost shinsu cost +1 shinsu
     - Poisoned: Every turn end, take 1 damage
     - Rooted: Can't switch positions
     - Stunned: Can't use abilities
     - Weak: Take +1 damage from all sources
2. **Color Coding**:
   - **Positive**:
     - Defensive Buffs (<span style="color: #ffff00;">Yellow</span>)
     - Damage Buffs (<span style="color: #ffa500;">Orange</span>)
     - Utility Buffs + HP Gain (<span style="color: #00ffff;">Blue</span>)
   - **Nagetive**:
     - Damage-Dealing Debuffs (<span style="color: #ff0000;">Red</span>)
     - Utility Debuffs (<span style="color: #aa00ff;">Purple</span>)

### List of Affiliations

-
-

## Future Features

### Team Leader

- Certain units may have a **Team Leader Effect** that activates when they are designated as the leader.
- Each player can only have one team leader at a time.

### Evolution

- Some units may evolve under specific conditions.
- Evolution improves a unit’s stats and abilities (e.g., Khun Ran evolves when given the Lightning Pill).
