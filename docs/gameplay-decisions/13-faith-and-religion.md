# §13. Faith, religions and temples

*(section 13 of `00-index.md`)*

**Source of truth for every number below**: `data/balance-config.json`, sections `faith`, `temple`, `rest` and `reflection`. This document names the mechanic and the field that drives it; the values are the data's. The engine is `src/engine/survival.ts` (Faith itself, Pray, Talk), `src/engine/temple.ts`, `src/engine/party.ts` (the boon's stats), `src/engine/dungeon.ts` (decay on entry, the boon's recovery) and `src/engine/reflection.ts`. The religions are `data/religions.json`, read by `src/data/religions.ts`.

## 13.1 Why it exists

The party already tracks HP, MP, fear (per character) and satiety (party-wide). Faith is a fourth pressure and the slowest one: a single party-wide value that falls on its own as the party walks, can be fed by choosing to, and is lost by neglect. On screen it is a torch burning between the party and what faces it, never a god's favor.

Three goals shaped it:

- **A pressure the player can keep alive, or lose by neglect.** A party that tends the torch should spend most of a run around the middle of the bar. A party that never prays should watch it go out.
- **Religion is worth reading on the select screen.** Each class follows one of four religions. Which temples help the party, and which reflection answers it is offered, depend on who is in it.
- **A choice is a trade with a visible cost** (§13.7). No answer is free and no stance is reliably the good one.

What it must not become: a torch that never matters (always full, or always out by the third floor whatever the player does), one religion or one answer that is always picked, and any text that explains the four faiths or lets the dungeon answer them.

Faith does not add a targeting or reach system, and it changes no class's kit or passive. A religion is a fixed label on a class, not a build.

## 13.2 Faith

`GameState.faith`, from 0 to 100, one decimal place, party-wide. A run starts at `faith.initial` (100). Every change goes through `adjustFaith` (`src/engine/survival.ts`), which clamps and rounds, the way `adjustFear` does for fear.

**What moves it.** Only five things: the decay below, the temple (§13.4), the rest room's Pray and Talk (§13.5), and a reflection answer's Faith effect (§13.7). Beating an Elite or a Boss gives none, and neither does winning any other fight.

### Decay

Faith drops on the **first entry into each room** by a flat amount (`faith.decayFlatPerRoom` (1)) plus a small percentage of the current value (`faith.decayPercentPerRoom`). Every room type counts: combat, event, rest, guard and hidden rooms once they are entered. The first room of floor 1 costs nothing, since the run starts full; the entry room of every later floor counts, because `advanceToNextFloor` places the party there without a move (`drainFaithOnFirstEntry`, called from `moveToRoom` and from `advanceToNextFloor`). A room already on the party's path never drains again, and the temple never drains.

The percentage part is what makes the decay hold a band instead of a straight fall. A bright torch burns faster than a low one, so Faith settles towards a resting level (`faith.typicalLevel` (35), a value the tools start their fights at, not one the engine reads) for a party that tends it. With a flat cost alone, the random yield of a floor's temple swung further than the band was wide, and a party that used every temple still lost the torch by the third floor. The same decay is multiplied by `temple.boon.decayMultiplier` (0.5) on the floor where a boon was asked (§13.4).

### Faith and fear

Every fear **gain** a character takes is multiplied by a factor that slides linearly with Faith, from `faith.fearGainMultiplierAtZero` (1.2) with the torch out to `faith.fearGainMultiplierAtFull` (0.5) at full Faith. The neutral point, where the factor is 1, falls a little under a third of the bar. The factor applies to gains only, never to relief (`04-fear-combat.md`), and stacks multiplicatively with a status's `fearResistPercent` inside `resistedFearGain`, which every fear-gain caller already runs before `adjustFear`. A fight reads the party's Faith at the start of each round; a reflection answer reads it as it was when the answer was picked, whatever order its effects list in.

At 0 the torch is out. Nothing else happens beyond the fear penalty.

### The torch

The battlefield divider between the party and the enemy block is the torch sprite, in every room, including rest, event, treasure and temple rooms. It has one frame per entry in `faith.torchFrameThresholds`, from full down to out, each used from its threshold upward; the sprites are in `data/sprites.json` (`torch`). The exact value, rounded down, also shows in the header beside Coins and Satiety, so the effect lines on the rest and reflection screens can be checked against it.

## 13.3 Religions

Four religions, each a record in `data/religions.json`: `id`, `name`, `templeDescription`, a `style` (abbreviation and color) and a `boon` shape (`emphasis`: `offense`, `defense`, `speed` or null; `recoversHpMp`). Every class carries a fixed `religionId` in `data/classes.json`; the loader refuses a class that names an unknown one.

<!-- docs:begin religions -->
*Generated from `data/religions.json` and `data/classes.json` by `bun run docs:sync`. Do not edit.*

| Religion | Classes | Boon |
|---|---|---|
| Light and Glory | Knight, Acolyte, Paladin | Defense raised more |
| Plague and Healing | Plague Doctor, Summoner, Jester | All three raised evenly; HP and MP restored in every room |
| Night and Silence | Mage, Rogue, Ninja | Speed raised more |
| Fury and Blood | Viking, Archer, Warlock | Attack and magic power raised more |
<!-- docs:end -->

The party select screen shows each class's religion under its role tags, in the religion's color, so a player can weigh a focused or mixed party; the character info screen shows it too. Religion matters in three places: which members a temple recognises (§13.4), how much Faith Talk restores (§13.5), and which reflection answers appear (§13.7).

### Where the four sit in the world

The world bible has one organised faith, the spiral-marked group that formed after the descents (`12-world-bible.md` §12.6). The four religions are not that group and not offshoots of it. They are faiths of the world above, older than any descent, that people carry down with them. Their temples stand in the dungeon anyway. Who built them is left open (pilgrims of those faiths who came down before, or the place repeating a shape the people walking it carry in their heads), and so is whether any of the four gods exists, hears or answers (`12-world-bible.md` §12.9). Temple text never shows a spiral, never mentions the split, and never has anything in the room respond to the party's faith.

On the page: religion names appear in the UI as labels, not lore. A temple's description is a physical scene in the house style. Faith is always "the torch".

## 13.4 The temple

### Placement

Each floor except the Founder encounter floor rolls a temple with chance `temple.chance` (80%), after its layout and monsters are built (`prependTemple`, `src/data/floor.ts`), so a seed's floor is the same with or without one. When it rolls, the temple is the floor's **entry room**: the party arrives in it, its only exit is the combat entrance the floor would have opened with, and its religion is drawn evenly from the four. The map shows it with its own glyph. Floor generation's invariant is that the entrance is a visible combat room; a temple in front of it is the one allowed exception (`technical-decisions.md` §1).

The Founder encounter floor never rolls a temple; floors after it resume the normal temple roll. What already happens on arrival at other floors still happens first: the gatekeeper on a new run, the journal pickup and the ending checkpoint. The temple screen comes after them. The entrance ambush does not fire on a temple (it has no monsters); the next room starts its own fight as any room does. The gatekeeper's paid blessing skips a temple the way it skips a rest room, so entering one never spends a blessed room.

### The four actions

One action per visit, then the room is cleared. A **matching** member is a living member whose class religion is the temple's.

| Action | Shown when | Effect |
|---|---|---|
| **Give blood** | at least one living member matches | Each matching member at or above `temple.giveBlood.upperHpFraction` (50%) of max HP loses `temple.giveBlood.hpCost` (50%) of max HP and adds `temple.giveBlood.faithGain` (15) Faith. A member between `temple.giveBlood.lowerHpFraction` (30%) and the upper line is brought down to `temple.giveBlood.hpFloor` (5%) of max HP and adds `temple.giveBlood.lowerFaithGain` (5). A member under the lower line cannot give and is listed as too weak. If every matching member is under it, the action shows locked with the reason. It never kills: HP never goes below the floor |
| **Give everyone's blood** | no living member matches | Every living member loses `temple.giveAll.hpCost` (60%) of max HP and can die from it, through the normal death path. Faith rises by `temple.giveAll.faithGain` (30), once, not per member |
| **Ask a boon** | Faith is at least `temple.boon.faithCost` (20) | Pays the Faith cost. The whole party gets the temple's boon until the floor ends |
| **Leave** | always | Nothing |

Give blood takes every eligible matching member at once; there is no picking. If Give everyone's blood leaves nobody alive, the run ends the way any wipe does. The outcome lines are `game.temple*` in `data/strings.json`, one plain sentence each.

### The boon

`GameState.boon` holds the religion and the floor depth it was asked on, and `advanceToNextFloor` clears it. Its effect is computed live in `recomputeCharacterStats`, as the Exhausted multiplier is, not stored as a status effect, so it shows in the stat screens as its own tag and ends with the floor without cleanup.

- Every boon raises attack, magic power, defense and speed by `temple.boon.statPercent` (5%).
- A religion with an emphasis raises that stat by `temple.boon.emphasisPercent` (12%) instead: defense for one, speed for another, attack and magic power together for the third. The religion without one raises all three evenly and restores `temple.boon.recoveryPerRoom` (10%) of max HP and MP to each living member on every room entered for the rest of the floor.
- A matching member multiplies all of it by `temple.boon.matchingMultiplier` (1.5).
- Faith decays more slowly for the rest of the floor (§13.2).

The word is "boon" in code and docs: "blessing" is the gatekeeper's paid blessing, and the Runner's barter buff is its own thing.

### Text

A temple screen shows the religion's name in its color, its `templeDescription` and the actions. Each description is one physical scene, around fifty words, in the same voice as an event room; none of them names a feeling or a god.

## 13.5 Pray and Talk (the rest room)

The rest room's flow is in `03-survival-stats.md`. Two of its options touch Faith:

- **Pray** raises Faith by `rest.pray.faith` (15) and lowers every living member's fear by `rest.pray.fearRelief` (5). No HP, MP or satiety. It is the one dependable way to feed the torch, and it costs the rest action that Eat and drink or Talk would have used.
- **Talk** keeps its HP and MP recovery and its larger fear relief (`survival.chatFearRelief`), and also raises Faith when living members share a religion. Each religion with at least two living followers adds the value for its group size, and the amounts add up across religions: a party of two pairs gets the pair amount twice. A party with no shared religion gets none. The amounts are `rest.chat.faithByGroupSize.2` (3), `rest.chat.faithByGroupSize.3` (8) and `rest.chat.faithByGroupSize.4` (12); dead members do not count.

Eat and drink is unchanged. Each option's effect shows as a line under it in the format reflection answers use, with Talk's Faith computed for the party as it stands.

## 13.6 A party that ignores Faith

Nothing breaks at 0. The torch goes out and the fear gain runs at its worst factor, which is enough: fear feeds back through its tiers (`04-fear-combat.md`), so a dark torch costs the party in the fights it can least afford. A party that tends it pays in rest actions (Pray instead of Eat and drink), in HP (Give blood) and in the room's other options. That is the whole trade: Faith costs something the player could have spent on a body.

## 13.7 Reflections carry effects

Every post-event reflection and every Camp Reflection answer has a visible cause and effect, and Faith is one of the stats they move. The rules, the data shape and the screens are in `08-events.md` §8.6; Camp Reflection is in `03-survival-stats.md`. Faith appears in an answer only where the room touches belief: the gambling den belongs to an outsider who deals in coin, so none of its answers move Faith.

## 13.8 Design rationale

- **Why a percentage decay.** A flat per-room decay cannot hold Faith in a band. The temple's yield per floor is random and swings further than the band is wide, so a flat rate tuned for "the torch goes out after two floors without temples" lost the torch by the third floor even for a party using every temple. A flat amount plus a share of the current value pulls Faith towards a resting level whatever the temples do, which is what lets "tended" and "neglected" be two different outcomes rather than one.
- **Why Pray costs the rest action.** If Faith could be kept up for free, it would be a number to ignore. Making Pray compete with Eat and drink and Talk puts the torch into the same budget as hunger and fear.
- **Why Give blood never kills but Give everyone's blood can.** A follower gives of their own faith and the temple takes only what the body can spare. When nobody there follows it, the party pays in a currency the temple has no reason to be gentle with.
- **Why no Faith from Elite or Boss kills.** Faith is the cost side of descending, not a reward for winning. A kill that fed the torch would make the strongest party the best-lit one, and the torch would stop being a choice.
- **Why the boon is floor-length and live-computed.** A boon is the price of a floor, not a permanent upgrade, so it ends with the floor and never lives in a save as a status.
- **Why Talk's Faith depends on shared religion.** It rewards a focused party for being focused, and gives a mixed party a reason to pray instead.
- **Why religion is a label, not a build.** A class's kit already decides how it plays. The religion decides what the world above did to it, which the temples and the reflections can then read.

<!-- docs:intent-begin -->
The simulation behind the decay shape ran 15 floors over 150 `random-play` runs' worth of party HP, with routes of 10 to 15 rooms and a party of two religions with one member, one with two and one with none. With flat-plus-percentage decay and Pray, a party that tends the torch spent 91 to 94 percent of floors from the third to the fifteenth between 20 and 50 Faith with the torch never out, and a party that never prays lost it in about nine runs of ten. The data's values are checked against the built game with `bun run random-play` and `bun run curve`.
<!-- docs:intent-end -->

## 13.9 Saves

The 1.3.0 step in `VERSION_MIGRATIONS` (`src/engine/migration.ts`) gives an older save full Faith and no boon, and turns a saved `pendingReflection` into a `pendingEventExit` with its reflection. A floor generated before 1.3.0 has no temple; the next floor rolls one. A saved reflection stance stays valid, since the old three stances are in the new set.
