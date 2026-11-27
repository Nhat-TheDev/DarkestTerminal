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

At 0 the torch keeps a red ember but casts no halo. Nothing else happens beyond the fear penalty.

### The torch

The battlefield divider between the party and the enemy block is an upright wooden handheld torch, including in rest, event, treasure and temple rooms. The torch and its halo are hidden while the Gatekeeper scene is pending. It has four frames, from a large yellow flame through medium and small flames down to red embers, selected by `faith.torchFrameThresholds`; the sprites are in `data/sprites.json` (`torch`). A warm halo blends into the surrounding backdrop, fading with distance from the flame. Its brightness and radius decrease continuously with Faith, including within one sprite threshold; at zero Faith it disappears. The halo leaves sprite pixels and text unchanged and follows the backdrop's combat dimming. The exact Faith value, rounded down, also shows in the header beside Coins and Satiety, so the effect lines on the rest and reflection screens can be checked against it.

## 13.3 Religions

Four religions, each a record in `data/religions.json`: `id`, `name`, `templeDescription`, `templeSpriteId`, an action-to-passage `narration` map (§13.4), a `style` (abbreviation and color) and a `boon` shape (`emphasis`: `offense`, `defense`, `speed` or null; `recoversHpMp`). Every class carries a fixed `religionId` in `data/classes.json`; the loader refuses a class that names an unknown one, or a religion whose `templeSpriteId` does not name a sprite in `data/sprites.json`'s `temple` section.

<!-- docs:begin religions -->
*Generated from `data/religions.json` and `data/classes.json` by `bun run docs:sync`. Do not edit.*

| Religion | Classes | Boon |
|---|---|---|
| Light and Glory | Knight, Acolyte, Paladin | Defense raised more |
| Plague and Healing | Plague Doctor, Summoner, Jester | All three raised evenly; HP and MP restored in every room |
| Night and Silence | Mage, Rogue, Ninja | Speed raised more |
| Fury and Blood | Viking, Archer, Warlock | Attack and magic power raised more |
<!-- docs:end -->

The party select screen shows each class's religion under its role tags, in the religion's color, so a player can weigh a focused or mixed party; the character info screen shows it too. Religion matters in three places: which members a temple counts as its own (§13.4), how much Faith Talk restores (§13.5), and which reflection answers appear (§13.7).

### Where the four sit in the world

The world bible has one organised faith, the spiral-marked group that formed after the descents (`12-world-bible.md` §12.6). The four religions are not that group and not offshoots of it. They are faiths of the world above, older than any descent, that people carry down with them. Their temples stand in the dungeon anyway. Who built them is left open (pilgrims of those faiths who came down before, or the place repeating a shape the people walking it carry in their heads), and so is whether any of the four gods exists, hears or answers (`12-world-bible.md` §12.9). Temple text never shows a spiral, never mentions the split, and never has anything in the room respond to the party's faith.

On the page: religion names appear in the UI as labels, not lore. A temple's description is a physical scene in the house style. Faith is always "the torch".

## 13.4 The temple

### Placement

Each floor except the Founder encounter floor rolls a temple with chance `temple.chance` (80%), after its layout and monsters are built (`prependTemple`, `src/data/floor.ts`), so a seed's floor is the same with or without one. When it rolls, the temple is the floor's **entry room**: the party arrives in it, its only exit is the combat entrance the floor would have opened with, and its religion is drawn evenly from the four. The map shows it with its own glyph. Floor generation's invariant is that the entrance is a visible combat room; a temple in front of it is the one allowed exception (`technical-decisions.md` §1).

The Founder encounter floor never rolls a temple; floors after it resume the normal temple roll. What already happens on arrival at other floors still happens first: the gatekeeper on a new run, the journal pickup and the ending checkpoint. The temple screen comes after them. The entrance ambush does not fire on a temple (it has no monsters); the next room starts its own fight as any room does. The gatekeeper's paid blessing skips a temple the way it skips a rest room, so entering one never spends a blessed room.

### Temple sprites

