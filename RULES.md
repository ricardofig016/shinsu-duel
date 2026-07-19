# Shinsu Duel: A Tower of God CCG

Shinsu Duel is a 1vs1 collectible card game (CCG) inspired by SIU's _[Tower of God](https://www.webtoons.com/en/fantasy/tower-of-god/list?title_no=95)_. Players build decks, deploy units, and use abilities to destroy their opponent's lighthouses while protecting their own.

- [Shinsu Duel: A Tower of God CCG](#shinsu-duel-a-tower-of-god-ccg)
  - [Objective](#objective)
  - [Resources](#resources)
    - [Shinsu](#shinsu)
    - [Lighthouses](#lighthouses)
    - [Combat Slots](#combat-slots)
  - [Board](#board)
    - [Physical Layout](#physical-layout)
    - [Lines](#lines)
  - [Gameplay](#gameplay)
  - [Setup](#setup)
    - [Round](#round)
    - [Actions](#actions)
  - [Cards](#cards)
    - [Units](#units)
    - [Consumables](#consumables)
    - [Equipment](#equipment)
  - [Deck](#deck)
  - [Keywords](#keywords)
  - [Positions](#positions)
    - [Main Positions](#main-positions)
    - [Special Positions](#special-positions)
      - [Shinheuh](#shinheuh)
      - [Landmark](#landmark)
  - [Traits and Conditions](#traits-and-conditions)
    - [Traits](#traits)
    - [Conditions](#conditions)
  - [Attributes](#attributes)
    - [Anima](#anima)
    - [Guide](#guide)
      - [Silver Dwarf](#silver-dwarf)
      - [Red Witch](#red-witch)
    - [Hwayeomsa](#hwayeomsa)
    - [Jeonsulsa](#jeonsulsa)
    - [Irregular](#irregular)
    - [Living Ignition Weapon](#living-ignition-weapon)
  - [Affiliations](#affiliations)
  - [Rank](#rank)
  - [Evolution](#evolution)
  - [Future Features](#future-features)
    - [Team Leader](#team-leader)
    - [Attributes](#attributes-1)

## Objective

Destroy your opponent's lighthouses. Each lighthouse represents one point of HP. You lose when you have **0 lighthouses**.

## Resources

### Shinsu

1. Required to play all cards.
2. Abilities may cost shinsu.
3. Every round, players' shinsu resets and they gain shinsu equal to the round number, to a maximum of 10 shinsu per round.
4. Up to 2 unspent shinsu carry over to next round to a different pool, called **Recharged Shinsu**, and the rest is lost.
5. The maximum shinsu a person can have is equal to the round number, not counting Recharged Shinsu.
6. This means that the max shinsu on round 4 is 6, on round 9 is 11, and on round 10+ is 12.
7. When a player gains shinsu it is added exclusively to the main pool. Recharged Shinsu is only filled by unspent shinsu at the end of a round.

### Lighthouses

1. Start with 20 lighthouses
2. Can gain additional lighthouses (to a maximum of 40)
3. Losing all lighthouses loses you the game

### Combat Slots

1. Each player has 5 combat slots: one for each of the positions.
2. A unit deployed in a position can only use an ability if the combat slot for that position is available. Notice that this doesn't stop the player from playing another unit in that position.
3. When a unit uses an ability, the combat slot for the position the unit was deployed in becomes unavailable until the end of the round.
4. This means the same unit can't use an ability twice in the same round, and other units in the same position can't use their abilities either.

## Board

### Physical Layout

Each player's side is divided into the following zones:

1. Deck (left)
2. Lighthouses (left)
3. Combat Slots (left)
4. Hand (right)
5. Shinsu (right)
6. Discard Pile (right)
7. Battlefield (center)
   1. Frontline: Fisherman, Scout, Wave Controller
   2. Backline: Spear Bearer, Light Bearer, Landmark

### Lines

1. Each player has 2 lines: a frontline and a backline.
2. The maximum number of units in each line is 5.
3. If you deploy a unit to a line that already has 5 units, choose a unit to be Destroyed.
4. Units can only target units in the enemy backline if the enemy frontline is empty. And can only target lighthouses if the enemy board is empty.

## Gameplay

## Setup

1. Each player draws 5 cards
2. Players start with 1 shinsu each

### Round

1. **Round Start**:
   1. Players flip all their combat slots back up
   2. Shinsu recharges (amount equal to the number of the round)
   3. Each player draws one card
2. **Player Turns**: Players alternate actions (each action is a turn)
3. **Round End**:
   1. The round ends when both players pass consecutively
   2. Players reset their shinsu, saving up to 2 unspent shinsu

### Actions

During your turn, choose one of these actions:

1. Play a card
2. Use an ability
3. Switch a unit's position
4. Pass the turn

## Cards

### Units

Represent characters, creatures or locations from Tower of God:

1. Deployed to the battlefield
2. Have HP and a shinsu cost to deploy
3. Have one or more positions they can occupy on the board
4. Have abilities that activate by using an action
5. May have a passive ability that is active while the unit is in play
6. May have traits that provide unique effects
7. May have an attribute that changes how the unit plays
8. May have affiliations that promote synergies with other units
9. Have a rank that may be targeted by other cards
10. May evolve when a specified trigger is met
11. Can't be played or summoned if a unit with the same name is already on your board
12. Can only target backline enemies when the enemy frontline is empty
13. Can only target lighthouses when the enemy board is empty
14. When you play a unit, you must choose a position for it to occupy from the positions available on the card.
15. You can change the unit's position later by using your turn for it.
16. You may have more than one unit in each position at a time.
17. When a unit dies, it is sent to the discard pile.

### Consumables

Single-use items:

1. Provide immediate effect
2. May target units or have global effect
3. Playing a consumable ends your turn
4. Examples: Lightning Pill, Ignition spells

### Equipment

Equipments can be attached to ally deployed units for enhancements.

Equiping a unit costs the turn.

Units can only hold 1 equipment at a time, unless they are [Irregular](#irregular).

It returns to hand when it's unit dies or when the unit is equiped when another equipment.

**Examples**: Green April, Zahard's Ring, Woon's Hammer

## Deck

1. A deck must have exactly 30 cards
2. Maximum 3 copies of same card
3. Starting hand: 5 cards
4. If at any point a player tries to draw and their deck is empty, they lose the game

## Keywords

Keywords are special terms that provide additional context to cards and abilities. Their purpose is to provide common language for effects and abilities, making each description less verbose.

1. **Cleanse**: Remove all negative traits
2. **Charge <x>**: Regain <x> shinsu
3. **Create <x>**: Regain <x> lighthouses
4. **Destroy <x>**: Destroy <x> enemy lighthouses
5. **Quick**: Doesn't end your turn
6. **Silence**: Remove all positive traits
7. **Slay**: Kill a unit
8. **Spend <x>**: Spend <x> shinsu
9. **Unreachable**: You can't put me in your deck during deckbuilding
10. **<position>**: available only when played as <position>

## Positions

Each unit occupies one position on the battlefield. The position determines its role and playstyle. When you play a unit with more than 1 position you must choose a single position for it to take.

### Main Positions

1. **Fisherman** (frontline): Durable units that tank damage and deal consistent damage to enemies
2. **Light Bearer** (backline): Strategic support units specializing in utility, buffs, and lighthouses
3. **Scout** (frontline): Disruptive units that excel at applying debuffs, breaking synergy, and compromising the enemy backline
4. **Spear Bearer** (backline): Long-range units designed to deal massive amounts of damage
5. **Wave Controller** (frontline): All rounder units that help their team by manipulating shinsu and providing shinsu-related buffs and debuffs

### Special Positions

These positions don't have a combat slot nor a rank.

#### Shinheuh

1. Special units summoned by Animas to attack on their behalf.
2. Can be frontline or backline, specified in the unit card.
3. You cannot build your deck using Shinheuh cards, they must be created during play.
4. To use their abilities, you need a Shinheuh combat slot, which is exclusivly created by [Anima](#anima).
5. A unit doesn't need to be a Anima to have Shinheuh related abilities.

#### Landmark

1. Special units that apply continuous passive effects to the entire battlefield.
2. They don't have a combat slot or abilities, but they do have HP and a passive.
3. Backline.
4. Each player can only have 1 landmark at a time on their board, playing another one causes the existing one to be destroyed.

## Traits and Conditions

Traits and Conditions are special effects that units can have. Both can stack.

### Traits

Traits are positive permanent effects native to cards. They are color coded as such:

1. Defensive Buffs (Yellow)
2. Damage Buffs (Orange)
3. Utility Buffs/HP Gain (Blue)

**List of Traits:**

1. **Barrier**: Negate all damage the first time I take damage each round
2. **Bloodthirsty**: When I kill a unit, restore 1 HP
3. **Creator**: When I am deployed, create 1
4. **Dealer**: Draw 1 card at the start of every round
5. **Immune**: I am immune to negative effects
6. **Last One Standing**: If I am the only ally unit, I have +4 HP and deal +4 damage
7. **Lethal**: When I damage another unit, kill it
8. **Pierce**: When I kill a unit, Destroy 1
9. **Reflect**: When I take damage, deal 1 damage to my attacker
10. **Regenerate**: Restore me to full HP at the end of the round
11. **Resilient**: I take -1 damage from all sources
12. **Ruthless**: I deal +1 damage if the enemy has less than 10 lighthouses
13. **Sharpshooter**: I can target any enemy unit
14. **Strong**: I deal +1 damage
15. **Taunt**: Enemies are forced to target me if they can

### Conditions

Conditions are negative temporary effects that last until the end of the round. They are color coded as such:

1. Damage Debuffs (Red)
2. Utility Debuffs (Purple)

**List of Conditions:**

1. **Burned**: I take 1 damage at the end of every turn
2. **Cursed**: I take 1 damage when I use an ability
3. **Doomed**: I will die at the end of this round
4. **Exhausted**: I deal -1 damage
5. **Frozen**: When i use an ability, spend all combat slots (_missing icon_)
6. **Ghost**: I don't prevent the enemy from targeting what's behind me
7. **Heavy**: My abilities cost +1 shinsu
8. **Poisoned**: I take 1 damage when i use an ability
9. **Rooted**: I can't switch positions or be substituted
10. **Stunned**: I can't use abilities
11. **Weak**: I take +1 damage from all sources

## Attributes

Some specific units have an attribute, which changes the core of how they function and play within the game. They represent unique and powerful abilities that some people have in Tower of God. Each attribute has a unique core mechanic that defines how the unit plays.

### Anima

Anima summon and control special creatures called [Shinheuh](#shinheuh) to fight for them. Yu Han Sung is an Anima.

**Core in-game mechanic:**

```
Round start: gain a single-use Shinheuh combat slot if you don't already have one.
```

**Example Synergies:**

- `**Passive**: Round start: choose 1 of 3 random Shinheuh to create in your hand`
- `**Passive**: When you summon a Shinheuh, Charge 1.`
- `**Passive**: When I am deployed, summon Bull` (Yuga)
- `**Ability**: Spend 1: Summon a random 2-3 cost Shinheuh`

### Guide

Guides are support units that help their team by providing information. They can tell what's the best move and predict the future.

There's 2 types of guides, each of them guide their team differently and have a different core mechanic.

#### Silver Dwarf

Specializes in navigating the immediate physical crossroads and obstacles right in front of them. Evan Edrok is a Silver Dwarf.

**Core in-game mechanic:**

```
When you draw a card, choose the card directly from your deck, then shuffle the rest.
```

#### Red Witch

Specializes in reading long-term destiny and the overarching threads of fate. Hwa Ryun is a Red Witch.

**Core in-game mechanic:**

```
You can always see your opponent's hand and the top card of both players' decks.
```

**Example Synergies:**

- `**Passive**: Round start: draw a card`
- `**Ability**: Spend 3: switch a card in your hand with a card in your opponent's hand`
- `**Ability**: Spend 3: draw 3 cards, Charge 1 for each Consumable drawn`
- `**Ability**: Spend 1: discard a Ranker from your opponent's hand`

### Hwayeomsa

Hwayeomsa are flame users who are able to convert shinsu into fire. They deal team-wide massive fire damage. Yeon Yihwa is a Hwayeomsa.

**Core in-game mechanic:**

```
Spend 1: Charge 1 **Fire Charge** and create **Fire Core** in your hand if you don't already have it.
**Fire Core**: Quick: Consume your Fire Charges to create **Incinerate <level>** in hand:
**Incinerate I**: I am created by consuming 1 Fire Charge. Deal 1 to an enemy.
**Incinerate II**: I am created by consuming 3 Fire Charges. Deal 2 to 2 enemies.
**Incinerate III**: I am created by consuming 5 Fire Charges. Deal 2 to 3 enemies and give them Burn.
**Incinerate IV**: I am created by consuming 7 Fire Charges. Deal 3 to all enemies, and give them Burn this round and the next.
```

**Example Synergies:**

- ``

### Jeonsulsa

Jeonsulsa are lightning users who have the ability to give electrical properties to Shinsu. They slowly chip, debuff, and immobilize enemy units. Khun Eduan is a Jeonsulsa.

**Core in-game mechanic:**

```
When I'm deployed, summon a 2 HP **Conduit** on the enemy backline. When I leave play, destroy it.
**Conduit**: Ghost. Round start or Activation: For every 2 HP that I have, play 1 random **Jeonsul Baang** on yourself.
**Lightning Baang**: Deal 2 damage to a random ally unit.
**Thunder Baang**: Root a random ally unit this round that is not already Rooted.
**Static Baang**: Give +1 Weak to a random ally unit this round.
```

**Example Synergies:**

- `**Passive**: When I use an ability, grant the enemy **Conduit** 1 HP or summon a new one.`
- `**Ability**: Spend 3: Activate the enemy **Conduit** twice.`
- `**Passive**: The first time an ally Jeonsulsa dies this game, activate the enemy **Conduit** 4 times.`

### Irregular

Irregulars are extremely powerful individuals who were not selected by Headon. Instead, they entered the First Floor from outside the Tower. They ramp up when killing enemies by stacking multiple different traits on themselves. Twenty-Fifth Baam is an Irregular.

**Core in-game mechanic:**

```
Slay: Grant me a random **Outsider Power** that I don't already have.
**Power of Fortitude**: Immune and Regenerate
**Power of Aegis**: Resilient and Barrier
**Power of Ruin**: Pierce and Ruthless
**Power of Vigor**: Bloodthirsty and Strong
**Power of Defiance**: Reflect and Taunt
```

**Example Synergies:**

- `**Ability**: deal 1 for every trait i have to an enemy`

### Living Ignition Weapon

**Core in-game mechanic:**

```
You may equip me as many times as you want with unique equipments.
```

**Example Synergies:**

- `**Passive**: When you equip me, grant a random trait to a random ally that is not me.`

## Affiliations

Affiliations represent a unit's allegiance: the groups, teams, organizations, and families they belong to. A unit can have multiple affiliations.

Affiliations have no direct effect on gameplay, but they can be targeted by abilities and can promote synergies with other units that share the same affiliation.

| Name                                                                                                   | Type         | Example Unit          |
| ------------------------------------------------------------------------------------------------------ | ------------ | --------------------- |
| [Team AKA](https://towerofgod.fandom.com/wiki/Team_Aka)                                                | Team         | Aka Williams          |
| [Team Baam](https://towerofgod.fandom.com/wiki/Team_Baam)                                              | Team         | Twenty-Fifth Baam     |
| [Team Bero](https://towerofgod.fandom.com/wiki/Team_Bero)                                              | Team         | Phonsekal Irure       |
| [Team Chang](https://towerofgod.fandom.com/wiki/Team_Chang)                                            | Team         | Quaetro Blitz         |
| [Team FUG](https://towerofgod.fandom.com/wiki/Team_FUG)                                                | Team         | Jue Viole Grace       |
| [Team Khel Hellam](https://towerofgod.fandom.com/wiki/Team_Khel_Hellam)                                | Team         | Khel Hellam           |
| [Team Novick](https://towerofgod.fandom.com/wiki/Team_Novick)                                          | Team         | Edin Dan              |
| [Team Rachel](https://towerofgod.fandom.com/wiki/Team_Rachel)                                          | Team         | Rachel                |
| [Team Sachi](https://towerofgod.fandom.com/wiki/Team_Sachi)                                            | Team         | Sachi Faker           |
| [Team Sweet and Sour](https://towerofgod.fandom.com/wiki/Team_Tangsooyook)                             | Team         | Ja Wangnan            |
| [Khun's Team](https://towerofgod.fandom.com/wiki/Khun's_Team)                                          | Team         | Khun Aguero Agnes     |
| [Team Ship](https://towerofgod.fandom.com/wiki/Ship's_Team)                                            | Team         | Ship Leesoo           |
| [FUG](https://towerofgod.fandom.com/wiki/FUG)                                                          | Organization | Ha Jinsung            |
| [Hidden Grove](https://towerofgod.fandom.com/wiki/Hidden_Grove)                                        | Organization | Cha                   |
| [Karaka's Servants](https://towerofgod.fandom.com/wiki/Karaka's_Servants)                              | Organization | Pedro                 |
| [Revolution](https://towerofgod.fandom.com/wiki/Revolution)                                            | Organization | Lo Po Bia Goruro      |
| [Wolhaiksong](https://towerofgod.fandom.com/wiki/Wolhaiksong)                                          | Organization | Baek Ryun             |
| [Zahard's Army](https://towerofgod.fandom.com/wiki/Zahard's_Army)                                      | Organization | Khun Maschenny Zahard |
| [Zahard's Princesses](https://towerofgod.fandom.com/wiki/Zahard's_Princesses)                          | Organization | Ha Yuri Zahard        |
| [Great Warriors](https://towerofgod.fandom.com/wiki/Great_Warriors)                                    | Organization | V                     |
| [Shining Ones](https://towerofgod.fandom.com/wiki/Shining_Ones)                                        | Organization | Urek Mazino           |
| [Arie Family](https://towerofgod.fandom.com/wiki/Arie_Family)                                          | Great Family | White                 |
| [Khun Family](https://towerofgod.fandom.com/wiki/Khun_Family)                                          | Great Family | Khun Aguero Agnes     |
| [Ha Family](https://towerofgod.fandom.com/wiki/Ha_Family)                                              | Great Family | Ha Jinsung            |
| [Tu Perie Family](https://towerofgod.fandom.com/wiki/Tu_Perie_Family)                                  | Great Family | Tu Perie Tperie       |
| [Eurasia Family](https://towerofgod.fandom.com/wiki/Eurasia_Family)                                    | Great Family | Phonsekal Laure       |
| [Po Bidau Family](https://towerofgod.fandom.com/wiki/Po_Bidau_Family)                                  | Great Family | Po Bidau Gustang      |
| [Yeon Family](https://towerofgod.fandom.com/wiki/Yeon_Family)                                          | Great Family | Yeon Yihwa            |
| [Ari Family](https://towerofgod.fandom.com/wiki/Ari_Family)                                            | Great Family | Ari Bright Sharon     |
| [Lo Po Bia Family](https://towerofgod.fandom.com/wiki/Lo_Po_Bia_Family)                                | Great Family | Lo Po Bia Elaine      |
| [Hendo Lok Family](https://towerofgod.fandom.com/wiki/Hendo_Lok_Family)                                | Great Family | Hendo Lok Bloodmadder |
| [Blitz Family](https://towerofgod.fandom.com/wiki/Blitz_Family)                                        | Family       | Quaetro Blitz         |
| [Grand Family](https://towerofgod.fandom.com/wiki/Grand_Family)                                        | Family       | Grand De Lee          |
| [Edrok Family](https://towerofgod.fandom.com/wiki/Edrok_Family)                                        | Family       | Evan Edrok            |
| [Mule Family](https://towerofgod.fandom.com/wiki/Mule_Family)                                          | Family       | Mule Love             |
| [Nissam Family](https://towerofgod.fandom.com/wiki/Nissam_Family)                                      | Family       | Khul Nissam Kay       |
| [Canines](https://towerofgod.fandom.com/wiki/Canines)                                                  | Species      | Baylord Yama          |
| [Data Humans](https://towerofgod.fandom.com/wiki/Data_Humans)                                          | Species      | Khun Eduan (Data)     |
| [Prince of the Redlight District](https://towerofgod.fandom.com/wiki/Prince_of_the_Red-light_District) | Other        | Karaka                |

## Rank

How the person is ranked in the tower. In game, it represents how expensive the unit is:

- **Regular** (cost **0-5**): someone chosen by Headon to climb the tower
- **Ranker** (cost **3-7**): someone who has reached the 134th floor of the tower (also encompasses advanced rankers)
- **High Ranker** (cost **5-10**): someone at the top 1% of Rankers

A unit's rank has no direct effect on gameplay, but it can be targeted by abilities and can promote synergies with other units that share the same affiliation.

## Evolution

Some units can evolve when a trigger is met. The trigger is specified in the unit's card.

The evolved card may have different HP, passives, abilities, traits, attributes, and affiliations. Lost HP, conditions, and any other effects are preserved on evolution.

Examples:

- `Khun Aguero Agnis` evolves into `Khun Aguero Agnis (evolved)` when equipped with `Ice Spear`.
- `Karaka` evolves into `Karaka (evolved)` when equipped with `Steel Tree`, `Karaka's Armor Suit`, or `Purple Dementor`.
- `Khun Ran` evolves into `Khun Ran (evolved)` when given `Redan`

## Future Features

### Team Leader

1. Special passive effect when designated as leader
2. Only one leader per player

### Attributes

Add new attributes such as:
**Wonsulsa** - Circle Technician (Mule Love, Gran de Lee, Yu Han Sung)
**Dansulsa** - Breaker (Kurudan, Yu Han Sung)
**Defender** (Aka Williams, Hendo Lok Bloodmadder)
