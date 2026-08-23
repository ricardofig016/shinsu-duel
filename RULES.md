# Shinsu Duel: A Tower of God CCG - Rules

Shinsu Duel is a 1vs1 collectible card game (CCG) inspired by SIU's _[Tower of God](https://www.webtoons.com/en/fantasy/tower-of-god/list?title_no=95)_. Players build decks, deploy units, and use abilities to Extinguish their opponent's lighthouses while protecting their own.

- [Shinsu Duel: A Tower of God CCG - Rules](#shinsu-duel-a-tower-of-god-ccg---rules)
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
    - [Skills](#skills)
    - [Equipment](#equipment)
  - [Deck](#deck)
  - [Keywords](#keywords)
  - [Positions](#positions)
  - [Kinds](#kinds)
    - [Shinheuh](#shinheuh)
    - [Landmark](#landmark)
    - [Conduit](#conduit)
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
  - [Random Tables](#random-tables)
    - [Random Trait](#random-trait)
    - [Random Condition](#random-condition)

## Objective

Extinguish your opponent's lighthouses. Each lighthouse represents one point of HP. You lose when you have **0 lighthouses**.

## Resources

### Shinsu

1. Required to play all cards.
2. Abilities may cost shinsu.
3. Every round, players' normal shinsu resets and they gain shinsu equal to the round number, to a maximum of 10 shinsu per round.
4. Up to 2 unspent shinsu carry over to next round to a different pool, called **Recharged Shinsu**, and the rest is lost.
5. The maximum normal shinsu a player can have is equal to the round number, not counting Recharged Shinsu.
6. The maximum Recharged Shinsu is 2.
7. This means that the true max shinsu on round 4 is 6, on round 9 is 11, and on round 10+ is 12.
8. When a player gains shinsu it is added exclusively to the normal pool. Recharged Shinsu is only filled by unspent shinsu at the end of a round.
9. Recharged Shinsu is always consumed first.
10. Effects that add shinsu (like Charge) always add to normal shinsu only and cannot exceed the round number cap. On round 5, a player with 0 shinsu who Charges 20 gains 5 normal shinsu and 0 Recharged Shinsu.

### Lighthouses

1. Start with 20 lighthouses
2. Can gain additional lighthouses (to a maximum of 40); Light Up beyond 40 is wasted
3. Losing all lighthouses loses you the game

### Combat Slots

1. Each player has 5 combat slots: one for each of the positions.
2. A unit deployed in a position can only use an ability if the combat slot for that position is available. Notice that this doesn't stop the player from playing another unit in that position.
3. When a unit uses an ability, the combat slot for the position the unit currently occupies is spent and becomes unavailable until the end of the round.
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
   2. Backline: Spear Bearer, Light Bearer, Landmarks, the Conduit

### Lines

1. Each player has 2 lines: a frontline and a backline.
2. The maximum number of units in each line is 5. Landmarks, Shinheuh, and the Conduit count toward this limit.
3. If you deploy a unit to a line that already has 5 units, choose a unit to be Discarded. This substitution isn't a kill, so on-death effects don't trigger.
4. Units can only target units in the enemy backline if the enemy frontline is empty, and can only target lighthouses if the enemy board is empty. This restriction applies only to units; skills target whatever their text allows.
5. A line or the lighthouses can be targeted only if every line in front of it is empty or contains only Ghost units.
6. Switching a unit into a full line is illegal.
7. Skills can target lighthouses if their text allows it, but "target a unit" or "enemy" never includes lighthouses.

## Gameplay

### Setup

1. Each player draws 5 cards
2. Players start with 1 shinsu each
3. A random player goes first

### Round

1. **Round Start**:
   1. Players flip all their combat slots back up
   2. Shinsu recharges (amount equal to the number of the round, to a maximum of 10)
   3. Each player draws one card
2. **Player Turns**: Players alternate actions (each action is a turn). Alternation continues across rounds without resetting; if player A ends a round, player B starts the next one.
3. **Round End**:
   1. The round ends when both players pass consecutively
   2. Players reset their shinsu, saving up to 2 unspent shinsu
   3. "Round end" effects trigger before conditions are cleared

### Actions

During your turn, choose one of these actions:

1. Play a card
2. Use an ability
3. Switch a unit's position
4. Pass the turn

Each action ends your turn unless the card or ability has Quick.

## Cards

**Summon** = appear on the board
**Play** = the action of playing a card (playing a unit also summons it)
**Create** = create a card somewhere (hand, deck, discard pile, etc.).

### Units

Represent characters, creatures or locations from Tower of God:

1. Deployed to the battlefield
2. Have HP and a shinsu cost to deploy
3. Have one or more positions they can occupy on the board
4. Have abilities that activate by using an action
5. May have passive abilities that are active while the unit is in play
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
17. When a unit dies, it is Discarded.

### Skills

Single-use items/spells/techniques that provide an immediate effect. Playing a skill ends your turn.

Skills may have requirements that must all be met when and how it is played.

Unlike unit/uquipment abilities, skills can target any unit unless otherwise specified.

**Examples**: Redan, Flower of Zygaena, Shinwonryu

### Equipment

Equipments can be attached to ally deployed units for enhancements. Equiping a unit ends your turn.

Units can only hold 1 equipment at a time, unless they are a [Living Ignition Weapon](#living-ignition-weapon).

Equipments may have requirements that must all be met when and how it is played.

**Ignition**: Some equipments can ignite when a trigger is met. The trigger is specified in the equipments's card. Ignited equipments have different effects. Example: `Narumada` ignites into `Narumada (ignited)` when its bearer kills a unit.

Equipments with more than 1 trigger ignite when any of the triggers are met.

When a bearer dies or is equiped with another equipment, its equipments return to the controlling player's hand. The card returns to its default non-ignited version. A [Living Ignition Weapon](#living-ignition-weapon) overrides this: it can be equipped with multiple equipment without returning the old ones.

**Examples**: Green April, Zahard's Ring, Woon's Hammer

## Deck

1. A deck must have exactly 30 cards
2. A deck may contain up to 3 copies of each card
3. Starting hand: 5 cards, no mulligan
4. If at any point a player tries to draw and their deck is empty, they lose the game
5. Maximum hand size is 5

## Keywords

Keywords are special terms that provide additional context to cards and abilities. Their purpose is to provide common language for effects and abilities, making each description less verbose.

1. **Charge `x`**: Regain `x` normal shinsu (up to the round cap)
2. **Cleanse**: Remove all conditions
3. **Compress `x`**: Reduce a card's shinsu cost by `x` (minimum 0)
4. **Disarm**: Send a unit's equipment back to it's owners hand
5. **Discard**: Send a card directly to the discard pile without triggering on death effects
6. **Extinguish `x`**: Deal `x` damage to enemy lighthouses (ignores targeting restrictions)
7. **Free**: The ability doesn't expend a combat slot.
8. **Light Up `x`**: Heal `x` HP from ally lighthouses
9. **Quick**: Playing a Quick card or using a Quick ability doesn't end your turn
10. **Reclaim `x`**: Put `x` cards from your discard pile into your hand (Unreachable and Shinheuh cards can be reclaimed)
11. **Silence**: Remove all traits at the moment it's applied (traits gained later are unaffected)
12. **Slay `x`**: Kill `x` units
13. **Steal**: Take control of an enemy unit, moving it onto your battlefield
14. **Spend `x`**: Spend `x` shinsu (You must have the shinsu to use it)
15. **Unreachable**: You can't put me in your deck during deckbuilding
16. **<position>**: The ability, passive, or effect is only available while the unit is deployed as <position>
17. **Enemy**: Enemy unit
18. **Ally**: Ally unit

## Positions

Each standard unit occupies one position on the battlefield. The position determines its role and playstyle. When you play a unit with more than 1 position you must choose a single position for it to take.

1. **Fisherman** (frontline): Durable units that tank damage and deal consistent damage to enemies
2. **Light Bearer** (backline): Strategic support units specializing in utility, buffs, and lighthouses
3. **Scout** (frontline): Disruptive units that excel at applying debuffs, breaking synergy, and compromising the enemy backline
4. **Spear Bearer** (backline): Long-range units designed to deal massive amounts of damage
5. **Wave Controller** (frontline): All rounder units that help their team by manipulating shinsu and providing shinsu-related buffs and debuffs

## Kinds

Every unit card has a kind that determines what it fundamentally is on the board: `standard`, `shinheuh`, `landmark`, or `conduit`. `standard` is the default; a standard unit occupies one of the positions above. The special kinds below have no position and no rank.

### Shinheuh

1. Special units summoned by Animas to attack on their behalf.
2. Can be frontline or backline, specified in the unit card.
3. To use their abilities, you need a Shinheuh combat slot, which is exclusivly created by [Anima](#anima).
4. A unit doesn't need to be a Anima to have Shinheuh related abilities.
5. Summoning doesn't cost shinsu, doesn't spend the Shinheuh slot, and doesn't end your turn.
6. Summoned units count toward line limits and respect name-uniqueness: a summoned copy of a unit already on your board is Discarded.
7. Shinheuh can be equipped.

### Landmark

1. Special units that apply continuous battlefield rules to the entire board.
2. They don't have a combat slot, a rank, or abilities, but they do have HP, always-on `rules`, and passives.
3. Backline.
4. Each player can only have 1 landmark at a time on their board, playing another one causes the existing one to be discarded.

### Conduit

1. A special token summoned by the [Jeonsulsa](#jeonsulsa) attribute onto the enemy backline.
2. No position, no rank, no combat slot.
3. Unreachable: it can't be put in a deck during deckbuilding.

## Traits and Conditions

Traits and Conditions are special effects that units can have.
Both can stack: stacking merges into a single instance (Burned 2 + Burned 3 = Burned 5), and a unit can't have two copies of the same trait or condition.
Traits and passives are different mechanics: Disabled affects passives only, Silence affects traits only.

### Traits

Traits are positive permanent effects native to cards. They are color coded as such:

- **Defensive Buffs (Yellow #FFFF00)**
- **Damage Buffs (Orange #FFA500)**
- **Utility Buffs (Blue #00FFFF)**

**List of Traits:**

1. **Barrier**: Negate all damage the first time I take damage each round
2. **Beacon `x`**: Round start: Light Up `x`
3. **Bloodthirsty `x`**: When I kill a unit, restore `x` HP
4. **Dealer `x`**: Round start: draw `x` cards
5. **Immune**: I am immune to conditions
6. **Last One Standing `x`**: If I am the only ally unit, I have +`x` HP
7. **Lethal**: When I damage another unit, kill it
8. **Pierce `x`**: When I kill a unit, Extinguish `x`
9. **Reflect `x`**: When I take damage from a unit, deal `x` damage back
10. **Regenerate `x`**: Round end: heal me `x` HP
11. **Resilient `x`**: I take -`x` damage from all sources
12. **Ruthless `x`**: I deal +`x` damage if the enemy has less than 10 lighthouses
13. **Sharpshooter**: I can target any enemy unit
14. **Strong `x`**: I deal +`x` damage
15. **Taunt**: Enemies are forced to target me if they can
16. **Undying**: When i would die, i survive with 1 HP instead
17. **Vengeful `x`**: I deal +`x` damage if I am missing HP

Notes:

- **Taunt** only forces targeting if the Taunt unit is a valid target, and only on enemy units' targeting, not skills. With multiple targetable Taunt units, the enemy chooses among them; all targetable Taunt units must be targeted before non-Taunt units.
- **Sharpshooter** only removes the line restriction; it doesn't bypass Taunt and can't target lighthouses.
- **Reflect** triggers only on damage from a unit's ability, and only if the damage is greater than 0; conditions and skills don't trigger it, and prevented damage (Barrier, Resilient) doesn't count.
- **Undying** is consumed when it triggers and saves a Doomed unit.
- **Last One Standing** counts Shinheuh, landmarks, and the Conduit as ally units, and its +x HP raises both current and max HP (a 12/17 unit with Last One Standing 3 becomes 15/20).
- **Barrier** resets at round start; "the first time" means the first damage event, not the first point of damage.

### Conditions

Conditions are negative temporary effects that last until the end of the round. They are color coded as such:

- **Damage Debuffs (Red #FF0000)**
- **Utility Debuffs (Purple #AA00FF)**

**List of Conditions:**

1. **Blinded**: My targets are chosen at random
2. **Burned `x`**: Turn end: i take `x` damage
3. **Cursed `x`**: Round end: i take `x` damage for each unique condition i have
4. **Disabled**: My passives have no effect
5. **Doomed**: I will die at the end of this round
6. **Exhausted `x`**: I deal -`x` damage
7. **Frozen**: When i use an ability, spend all ally combat slots
8. **Ghost**: I don't prevent the enemy from targeting what's behind me
9. **Heavy `x`**: My abilities cost +`x` shinsu
10. **Poisoned `x`**: I take `x` damage when i use an ability
11. **Rooted**: I can't switch positions or be substituted
12. **Stunned**: I can't use abilities
13. **Weak `x`**: I take +`x` damage from all sources

Notes:

- **Burned** triggers at the end of every turn, including the turn it was applied.
- **Cursed** counts itself among "each unique condition".
- **Frozen**'s "all ally combat slots" includes the Shinheuh slot.
- **Rooted**'s "substituted" means deploying a unit into a full line, which Discards a unit.
- All units can receive conditions (including Landmarks); lighthouses can't.

## Attributes

Some specific units have an attribute, which changes the core of how they function and play within the game. They represent unique and powerful abilities that some people have in Tower of God. Each attribute has a unique core mechanic that defines how the unit plays.

### Anima

**Descripttion:**

Anima summon and control special creatures called [Shinheuh](#shinheuh) to fight for them. Yu Han Sung is an Anima.

**Core in-game mechanic:**

```md
Round start: gain a single-use Shinheuh combat slot if you don't already have one.
```

The Shinheuh slot is single-use and is removed at round end with the other slots. You need at least 1 Anima on your board at round start to gain it.

**Example Synergies:**

- `**Passive**: round start: choose 1 of 3 random Shinheuh to create in your hand`
- `**Passive**: when you summon a Shinheuh, Charge 1`
- `**Passive**: when I am deployed, summon Bull`
- `**Ability**: spend 1: Summon a random 2-3 cost Shinheuh`

### Guide

**Descripttion:**

Guides are support units that help their team by providing information. They can tell what's the best move and predict the future.

There's 2 types of guides, each of them guide their team differently and have a different core mechanic.

#### Silver Dwarf

Specializes in navigating the immediate physical crossroads and obstacles right in front of them. Evan Edrok is a Silver Dwarf.

**Core in-game mechanic:**

```md
The first time you draw a card each round, choose the card directly from your deck.
```

Applies to just one card of a multi-card draw, and choosing from the deck counts as drawing.

#### Red Witch

Specializes in reading long-term destiny and the overarching threads of fate. Hwa Ryun is a Red Witch.

**Core in-game mechanic:**

```md
You can always see your opponent's hand and the top card of both players' decks.
```

**Example Synergies:**

- `**Passive**: Round start: draw a card`
- `**Ability**: Spend 3: switch a card in your hand with a card in your opponent's hand`
- `**Ability**: Spend 3: draw 3 cards, Charge 1 for each Skill drawn`
- `**Ability**: Spend 1: discard a Ranker from your opponent's hand`

### Hwayeomsa

**Descripttion:**

Hwayeomsa are flame users who are able to convert shinsu into fire. They deal team-wide massive fire damage. Yeon Yihwa is a Hwayeomsa.

**Core in-game mechanic:**

```md
Spend 1, Free: Gain 1 **Fire Charge** and create **Fire Core** in your hand if you don't already have one.
**Fire Core**: Quick: Spend Fire Charges to create the highest affordable Incinerate in your hand.
**Incinerate I**: Create me by spending 1 Fire Charge. Deal 1 to an enemy.
**Incinerate II**: Create me by spending 3 Fire Charges. Deal 2 to 2 enemies.
**Incinerate III**: Create me by spending 5 Fire Charges. Deal 2 to 3 enemies and give them Burn.
**Incinerate IV**: Create me by spending 7 Fire Charges. Deal 3 to all enemies, and give them Burn 2.
```

Fire Charges are a persistent pool (maximum 7) that carries across rounds.

**Example Synergies:**

- `**Passive**: Baang gives Burned`
- `**Passive**: when an ally gives Burned <x> to an enemy, they give Burned <x+1> instead`
- `**Ability**: spend 3: deal 2 to all Burned enemies`

### Jeonsulsa

**Descripttion:**

Jeonsulsa are lightning users who have the ability to give electrical properties to Shinsu. They slowly chip, debuff, and immobilize enemy units. Khun Eduan is a Jeonsulsa.

**Core in-game mechanic:**

```md
When I'm deployed, heal 2 HP from or summon **Conduit** on the enemy backline.
**Conduit**: No position. 2 HP. Round start: give me Ghost. Round start or Activation: if there is no Jeonsulsa on the enemy team, Slay me. Round start or Activation: for every 2 HP that I have, play 1 random **Jeonsul Baang** on a random ally.
**Lightning Baang**: give Burned 1 to a unit.
**Thunder Baang**: give Exhausted 1 to a unit.
**Static Baang**: give Weak 1 to a unit.
```

"When I'm deployed, heal 2 HP from or summon Conduit": heal 2 from the enemy Conduit if one exists, otherwise summon a Conduit on the enemy backline. The Conduit sits on the enemy backline and counts as a unit; "ally" in its text is its own team (the Jeonsulsa player's opponent), so the Baangs hit that player's units. **Activation** is only used by the Conduit: an effect that says "activate the Conduit" triggers the Conduit's Activation effect.

**Example Synergies:**

- `**Passive**: when I use an ability, grant the enemy **Conduit** 1 HP or summon a new one.`
- `**Ability**: spend 3: Activate the enemy **Conduit** twice.`
- `**Passive**: the first time an ally Jeonsulsa dies this game, activate the enemy **Conduit** 4 times.`

### Irregular

**Descripttion:**

Irregulars are powerful individuals who were not selected by Headon and came from outside the Tower. They don't follow the rules of the Tower and so are unaltered by many card effects. Jyu Viole Grace is an Irregular.

**Core in-game mechanic:**

```md
Unit passives and landmark rules have no effect on me.
```

### Living Ignition Weapon

**Descripttion:**

Living Ignition Weapons are living beings who were fused with a Weapon by the Workshop. They can use a plethora of equipments to adapt to any circumstance. Kang Horyang is a Living Ignition Weapon.

**Core in-game mechanic:**

```md
You may equip me as many times as you want with unique equipments.
```

"Unique" means different card names and different ignition lines: you can't have both `Green April` and `Green April - Evolved` on me.

**Example Synergies:**

- `**Passive**: equipments cost 1 less`
- `**Passive**: when you equip me, give a random condition to a random enemy`
- `**Ability**: spend 3: steal an enemy equipment and play it on me`

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
| [Prince of the Redlight District](https://towerofgod.fandom.com/wiki/Prince_of_the_Red-light_District) | Organization | Karaka                |
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

## Rank

How the person is ranked in the tower. In game, it represents how expensive the unit is. A unit's rank is written on the card; the rank enforces the cost, not the other way around.

- **Regular** (cost **0-5**): someone chosen by Headon to climb the tower
- **Ranker** (cost **3-7**): someone who has reached the 134th floor of the tower (also encompasses advanced rankers)
- **High Ranker** (cost **5-10**): someone at the top 1% of Rankers

A unit's rank has no direct effect on gameplay, but it can be targeted by abilities and other effects.

## Evolution

Some units can evolve when a trigger is met. The trigger is specified in the unit's card. Evolution is mandatory and automatic when the trigger is met, and costs no action.

The evolved unit may have different HP, passives, abilities, traits, attributes, and affiliations. Lost HP, conditions, and any other effects are preserved on evolution. Equipment and position are preserved. An evolved unit can evolve again.

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

## Random Tables

When a rule or card calls for a random event, consult consult these random tables.
If the tables can't satisfy your specific need, decide with your opponent how to resolve your random event.

### Random Trait

Roll a d20:

- 1 Barrier
- 2 Beacon
- 3 Bloodthirsty
- 4 Dealer
- 5 Immune
- 6 Last One Standing
- 7 Lethal
- 8 Pierce
- 9 Reflect
- 10 Regenerate
- 11 Resilient
- 12 Ruthless
- 13 Sharpshooter
- 14 Strong
- 15 Taunt
- 16 Undying
- 17 Vengeful
- 18+ reroll

### Random Condition

Roll a d20:

- 1 Blinded
- 2 Burned
- 3 Cursed
- 4 Disabled
- 5 Doomed
- 6 Exhausted
- 7 Frozen
- 8 Ghost
- 9 Heavy
- 10 Poisoned
- 11 Rooted
- 12 Stunned
- 13 Weak
- 14+ reroll