Each religion has its own temple sprite in `data/sprites.json`, linked by `templeSpriteId` in `data/religions.json`. The screen selects it from the room's `templeReligionId`, regardless of the party's religions. Each colored pixel occupies one terminal cell; previews use the same 1:2 width-to-height ratio.

Light and Glory has a golden sun above a stepped altar with brass lamps. Plague and Healing has a moss-green roof, pale stone columns and an arched entrance. Night and Silence has a pointed violet hood, a dark recess and ash bowls. Fury and Blood has a rust-red roof, iron-clad pillars and iron rings. Their silhouettes and architectural details differ as well as their palettes. All four can be edited in the game editor's Religion temples category.

### The three actions

One action per visit, then the room is cleared. A **matching** member is a living member whose class religion is the temple's; every other living member is **other**.

| Action | Available when | Effect |
|---|---|---|
| **Give blood** | Faith is under 100 and at least one living member can give | Opens a list of the party. The player toggles any members the temple will take and gives with at least one chosen. Each donor's Faith adds up, and Faith over 100 is lost |
| **Ask a boon** | Faith is at least `temple.boon.faithCost` (20) | Pays the Faith cost. The whole party gets the temple's boon until the floor ends |
| **Leave** | always | Nothing |

Who can give, and for what:

| Donor | HP before giving | HP lost | Faith |
|---|---|---|---|
| Matching | at least `temple.giveBlood.matching.minHpFraction` (50%) of max HP | `temple.giveBlood.matching.hpCost` (50%) of max HP | `temple.giveBlood.matching.faithGain` (18) |
| Matching | from `temple.giveBlood.matching.lowMinHpFraction` (30%) up to the line above | down to `temple.giveBlood.hpFloor` (1%) of max HP | `temple.giveBlood.matching.lowFaithGain` (6) |
| Other | at least `temple.giveBlood.other.minHpFraction` (55%) of max HP | `temple.giveBlood.other.hpCost` (55%) of max HP | `temple.giveBlood.other.faithGain` (15) |

Anyone under their line cannot give and shows as such in the list. No donor ever drops below `temple.giveBlood.hpFloor` (1%) of max HP, and never below 1 HP, so Give blood never kills. When no living member can give, or the torch is already full, the action shows locked with the reason. The donor list, each row's HP after giving and the Faith it adds are drawn from `bloodGift` (`src/engine/temple.ts`), the same function `templeGiveBlood` applies.

Giving, asking a boon and leaving each take a second press of the same key (`docs/developer-guide.md`, "Key hints"); opening the donor list and choosing donors do not. Successful actions keep the `game.temple*` log lines in `data/strings.json` and open the shared narration below before returning to the cleared room.

### The boon

`GameState.boon` holds the religion and the floor depth it was asked on, and `advanceToNextFloor` clears it. Its effect is computed live in `recomputeCharacterStats`, as the Exhausted multiplier is, not stored as a status effect. The party's buff list and character details show `Boon: <religion name>` in that religion's color, naming the temple's religion rather than the character's. Stat breakdowns show its contribution separately. The label and effect end with the floor.

- Every boon raises attack, magic power, defense and speed by `temple.boon.statPercent` (8%), or `temple.boon.matchingStatPercent` (12%) for a member of the temple's religion.
- A religion with an emphasis raises that stat by `temple.boon.emphasisPercent` (15%) instead, or `temple.boon.matchingEmphasisPercent` (20%) for a matching member: defense for one, speed for another, attack and magic power together for the third.
- The religion without an emphasis raises all four stats evenly and restores `temple.boon.recoveryPerRoom` (7%) of max HP and MP to each living member on every room entered for the rest of the floor, or `temple.boon.matchingRecoveryPerRoom` (10%) for a matching member.
- Faith decays more slowly for the rest of the floor (§13.2).

The word is "boon" in code and docs: "blessing" is the gatekeeper's paid blessing, and the Runner's barter buff is its own thing.

### Text

