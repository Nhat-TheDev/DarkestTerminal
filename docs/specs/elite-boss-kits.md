# Elite/Boss kits — one kit per monster

Transient spec. Once implemented, its content is merged into `docs/gameplay-decisions/02-monster.md`, `docs/gameplay-decisions/06-level-system.md` §6.12 and `docs/technical-decisions.md` §5, then this file is deleted. No balance numbers live here: every magnitude, chance, duration, cooldown, weight and HP threshold is a `data/*.json` value.

## Problem

Every guard-room archetype (Skeleton Guard, the 9 guard-only archetypes, The Founder) runs the same kit under a different name: a single-target Strike, a whole-party Cleave, a boss-only Debuff that applies one status, and a Finishing Blow charged on a shared global cooldown. The action weights are identical across archetypes. The AI is a flat weighted roll, so a solo boss acts without intent and there is never a turn the party has to read. Fights blur together and the guard room is easier than it should be.

## Goals

- Each archetype fights the way its `description` says it does. The difference is in **mechanics and behaviour**, not just in which status a hit applies.
- Skill count varies per archetype.
- No status effect or damage mechanic appears in more than 2 archetypes' kits. Monster summoning is the one deliberate exception (3 archetypes), and each of the three uses it differently.
- The elite tier runs a reduced subset of the same archetype's boss kit. Meeting the elite teaches the party how the monster fights; the boss adds its signature (telegraph, phase changes, extra skills).
- Difficulty rises with `minFloor` along a banded curve (Part 4), through behaviour first, then damage and durability. No single action one-shots the lowest-HP class at the floor depth where that archetype appears.
- Everything is declared in JSON. The engine names no archetype or skill.

## Non-goals

- Normal-tier monsters are unchanged. That includes Skeleton Guard when it spawns in an ordinary combat room.
- No changes to party-side skills, classes, items or artifacts.
- No new UI screens. Existing battlefield, log and status rendering carry the new mechanics.

## Part 1 — Monster AI

### Turn flow

Each elite/boss turn runs in this order. Stun handling stays first, unchanged.

