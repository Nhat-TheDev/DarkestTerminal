# Developer Guide

This is the entry point for understanding **how Darkest Terminal is built** —
architecture, data files, and code layout. If you're a player looking for
installation instructions or how to play, see the [main README](../README.md)
instead; this doc is written for anyone reading or changing the code.

Runs on [Bun](https://bun.sh) + [OpenTUI](https://github.com/anomalyco/opentui).

**Related docs**: this file covers *implementation* — for *design decisions*
(why a mechanic works the way it does, exact formulas/thresholds), see
[`design-doc.md`](./design-doc.md), [`gameplay-decisions/00-index.md`](./gameplay-decisions/00-index.md)
(per-topic design docs), and [`technical-decisions.md`](./technical-decisions.md).

## 🧪 Development setup & tests

```bash
bun install
bun run start   # run the game from source

bun test        # unit tests for the engine (resolver, combat, aggro, level, floor pattern, ...) +
                 # headless smoke tests for the UI (simulated keyboard input via @opentui/core/testing)
bun run typecheck
bun run game-editor  # dev tool: sprite and backdrop editing, stat/balance rebalancing, damage/skill preview, and CRUD for monsters/artifacts/items/status effects/monster skills (tools/game-editor/)
bun run dump-save    # dev tool: web UI that writes a save at any level/floor/room/event (tools/dev-save-dump/, dev mode only)
bun run docs:sync    # rewrite the doc tables and numbers that mirror data/*.json (--check only verifies, --coverage lists unprotected numbers; bun test runs the check)
bun run random-play  # dev tool: a bot plays seeded runs through the headless UI and writes report.html (tools/random-play/); --evidence captures every screen as PNG
bun run curve        # dev tool: elite/boss fights on the engine, win rate per guard and team (tools/curve/); --check gates on the curve rules

bun run build        # compile a standalone release binary (--define __DEV__=false, so dev mode is off)
```

<!-- docs:intent-begin -->
`bun run random-play` (`--runs N --team NAME --seed-start S --max-steps M --out DIR --report html|none`)
drives the real `App` with simulated keypresses, the way `test/ui.test.ts` does, but for many
seeds. It plays `--runs` runs (5 by default) for each team in `tools/random-play/team.ts`, or for
the one `--team` names; `--max-steps` defaults to 5000. A run ends once its party leaves the floor
it started on, so it covers one guard and the screens after it, or on defeat. A quarter of the runs
start fresh; the rest start, via `applyDump`, on a guard floor ending in 1 or 5 below the ending
checkpoint, at that floor's average level. In a fight nearly every key comes from the team's policy;
outside one, close to a third come from the footer at random, so stray menus still get opened.

The policy works from what each member's roles and skills allow. A member holds one or more roles: a
healer heals from 70% HP rather than 50% and keeps the MP for its cheapest heal, a tank opens with
support skills, a striker attacks. A healer counts calling up a minion that has a healing skill as a
heal while that minion is not on the field. An attack or magic buff for allies goes on the hardest
hitter, at most once every 3 rounds per caster, and waits for an opening: the guard's defense held
down by at least 10% by debuffs, or else 6 rounds without a buff. A buff that only raises attack or
magic must add more than the caster's own attack would, or half of it inside an opening. A skill that
gives an ally MP goes first to the hardest hitter below 35% MP, opening or not. It heals, relieves fear from the point where
combat penalties start, then attacks, and holds the costliest skills and ultimates for the
guard unless the party is in danger. Below 35% MP a character conserves: outside a guard fight it
spends MP only on heals and fear relief, and otherwise reaches for a recovery item, a damage item
or the free basic attack, in that order. Mana potions wait for the guard, and a healer always keeps
the MP for its cheapest heal. It takes a rest room when anyone is hurt, frightened, low on MP or
satiety is at 50 or below, eats when hungry, talks when frightened, and camps on a kit when hungry.

Once the run has not changed for a while it stops following the policy, backs out of any screen that offers Esc and favours digits and
Enter over the global keys, so it does not idle in the character sheet or the log. Every run plays
at a height of 70 rows and widths 150/180/220, so the whole party and every panel is visible; each
new screen is also redrawn once at the minimum supported size, 150×45. Along the way it saves and
reloads (more often mid-combat) and occasionally resizes. It reports:

- **crash** — an exception, including one OpenTUI's key handler catches and only logs;
- **invariant** — state that must never happen (a NaN stat, HP outside 0..max, two summons with one id, an open combat after the run ended, two characters carrying one Ability…), see `findInvariantViolations` in `tools/random-play/checks.ts`;
- **textLeak / longDecimal** — `undefined`, `NaN`, `{{template}}` or raw ANSI on screen, and numbers with three or more decimals;
- **deadKey / hiddenKey** — a footer key that does nothing, or an unadvertised digit that changes the run;
- **missingFooter / footerTruncated / panelMissing** — layout broken at the play sizes or at 150×45;
- **softLock** — 300 keypresses without the run changing, even while trying to back out and move on.

A digit that does nothing (re-picking the tab already shown) and text touching a panel's right
border are warnings for a human look, not failures. Each finding carries the seeds, the last 50
steps and a colour capture of the screen; `--game-seed X --bot-seed Y --team NAME` replays one run exactly.
`report.html` also holds a gallery of every screen reached, rarest first: one capture per screen kind,
event room and case (a fight's tier from its strongest monster, a fight's outcome, a reward or an empty
one) at the size it was reached at, and again at 150×45. The tool exits non-zero
when it finds a failure, and prints each kind of failure with the screens it hit and a command that
replays its first occurrence; `--report none` skips `report.html` and `failures.json`, so that list
and the exit code are the whole result. `report.html` also tabulates how each team played and the
guards it met, for a look only: balance is measured by `bun run curve`, below. Every pull request
runs 5 fixed seeds per team this way (`.github/workflows/random-play.yml`).

`bun run random-play --evidence` plays fixed scenarios instead, to capture every screen rather than
find crashes: a fresh run with its opening scenes, a rest room, every room event (each forced into an
event room with `applyDump`'s `forceEventId`, the run ending once the party leaves the room), an elite
and a boss guard room, and a defeat. A scenario's seed and team come from its name, so adding an event
leaves every other scenario's screens as they were, and a scenario plays at
180×70 with no save round trips, resizes or hidden-key probes, so the same code captures the same
screens. It still reports failures as above. Into `--out` it writes `screens/*.png` (each screen at
180×70 and 150×45, drawn from the captured cells by `@resvg/resvg-js`, block glyphs as rectangles),
`manifest.json` (each screen's key, size, file and a hash of its cells, plus the failure count) and
a gallery `README.md` (`tools/random-play/evidence.ts`). On a pull request,
`.github/workflows/evidence.yml` runs it on the branch and, when the base has it too, on the base
(a pull request from a fork skips it, since its token can neither push nor comment);
publishes the branch's screens as a single orphan commit on `evidence/pr-<number>`, replaced on every
push and deleted when the pull request closes; and keeps one comment on the pull request: the screen
count, the room events with no screen, the screens new, gone or changed against the base (the first
30 changed ones as images, linked by the evidence commit so an edit never shows a cached image), and
a link to the gallery. A change that sends the bot down another path also changes the screens after
it. The curve comment and this one each start with a marker that
`.github/scripts/upsert-comment.sh` finds to edit them in place.

`bun run curve` (`--only ID,ID --tier elite|boss --teams NAME,NAME --level min|avg|max --precision P
--max-fights N --baseline FILE --out DIR`) measures elite and boss fights on the engine itself, with
no UI. Each guard archetype is fought on every random-play start floor it can appear on, on its first
elite and boss floors, and the final boss on its own floor. The party starts at full HP with the
starting items and no artifacts, at that floor's average level from `simulateLevelByDepth`
(`--level min|max` takes the floor's lowest or highest instead), and every member plays the
random-play team policy. Fights come in batches of 20 per team until the 95% Wilson interval of the
win rate is within `--precision` (0.05) on each side, or `--max-fights` (1000) is reached; a fight
still going after 300 rounds counts as lost and is counted apart. Each guard reports its win rate
with that interval and per team, the 10th, 50th and 90th percentile rounds of the fights won, the
share of party HP lost, deaths, the share of MP spent and items used, on the console and in
`curve.json` and `report.html`. Seeds are fixed, so the same data gives the same numbers;
`--baseline` takes an earlier `curve.json` and lists every guard whose win rate moved more than 5
points, which separates the effect of a data change from noise. The numbers describe that policy,
not a skilled player: it never uses Command and always holds a channel, and floor attrition and
artifacts are not modelled yet.

`bun run curve --check` runs every guard with the default options and exits non-zero when a rule in
`findCurveIssues` (`tools/curve/bench.ts`) fails: a guard whose whole win-rate interval sits below
`MIN_GUARD_WIN_RATE`, a final boss won more than `FOUNDER_WIN_RATE_SLACK` more often than the hardest
guard, or a boss taking more than `BOSS_HP_LOST_TOLERANCE` less of the party's HP than its elite on
the floors just before it. A move from the base branch is reported, not failed: whether it is
intended is the reviewer's call. The `curve` job of `.github/workflows/random-play.yml` runs the check
on every pull request and on every push to `main` or a `release/**` branch, and keeps `curve.json`
and `report.html` as the `guard-curve` artifact for 90 days. On a pull request it takes the base
commit's own `guard-curve` artifact from that push run, or, when there is none (the run is missing,
still going or expired), checks out the base and measures it with its own code. It then posts one
comment on the pull request, edited on every push (`tools/curve/comment.ts`): the check result, a
Teams table (win rate, HP lost, deaths and median rounds over every guard, base against branch, and
each team's hardest guard) with each team's members and roles below it, every guard whose win rate moved more than 5
points with its HP lost and median rounds, the hardest guards, and every guard in a collapsed table.
To compare locally, download a run's artifact (`gh run download RUN -n guard-curve`) and pass its
`curve.json` to `--baseline`. A base without `bun run curve` gets the comment without the comparison. The base runs its own team
policy and bench, so a change to either shows in the comparison as well as a balance change.
<!-- docs:intent-end -->

## ✅ Implementation overview

- **Multiple dungeon floors, with real floor descents** — each floor is generated by a runtime algorithm (see "Floor structure" below), always with 1 entrance and 1 guard room (elite/boss) at the end, no dead ends, and routes that split into lanes of different lengths and join again. While choosing a path, the Battlefield shows a map of the whole floor. Defeating the monster guarding the final room of a floor → immediately generates the next floor — there's no fixed "you win the game" state, you just play as far as you can get — `src/data/floor.ts`, `src/data/floorPatterns.ts`, `src/engine/floorGraph.ts`, `src/ui/floorMap.ts`, `src/engine/game.ts`
- **12 classes** with 6 stats + a basic attack (slot 0, free) + 5 class-specific skills in slots 1-5 + a dedicated ultimate in slot 6 (Knight, Mage, Rogue, Acolyte, Viking, Plague Doctor, Archer, Ninja, Summoner, Jester, Paladin, Warlock) — `src/data/classes.ts`
- **Party selection at game start + save/load** — a party of 4 different classes chosen from the 12 on the party select screen, which browses one class at a time (stats, passive, opening skills) and takes each recruit's Ability right after the pick; 5 fixed save slots — New Game picks a slot (one holding a run, a run that ended or a save that can't be loaded asks before it is overwritten, and overwriting starts the slot over), every save (`[q]`, `[s]`, and the autosave after any key that changed the run, `App.autosave`) writes to the run's slot, Continue lists the slots holding a run plus those whose run ended (a slot with a profile but no run picks up at party select for its next run), and any ending other than `victory` clears the run but keeps the slot. Each slot has its own profile (`slotN.profile.json`: unlocked abilities, retired characters, run count, the last ended run's play time and end time) that survives permadeath; the game over screen's `[n] New Run` starts the next run in the same slot (overwriting a slot only clears it once the new party is picked; `Esc` with nobody picked leaves party select for the slot list, or for the main menu on New Run), and the slot list shows which run a slot is on. The slot's first boss-tier kill unlocks Memory (`memoryUnlocked` in the profile): a one-time intro (`memoryIntroShown`, also in the profile), then `[m]` opens a read-only list of the slot's non-common abilities from any dungeon screen — `src/ui/screens/memory.ts`. Playtime is stored per save in `meta.playTime`, and a wipe copies it to the profile's `lastRun` for the slot list's ended line — `src/ui/partySelect.ts`, `src/ui/saveSelect.ts`, `src/engine/save.ts`, `src/engine/profile.ts`, `src/main.ts`
- **Journal** — a per-slot record of what the dungeon showed and what the party made of it (`data/journal.json`: pages of lines, each line with at least 2 directions, plus the fragments that open them and where each fragment comes from: an event resolution or a floor-milestone omen). A room clear or omen that turns up a fragment holds it as a find (`GameState.pendingJournalFind`, in place of that visit's event reflection) only when looking would open a scene: a living member who would argue one of its readings has stopped to look at something, and the party looks or moves on. A fragment that would open no scene is copied straight into the slot with no choice: a short notice shows who noticed it, its text and that it matches nothing yet, behind any find or scene still open, and `[Enter]` closes it and logs the text (`Game.journalNoticeView`/`dismissJournalNotice`; held on `Game`, not saved). Moving on writes nothing; either way the fragment isn't found again that run. Looking copies it into the slot and opens a deduction scene under the line's subject (no page title): the fragment's text shows with the first scene it opens and never again that run (a fragment in the same find that opens no scene goes to that notice), each reading offered as a living party member's line (an unmatched reading shows as a margin note with its default `speech`). A reading a scene has offered (`GameState.journalOffered`) isn't offered again that run, so a line reopens only with a reading it hasn't shown yet; a blank line that already had a scene reopens on one new reading. A new run starts with nothing offered. Every class carries a hidden personality (`personalityId`, `data/personalities.json`): what it notices, and `badWhen`, the conditions under which it speaks its bad side, a virtue pushed too far. A direction holds a `good` and a `bad` line per personality that would argue it; who speaks and in which face is fixed when the scene opens (`pendingJournal.voices`), and each bad-side line costs every other living member `journal.badFaceFearCost` fear, and the choice to write one, leave the line unwritten, or strike what was written. Fragments are picked in authoring order, never from the run's rng. A line that opens behind another scene waits in `GameState.journalQueue` for the next floor clear; a line left unwritten comes back only with a new fragment. A written reading whose own `requires` stops holding is struck. The journal lives in the slot profile (`journal`) and is written back on every change; a wipe moves the party's readings into `droppedJournal` at the death depth and keeps the fragments, and the game-over screen says which floor it lies on. A later run in the slot that arrives at that floor reads it before the entry room's ambush check (`startJournalPickup`, from `advanceToNextFloor`, `enterDungeon` and the floor-1 constructor path; never on the founder floor): their readings on lines this party left blank are offered a page at a time, each line read differently is offered as keep ours / take theirs / leave both, which writes a `split` line that counts for no condition until its next scene picks one, and a reading whose own gate fails for this party is shown but can't be taken; past `journal.maxMergeScreensPerFind` the rest merges silently. When the bundle holds several hands the newest wins each line. A run that dies without reaching it moves it up `journal.driftFloorsPerMissedRun`, never above `journal.driftMinDepth`, and adds its own readings as another hand. Echoes (`echoes` in `data/journal.json`) show only while the journal holds the reading they name: an event visit shows the first eligible one under its own text, once per run (`Room.journalEchoId`, picked in `Game.move`); an ending shows up to `journal.maxEndingEchoes`, one-sided lines first and at most one mirrored line, on a Last page the game-over screen opens with `[Enter]`. The loader rejects a line with echoes on some but not all of its readings, and a page where every line is one-sided. Every echo seen is kept and shown under its reading in the viewer as a `Since:` line. `[j]` opens a read-only viewer once the slot holds a written line; a line goes onto its page only once a reading is written there (or it is split), with the fragments that name it — `src/data/journal.ts`, `src/engine/journal.ts`, `src/ui/screens/journal.ts`
- **33 regular monster types** (`COMBAT_ROOM_ARCHETYPES`) + **10 guard-room archetypes** (`GUARD_ROOM_ARCHETYPES`, one of which can also spawn as a regular monster) guarding the boss room of every floor, with 1 of the 10 picked at random each time, plus 1 scripted final boss (`FINAL_BOSS_ARCHETYPE`) excluded from that random pool — `src/data/monsters.ts`
- **2-phase combat** (command all 4 characters → execute in speed order, monsters decide on the spot), weighted-random targeting mixed per `aiPattern` from aggro, low HP, fear and damage taken (`src/engine/monsterAI.ts`, `02-monster.md`), retarget/cancel rule when a target dies before its turn — `src/engine/combat.ts`
- **One Elite/Boss kit per guard-room archetype** (all 10, plus the final boss, What's Left of Him, `the-founder`): data-declared skills with their own cooldowns, conditions, target rules and phases, plus a boss-only telegraph released by a meter; the elite tier runs a reduced subset of the boss kit. Built on a rules-aware monster AI and a few generic mechanics (summoning, riposte, a breakable shell, untargetable monsters) — `data/monster-skills.json`, `data/monsters.json`, `src/engine/monsterAI.ts`
- **`SkillEffect` resolver** shared across skills/status-effects/items, buffs/debuffs via `modifyCombatStat`, DoT ticks at the end of every round — `src/engine/resolver.ts`
- **Fear + Satiety survival stats**, HP=0 → true permadeath, fear affects combat back through 4 tiers — `src/engine/survival.ts`, `src/engine/resolver.ts`. Satiety is party-wide, draining once per room resolved (amount depends on room type); low satiety escalates through **Exhausted** (stats reduced) and **Dying** (a recurring HP tick on top of Exhausted). The rest room offers Eat and drink or Talk (or Skip, and Trade when the Merchant's Runner is there — `src/ui/screens/room.ts`), and **Camp** — a post-victory option paid for with an Exploration Kit item — restores satiety outside the rest room. Details in [`gameplay-decisions/03-survival-stats.md`](./gameplay-decisions/03-survival-stats.md)
- **Level 1-100 system**: `attack`/`defense`/`maxHp`/`maxMp` grow through tapered tiers via `growthBonus()`, shared between characters (by `level`) and monsters (by `floorDepth`). Characters additionally apply their own class-specific `growthWeights` so the 12 classes don't converge to look the same at high levels. Character level (shared across the party, capped at 100, gained through EXP from killing monsters) is completely separate from dungeon floor level (`Floor.depth`, uncapped) — details in [`gameplay-decisions/06-level-system.md`](./gameplay-decisions/06-level-system.md)
- **Consumable items + permanent, one-shot-decision Artifacts** — items dropped by monsters, usable only in combat (view-only outside it; `combatUsable: false` keeps one out of combat too, e.g. the Camp kit); artifacts are equipped on one specific character (max 3 per character) the instant they're picked up — the player decides equip-or-discard right then, with no free reassignment afterward (3 narrow exceptions) — effects only counting for whoever has it equipped — `src/data/items.ts`, `src/data/artifacts.ts`, `src/engine/artifacts.ts`, `src/engine/party.ts`, details in [`gameplay-decisions/07-items-artifacts.md`](./gameplay-decisions/07-items-artifacts.md)
- **Cursed Coins** — a party-wide currency dropped by every monster kill (amount by monster power tier), spent in the Merchant (coin prices + a paid Refresh), the Wandering Gambling Den (a 4-round escalating coin gamble), the Wandering Hermit's Exchange Fortune service, and the Merchant's Runner's shop (selling items back to him is a small coin source) — `src/data/currency.ts`, `src/engine/events/`, details in [`gameplay-decisions/09-currency.md`](./gameplay-decisions/09-currency.md)
- **Merchant's Runner** — a 50% chance on entering a Rest room: a notice screen, then a fourth **Trade** option that replaces the room's rest action. He runs a coin shop of consumables (5 rotating offers, singly or as lots of 3, refreshable, with tier odds that climb with floor depth), buys consumables and trophies back at a fifth of the single price, and takes a number of one effect-less monster trophy kind for a buff that waits for the floor's elite/boss fight — `src/engine/events/runner.ts`, `src/engine/events/barter.ts`, `src/data/shopStock.ts`, `src/ui/screens/runner.ts`, details in [`gameplay-decisions/03-survival-stats.md`](./gameplay-decisions/03-survival-stats.md) (flow, shop odds, barter), [`09-currency.md`](./gameplay-decisions/09-currency.md) and [`07-items-artifacts.md`](./gameplay-decisions/07-items-artifacts.md) (tiers, trophies)
- **Event room** — a random event room rolling 1 of several event types when entered, split into 2 rarity tiers — `src/data/events.ts`, details in [`gameplay-decisions/08-events.md`](./gameplay-decisions/08-events.md)
- **The Gatekeeper** — every new run opens at the cave mouth with the one `kind: "scripted"` event, before floor 1's entry room (whose ambush waits for `Game.enterDungeon`). Paying `gatekeeper.tollCoins` (50) coins blesses the next `gatekeeper.blessingRooms` (5) rooms the party enters, rest rooms not counted: a fight in one opens with the `gatekeeper.blessingStatusId` status on every living member, and the guard room ends the blessing. Refusing costs nothing. The party then takes the map and moves in — `src/engine/events/gatekeeper.ts`, `src/ui/screens/gatekeeper.ts`, details in [`gameplay-decisions/08-events.md`](./gameplay-decisions/08-events.md) §8.7
- **Camp Reflection + lore exposure** — each resolved event that counts as lore (not `noLoreExposure`, not the scripted one; `LORE_EXPOSURE_EVENT_IDS`) raises `GameState.loreExposureCount`. Entering an uncleared rest room once the count reaches a tier above the highest one answered (`survival.campReflectionTier1Threshold` up to `survival.campReflectionTier4Threshold`) opens a 3-choice reflection (`campReflection`); the choices are kept in `campReflectionChoices` — `src/data/loreExposure.ts`, `src/engine/dungeon.ts`, `src/ui/screens/campReflection.ts`
- **Floor-milestone omens** — winning the guard room on a floor that is a multiple of the `interval` in `data/floor-milestones.json` shows one omen line (`floorMilestone`), never repeated in a run and due by its `maxFloor`; an omen can also grant a journal fragment — `src/data/floorMilestones.ts` (`pickFloorMilestoneOmen`), `Game.clearFinishedCombat`, `src/ui/screens/floorMilestone.ts`
- **Endings** — clearing floor `endings.checkpointFloorDepth` (100) opens the ending checkpoint (`endingCheckpoint`). `endingCheckpointMode` picks its options: Leave alone when the run's event history triggers it (ambushed, or escaped with an `escapesLeaveAmbush` artifact equipped), Stay or Let go otherwise, plus Continue once Camp Reflection has reached tier 4. Stay retires a living character into the slot profile. Continue carries on to floor `endings.founderFloorDepth` (120), where the founder dialogue leads into the final boss fight — `src/data/endings.ts`, `Game.pickEndingChoice`, `src/ui/screens/ending.ts`, `src/ui/screens/founderDialogue.ts`
- **Dev mode** — `DEV_MODE` (`src/engine/devMode.ts`) is true everywhere except the release binary, where `bun run build` bakes `__DEV__=false` in at compile time. `writeDevDumpSave` (used by `bun run dump-save`) marks a save `devDump: true`, and `isDevDumpAllowed` (`src/engine/save.ts`) refuses to load such a save outside dev mode, even when its file is copied into a release install
- **Title (splash) screen** before entering the game — built with a hand-written block font (`src/ui/bigText.ts`, `test/bigText.test.ts`) — `src/ui/mainMenu.ts`, `src/main.ts`

## ✂️ Cut from scope (compared to the full design doc)

Not yet implemented: **FOV/pathfinding/diff-based rendering**. See the "Future direction" section in [`design-doc.md`](./design-doc.md).

## 📦 Design data (JSON)

All numeric/content data for characters, monsters, effects, items,
artifacts, events, pixel-art sprites, and UI text lives in `data/*.json`
(not TypeScript) — tweaking numbers or adding new content doesn't require
touching code, just editing the JSON to match the right shape. The modules
in `src/data/`/`src/ui/sprites.ts` are just a thin loading + light-validation
layer that re-exposes an API (`getClass`, `getSkill`, `getArchetype`,
`getItem`, `getArtifact`, `getEvent`, `spriteForClass`, `t`, ...) — the rest
of the code doesn't need to know the data comes from JSON.

| File | Contents | Loader |
|---|---|---|
| `data/classes.json` | 12 classes (Knight/Mage/Rogue/Acolyte/Viking/Plague Doctor/Archer/Ninja/Summoner/Jester/Paladin/Warlock): stats + all 7 skills per class + the passive, and `recommendedAbilityIds` (the abilities party select marks with `*`) | `src/data/classes.ts` |
| `data/monsters.json` | 43 monster archetypes (32 trash + 1 triple-role + 9 guard-only + 1 final boss): base stats + AI pattern + `roles` | `src/data/monsters.ts` |
| `data/monster-skills.json` | Elite/Boss skill kits (strike/cleave/execute/debuff × 10 guard-room archetypes) + regular-monster skills (per-archetype, e.g. Acid Spit, Web Spit, Blood Drain) | `src/data/monsters.ts` |
| `data/status-effects.json` | Buffs/debuffs (`guard`, `taunt`, `rallied`, `poison-coated`, `poisoned`, `burning`, `stunned`, `weakened`, ...) | `src/data/statusEffects.ts` |
| `data/items.json` | Items: the general pool (consumables, incl. the combat-unusable Exploration Kit) and effect-less monster trophies, each with a `tier` that sets its drop weight | `src/data/items.ts` |
| `data/floor-milestones.json` | The floor-milestone omen lines (one per milestone floor, banded by `maxFloor`): `id`, `maxFloor`, `text`, plus the milestone `interval` | `src/data/floorMilestones.ts` |
| `data/personalities.json` | The 12 hidden personalities: `id`, `lens` (a writing note), `badWhen` (conditions on the character's own fear or an ally's, HP, an ally's HP, a death in the party, the party's coins and satiety, depth, artifacts worn) | `src/data/personalities.ts` |
| `data/journal.json` | Journal pages (lines with a `subject`, optional `requires`/`minDepth`, and at least 2 directions: `label`, `speech`, optional `personalities` with a `good` and `bad` line each, optional `requires`) and fragments (`text`, `lineIds`, `sources`, optional `remark`) | `src/data/journal.ts` |
| `data/barter.json` | What each trophy costs and buys when bartered to the Merchant's Runner: item, number needed, and buff effects | `src/data/barter.ts` |
| `data/artifacts.json` | Equippable artifacts (multiple rarity tiers, multiple effect types, incl. Cursed ones) | `src/data/artifacts.ts` |
| `data/events.json` | Events for the event room (2 rarity tiers) | `src/data/events.ts` |
| `data/room-names.json` | Room-name pools per room type (combat, rest, boss, event); each name links to the backdrop scene drawn behind its Battlefield | `src/data/roomNames.ts` |
| `data/backdrops.json` | Battlefield backdrops: the global render settings, the wall/floor `bases`, the `props`, and one `scenes` entry per room name (a base plus placed props) | `src/data/backdrops.ts` |
| `data/level-growth.json` | Stat growth tiers by level/depth + elite/boss coefficients + `expTiers` + `maxLevel` | `src/data/levelGrowth.ts` |
| `data/balance-config.json` | Shared balancing constants (drop rates, weights, thresholds, Cursed Coin amounts...) | `src/data/balanceConfig.ts` |
| `data/sprites.json` | Pixel-art (character grid + palette) for every class + every monster role (normal→`monsters`, elite→`elites`, boss→`bosses`; guard-only ships elite+boss only, final boss ships boss only) | `src/ui/sprites.ts` |
| `data/strings.json` | All text displayed in the UI. `{{name}}` inserts a value; `{{name\|one\|many}}` writes `one` when that value is 1 and `many` otherwise, so a count reads "1 turn" / "2 turns" | `src/data/strings.ts` |
| `data/abilities.json` | Player-purchasable abilities (ability-buyback screen) | `src/data/abilities.ts` |
| `data/growth-weights.json` | Per-class `growthWeights` multipliers layered on top of the shared level-growth curve | `src/data/growthWeights.ts` |
| `data/monster-races.json` | Race/subRace resist/weak profiles referenced by monster archetypes | `src/data/monsterRaces.ts` |
| `data/monster-traits.json` | Trait-level resist/weak modifiers composed into a monster's resolved race profile | `src/data/monsterRaces.ts` |
| `data/summons.json` | Summon archetypes (stats, `speed`, passive behavior) spawned by summon skills | `src/data/summons.ts` |

**Class passives — 2 shapes, no hardcoded ids in engine code.** A passive's mechanic always reads its magnitude off `PassiveRankDefinition`/`PassiveSkillDefinition` fields in `data/classes.json` (see `src/types.ts`) — never a number typed into TypeScript. Every passive mechanic reads the character's own unlocked rank (`ownPassiveRank`, `src/data/classes.ts`) or passive and acts on the field it declares (`dodgePercent`, `reflectPercent`, `requiresTargetStatusId`, `debuffPool`...), never on the class id, so any class that declares the field gets the mechanic.

**No content id in engine or UI code.** Code never compares against, or looks up, a specific record's id: it reads a field that record declares. The record that plays a fixed role carries a flag for it: the Camp kit (`campKit`, `data/items.json`), the final boss (`finalBoss`, `data/monsters.json`), the artifact that escapes the Leave ambush (`escapesLeaveAmbush`, `data/artifacts.json`), the retired-character event (`retiredCharacterEvent`), the event that never counts as lore (`noLoreExposure`) and the opening scene (the one `kind: "scripted"` event). Event rooms dispatch on `kind`, and an event's text escalation names its counter and thresholds in `escalation`. A unit's chip label and color is its `style`. `test/noContentIds.test.ts` fails when code in `src/` names an id from `data/*.json`, as a quoted literal in any quote style or as an unquoted object key; comments never count. A word a type union in `src/types.ts` also declares as a mechanic name (`heal`, `fire`) passes as that mechanic, but still fails where only an id fits: compared to an `id`, passed to a `get*` lookup or `includes`/`has`, or used as an index. Only `src/engine/migration.ts` is exempt, since a version remap must name the historical ids it rewrites. Beyond that, a passive is one of 2 shapes:
- **Pure stat math** (Knight, Rogue's bonus%, Acolyte, Archer, Ninja's dodge/clone%, Summoner): no status effect involved at all — the hook/helper in `src/engine/combat.ts`/`combatHooks.ts` just reads the rank's numeric field(s) and computes directly.
- **Applies a status effect**: the status id(s) a passive can apply must also come from JSON, never a literal string in engine code. 2 valid ways to do this, picked by whether the ranks genuinely need a distinct status identity: a JSON array/pool of ids picked from at runtime (Plague Doctor's `debuffPool`), a JSON field naming a different status id per rank, whose own magnitude is the whole effect (Mage's `onHitStatusEffectId` — "shredded"/"-ii"/"-iii", Viking's `thresholdStatusEffectId` — "bloodrage"/"-ii"/"-iii", same shape Rogue's own Poison Bomb skill uses for "poisoned"/"-ii"/"-iii"), or, when 3 near-duplicate statuses would be pure duplication, 1 status id whose `data/classes.json`-declared rank magnitude overrides the status's own placeholder value at apply time (Totem Recall's `totems-strength` — see `docs/gameplay-decisions/01-class-skill.md` §1.3.9.2's `minPercent`-override note). A passive never repeats a number its status already carries. A passive that needs to check the *target's* status (not apply one) reads a JSON `requiresTargetStatusId` the same way (Rogue) — matched via `statusSatisfiesRequirement`, which already understands a status's own `rankOf` family link, so no hardcoded array of that family's ids belongs in engine code either.

**Status fields that bend a fight (Knight, Viking).** Each is a field a status (or, for Watchful, a passive rank) can declare in `data/*.json`, read by the engine; none names an id in code.
- `interceptsForSource` (Interpose's `interposed`): a monster's single-target damaging attack aimed at the bearer goes to the status's source (the Knight) while the source is alive and not stunned. `interceptTarget` (`src/engine/interception.ts`) runs after the monster has picked a target and before the hit and dodge rolls, so the Knight is rolled against as if chosen. Area attacks and skills with no damage effect are never redirected.
- `interceptWeakestChancePercent` (Watchful, a passive rank field): the same redirect, rolled per rank, for a hit aimed at the living party character with the lowest HP percentage. It fires at most once per round (`CombatState.watchfulRound`), never for the Knight itself, and yields to an `interposed` redirect.
- `onLandedHitSourceStatus`: when the bearer's own action lands a damaging hit, the status's source gains the named status (`applyLandedHitFollowUps`, `src/engine/combat.ts`). A miss, a stun, a heal or a buff gives nothing. The engine supports it, but no status in `data/status-effects.json` declares it yet.
- `rankOf` / `rankLevel`: statuses sharing a `rankOf` are levels of one family (the base is level 1), and a target carries one of them at a time. A higher level replaces a lower one, undoing its stat deltas; a lower level landing on a higher one adds `combat.lowerRankStatusExtendTurns` to it, capped at the higher one's own applied duration (`ActiveStatusEffect.durationTurns`, falling back to `combat.lowerRankStatusExtendDefaultCapTurns`), and logs a refresh once it is at the cap. Levels already sitting side by side, as an older save can hold, collapse to the highest the next time one lands (`applyStatusEffectToActor`, `src/engine/resolver.ts`). `levelsStack: true` on a family's base status turns the rule off for that family, so its levels stack (the barter regeneration tiers). A skill's `applyStatusEffect` may carry `rankWeights` (Spreading Toxic Fog): once it lands, `applySkillEffects` (`src/engine/combat.ts`, `rollStatusLevel`) picks the family level per target by those weights, an effect with its own `target` included. `assertRankWeights` (`src/data/statusEffects.ts`) refuses, for class, monster and summon skills alike, a weight on a level the family lacks or weights that are all 0; an item effect may not carry `rankWeights`, since items do not roll it.
- `damageTakenPercent` (Breach's `breached`): every direct hit on the bearer deals this percent more, whether it comes from a skill, a summon, an item, an artifact/ability's `autoDamage` or a reflect (`damageTakenMultiplier`, `src/engine/resolver.ts`). Status ticks are not raised.
- `woundOnHit` (Viking's `deep-wound`): each direct hit the bearer survives deals `amount` + a percent of its max HP more, of `damageType`, on its own log line (`openWounds`, `src/engine/resolver.ts`). The percent climbs from `minMaxHpPercent` at full HP to `maxMaxHpPercent` at `fullAtHpPercent` HP or below. Crits and `damageTakenPercent` do not touch it; a monster's defense blunts it at its tier's share (`combat.statusDamageDefensePercentByTier`, `statusDamageAfterDefense`) as it does a DoT tick, less the triggering hit's own `ignoreDefensePercent` (the Viking's `storm-empowered` bonus included), the race's resist/weak for `damageType` applies, it never drops below 1 unless the race is immune, an intact shell blocks it like a tick, and a race fully resistant to `damageType` never takes the status. A killing hit, a status tick, an `autoDamage` or a reflect opens nothing.
- `buffsAttackerOnHit` (Breach's `breached`): each party member's skill cast that lands a damaging hit on the bearer rolls `chance` once, however many damage effects it carries, to give that attacker the named status. Items, summons and artifacts/abilities never roll it, and the one who applied it never gains it (`applyAttackerBuffsOnHit`, `src/engine/combat.ts`).
- `counterAttack.target` (Engage's `engaged`): `"attacker"` makes the counter strike only the monster that landed the blow; absent or `"allEnemies"` strikes every targetable enemy.

## 🗺️ Floor structure — generated at runtime

Floors are generated directly by a runtime algorithm (`generateFloorLayout`,
`src/data/floorPatterns.ts`). A floor is a graph from 1 entrance room to 1
guard room: the route splits into at most
`floorGeneration.maxLanesPerSplit` (3) lanes (at least 2 rooms each) that
join again; a lane can split again inside itself, or send a branch that
merges into the lane below, a limited number side by side, and a join can
split again at once. There are no dead ends and no way back. Every route
stays within the `floorGeneration` bounds on rooms, rests and events, and
never passes two events or two rests in a row. Some rooms are hidden as
`[?]` until entered, more often deeper down.

The generator draws a shape and room types, then checks every rule over the
graph (`FloorGraph`, `src/engine/floorGraph.ts`) and redraws until they hold.
While the party chooses its next room, `src/ui/floorMap.ts` draws the whole
floor on the Battlefield from `connectedRoomIds` alone, so floors from older
saves draw too. The rules, the unknown-room placement and the map layout are
in **[`technical-decisions.md`](./technical-decisions.md)** §1.

Room names, and the monster types/counts for each combat room, are
randomized in `src/data/floor.ts` when the layout is built into an actual
`Floor` (reused for every floor, with `depth` increasing via
`Game.advanceToNextFloor()`) — the layout only determines the
**structure**, not the content of individual rooms.

## 🖥️ Interface — implementation

Before entering the game: title screen (`src/ui/mainMenu.ts`) → party
select (`src/ui/partySelect.ts`) or save select (`src/ui/saveSelect.ts`).
In-game: a dark color theme (background `#100d0a`/panel `#171310`), with each
character/monster getting its own colored "chip" (a colored background chip +
abbreviation, e.g. `KN` in steel blue for Knight, `GRD` in bone gray for
Skeleton Guard, bosses tinted red). HP changes color by threshold
(green/yellow/red), and fear only shows a colored label from tier 2 onward.

The smallest supported terminal is 150×45. At that size every screen must still show its whole <!-- docs:intent -->
footer and at least one row of the main (Dungeon) panel; the party list may scroll.
`bun run random-play` checks this on every screen it reaches. Every row of the combat skill menu fits
one line at that size, so a skill's `shortDescription` is limited by what its name and MP cost leave;
`test/skillShortDescription.test.ts` fails on one that doesn't fit, naming its limit.

From top to bottom the screen is the header, a row holding the Battlefield and the
Log beside it, the Party | Dungeon | Monsters row, and the key hints on the last line. The
Battlefield's content has a fixed size (`BATTLEFIELD_CONTENT_WIDTH` in `src/ui/layout.ts`, wide enough
for the widest enemy side a fight starts with, and tall enough for a boss sprite), so it never resizes from one
room to the next. The Log is a fixed-width column, as wide as the Monsters panel under it (`SIDE_PANEL_WIDTH`): each entry starts with its kind's
icon and wraps with its later lines indented under the text. Every extra column goes to the
Battlefield, which centres its content, and every extra row to the Party | Dungeon | Monsters row,
which has 16 rows of content at 150×45. <!-- docs:intent -->

Three viewers open over the current screen and keep every panel in place. `[p]` draws the floor map on the Battlefield
without exit digits, and puts its summary in the Dungeon panel (`src/ui/screens/floorMapView.ts`: the room the party stands
in, the rooms behind it, and the spread of rooms, rests and events left on the routes to the guard, a hidden room counting
as a fight so it gives nothing away). `[v]` shows the fight's monsters in the Dungeon panel, as `[b]` shows the party
(`src/ui/screens/monsterInfo.ts`: tier, race and reach on the heading, then traits, weaknesses and resistances, one stat per
row with a second row for what status effects add or take, shell, bar and telegraph, the skills its tier can cast with their
cooldowns, its statuses) or, outside a fight, the bestiary of every archetype the slot has fought. That list is the profile's `seenMonsterIds`, written by
`Game.noteSeenMonsters()` whenever a fight starts, a round resolves (it may summon) or a run loads mid-fight. A viewer opened from another replaces it, so `[Esc]` always
returns to the screen the first one was opened from.

### The "Battlefield" panel — pixel art

A dedicated panel under the header, beside the Log, showing the party of 4 characters
(left) and the monsters/boss in the current room (right), rendered as pixel
art: **1 pixel = 1 character cell** (a space with a background color, no
visible glyph). Characters/regular monsters are up to **10 pixels** tall,
elites up to **11 pixels**, bosses up to **15 pixels** (`MAX_UNIT_HEIGHT`/
`MAX_ELITE_HEIGHT`/`MAX_BOSS_HEIGHT`, `src/ui/sprites.ts`) — every unit is
rendered into the same fixed-width slot (`SLOT_WIDTH`, `src/ui/layout.ts`) and
bottom-aligned within a shared 15-pixel-tall frame. Below each sprite are 3 rows
(`buildUnitMeta`, `src/ui/app.ts`): a blank row, the label (abbreviation) and a status
row (current HP) — full detail (long names, MP, effects...) lives in the
"Expedition Party"/"Monsters" panels below. Sprite data lives in
`src/ui/sprites.ts`, with its own tests (`test/sprites.test.ts`) that catch
row/column misalignment or missing palette colors. Sprites are edited
visually in the browser via `bun run game-editor` (`tools/game-editor/`,
Sprite Editor tab) rather than by hand-editing the character grid in JSON. The same editor's
Backdrops tab edits the scenes drawn behind the panel (see "Backdrops" below).

On the room screen, while the party picks its next room, the Battlefield shows the floor map
(`src/ui/floorMap.ts`, technical-decisions.md §1) instead of the sprites, on the plain panel with no
backdrop. The Gatekeeper and every other screen keep the sprites.

Each unit's role icons sit one blank row above the tallest sprite its tier allows
(`tierFrameHeight`, `src/ui/battlefieldFocus.ts`: characters and normal monsters share
`MAX_UNIT_HEIGHT`, then `MAX_ELITE_HEIGHT`, `MAX_BOSS_HEIGHT`), so every unit of a tier wears its
icons on the same row and an icon never touches a sprite. A boss needs the 2 extra rows above the
frame (`ICON_BAND_ROWS`, `src/ui/layout.ts`); the battlefield always reserves them. Icons are
centred over the unit's own sprite (`spriteSlotLayout`, `src/ui/sprites.ts`). While a round resolves,
every unit outside the action being narrated is rendered grey (`dimColor`/`dimSprite`,
`src/ui/battlefieldFocus.ts`) and the participants wear icons — ⚔ attacker (also the caster of
a skill that only debuffs or only applies damage over time), ⛨ attacked (hit or missed), followed by ▼ when a debuff landed with the hit or
⁂ when a damage-over-time status did (`LogSession.debuffLandedIds`/`dotLandedIds`, filled from the
`statusLandedOf` that `applyStatusEffectToActor` puts on its line when the status lands on the
opposing side; one that missed, failed its chance or was thrown off adds nothing), ▼ debuffed by a skill with no damage or a unit
that lost a buff (it ran out, was removed or was spent — `LogSession.buffLostIds`, filled from the
`buffLostOf` of the line `expireStatusEffect` logs), ▲ buffed, ✚ healed (a heal-over-time such as
Mending counts here too, applied or expired), ⚚ caster of a buff/heal, ⊘ a unit whose turn was
cancelled (stunned, too afraid to act, or cut short by an Overwatch shot — `LogSession.lostTurnIds`;
a minion's lost turn shows on its owner), ♥ an attacker that drained HP from its own hit (`LogSession.lifestealIds`; a heal-on-kill is not
lifesteal and only shows its number), ♙ a unit whose summon took part in the session — it acted, was
targeted, ticked, lost a buff or fell (`LogSession.summonIds`, the owner's id; the cast that summons it does not count),
worn after the role icons it comes with. Blue marks the party, red the monsters, by the side of the
unit wearing the icon.
A status that changes a stat is a buff or a debuff, by the direction of the change
(`statusRole`, `src/engine/resolver.ts`); a stun and a blind are debuffs of their own, though they
change no stat; a dodge chance such as Smoke Cover is a buff; one that restores HP or MP over time
is a heal; damage over time, vulnerability, stealth and a stance such as Overwatch are neither, so
casting or losing one lights the unit without a ▲ or ▼ (a damage-over-time status that lands on
the opposing side still shows ⁂).
Who those units are comes from `LogEntry.session` (`LogSession`, built in
`src/engine/logSession.ts` and attached by `resolveRound`); a summon is recorded as its owner
because it has no sprite. Round-start and round-end ticks are one actor-less session per block
that lights the units whose tick logged; its `cause` picks their icon — ⁂ a damage-over-time tick
(`LogSession.tickDamageIds`) and ✚ a heal-over-time tick such as Mending (`healedIds`), both on a
unit that received both whatever the net HP change, ☠ Dying, ✦ the bearer of an artifact's
auto-damage (its target wears ⛨), ◉ a character whose fear changed at the end of the round or on a victory; a stat-mod expiry block shows only the ▼ of the units that lost a
buff, which includes the allies whose buff ends with a leaving Recall Totem. An ally that a skill or
item touches without helping (an aggro drop, say) is lit without an icon.

After the icons comes the unit's outcome for the session, from its impact on: its HP change
(`-12`, `+8`), or `miss` for a target whose attack or debuff missed or was dodged
(`LogSession.missedIds`) and lost no HP, or `immune` for one that lost no HP because its race fully
resists a damage-over-time status aimed at it (`LogSession.immuneIds`, filled from the
`statusImmuneOf` on the `resolver.statusImmune` line; see `docs/gameplay-decisions/02-monster.md`). Damage is white on a monster and red on a character; a
heal is green, lighter on a character and deeper on a monster (`MARKER_COLOR`, taking its colours
from `PALETTE` in `src/ui/theme.ts`; the words are `ui.focusMiss` and `ui.focusImmune` in `data/strings.json`).
The change is the difference between the HP on screen when the session lights up and its own
snapshot: each run of a session's entries carries the combatant state as of the end of that run
(`runInSession`'s `snapshot` option), so a session never shows a change that belongs to the next
one. A unit whose HP changed is never grey. A save writes every entry's snapshot empty (`saveBody`,
`src/engine/save.ts`): a loaded fight never replays a resolved round, and the snapshots are most of
a long fight's size.

A summon is drawn as its owner, so the HP change of the summons a unit owns is written there too.
Alone it reads like the owner's own number. When the owner changed as well, the owner's number shows
first and, a beat after the impact (`SUMMON_BEAT_TICKS`), the summon's replaces it,
led by ♙ (`-12` becomes `♙-12`). A summon that died, was dismissed or faded leaves the fight with the
HP it left with (`CombatState.departedSummons`), so a killing hit is still a number and a fade-away
is not one. The label under a party member's sprite carries one ♙ per living summon it owns
(`NJ ♙♙`), counted from the replayed snapshot so a summon spawned later in the round appears with
its own action.

A unit that took 2 or more direct hits in one session shows them one at a time instead of their sum:
`-53` at the impact, then `-52` a beat later. Each damage line of a direct hit carries the actor it
landed on, its full damage and the overkill the actor had no HP left to take (`LogEntry.hit`, set in
`resolveSkillEffect`; a damage-over-time tick has none). The marker reads the full damage, so a crit of
52 on a unit with 24 HP left is `-52!`, not `-24!`. The hits of a multi-hit cast that come after the
target has fallen are rolled for crit and variance like any other (`ResolveContext.unapplied`, set by
the hit loop in `applySkillEffects`): nothing is dealt, healed or hooked for them, and each is logged
after the "is defeated" line as `Overkill on Dungeon Rat: 49 from Knight's Frenzied Slash.` (with the
crit prefix when it crit; the line never says the unit takes damage). The battlefield still reads every
hit of the cast, `-52!`, `-49`, `-51`.
`RevealQueue` collects the hits per session (`focusHits`), moves to the next one every `HIT_BEAT_TICKS`
from the impact (`hitStep`) and holds the last, and the session runs `HIT_BEAT_TICKS` longer for each
hit past the first; a summon's number waits for the last hit. The log keeps that pace: the line of a
unit's k-th hit, with the lines that follow it ("is defeated"), is revealed at beat k (`paceByBeat`), so
the log names a hit when its number is up. When several units are hit more than once the lines of the
same beat are revealed together, interleaved by beat rather than grouped per unit; the stored
`combat.log` keeps the order they were logged in. `markerReading` picks the number, and
only when the HP the hits took (their damage less their overkill) adds up to the unit's whole HP
change: a heal landing on the same unit in the same session leaves the net on screen. The HP bar still
moves once, at the impact. An area attack (one hit per target) reads as before, and so does the damage
a summon takes (it is added to its owner's number, as above).

A critical hit or critical heal ends its number with `!` (`-80!`, `+30!`). The damage line of a hit
carries `crit` in `LogEntry.hit` and a critical heal's line carries `healCritOf`, set in
`resolveSkillEffect`; `RevealQueue` keeps them with the hits (`focusHits`, `focusHealCrits`) and
`markerReading` picks the number and its crit together, so in a run of hits only the beats of hits that
crit carry the `!`. When the hits do not add up to the unit's change, the net reads with `!` if any hit
on the unit or any heal that landed on it was a crit. A summon's number is read the same way
(`markerReading` over the hits that landed on the summon, so it too is the full damage and carries its
own `!`); when its owner took hits in the same session it replaces the owner's number a beat later,
after the owner's run of hits, and then reads its last hit. Colour and timing are unchanged.

A character whose fear changed in a session (`LogSession.fearChangedIds`, noted by `noteFearChange`
when a monster's hit lands, a skill or item's `modifyStat` moves it, the round ends, or the fight is
won) shows the change once everything else it wears has had its time: the reveal holds the session
`FEAR_BEAT_TICKS` past its usual end, and for that beat the character wears only `◉ +2.1` or
`◉ -15` (`MARKER_COLOR.fearUp`/`fearDown`, written by `formatFear`, which drops a trailing `.0`),
the change read from the `fear` that snapshots carry for characters. Party-wide fear (end of round,
victory) has no line in the log, so its session (`runFearSession`) rides on one `LogEntry` with
`hidden: true`, which `logLines` never renders; its beat starts at the impact.

The row holding this panel and the Log is `UNIT_BLOCK_HEIGHT` + 2 rows tall (`src/ui/layout.ts`):
2 icon rows + 15 pixels + 3 label rows, plus the border, 22 rows in all. With the header and the
footer that leaves the Party | Dungeon | Monsters row its 16 rows of content at the 150×45 minimum <!-- docs:intent -->
(see above). The game plays best at 150×70, where the whole party and every panel is visible <!-- docs:intent -->
without scrolling.

The target list (`pickTarget`, `src/ui/targetPicker.ts`) reads the picked skill's or item's effects.
Each ally's row lists every figure the effects touch, in a fixed order: HP for a heal (a `heal`
effect, or a status that heals over time), MP for `restoreMp`, fear for a `modifyStat` on fear or a
status with `fearResistPercent`, then the stats a buff raises (`ATK`, `DEF`, `SPD`, `MAG`, `AGG` —
the unit's current value). Prayer reads `(Fear 52, DEF 11)`, Blood Pact `(10/30 MP, MAG 3)`. MP and
fear exist only on characters, so a summon falls back to HP; a cure, a debuff or an attack lists
plain HP. HP is coloured with the party panel's thresholds (`hpColorFor`), MP in the MP colour and
fear by its tier (`fearColorFor`); names and stats are not. A trailing `*` flags the most hurt
target, only when its HP is under half (`MOST_HURT_BELOW`) and the first of equally hurt targets: an
ally for a heal, an enemy for an attack or a debuff once at least two stand. Each side is read from
the effects that reach it, so a stat buff or a heal flags no enemy and Purify flags an enemy and no
ally.

The remaining panels:
- **Expedition Party** (`renderCharacterLines`, `src/ui/app.ts`): each living character takes a
  name line (chip, name, level), then an HP bar, an MP bar and a fear line (its tier label from
  tier 2, and the dice count for a class with a dice hand), then one line each for its equipped
  Ability, its artifacts, its buffs and its debuffs (with turns left), and one line per living
  summon it owns with that summon's HP. A fallen character is one line. A name-line tag appears
  when the party is Exhausted/Dying (satiety-driven, party-wide —
  `gameplay-decisions/03-survival-stats.md` §3). Party-wide Coins/Satiety are shown in the header
  instead of per character.
- **Monsters**: the monsters in the current fight + their HP, a defeated one kept as a dead chip.
  Outside a fight the panel stays and says why it is empty: `ui.noMonsters` in a room that holds
  no fight, and in a combat or guard room `ui.roomSafe` once cleared or `ui.notEncounteredDot`
  before (`renderMonsterLines`). A boss with a telegraph shows its meter on a
  line under its HP (`◆` filled, `◇` empty, one icon per boss turn); a boss that fights in
  HP bars (the final boss) shows `Phase n/total` as well, and each bar has its own meter.
- **Log**: beside the Battlefield, spanning its row (`UNIT_BLOCK_HEIGHT` rows inside the border),
  scrollable (`↑`/`↓`, `ScrollBoxRenderable`, sticks to the bottom).
  The box shows the **room log** — the latest 50 entries, cleared when the player enters
  another room. `[l]` opens the **run log** on its own screen (`fullLog`): the latest 500
  entries of the run, in memory only (a loaded save starts empty); only `Esc`, `↑`/`↓` and
  `Ctrl+C` work inside it. Combat rounds are revealed **by action**: each actor's turn is one
  session that stays on screen for at least `SESSION_MIN_TICKS` reveal ticks (`REVEAL_TICK_MS`
  each). Its first line appears with the highlight; its **impact** comes `IMPACT_TICKS` later,
  and only then do HP, statuses and the battlefield's numbers change and its other lines start,
  one tick apart (a session with more lines than fit lasts until its last one). Lines with no
  session (combat start, rewards, toasts) appear one per tick with no hold and apply at once.
  One clock drives everything (`RevealQueue`,
  `src/ui/revealQueue.ts`): each tick moves the log, the battlefield highlight and the displayed
  HP/MP/status/coins together in a single `App.render()` — a session's state lands at its impact,
  a line with no session's state with the line itself — so the screen is never ahead of the log.
  Any key skips straight to the end of the reveal, in one render.

The UI palette is `PALETTE` in `src/ui/theme.ts`. A class's or monster's chip
label and color is its `style` (`{ abbr, color }`) in `data/classes.json` /
`data/monsters.json`; a new class or monster also needs its sprite in
`data/sprites.json`.

#### Backdrops

Behind the Battlefield's pixel art sits a painted room scene, drawn in the same one-cell pixels.
`data/backdrops.json` holds three catalogues and one render block, all read through
`src/data/backdrops.ts`:

- `bases` — a wall tile, a floor tile (each a character grid with its own palette, tiled across the
  width) and a `baseboard` colour for the row where wall meets floor. A base is the material of a room.
- `props` — small pixel-art objects (torches, pillars, an altar...) in the same grid-plus-palette
  form as a sprite, where `.` is transparent. A prop may carry a `light` (`radius`, `color`,
  `strength`) that tints the cells around it.
- `scenes` — one entry per room name: a `base` plus placed `props` (`prop`, `x`, `y`, measured from
  the left edge of the Battlefield's fixed-size content, so a scene lines up with the units however
  wide the panel is), and an optional partial `render` that overrides the global one for that scene.
  An optional `rightBase` (`x`, `base`) swaps in another base from that content column to the
  panel's right edge, for a scene whose right side is one mass that must reach the edge at any
  width (the Gatekeeper's mountain); props can't do that, since they end with the content.
- `render` — the global settings: `floorRow` (where the wall ends), `brightness` and `jitter` (a
  per-cell brightness noise that keeps flat tiles from looking printed), `edgeFade` (darkens the
  columns at both sides), `topFade`, `dimFactor` and `unitShadow`.

A room name reaches its scene through `data/room-names.json`: each entry is `{ name, backdrop }`
and `backdrop` names a scene. The loader rejects a scene that uses an unknown base or prop, a ragged
or palette-less grid, a bad colour, and a room name pointing at a missing scene. A room name with no
scene draws the plain panel, so a name can ship before its art does. A new room name needs a scene;
add both in the same change.

An event that stands outside any room names its own scene in `backdrop` (`data/events.json`). The
Gatekeeper, met at the cave mouth before the party enters, is the only one: while it is pending, the
Battlefield shows its scene instead of the first room's. The loader rejects an event pointing at a
missing scene.

`paintBackdrop` (`src/ui/backdrop.ts`) builds the picture in layers, bottom to top: the base (wall
rows above `floorRow`, the baseboard on it, floor rows below), then the props, then each prop's light
as a radial tint, then the shading. `edgeFade` darkens toward the left and right edges and `topFade`
is a brightness profile with one entry per backdrop row, so it scales every row, not just the top;
the profile can darken the rows where units stand to keep dark sprites readable against the
wall and floor. The backdrop fills the Battlefield panel's full inner width
(`battlefieldInnerWidth`), not only the fixed-size content, and is repainted when the terminal
resizes. The painted grid is cached in `App.backdropFor` per room name, width, content offset and dim
state, so an ordinary render does not repaint it.

`composeBattlefield` puts the units on top. Only the pixel cells of a sprite keep their own colour;
every other cell of the backdrop rows (including the icon band above the tallest sprite) takes the
backdrop colour as its background, so icons, markers and the gaps between units read over the scene.
The backdrop covers the icon band, the shared sprite frame and one row below it; the label and
status rows under each unit keep the panel colour so text stays on a flat ground. A unit shadow is
available through the `render.unitShadow` switch (`enabled`, `reachCols`, `reachRows`, `darkness`): when on,
backdrop cells within reach of a sprite are darkened. It is off by default and a scene can turn it on
through its own `render.unitShadow`.

The backdrop dims (`dimFactor`) whenever a unit is greyed during a narrated round, so the scene
steps back with the units that are not acting; `renderBattlefield` reports that as `dimmed`.

Art direction for a scene:

- The scene's identity (the prop that says "shrine", "sunken chamber", "ritual chamber") goes in
  the upper rows, above where regular units stand, so it reads at a glance and no sprite covers it.
- A boss scene puts its identity behind and beside the boss, not in the middle of the enemy side:
  a boss sprite covers almost the full height of its side, so a prop placed there is hidden or
  merges with it.
- Rest and event rooms draw a sprite on the enemy side too (the campfire, the treasure chest, the
  event's figure), so props near it stay low or off to the side and do not merge with it.
- No bright blue or red in a scene. The party is marked in blue and the monsters in red, and a
  backdrop that uses them blurs who is who.
- New pixel art (bases, props) is checked rendered at 1:2, the aspect a terminal cell has, never as a
  square-pixel preview; the Backdrops tab of the game editor renders it that way.

The Backdrops tab of `bun run game-editor` (`tools/game-editor/`, `backdropPreview.ts`) edits the
room-name-to-scene links, the scenes (including an event's own scene, listed under the room names,
and a scene's `rightBase`), bases and props (pixels and palette). It previews a scene with a sample
party and monsters through the same `paintBackdrop` and `composeBattlefield` the game uses, with
switches for the dimmed state and the unit shadow; the shadow switch starts at the scene's own
setting. Saving checks the file with the game's loader, including every event's scene, and rejects a
prop placed outside the backdrop (`propBoundsError`, `src/ui/backdrop.ts`).

### Key hints — where they live and how they're written

Every screen has to tell the player which keys do what. Left unmanaged this
drifts fast — the same hint ends up phrased three ways, in two different
places on screen, naming a key the handler doesn't actually accept. The rules
below exist so that never has to be re-litigated per screen.

**R1 — Body says content, footer says keys.** There are exactly two kinds of
text allowed to contain square brackets:

| Kind | Lives in | Example | Rule |
| --- | --- | --- | --- |
| **Choice line** | the main panel (body) | `  [1] Equip`, `  [Enter] Continue` | The bracket is glued to one concrete option of this screen. That is content — keep it. |
| **Key hint** | the footer bar, always | `[1-9] Item   [Esc] Back` | Any instruction about *how to press*. Never in the body, no exceptions. |

So a sentence like "Press [i] to check items." never belongs in `renderMain` —
it is a key hint and goes to `renderFooter`. Likewise a page counter drawn in
the body says `(Page 1/2)` and nothing more; the `[←/→]` that changes the page
is a key hint and belongs in the footer.

**R2 — Footer grammar is tokens, not prose.**

```
[key] Label   [key] Label   │   [key] Label
└── contextual ────────────┘   └── global ──┘
```

- Label: 1–2 words, Title Case, **no trailing period**. Never "Press a number to…".
- Separator between two hints: **three spaces** (`HINT_GAP`). Between the contextual
  group and the global group: `   │   ` (`GROUP_SEP`). Both live in `src/ui/keyHints.ts`.
- One line. No wrapping, no full stops.

**R3 — Inside a bracket there is a key name and nothing else.**

| Write | Don't write | Why |
| --- | --- | --- |
| `[{{keys}}]` in the string, `[1]` / `[1-4]` on screen | `[1-9]` hard-coded | the range is filled in per render from the option count; a fixed `[1-9]` on a 2-option screen advertises 7 dead digits |
| `[Enter]` `[Esc]` `[Ctrl+C]` `[Any]` | `[esc]`, `[ENTER]` | named keys are Title Case |
| `[i]` `[a]` `[b]` `[q]` `[s]` `[r]` | `[R]` | letter keys are spelled **exactly as `key.name` arrives** — an uppercase hint for a lowercase handler is a lie |
| `[←/→]` | `[left/right]` | the arrow pair is the one permitted two-key bracket |
| `[Esc] Back` | `[b/Esc] Back` | **one bracket, one key**. Alternate bindings keep working, they just aren't advertised. |

**R4 — Fixed order, so the eye always lands in the same place.**

```
1. select      [1-9] <what is being selected>
2. confirm     [Enter] …
3. screen-specific actions   [i] [a] [r] …
4. paging      [←/→] Page
5. back        [Esc] Back
   │
6. globals     [b] Party   [m] Memory   [j] Journal   [p] Map   [v] Monsters   [l] Log   [q] Save   [s] Quicksave   [Ctrl+C] Quit   ([m] only once the slot has unlocked Memory, [j] once its journal holds a written line, [v] only with a fight or a bestiary entry to show)
```

**R5 — Global hints are derived, never hand-written per screen.** `[q]`, `[s]`,
`[b]`, `[m]`, `[j]`, `[l]` and `[Ctrl+C]` are handled centrally in `App.handleKey` (`src/ui/app.ts`),
including where they are suppressed — `[q]` is off on `gameover`/`journalLastPage`/`abilityBuyback`/
`saveMenu`/`gatekeeper`, `[s]` is off on `gameover`/`journalLastPage`/`abilityBuyback`/`gatekeeper`,
`[b]` only opens party info from a fixed list of screen kinds, `[m]` exists only once the
slot has unlocked Memory and read its intro and is off on `fullLog`/`gameover`/`abilityBuyback`/
`gatekeeper`/`memoryIntro`/`memory` (`canOpenMemory`, `src/ui/keyHints.ts`), `[j]` exists once the slot's journal
holds a written line and is off on those same screens and on its own (`canOpenJournal`); it opens mid-combat too. `[p]` (`canOpenMap`)
and `[v]` (`canOpenMonsters`) each come from a fixed list of screen kinds in `src/ui/keyHints.ts`, and `[v]` also needs a fight or a
bestiary entry to show. Both lists leave out every screen whose fullest footer would then overflow the 150-column minimum:
`roomReward` for both, `room` and `pickItemInCombat` for `[v]`; `test/keyHints.test.ts` measures each screen that offers them. The footer's global group must be
computed from those same conditions rather than typed into individual strings,
otherwise the two drift apart and the hint outlives the binding. On the log screen itself
only `[Ctrl+C]` remains in the global group: `App.handleKey` swallows every other key there,
so no save hint is shown. `globalHints()`
(`src/ui/keyHints.ts`) is that single derivation; `App.render` runs every footer
through `composeFooter()` so no screen can opt out.

Paging is the one hint no screen writes itself: `App.isPaginated()` derives it from
the same `listCountFor`/`pageSizeFor` pair that drives `←`/`→`, and
`withPageHint()` splices it in at the right spot.

**R6 — Only advertise a key that works right now.** `[Enter] Start` on character
select appears once four characters are picked, not before. `[←/→] Page` appears
only when `pages > 1`. A dead key in the footer is worse than no footer.

That applies to the digit range too, which is why footer strings carry a
`{{keys}}` placeholder instead of a literal range. Each screen resolves it from
the same data it just rendered — `connectedRoomChoices().length` for the room,
`ui.candidates.length` for targeting, the current page's item count for a paged
list — by calling `digitHint(key, count)` (`src/ui/keyHints.ts`). `digitRange`
underneath returns `"1"` for a single option (never `"1-1"`), `"1-n"` beyond
that, and `null` for none, in which case `digitHint` falls back to a hint-free
string rather than rendering an empty `[]`. Counting is deliberately left to the
screen: a central table would have to re-derive what `renderMain` already knows
and would drift the first time an option list changed.

#### Mapping — contextual part per screen

The global group is appended automatically, so the table lists only what each
screen contributes.

| `ui.kind` | Contextual footer |
| --- | --- |
| `room` | `[1-n] Move   [i] Items   [a] Artifacts` — n = exits from this room; `[i]` drops when the bag is empty (`ui.footerRoomNoItems`) |
| `rest` | `[1-2] Choose   [Enter] Skip` — `[1-3]` when the Merchant's Runner is there (Trade) |
| `runnerNotice` | `[Enter] Continue` |
| `runnerShop` | `[1-n] Buy   [r] Refresh   [x] Sell   [t] Barter   [Enter] Leave` — n = offers left; `[r]` drops once refreshes run out, `[x]` when nothing is sellable, `[t]` when no trophy trade is left |
| `runnerBarter` | `[1-n] Trade   [Esc] Back` — n = trophy trades left |
| `runnerSell` | `[1-n] Sell   [Esc] Back` — n = items on this page |
| `pickAction` | `[1-2] Action` — "Use item" stays listed (tagged) even with an empty bag |
| `pickSkill` | `[1-n] Skill   [Esc] Back` — n = the actor's skills |
| `skillDetail` | `[Enter] Use   [Esc] Back` |
| `pickCommandMinion` | `[1-n] Minion   [Esc] Back` — n = minions the Summoner can Command |
| `pickCommandSkill` | `[1-n] Skill   [Esc] Back` — n = the minion's signature skills |
| `pickItemInCombat` / `pickItemOutOfCombat` | `[1-n] Item   [Esc] Back` — n = items on this page |
| `pickTarget` | `[1-n] Target   [Esc] Back` — n = candidates |
| `roundResolved` / `combatOver` | `[Any] Continue` |
| any screen, while a combat round is being revealed | `[Any] Skip` (`ui.footerSkipReveal`) |
| `itemDetail` / `artifactDetail` | `[1-2] Choose   [Esc] Back` — `[1] Back` alone on the back-only views |
| `artifactMenu` | `[1-n] Artifact   [Esc] Back` — `[Esc] Back` alone when nothing is equipped |
| `artifactDecision` | `[1-2] Choose` — `[1]` alone when the artifact is forced-equip |
| `artifactDecisionPickCharacter` | `[1-n] Character` — n = party size |
| `artifactDecisionPickReplace` | `[1-n] Artifact` — n = the character's non-cursed artifacts |
| `roomReward` | `[1-n] Details   [Enter] Continue` — n = entries on this page |
| `campPrompt` | `[1] Camp   [Enter] Skip` |
| `eventArtifactShop` | `[1-9] Choose   [r] Refresh` (the `[r]` drops once the visit is out of refreshes; the offer detail shows `[1-2] Choose   [Esc] Back`) |
| `eventHpGamblePickPayer` | `[1-n] Character` — n = party size |
| `eventFortuneExchangePickArtifact` | `[1-n] Artifact` — n = artifacts on this page |
| other `event*` | `[1-n] Choose` — n counts the options that event actually offers (a forced guardian fight drops to `[1]`) |
| `campReflection` | `[1-3] Choose` |
| `floorMilestone` | `[Enter] Continue` |
| `endingCheckpoint` | `[1-n] Choose` — 1, 2 or 3 by `endingCheckpointMode` |
| `founderDialogue` | `[1] Continue` |
| `gatekeeper` | `[1-2] Choose`, then `[1] Take` (the map) once answered, then `[1] Move` once it is taken (no `[q]`/`[s]` until the party is inside) |
| `characterInfo` | `[1-n] Character   [Esc] Back` — n = party size + living minions |
| `floorMap` | `[Esc] Back` |
| `monsterInfo` | `[1-n] Monster   [Esc] Back` — n = monsters in the fight, fallen ones included |
| `bestiary` | `[1-n] Details   [Esc] Back` (+ `[←/→] Page`) — n = entries on this page; `[Esc] Back` alone on an entry |
| `abilityBuyback` | `[1-2] Choose` — `[2] Let it go` alone when the run can't afford the reclaim |
| `saveMenu` | `[1-3] Choose   [Esc] Cancel` |
| `gameover` | `[n] New Run   [Esc] Main Menu` — `[Enter] Last page   [n] New Run   [Esc] Main Menu` when the ending showed journal echoes |
| `journalLastPage` | `[Esc] Back` |
| `journalPickup` | `[Enter] Read it` on the first screen, `[1-2] Choose` (their page) or `[1-3] Choose` (a line read differently), `[Enter] Continue` on a reading that can't be taken |
| `memoryIntro` | `[Enter] Continue` |
| `memory` | `[←/→] Page   [Esc] Back` (`[←/→]` only with more than one page) |
| `journalDeduction` | `[1-2] Choose` on a find (look / move on); `[Enter] Continue` on a notice of fragments that open no scene; `[1-n] Write` on a scene — n = the readings offered plus leave-unwritten, or keep/strike on a line already written |
| `journal` | `[←/→] Page   [Esc] Back` (`[←/→]` only with more than one page) |
| main menu, waiting for a key | `[Any] Continue` |
| main menu, choosing | `[1] Start   [2] Continue` (`[2]` only when a slot holds a run or an ended one) |
| party select, browsing | `[Enter] Pick   [←/→] Browse   [Esc] Back` (`[Esc] Main Menu` on New Run, `[Esc] Undo` once a recruit is in the party) |
| party select, choosing the recruit's ability | `[1-n] Choose   [0] Skip   [Esc] Back` (+ `[←/→] Page`); `[0] Skip   [Esc] Back` when the page is empty |
| slot select | `[1-n] Choose   [Esc] Back` — New Game lists all 5 slots, Continue only the ones holding a run or an ended one |
| slot select, overwrite confirm | `[1] Overwrite   [Esc] Cancel` |

The three pre-game screens (`src/ui/mainMenu.ts`, `partySelect.ts`,
`saveSelect.ts`) run outside `App` and own their layout, so
they carry their own footer element — but it is bottom-anchored and uses the
same grammar, so the hint line never moves between screens.

#### Adding a new screen

1. Write the option lines in `renderMain` with `  [n] Label` prefixes — content only.
2. Write **one** contextual footer string in `data/strings.json` following R2–R4.
   Use `[{{keys}}]` for the digit range, and do not list `[q]`/`[s]`/`[b]`/`[m]`/`[Ctrl+C]`
   there; R5 adds those.
3. Return `digitHint(key, <options on screen>)` from the screen's `renderFooter`
   and wire the `ui.kind` into `App.renderFooter` (`src/ui/app.ts`).
4. Check every bracket against the `key.name` its handler compares — that check
   is what R3 exists for.

Bracketed segments are styled by `highlightKeyHints` (`src/ui/theme.ts`), which
renders `[...]` bold in the accent color and the rest dim; the grammar above is
what makes that styling read as a consistent row of keycaps.

#### Enforcement

`test/keyHints.test.ts` lints every footer string in `data/strings.json` against R2
and R3 — no prose, no trailing period, `[key] Label` shape, one key per bracket —
and asserts the global-hint sets, the page-hint placement and that the room screen
renders its `[i]`/`[a]` hints in the footer rather than the body. A new footer
string is covered automatically as long as its key starts with `ui.footer`/`ui.hint`
or is added to that test's catalog list.

It also drives a whole run headless and asserts no frame ever shows an unresolved
`{{keys}}` or an empty `[]` bracket — the two ways a missed `digitHint` call would
surface.

## 🔄 Docs sync

Docs under `docs/` quote tables and numbers that live in `data/*.json`. Nobody keeps those copies in step by hand: `bun run docs:sync` does, and `bun test` fails (`test/docsSync.test.ts`) when a doc is out of step, so a rebalance cannot slip through. After editing the JSON, run it and commit what it rewrites.

It checks four things:

- **Pairs.** A backticked field path followed by parentheses that open with a number, such as `` `section.field` (value) ``, is compared with the config, and the number is rewritten when it differs. Only a number the parentheses open with counts, after an optional `≈`; one inside a sentence is not a value. A percentage may have a space before the sign. A percentage is read by the field's name: a `…Percent` field stores whole percents and is written as that number with a percent sign, any other field stores a fraction and is written as its percentage. Name a new config field to match, and call a stored fraction `…Fraction` or `…Chance`, never `…Percent`; `test/docsSync.test.ts` fails when a `…Percent` field holds a fraction. The path starts at a top-level key of `data/balance-config.json`; prose that quotes a value writes the whole path, and a bare field name with a value is not checked. A pair on a field that holds an object or a list cannot be compared and is listed as `unchecked`.
- **Generated blocks.** A table between `<!-- docs:begin NAME key=value -->` and `<!-- docs:end -->` is written by the generator `NAME` (`tools/docs-sync/generators/`) from the data and the game's own helpers. Never edit between the markers, and keep explanation outside them: a block holds data only, so a table that mixes data with prose is split.
- **References.** Every `docs/<name>.md` path, and every bare `NN-name.md` name, written in `src/`, `test/`, `tools/`, `CLAUDE.md`, `README.md` or the docs must name a file that exists. This one is reported, not fixed.
- **Coverage.** A number in prose that equals a value in `data/*.json`, and is neither a pair nor inside a block, may be a hand-kept copy. `bun run docs:sync --coverage` lists them and changes nothing. A decimal or a number above 100 always counts; a whole number up to 100 counts only when a field name or entry id that holds that value is within a few words of it. The count per doc is recorded in `tools/docs-sync/coverage-baseline.json`: a doc that gains one fails the check, and one that loses one asks for the baseline to be lowered, which `bun run docs:sync` does. A doc missing from the file, or the file itself, counts as zero; a file that is not valid JSON, or not an object of counts, is reported as a finding and never overwritten. Fix a hit by writing it as a pair, generating it, or describing it in words. A line that ends with `<!-- docs:intent -->`, and a section between `<!-- docs:intent-begin -->` and `<!-- docs:intent-end -->`, are left out: use them for a record of reasoning, whose numbers are as of the decision, or for a figure that is not a copy of the data. A begin without its end would exempt the rest of the doc, so an unpaired marker fails the check.

A code fence that is never closed is reported too, because everything after it would count as code and go unchecked.

The generators live in `tools/docs-sync/generators/`; `generators/index.ts` lists them. A generator that shows an effect, an ability, an artifact or a status uses the game's own text for it where one exists. To add a generator: write a `GeneratorSpec` in `tools/docs-sync/generators/` that returns a `DocTable` (columns and rows; `format.ts` prints a value from the data with `formatNumber`, a computed one such as an odds weight with `formatRounded`, and a field that may hold an object or a list with `showValue`), register it in `generators/index.ts`, add what it reads to `DocsData` and `loadDocsData`, test it on made-up data in `test/docsSyncTool.test.ts`, then put the marker in the doc and run `bun run docs:sync`. The tool's own tests carry no real balance numbers, and a test that needs the name of a doc that does not exist builds it from two strings, because the reference check also reads `test/`. If a merge conflict lands inside a block, take either side and run `bun run docs:sync`.

## 📁 Code structure

```
data/                  # design data as JSON — see "Design data" above
  classes.json
  monsters.json
  monster-skills.json
  status-effects.json
  items.json
  artifacts.json
  events.json
  room-names.json
  backdrops.json
  floor-milestones.json
  journal.json
  personalities.json
  barter.json
  abilities.json
  summons.json
  monster-races.json
  monster-traits.json
  growth-weights.json
  level-growth.json
  balance-config.json
  sprites.json
  strings.json
src/
  types.ts            # runtime types (Character, Monster, CombatState, GameState, ...)
  data/                # loaders for data/*.json + build logic (spawnMonster, floor layout generation, ...)
    classes.ts          # data/classes.json loader — getClass, getSkill
    monsters.ts          # data/monsters.json + data/monster-skills.json loader — spawnMonster, getArchetype, getMonsterSkill
    statusEffects.ts     # data/status-effects.json loader — getStatusEffect
    items.ts             # data/items.json loader — getItem, rollItemDrop
    floorMilestones.ts   # data/floor-milestones.json loader — pickFloorMilestoneOmen (depth bands, no repeats, each line shown by its maxFloor)
    journal.ts           # data/journal.json loader — validateJournal (ids, 2+ directions, gates and their cycles, sources, echoes, personality lines)
    personalities.ts     # data/personalities.json loader — validatePersonalities (condition kinds, every class's personalityId)
    barter.ts            # data/barter.json loader — getBarterEntry (checks every trophy has an entry)
    shopStock.ts         # rollShopOffers/rollBarterOffers — the Runner's stock and barter offers, tier odds by floor depth
    artifacts.ts         # data/artifacts.json loader — getArtifact, rollArtifact/rollArtifactWithMinRarity/rollArtifactOrCursed, rollArtifactRarity + pickArtifactOfRarity; rarity weights come from `artifacts.anchorWeights` in balance-config, shifted by depth (artifactRarityWeights over the shared tierWeightsByDepth curve)
    events.ts            # data/events.json loader — getEvent, rollEvent
    floor.ts             # createFloor(rng, depth) — builds a Floor from a generated layout + spawns rooms/monsters
    floorPatterns.ts     # generateFloorLayout(rng, depth) — floor shape, room types and unknown rooms; validateFloorLayout checks every rule
    levelGrowth.ts        # growthBonus(stat, level)/growthBonusForDepth by tier + elite/boss coefficients + expTiers
    balanceConfig.ts      # shared balancing constants, read from data/balance-config.json
    currency.ts            # rollCoinDrop(monster, rng) — Cursed Coin amounts by monster power tier
    strings.ts            # UI text loader from data/strings.json
    abilities.ts          # data/abilities.json loader — getAbility, rollAbility (elite/boss drops, skipping abilities the slot has already unlocked), effect text
    backdrops.ts          # data/backdrops.json loader — parseBackdrops validates bases/props/scenes against the room names and events; sceneForRoomName, sceneById
    roomNames.ts          # data/room-names.json loader — roomNamePool, backdropIdForRoomName
    summons.ts            # data/summons.json loader — getSummonArchetype, getSummonSkill, getSummonCast, assertSummonDataConsistent
    monsterRaces.ts       # data/monster-races.json + data/monster-traits.json loader — resolveRaceProfile (race + subRace + traits), assertRaceDataConsistent
    growthWeights.ts      # data/growth-weights.json loader — GROWTH_WEIGHTS (per-class growth multipliers)
    loreExposure.ts       # LORE_EXPOSURE_EVENT_IDS, campReflectionTier (thresholds from balance-config), the Camp Reflection prompt/options
    endings.ts            # ending checkpoint and founder floor depths, endingCheckpointMode, leaveTriggered
  engine/              # pure logic (rng, party, resolver, combat, survival, dungeon, floorGraph, artifacts, save, migration, game) — testable without the UI
    party.ts             # character creation/stats, the Artifact equip/discard/replace decision flow (grantArtifact, resolveArtifactEquip, discardPendingArtifact)
    survival.ts           # fear + satiety mechanics: room-entry drain, Exhausted/Dying, Camp, rest room actions
    journal.ts            # journal rules: conditions, fragment grants (no rng), the deduction queue, auto-strike, tear-out on a wipe
    migration.ts           # upgrades a GameState loaded from an older save to the current shape (see save.ts). A save loads if its version is an x.y.z version from `OLDEST_LOADABLE_SAVE_VERSION` (`save.ts`) up to the current app version. `VERSION_MIGRATIONS` holds one step per release that changed what a saved value means, oldest first; a save runs every step newer than its own version, in order, before the shape backfills (1.1.1 and 1.2.0 each rescale `partyExp` to that release's EXP curve, keeping the level and the share of the way to the next one, so a release that changes `expTiers[]` freezes its curve in `migration.ts` and adds a step, and `test/save.test.ts` fails until it does; 1.2.0 also remaps the class id `vanguard` to `knight`, renaming a character still carrying the old class name and the retired-character class; 1.2.1 renames two rooms on the saved floor, whose backdrop is found by name). A release that changes a saved value's meaning adds its step there; a release that changes nothing needs no step. Renamed ids are not remapped by default: whatever a loaded save still holds under an id that has left the catalog (inventory counts, statuses on units and in log snapshots, summons of an unknown archetype, queued actions, cooldown/use counters) is dropped, not carried over, so a release that renames an id an allowed version can hold remaps it in its step
    events/               # 1 file per event room (merchant, bloodAltar, cursedShrine, twinAltars, sacrifice, gamblingDen, hermit, collapsedFloor, guardianFight, openChest) + shared.ts (helpers shared across event rooms)
    events/gatekeeper.ts  # the opening Gatekeeper (not an event room): the toll answer and the blessing's room count
    events/runner.ts      # the Rest-room Merchant's Runner (not an event room): rollRestRunner, shop purchase/refresh, buyback
    events/barter.ts      # his trophy-for-buff barter: runnerBarter, and applyPendingBarterBuffs when the floor's elite/boss fight begins
    logSession.ts         # LogSession builder: runInSession/runTicksInSession tag each actor's turn (or tick block) and note who it attacked/debuffed/buffed/healed
    combatHooks.ts        # passive/on-hit hook helpers read by combat.ts (class passives that don't apply a status effect)
    monsterAI.ts           # monster turn flow: fill the telegraph meter and release it when full, enter a phase, filter/score/pick a skill, pick targets (pickMonsterAction, pickTargets)
    monsterAiRules.ts      # pure predicate evaluation and weight scoring for aiCondition/aiRules/targetRules
    monsterShell.ts        # the breakable-shell state machine (formShell, shellAdjustedDamage, noteShellHit, advanceShellAfterOwnTurn)
    paths.ts                # save-directory/file path resolution
    interception.ts         # interceptTarget: the `interceptsForSource` and Watchful redirects of a monster's single-target hit
    monsterBars.ts          # a boss that fights in HP bars: barsOf, advanceBar (next bar at full HP, empty meter)
    devMode.ts              # DEV_MODE, false only in the release binary (`__DEV__` defined by bun run build)
    profile.ts               # run/profile-level stats tracked across saves
  ui/theme.ts          # color palette + StyledText helpers (chips, HP/fear-based coloring)
  ui/sprites.ts        # loads pixel-art sprites from JSON + renders them into a fixed frame
  ui/bigText.ts        # hand-written block font for the title screen
  ui/mainMenu.ts        # title screen, waits for any key before booting the App
  ui/partySelect.ts    # building the party at the start of a new game: browse the roster one class at a time, pick 4 different classes, choose each recruit's Ability
  ui/saveSelect.ts      # slot select for New Game / Continue
  ui/layout.ts          # shared panel sizing/layout helpers for App.render
  ui/revealQueue.ts     # RevealQueue: the single clock pacing the combat log by session and driving the battlefield highlight
  ui/battlefieldFocus.ts # greying of bystanders, role icons and the icon band above the sprites
  ui/floorMap.ts        # the whole-floor map the Battlefield shows on the room screen, drawn from the room graph (the `[p]` viewer reuses it without exit digits)
  ui/targetPicker.ts    # the target list rows: coloured HP/MP/fear, the stats a buff raises, the most-hurt `*`
  ui/pagination.ts      # listCountFor/pageSizeFor and the shared paged-list helpers
  ui/state.ts           # UiState union + the state shared across screens
  ui/app.ts            # OpenTUI: layout + keyboard input, only reads/writes through Game
  ui/screens/           # 1 module per screen (room, combat, artifacts, artifactDecision, camp, events, rewards, inventory, save, log, gameover, abilityBuyback, campReflection, runner, characterInfo, context, ending, floorMilestone, founderDialogue, memory, floorMapView, monsterInfo, gatekeeper, journal) — handleKey/renderMain/renderFooter
  main.ts              # actual entry point (createCliRenderer → mainMenu → partySelect/saveSelect → App)
tools/
  game-editor/          # dev tool: sprites, backdrops, stat/balance rebalancing, damage/skill preview, and CRUD for monsters/artifacts/items/status effects/monster skills (bun run game-editor)
  docs-sync/            # dev tool (bun run docs:sync): keeps the docs in step with data/*.json — pairs (checked against data/balance-config.json), generated blocks, the reference check and the --coverage check
  dev-save-dump/        # dev tool (bun run dump-save, dev mode only): server.ts + index.html write a devDump save at any level/floor/room/event; applyDump.ts (also used by random-play to start runs mid-dungeon)
  curve/                # dev tool (bun run curve): bench.ts (guard cases, real engine fights, statistics, comparison with another run, the check's rules), run.ts (CLI, --check), comment.ts (the pull request comment)
  random-play/          # dev tool (bun run random-play): bot plays seeded runs through the headless UI — checks.ts (pure checks), team.ts (teams and their key policy), curve.ts (level by depth, first guard floors, guard and survival tallies), bot.ts (one run), evidence.ts (screen keys, PNGs, manifest and the evidence comment), report.ts (report.html), run.ts (CLI)
test/
  engine.test.ts       # floor layout (every room reachable, one guard room, monsters only in combat rooms), level-1 character skills, and the plural forms in data/strings.json
  ui.test.ts           # headless UI tests via simulated keyboard input: screens, paging, the post-victory artifact-decision/camp/floor-advance ordering (also across a reload) and the panel layout
  randomPlay.test.ts   # the random-play tool's checks, report rendering and screen evidence, plus one short bot run
  curveBench.test.ts   # the guard bench's statistics, cases, stopping rule and comparison with another run, the curve check's rules, and the pull request comment
  character-skills.test.ts # per-class skill ranks, queued-action refund, conditionalBonus/lifesteal/accuracyPenalty effects
  combat-ranks.test.ts # combat round structure (command + speed-ordered execution) and aggro-weighted targeting
  resolver.test.ts     # the shared SkillEffect resolver + status-effect cleanup when a room is cleared
  status-effect-timing.test.ts # turn-countdown timing per status category (DoT/HoT, stat modifiers, "special" effects like stuns/on-hit riders)
  monster-skills.test.ts # Elite/Boss skill kits, regular-monster skills, and AI patterns (incl. the low-HP self-skill bias), end-to-end
  artifact-effects.test.ts # the Artifact equip/discard/replace decision flow, effect hooks, Exhausted stat math, fear-relief quick-win rules
  items.test.ts        # consumable item effects and usage
  events.test.ts       # every event room's mechanics, incl. Merchant Refresh and the Gambling Den's 4-round coin state machine
  survival-currency.test.ts # Camp, coin-drop ranges by monster power tier, save-file migration from a pre-rework save
  save.test.ts         # save version blocking, save-state validation, slot read/write/delete, playtime carry-over
  sprites.test.ts      # per-sprite dimensions/palette + renderSpriteInSlot behavior
  bigText.test.ts      # block font: every glyph has consistent width per row
  floorPatterns.test.ts # property-based test for generateFloorLayout: route, lane and unknown-room rules over many seeds and depths, validator
  floorMap.test.ts     # floor map: the approved mockup renders exactly, column alignment, width bound, old-save floors, unknown rooms
  viewers.test.ts      # the viewers: [p] floor map on the Battlefield, [v] monster info and bestiary in the Dungeon panel, the profile's seen-monster list
  levelGrowth.test.ts  # monsterDepthBuffPercent: its floor brackets, the increment that keeps applying past the last one, and the per-stat coefficients
  docsSync.test.ts     # the real docs against the real data: red after a rebalance until `bun run docs:sync` has rewritten them
  docsSyncTool.test.ts # the docs-sync tool itself (pairs, blocks, references, the shop-odds generator) on made-up data
```