A temple screen shows the religion's name in its color, its `templeDescription` and the actions. Give blood and Ask a boon each carry a dim `Cost:` and `Result:` line under them, drawn from `temple.giveBlood` and `temple.boon`; Leave has none. Ask a boon's `Result:` names the religion's boon and ends in `*`, and a `*` note under Leave spells out what that boon does, built from the religion's `boon` record and `temple.boon` (`boonEffectText`, `src/ui/screens/temple.ts`). Each description is one physical scene, around fifty words, in the same voice as an event room; none of them names a feeling or a god.

### Choice narration

Give blood, Ask a boon and Leave each show one religion-specific passage after the action succeeds, then `[Enter] Continue` returns to the room. Temple narration uses the shared screen, controls, result format and saved state in [`08-events.md` §8.26](./08-events.md#826-choice-narration). It adds no temple Reflection, attitude answers or divine response.

Each religion's `narration` in `data/religions.json` contains exactly `giveBlood`, `boon` and `leave`. `src/data/religions.ts` rejects missing, blank, non-text or additional cases and placeholders. The passages fit a single donor or several, including mixed religions; committed member names and resource values belong to the result block rather than to an invented ritual branch.

| Religion | Passage setting | Boundaries |
|---|---|---|
| Light and Glory | Gold-leaf sun, cold brass lamps, cloth passed to donors | Asking does not heal immediately or make the lamps light |
| Plague and Healing | Warm stone basin, herbs and bandages | Asking activates the existing movement-triggered recovery; no immediate healing or blanket cure |
| Night and Silence | Felt, ash bowls, low torch | No granted invisibility, stealth or combat turn |
| Fury and Blood | Iron rings, trough and wet drain | No forced frenzy, new weapon, Fear change or extra sacrifice |

The exact passages stay in the religion catalog. They preserve §13.3's physical scenes and do not establish that a god heard or answered.

Give blood remains: open donor list → toggle members → Enter to arm → Enter to commit → narration → one fresh Enter → room. Toggling and arming spend nothing. Another key cancels armed confirmation and consumes that key while retaining the selection; a subsequent Escape returns to the temple. The committing Enter cannot also dismiss the narration.

| Donation/boon condition | Narration and result |
|---|---|
| One or several accepted donors | One passage; each selected donor's actual HP before/after, plus the actual rounded/capped total Faith increase |
| Selected member's payment rounds to zero | Still name that contributor and show unchanged HP; do not silently omit the selection |
| Eligible member left unselected | No payment, result row or claim that the member was weak or refused |
| Selected gains exceed remaining Faith capacity | Preserve all selected HP costs; report only the actual capped Faith increase |
| Empty selection, full Faith, dead/ineligible donor, or any rejected committed donor | Existing error, no narration, no payment and no room clear; donor validation stays all-or-nothing |
| Boon accepted | Report Faith paid and the active boon until the floor ends; no HP/MP recovery on selection or Continue |
| Boon unaffordable or another action rejected | Existing error only; no narration or resource change |
| Leave | Religion-specific exit passage, no result block or cost |

Accepted donations preserve the HP floor in §13.4 and cannot kill. There is no weak-member appendix or fatal-offering narration. Rendering and Continue never pay again, heal, drain Faith or advance the run. Previewed costs and eligibility remain owned by `bloodGift` and the existing temple rules.

## 13.5 Pray and Talk (the rest room)

The rest room's flow is in `03-survival-stats.md`. Two of its options touch Faith:

- **Pray** raises Faith by `rest.pray.faith` (20) and lowers every living member's fear by `rest.pray.fearRelief` (5). No HP, MP or satiety. It is the one dependable way to feed the torch, and it costs the rest action that Eat and drink or Talk would have used.
- **Talk** keeps its HP and MP recovery and its larger fear relief (`survival.chatFearRelief`), and also raises Faith when living members share a religion. Each religion with at least two living followers adds the value for its group size, and the amounts add up across religions: a party of two pairs gets the pair amount twice. A party with no shared religion gets none. The amounts are `rest.chat.faithByGroupSize.2` (3), `rest.chat.faithByGroupSize.3` (8) and `rest.chat.faithByGroupSize.4` (12); dead members do not count.

Eat and drink is unchanged. Each option's effect shows as a line under it in the format reflection answers use, with Talk's Faith computed for the party as it stands.

## 13.6 A party that ignores Faith

Nothing breaks at 0. The torch goes out and the fear gain runs at its worst factor, which is enough: fear feeds back through its tiers (`04-fear-combat.md`), so a dark torch costs the party in the fights it can least afford. A party that tends it pays in rest actions (Pray instead of Eat and drink), in HP (Give blood) and in the room's other options. That is the whole trade: Faith costs something the player could have spent on a body.

## 13.7 Reflections carry effects

Every post-event reflection and every Camp Reflection answer has a visible cause and effect, and Faith is one of the stats they move. The rules, the data shape and the screens are in `08-events.md` §8.6; Camp Reflection is in `03-survival-stats.md`. Faith appears in an answer only where the room touches belief: the gambling den belongs to an outsider who deals in coin, so none of its answers move Faith.

## 13.8 Design rationale

- **Why a percentage decay.** A flat per-room decay cannot hold Faith in a band. The temple's yield per floor is random and swings further than the band is wide, so a flat rate tuned for "the torch goes out after two floors without temples" lost the torch by the third floor even for a party using every temple. A flat amount plus a share of the current value pulls Faith towards a resting level whatever the temples do, which is what lets "tended" and "neglected" be two different outcomes rather than one.
- **Why Pray costs the rest action.** If Faith could be kept up for free, it would be a number to ignore. Making Pray compete with Eat and drink and Talk puts the torch into the same budget as hunger and fear.
- **Why anyone can give, but a stranger pays more.** A temple no member follows would otherwise be a room with nothing to do but leave. Letting every member give keeps the choice open, and the steeper line and cost for a stranger keep the temple's own faithful the cheaper way to feed the torch. The player picks the donors because the body that pays is the decision: a member about to carry the next fight should be able to keep their blood.
- **Why Give blood never kills.** The temple takes what the body can spare. A temple action that could end the run in one keypress would turn a choice about the torch into a trap.
- **Why Give blood locks at full Faith.** Blood given to a full torch buys nothing, and an action that only costs is not a choice.
- **Why no Faith from Elite or Boss kills.** Faith is the cost side of descending, not a reward for winning. A kill that fed the torch would make the strongest party the best-lit one, and the torch would stop being a choice.
- **Why the boon is floor-length and live-computed.** A boon is the price of a floor, not a permanent upgrade, so it ends with the floor and never lives in a save as a status.
- **Why Talk's Faith depends on shared religion.** It rewards a focused party for being focused, and gives a mixed party a reason to pray instead.
- **Why religion is a label, not a build.** A class's kit already decides how it plays. The religion decides what the world above did to it, which the temples and the reflections can then read.

<!-- docs:intent-begin -->
The simulation behind the decay shape ran 15 floors over 150 `random-play` runs' worth of party HP, with routes of 10 to 15 rooms and a party of two religions with one member, one with two and one with none. With flat-plus-percentage decay and Pray, a party that tends the torch spent 91 to 94 percent of floors from the third to the fifteenth between 20 and 50 Faith with the torch never out, and a party that never prays lost it in about nine runs of ten. The data's values are checked against the built game with `bun run random-play` and `bun run curve`.
<!-- docs:intent-end -->

## 13.9 Saves

The 1.3.0 step in `VERSION_MIGRATIONS` (`src/engine/migration.ts`) gives an older save full Faith and no boon, and turns a saved `pendingReflection` into a `pendingEventExit` with its reflection. A floor generated before 1.3.0 has no temple; the next floor rolls one. A saved reflection stance stays valid, since the old three stances are in the new set.

A committed temple action saves its resolved passage, selected contributors and actual results in `pendingChoiceNarration` (`08-events.md` §8.26). Loading resumes the same reading; Continue clears it and returns to the already-cleared temple without a second payment or boon application. Older saves with no pending narration do not infer one.

Before commitment, `UiState.templeDonors.selectedIds` and armed confirmation remain UI-only: a reload may return to the open temple without a selection, and spends nothing. Narration persistence does not add picker/confirmation persistence.