1. **Release.** If a telegraphed skill is charging, release it: a single-target or `targetCount` telegraph on the target(s) it locked (any that died are re-picked by the skill's target rules), an area telegraph on everyone alive at release. Then stop.
2. **Phase entry.** If HP has crossed below the threshold of a phase not yet entered, enter it. If the phase names an `onEnterSkillId`, cast that skill this turn and stop.
3. **Filter.** Build the candidate list from the current phase's weights (`"basicAttack"` + skill ids). Drop skills that are on cooldown, out of `usesPerCombat`, or whose `aiCondition` fails.
4. **Score.** Multiply each candidate's weight by every matching `aiRules` entry's `weightMultiplier`.
5. **Pick** by weighted random over the scored weights.
6. **Target.** Resolve the picked skill's targets. For a single-target skill (and each pick of a `targetCount` skill), the targeting pool is weighted by `aiPattern` as today, then multiplied by every matching `targetRules` entry. An archetype with `targeting: "random"` skips both and picks uniformly.
7. **Act.** A `telegraph` skill locks its target, resolves its `chargeEffects`, logs the warning and stops without dealing damage. Any other skill resolves immediately. Using a skill starts its `cooldownTurns` and spends one of its `usesPerCombat`.

### Normal tier is untouched

A normal-tier monster behaves exactly as it does today, down to the order of its RNG draws. It rolls only `actionWeights.normal`; no cooldown, phase, charge or shell state is created for it. The `defensive` low-HP branch only considers self-targeted skills that the monster's current tier weights name. This matters for Skeleton Guard, the one triple-role archetype: its `skillIds` now hold self-targeted guard-room skills, but its normal weights name only the basic attack, so the normal-tier Skeleton Guard never reaches them.

### Predicates

`aiCondition`, `aiRules[].if` and `targetRules[].if` share one predicate vocabulary. An entry passes only when every field in it holds.

| Field | Evaluated against |
|---|---|
| `selfHpBelowPercent` | the acting monster |
| `selfHasStatusId` / `selfLacksStatusId` | the acting monster |
| `targetHpBelowPercent` | `targetRules` only: the candidate target's HP percentage |
| `targetHasStatusId` / `targetLacksStatusId` | in `targetRules`: the candidate target. In `aiCondition`/`aiRules`: true if any living enemy matches |
| `targetsBelowHpPercent` + `atLeast` | count of living enemies under the HP percentage |
| `alliesFewerThan` | count of living monster-side allies, excluding the acting monster, is below the given number (summon gating) |

Status checks match a status's rank family, the same way `conditionalBonus` already does.

### Fields

On a monster skill (`data/monster-skills.json`):
- `cooldownTurns` and `usesPerCombat` — existing `SkillDefinition` fields, now honoured for monsters. Cooldowns count down at the end of each of the monster's own turns, stunned or not, matching how a character's cooldowns count down once per round.
- `initialCooldownTurns` — the cooldown a skill starts the fight on, so a telegraph cannot open the fight (the old Finishing Blow's opening delay).
- `aiCondition` — a predicate. The skill is a candidate only while it holds.
- `aiRules: { if, weightMultiplier }[]`
- `targetRules: { if, weightMultiplier }[]`
- `targetCount: { min, max }` — on a `singleEnemy` skill: hits that many distinct enemies (Part 2, mechanic 6).
- `telegraph: true` — a charge turn, then release on the locked target(s).
- `chargeEffects` — optional `SkillEffect[]` resolved on the caster during the charge turn (Dragon's `airborne`).

On an archetype (`data/monsters.json`):
- `actionWeights.elite` / `actionWeights.boss` — the base (first) phase's weights.
- `phases: { tier, hpBelowPercent, weights, onEnterSkillId? }[]` — `weights` replaces the tier's table once that phase is entered. An archetype may enter more than one phase.
- `targeting: "random"` — targets are picked uniformly, ignoring aggro. Used only by Void Amalgamation.
- `shell` — a breakable shell (Part 2, mechanic 3).

Removed: `executeSkillId` (archetype), `combat.executeCooldownTurns` (`data/balance-config.json`), `Monster.executeCooldownTurns`. Their job is done by `telegraph` + `cooldownTurns`.

### Monster runtime state

`Monster` gains per-skill cooldowns, per-skill uses spent, entered phase indexes, the charging skill id with its locked target id, and shell state (intact/broken, hits left to break, turns since breaking). This state is saved mid-combat, so `src/engine/save.ts` validation covers the new fields. Only current-version saves load, so no migration is needed.

## Part 2 — New mechanics

Each mechanic is generic. Any archetype could declare it in JSON.

1. **`summonMonster` effect** (`SkillEffect.kind`). Spawns monsters of the named normal archetype into the running combat, scaled to the current floor depth at normal tier. It registers them in `ctx.monsters` and `combat.combatants`, so they act on their speed from the next round. Spawning stops at the cap on living monsters summoned by that summoner (`data/balance-config.json`). Summoned monsters:
   - carry the id of the monster that summoned them;
   - give no exp and no loot, and do not count as room monsters;
   - die when their summoner dies, so killing the summoner always ends the fight;
   - may be raised again (Lich phase 2) — re-raising is just another cast.
2. **`reflectDamagePercent` on a status.** When the bearer takes direct damage, it deals that percentage back to the attacker. This works for any actor, not just a character with an artifact. Status ticks are never reflected.
3. **`shell` on an archetype** — a cycle of intact → broken → reformed, run by the engine and costing the monster no turn. Every value below is a field of `shell`.
   - **Intact** (from spawn, and after every reform): each direct damage instance is capped at a percentage of the bearer's max HP; status ticks deal no damage. Every direct hit counts toward breaking it. A multi-hit counts each hit, an area hit counts once. The number of hits needed is rolled from a min–max range each time the shell forms.
   - **Breaks** on the last counted hit: the bearer gets the configured stun status (one turn); the cap and the tick immunity are lifted. A telegraph being charged is delayed by the stun, not cancelled (the existing stun rule).
   - **Reforms** at the end of the bearer's configured turn after breaking (the stunned turn counts as the first). On reform every debuff on the bearer is removed; buffs stay. The hit count is re-rolled.
   - Damage that reaches the bearer outside the skill resolver (a character's artifact reflect) is capped the same way while the shell is intact, but does not count as a hit.
   - Breaking and reforming each write their own log line. The intact shell shows in the status row (hits left), and so does the broken state.
4. **`untargetable` respected on the monster side.** The player's target pool, the party's auto-resolved `allEnemies`, and every automatic party-side attack (player summons, artifact auto-damage, on-hit area damage, Overwatch) exclude an untargetable monster. Overwatch holds its shot and stays primed rather than firing at, or interrupting, an untargetable monster. If every monster is untargetable, the party's damaging actions have no target, while self/ally actions still work.
5. **`targeting: "random"`** — see Part 1.
6. **`targetCount: { min, max }`** on a monster skill whose `target` is `singleEnemy`. Each cast rolls N in the range, capped at the living, targetable enemies (one left means a single-target hit). The N targets are distinct: picked one at a time from the weighted pool (`aiPattern` × `targetRules`), each pick removed before the next. Each target rolls accuracy on its own, as an area skill does. The log names every target. `SkillTarget` itself is unchanged, so player-side targeting code is untouched. A telegraph with `targetCount` locks all N targets on its charge turn. It is a targeting shape, like single and all, so the repetition rule does not count it.

A status may declare `harmful: true`. A status with no stat change, tick, stun or blind would otherwise count as helpful — shown as a buff and skipped by cleanses — which `marked` and `challenged` must not be.

New statuses, all data-only on top of existing status fields except where noted:
- `challenged` — aggro up on the bearer, `harmful`. Dark Knight.
- `marked` — no tick, `harmful`. A tag that Lich target rules read. Cleansable.
- `withered` — max HP down. Lich.
- `riposte` — uses the new `reflectDamagePercent` status field. Skeleton Guard.
- `airborne` — `untargetable`. Dragon.

## Part 3 — Kits

Legend: **E** = elite and boss · **B** = boss only · ⏳ = telegraph · ◆ = phase `onEnterSkillId`. Skill ids are the kebab-case of the name, prefixed by the archetype id when the name alone is not unique (e.g. `dragon-fire-breath`). Descriptions are rewritten in the established voice: flavour only, no mechanics.

### Skeleton Guard — holds its ground, answers what hits it
No phases.
- E *Hold the Line* — self `guard-iii`. Weighted up when low on HP.
- E *Shield Bash* — single, light, `enfeebled`.
- B *Riposte Stance* — self `riposte`, with a cooldown. The status icon is the read: hit it then and you pay for it.
- B ⏳ *Overhead Cut* — single, heavy, partial defense ignore.

### Giant Spider — binds first, feeds later
- E *Web Barrage* — 2–3 enemies, light, chance of `webbed`. Prefers targets not yet webbed.
- E *Venom Bite* — single, `poisoned-ii`. Prefers a `webbed` target.
- B ⏳ *Cocoon* — single. Prefers a `webbed` target. `stunned` + `poisoned-iii`.
- B *Feed* — single, `executeBonus`. Prefers a poisoned target.
- Phase 2 ◆ *Into the Rafters* — self `smoke-cover-ii`. Weights shift to the bites.

### Dragon — fire that wears the party down, then takes to the air
- E *Claw Rake* — single, 1–2 hits.
- E *Fire Breath* — all enemies, `burning`, with a cooldown. Weighted up when several targets are under the HP threshold.
- B *Brand* — single, `burning-vulnerable`. Prefers a burning target.
- B ⏳ *Inferno* — all enemies, heavy. Its charge turn puts the Dragon `airborne` (`chargeEffects`): the party gets one round it cannot hit, to brace for what comes next.
- Phase 2 ◆ *Old Fire Wakes* — self `empower`.

### Zombie Knight — works through its guards, gets back up once
No phases.
- E *Diseased Blade* — single, `enfeebled`.
- E *Guard Position* — self `guard-ii`, on a cooldown. This gives it a near-regular rhythm.
- B *Undying* — self heal, large. `usesPerCombat: 1`. Only below an HP threshold.
- B ⏳ *Rotting Embrace* — single, `agony`.

### Dark Knight — complete in attack and defence, picks one opponent
- E *Salute* — single, `challenged` + fear up, with a cooldown.
- E *Measured Cut* — single, crit chance. Strongly prefers the `challenged` target.
- B *Parry Stance* — self `fortify`, with a cooldown.
- B *Dread Presence* — all enemies, fear up.
- B ⏳ *Abyssal Judgment* — only once someone is `challenged`, and aimed at them. Heavy, `stunned`.
- Phase 2 ◆ *Second Salute* — `challenged` on a new opponent (prefers a target lacking it).

### Orc Chieftain — a warband leader, no patience
No telegraph.
- E *Skullsplitter* — single, `executeBonus`.
- E *Call the Warband* — `summonMonster` Goblin. Keeps at most one Goblin up, so the Orc Brute of its phase 2 always has room.
- B *War Cry* — all allies (itself and its adds), `rallied`.
- B *Rout* — 2–3 enemies, `weakened`. Prefers targets under the HP threshold.
- Phase 2 ◆ *Gets Up* — self `bloodrage` + `summonMonster` Orc Brute. Weights shift to *Skullsplitter*.

### Vampire Lord — opens wounds, drinks from them, calls the flock when pressed
- E *Crimson Talon* — single, one `bleeding` stack.
- E *Drink* — single, lifesteal, scales with the target's `bleeding` stacks. Strongly prefers a bleeding target.
- B *Bat Swarm* — `summonMonster` Vampire Bat ×2. Weighted up when low on HP.
- B ⏳ *Final Draught* — single, heavy, lifesteal. Strongly prefers a bleeding target.
- Phase 2 — no new skill; low on HP, its weights lean hard on *Drink*.

### Void Amalgamation — no intent
`targeting: "random"`, no target rules, no telegraph, no phases.
- E *Grasping Remnants* — 2–3 random enemies, one hit each, `shredded`.
- E *Unravelling Tide* — all enemies, `corroded`.
- B *Old Work* — self `regeneration`.
- B *Subsume* — single, heavy, lifesteal, with a cooldown.

### Ancient Golem — cannot be broken quickly
Declares a `shell`, at elite and boss tier alike. Chip the shell down hit by hit, spend the short broken window on burst and damage-over-time, then do it again: the reform wipes every debuff.
- E *Stoneshear* — single, heavy.
- E *Tremor* — all enemies, `slowed`.
- B ⏳ *Sealing Blow* — single, very heavy.
- Phase 2 ◆ *Crumbling Shell* — self `empower`. Weights shift to *Sealing Blow*.

### Lich — arranged the room, raises the dead, strikes a name
- E *Withering Touch* — single, `withered`.
- E *Raise the Dead* — `summonMonster` Skeleton and Skeleton Mage. Gated on ally count.
- B *Ledger Mark* — single, `marked`, with a cooldown. Prefers an unmarked target.
- B ⏳ *Name Struck Out* — only once someone is `marked`, and aimed at them. Heavy. Removes `marked` on hit. Cleansing the mark before the charge moves the blow elsewhere; a cleanse removes the first debuff it finds, so a party member carrying other debuffs may need more than one.
- Phase 2 ◆ *Unhurried* — `marked` on all enemies, then raises to the cap.

### The Founder — fear that climbs
Boss only. Two phases.
- *Paid In Full* — 2–3 enemies.
- *The Same Price* — all enemies, full defense ignore.
- *What's Left Listening* — single, `blinded` + fear up.
- ⏳ *Everything You Asked For* — single, heavy.
- Phase 2 ◆ *Hung Lower* — self `knitting-ii` (heals a share of max HP each turn; `mending` scales off magic power, which a monster has none of).
- Phase 3 ◆ *The Last of It* — all enemies, fear up. Weights shift to *What's Left Listening*.

### Repetition check

Turn structure — telegraphs, phases, cooldowns, AI rules — and target shape are the frame every kit is built in, not effects, so the repetition rule does not count them. So that the frame does not become the new shared pattern: no two archetypes share a telegraph cadence (`cooldownTurns` together with `initialCooldownTurns`), two archetypes (Orc Chieftain, Void Amalgamation) have no telegraph at all, and each telegraph differs in what it is aimed at and when it is allowed (above).

| Effect / mechanic | Archetypes |
|---|---|
| `summonMonster` | Orc Chieftain, Vampire Lord, Lich (intended exception) |
| `weakened` | Orc Chieftain |
| `enfeebled` | Skeleton Guard, Zombie Knight |
| `stunned` | Giant Spider, Dark Knight |
| `blinded` | The Founder |
| fear up | Dark Knight, The Founder |
| `smoke-cover-ii` | Giant Spider |
| `empower` | Dragon, Ancient Golem |
| `corroded` | Void Amalgamation |
| lifesteal | Vampire Lord, Void Amalgamation |
| multi-hit | Dragon |
| defense ignore | Skeleton Guard, The Founder |
| `executeBonus` | Giant Spider, Orc Chieftain |
| one archetype only | `poisoned`, `webbed`, `burning`, `burning-vulnerable`, `bleeding`, `shredded`, `slowed`, `agony`, `withered`, `marked`, `challenged`, `riposte`, `airborne`, breakable shell, `guard-ii`, `guard-iii`, `fortify`, `bloodrage`, `regeneration`, `knitting-ii`, `rallied`, crit, random targeting |

The repetition test (below) enforces the "at most 2" rule from data, with `summonMonster` allow-listed.

## Part 4 — Difficulty curve by `minFloor`

Measured on the old kit (party level from `simulateLevelByDepth`), difficulty did not follow `minFloor`: a floor-80 archetype hit hardest, a floor-90 one hit softest, and the two earliest guards died in about two rounds — too short for a telegraph, a phase or a summon to ever show. Balancing therefore works on two axes, damage and durability, against a curve of four bands plus the final boss:

- **Band I** (earliest `minFloor`: Skeleton Guard, Giant Spider) — teaches reading a telegraph and a status. Lowest damage share, shortest fights, but long enough for the boss to telegraph at least once.
- **Band II** (Zombie Knight, Orc Chieftain, Vampire Lord) — summons and self-healing appear.
- **Band III** (Dark Knight, Void Amalgamation, Lich) — mechanics combine; phases matter.
- **Band IV** (Ancient Golem, Dragon) — the full test.
- **The Founder** — the top of the curve.

Each band rises over the previous one in average damage per round (as a share of the party's total HP), in rounds the party needs to win, and in the cap on a telegraph's single-target damage (as a share of the lowest-HP class's max HP). Boss tier sits above elite tier inside every band. No action from any archetype reaches the lowest-HP class's max HP. Band membership follows `minFloor`; the targets themselves are constants of the balance test, not of this doc.

Levers:
- **Damage** — skill amounts, weights and cooldowns in `data/monster-skills.json` / `data/monsters.json`.
- **Durability, guard-only archetypes** — `baseHp`/`baseAttack`/`baseDefense` are reshaped with Monster Balance Points kept inside the Elite/Boss band. The Ancient Golem's defense drops sharply because its shell carries its durability. The Founder stays outside the band.
- **Durability, Skeleton Guard** — it is triple-role, so its base stats stay put (the normal-tier version shares them). Its guard-room durability comes from its defensive kit.

The balance test simulates real engine fights, with the party using its skills, at each archetype's first elite floor and first boss floor, over several seeds, and checks every archetype against its band.

## Removed content

- Every `elite-strike-*`, `elite-cleave-*`, `boss-debuff-*` and `boss-execute-*` skill in `data/monster-skills.json`.
- The archetype field `executeSkillId`, the balance field `combat.executeCooldownTurns`, and the loader export `EXECUTE_COOLDOWN_TURNS`.
- The strings `combat.bossExecuteCharge` / `combat.bossExecuteRelease`, replaced by telegraph strings that name the skill. Phase entry, summoning, the shell and riposte get their own log strings.

## Testing

- **Normal-tier regression**: a normal-tier Skeleton Guard only ever basic-attacks, never gains cooldown/phase/charge/shell state, keeps its base stats, and — checked once against `main` before merge — produces the same combat log as `main` for the same seeds.
- **AI unit tests** (`test/monster-skills.test.ts`, rewritten): cooldown and `usesPerCombat` are honoured; `aiCondition` gates; `aiRules` and `targetRules` multiply; telegraph charges, locks, releases and re-picks a dead target; a stun delays a charged release instead of cancelling it; each phase is entered once and casts its `onEnterSkillId`; `targeting: "random"` ignores aggro; `targetCount` picks distinct targets, caps at the living count, honours `targetRules`, rolls accuracy per target, and a telegraph locks all of them.
- **Mechanic tests**: summon cap; adds give no exp; adds die with their summoner; victory when the summoner dies with adds alive; reflect hits the attacker but ignores ticks; the shell caps hits (and artifact reflect) while intact, ignores ticks, breaks on the rolled hit count (multi-hit counts each hit, AoE once), stuns once, reforms on the configured turn, clears debuffs but keeps buffs, and delays rather than cancels a charging telegraph; an untargetable monster is excluded from the player's pool, from `allEnemies` and from automatic party attacks, and Overwatch holds its shot; a `harmful` tag status is cleansable and shows as a debuff; `initialCooldownTurns` holds a telegraph back.
- **Data tests**: the repetition rule; every predicate status id and summoned archetype id exists; `targetCount` only appears on `singleEnemy` skills with `1 <= min <= max`; summoned archetypes are normal-role; every boss-only skill is absent from the elite weights; every elite skill is in the boss kit; no two telegraphs share a cadence.
- **Balance test** (Part 4): per archetype and tier, simulated damage share, rounds to win and telegraph cap sit in the band for its `minFloor`; bands rise in order; no single action reaches the lowest-HP class's max HP. Monster Balance Points of guard-only archetypes stay in the Elite/Boss band.
- **Save round-trip** with a boss mid-charge, mid-phase and with live adds.
- **UI check** (tui-testing): a boss with 2 adds fits the battlefield width; telegraph, phase and summon log lines render; `airborne`/`riposte` and the shell state (intact with hits left, broken) show in the status row.
- `bun test`, `bun run typecheck`, `bun run docs:sync`.

## Docs and tools

- `docs/gameplay-decisions/06-level-system.md` §6.12 is rewritten around per-archetype kits and the AI layer. `02-monster.md` "Guard-room archetypes" and the `defensive` pattern note are updated. `technical-decisions.md` §5 describes the new fields, and `developer-guide.md`'s combat section stops describing the Finishing Blow. The generated skill tables are refreshed with `bun run docs:sync`.
- `tools/game-editor`: the monster/monster-skill CRUD and rebalance tab read and edit the new fields. `calc.ts` drops its execute-specific preview.
