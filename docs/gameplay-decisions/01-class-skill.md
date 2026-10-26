# §1. Class & Skill

*(section 1 of `00-index.md` — see that file for the full table of contents)*

Each class has a shared basic attack (slot 0) + several class-specific skills, plus 4 engine mechanics (percentage-based procs, self-buffs applied on a successful hit, stun that skips a turn, and skills whose effect differs depending on the target's side), and cooldowns measured in turns for some of the stronger skills. The roster is 12 classes (section 1.3): Knight, Mage, Rogue, Acolyte, Viking, Plague Doctor, Archer, Ninja, Summoner, Jester, Paladin and Warlock. Every class has 5 class skills in slots 1-5 and its ultimate in slot 6; section 1.3.13 covers the slot-5 skills and the mechanics they brought. Every class-specific skill has 3 ranks of power scaling (section 1.4), and every class has 1 always-on passive skill (section 1.5). Archer and Ninja carry their own reactive and stealth mechanics (an interrupt/overwatch reaction, untargetable stealth). Section 1.7 covers the engine fields a skill opts into that are described once rather than under one class: critical hits, a summoned-combatant primitive, an execute/low-HP damage bonus, stackable status effects, a per-skill offense multiplier, and a summon death-burst.

**Source of truth for every number below**: `data/classes.json`. This document describes the *shape* of each class's kit (which stat/target/mechanic each skill uses) — not the actual MP costs, damage/heal amounts, proc chances, or cooldown lengths, which live only in the JSON and get tuned there without needing a doc update.

**Naming convention**: every `id`/`name` for classes, skills, and status effects is in **English**, matching `data/classes.json`/`data/status-effects.json`/`data/monsters.json`. The descriptive/explanatory text in this document follows suit in English.

## 1.1 Stats & Balance Points

### Stat shape (level 1)

Class stats: **attack** (`attack`), **magic power** (`magicPower` — see below), **defense** (`defense`), **HP** (`maxHp`), **mana** (`maxMp`), **aggro** (`aggro` — the weight used when a monster picks its target, see `02-monster.md` section 2), **speed** (`speed` — priority for acting first, see `docs/technical-decisions.md` §2). Level-1 values for all 12 classes: `data/classes.json`.

- Knight has high `maxHp` and `defense`, `aggro` second only to the Paladin's, and low `speed` (it acts late). On top of the hits its aggro draws, Interpose, Watchful and Engage pull blows meant for others onto it; the Paladin still holds the party's top aggro.
- Mage has the lowest stats across the board on defense/aggro but decent `speed`, and is the only class with low `attack` and the highest `magicPower` — Mage's damage carry comes from its spell skills (section 1.3.2), not its basic attack.
- Rogue has the highest `speed`/`attack`, low `defense`, and no `magicPower` (purely physical), and is the party's main damage source (section 1.3.3).
- Acolyte is balanced, with average `aggro` and decent `magicPower` (healing + secondary damage, lower than Mage's).
- Viking is a hybrid physical/lightning berserker: high risk, extremely high damage, purely physical active skills — no skill scales off `magicPower` directly (section 1.3.5).
- Plague Doctor is an AoE debuffer/support, favoring status effects (burn/poison/blind/weaken) over raw damage, plus a single-target heal and a dual heal+debuff ultimate (section 1.3.6).

Current values for every class, generated from `data/classes.json`:

<!-- docs:begin classStats -->
*Generated from `data/classes.json` by `bun run docs:sync`. Do not edit.*

| Class | Max HP | Max MP | Attack | Defense | Magic power | Aggro | Speed |
|---|---|---|---|---|---|---|---|
| Knight | 140 | 22 | 14 | 11 | 0 | 20 | 8 |
| Mage | 70 | 60 | 3 | 5 | 16 | 8 | 10 |
| Rogue | 100 | 40 | 18 | 6 | 0 | 10 | 20 |
| Acolyte | 90 | 50 | 6 | 8 | 10 | 11 | 9 |
| Viking | 100 | 30 | 18 | 6 | 8 | 16 | 11 |
| Plague Doctor | 80 | 60 | 2 | 6 | 13 | 8 | 11 |
| Archer | 90 | 45 | 17 | 8 | 0 | 9 | 13 |
| Ninja | 110 | 45 | 12 | 8 | 0 | 8 | 16 |
| Summoner | 80 | 55 | 4 | 7 | 12 | 7 | 10 |
| Jester | 95 | 40 | 10 | 6 | 10 | 10 | 18 |
| Paladin | 125 | 30 | 8 | 10 | 8 | 22 | 5 |
| Warlock | 80 | 55 | 3 | 6 | 15 | 8 | 10 |
<!-- docs:end -->

#### The `magicPower` stat and the `isMagic` flag

Any skill whose `damage`/`heal` is "magical" in nature (Mage's fire/lightning/ice elements, Acolyte's holy heal/purge, all of Plague Doctor's skills, and the Mage/Acolyte/Summoner basic attacks) is flagged `isMagic: true` in `data/classes.json`. When the resolver computes damage/healing for an `isMagic` skill, it uses the caster's `source.magicPower` in place of `source.attack` — only the offense side of the formula changes; how defense is subtracted stays the same (full mitigation formula details: `docs/technical-decisions.md`, section "Handling by `effect.kind`"). Skills not flagged `isMagic` (the Knight/Rogue/Viking/Archer/Ninja basic attacks, all of Knight's/Rogue's/Viking's skills, Purify's damage — enemy branch only) use `attack` as normal. Which skills carry `isMagic: true` for each class: `data/classes.json`.

`magicPower` grows by level along the same tapered curve shared with `attack`/`defense`/`maxHp`/`maxMp` (`06-level-system.md` §6.3), multiplied by a class-specific `growthWeights.magicPower` — see `06-level-system.md` §6.8.

#### `damageType` — independent of `isMagic`

A `damage`-kind `SkillEffect` can also carry a `damageType` (`"physical" | "magic" | "fire" | "ice"
| "lightning" | "poison" | "bleed" | "holy"`), keyed against a target `Monster`'s race resist/weak
(`02-monster.md`'s "Race, subRace & traits" section) — unrelated to `isMagic`, which only decides
`attack` vs `magicPower` as the offensive stat. Absent `damageType` defaults to `"physical"`, so
only skills that should carry a specific elemental/status identity are tagged: Mage's Fireball/Fire
Pillar (`fire`), Lightning Bolt/Lightning Storm (`lightning`), Ice Age (`ice`), Arcane Bolt
(`magic` — see below); Viking's Thunder God's Fury (`lightning`); Plague Doctor's Fire Vial
(`fire`), Spreading Toxic Fog (`poison`); Acolyte's Purify/Divine Descent enemy-facing damage only
(`holy`). Status-effect DoT ticks carry it the same way (`poisoned`/`bleeding`/`burning`/
`acid-burn`), as does `onHitAoeDamage` (`storm-empowered`'s lightning splash) — `damageType` is a
property of any `damage`-shaped effect, not something scoped to `perTurnEffects` specifically.

**Mage's basic attack, Arcane Bolt** (`arcane-bolt`), is `isMagic: true` (scales off
`magicPower`), consistent with its `damageType: "magic"` tag.

### Base stats balancing formula (Balance Points)

Comparing "how much stronger/weaker is this class than that one" at base stats (level 1) can't just add up `attack + defense + maxHp + maxMp + magicPower` directly — 1 point in each stat isn't worth the same amount.

**Conversion source**: use the per-level-up growth rate of the first tier from the shared growth table (`06-level-system.md` §6.3, `data/level-growth.json` → `tiers[0]`). Since this is a shared curve across every class (before multiplying by `growthWeights`), treat it as though the original design already defines its own **conversion rate**: tier-1's `attack` rate ⇔ tier-1's `defense` rate ⇔ tier-1's `maxHp` rate ⇔ tier-1's `maxMp` rate ⇔ tier-1's `magicPower` rate, all equal to **1 "balance point"**. `speed` never scales with level, so it has no `tier1` rate to derive a conversion constant from — instead it uses the same hand-picked `speedRate = 12` constant that `MonsterBalancePoints` uses (`02-monster.md` "Monster Balance Points"), so char and monster BalancePoints stay on one consistent scale.

**Formula shape** (divide each stat by its tier-1 rate — or `speedRate` for `speed` — then sum):

```
BalancePoints = attack/tier1.attack + defense/tier1.defense + maxHp/tier1.maxHp + maxMp/tier1.maxMp + magicPower/tier1.magicPower + speed/speedRate
```

`aggro` is not part of the formula.

**How to use it**: compute `BalancePoints` for every class's base stats, compare against the group average — a class that deviates too far from the average (rule of thumb: roughly ±10%) is a sign that base stats are off-balance and need adjusting. Don't hand-maintain a comparison table here — recompute it against the current `data/classes.json` whenever this needs re-checking, since every class's stats can drift independently of this document.

Balance Points of each class against the roster average, scored with the formula above by `tools/game-editor/calc.ts`:

<!-- docs:begin balancePoints -->
*Generated from `data/classes.json` and `data/level-growth.json`, scored by `tools/game-editor/calc.ts` by `bun run docs:sync`. Do not edit.*

| Class | Balance points | Against the roster average |
|---|---|---|
| Knight | 24.5 | −0.6% |
| Mage | 24.7 | +0.1% |
| Rogue | 24.5 | −0.7% |
| Acolyte | 24.8 | +0.8% |
| Viking | 24.7 | +0.3% |
| Plague Doctor | 24.6 | −0.1% |
| Archer | 24.7 | +0.1% |
| Ninja | 24.7 | +0.2% |
| Summoner | 24.5 | −0.4% |
| Jester | 24.6 | −0.1% |
| Paladin | 24.7 | +0.1% |
| Warlock | 24.7 | +0.3% |
| Roster average | 24.6 | — |
<!-- docs:end -->

## 1.2 Basic attack (every class, slot 0)

Free (`mpCost 0`), always available from level 1, unlimited uses, no cooldown, `target: singleEnemy`, a flat `damage` effect with `amount: 0` → damage comes entirely from `mitigatedOffense(attack, defense)` (the mitigation formula, `docs/technical-decisions.md`), true "baseline damage" (identical to the monster basic-attack formula). The name depends on class, with no mechanical purpose beyond being a free fallback when out of MP:

<!-- docs:begin basicAttacks -->
*Generated from `data/classes.json` by `bun run docs:sync`. Do not edit.*

| Class | Skill id | Name | Damage stat |
|---|---|---|---|
| Knight | `slash` | Slash | attack |
| Mage | `arcane-bolt` | Arcane Bolt | magicPower |
| Rogue | `stab` | Stab | attack |
| Acolyte | `smite` | Smite | magicPower |
| Viking | `axe-slash` | Axe Slash | attack |
| Plague Doctor | `vial-toss` | Vial Toss | magicPower |
| Archer | `quick-shot` | Quick Shot | attack |
| Ninja | `kunai-strike` | Kunai Strike | attack |
| Summoner | `hollow-pulse` | Hollow Pulse | magicPower |
| Jester | `knife-flick` | Knife Flick | attack |
| Paladin | `mace-strike` | Mace Strike | attack |
| Warlock | `eldritch-bolt` | Eldritch Bolt | magicPower |
<!-- docs:end -->

*Most basic attacks are physical and scale off their full `attack`. The exceptions: the **magic basics** — Mage's Arcane Bolt, Acolyte's Smite, Summoner's Hollow Pulse, Warlock's Eldritch Bolt (`isMagic: true` + `damageType: "magic"`, each with a reduced `offenseMultiplierPercent`) and Plague Doctor's Vial Toss (`isMagic: true` only, full multiplier) — draw their baseline damage from `magicPower` instead of `attack`; and the **ranged basics** — Archer's Quick Shot, Ninja's Kunai Strike and Jester's Knife Flick — which stay physical but carry a reduced `offenseMultiplierPercent` because they attack from range, while the melee basics keep the full multiplier. Exact values: `data/classes.json`.*

## 1.3 Classes

The first class-specific skills are unlocked at level 1 (on top of the always-available basic attack), the rest unlock gradually via each skill's `unlockLevel` field. `slot`/`unlockLevel`/`cooldownTurns` match the field of the same name in `SkillDefinition` (see `docs/technical-decisions.md` §4) — `usesPerCombat` is not used for character skills (section 1.8, "Design notes", the `usesPerCombat` bullet).

**Reading the Effects column**: per `src/engine/resolver.ts`'s `resolveSkillEffect` case `"damage"`, the engine computes `finalDamage = amount + mitigatedOffense(attack * offenseMultiplier, defense)`, where `offenseMultiplier = (effect.offenseMultiplierPercent ?? 100) / 100` — the caster's `attack` stat is mitigated by the target's `defense` same as always, but is scaled by this **per-skill, per-rank** multiplier *before* mitigation (see section 1.7.5). `amount` is a flat bonus added on top of the mitigated term, unaffected by defense mitigation. So a damage entry reads `damage <amount> + <percent>% ATK` (`MAG` for a magic skill), with the values for ranks 1, 2 and 3 separated by slashes; both are the exact `SkillEffect.amount` and `SkillEffect.offenseMultiplierPercent` (100 when absent) from `data/classes.json`. `heal` works the same way (`heal <amount> + <percent>% MAG`, `case "heal"`: `amount + magicPower * offenseMultiplier`). A value that is the same at every rank is written once. A multi-hit skill (e.g. Rogue's Flurry Assault) lists each hit, and identical hits are folded into `×N`.

**Writing `description` text for a skill**: see `02-monster.md`'s "Writing `description` text"
section — the same rule (flavor only; no mechanical notes, no cross-references to another skill by
name, no numbers/stat references) applies to every skill's `description` field, in
`data/classes.json` as much as `data/monster-skills.json`.

### 1.3.1 Knight — shield-bearing captain: guards one ally, drives the others

<!-- docs:begin classSkills class=knight -->
*Generated from `data/classes.json` by `bun run docs:sync`. Do not edit.*

| Slot | Skill id | Name | Target | Cooldown | MP cost (R1/R2/R3) | Unlock level (R1/R2/R3) | Effects (R1/R2/R3) | Flags |
|---|---|---|---|---|---|---|---|---|
| 1 | `interpose` | Interpose | singleAlly | 3 | 8 / 9 / 10 | 1 / 7 / 15 | status interposed (2 / 3 / 4 turns); not on the caster | buff |
| 2 | `side-by-side` | Side by Side | singleAlly | 3 | 6 / 7 / 8 | 1 / 7 / 15 | status side-by-side / side-by-side-ii / side-by-side-iii (1 turn); not on the caster | buff |
| 3 | `rally` | Rally | allAllies | 2 | 12 / 13 / 14 | 10 / 25 / 45 | fear -8 / -10 / -12; status rallied / rallied-ii / rallied-iii (1 turn) | buff |
| 4 | `heavy-charge` | Heavy Charge | allEnemies | 3 | 14 / 15 / 16 | 15 / 40 / 65 | damage 20 / 30 / 40 + 70 / 80 / 90% ATK | — |
| 5 | `engage` | Engage | singleEnemy | 4 | 12 / 13 / 14 | 25 / 50 / 75 | damage 12 / 16 / 20 + 80 / 90 / 100% ATK; status taunt (1 turn, target self); status engaged / engaged-ii / engaged-iii (1 turn, target self) | — |
| 6 | `sword-judgment` | Sword Judgment | singleEnemy | 5 | 14 / 15 / 16 | 35 / 70 / 100 | damage 30 / 40 / 50 + 85 / 95 / 110% ATK | ultimate |
<!-- docs:end -->

How each skill works:

- `interpose` — `applyStatusEffect "interposed"` (2 / 3 / 4 turns) on one other ally. While it lasts, a monster's single-target damaging attack aimed at that ally goes to the Knight instead, as long as the Knight is alive and not stunned. The hit is rolled against the Knight's defense, and a cast that already targets the Knight never hits it twice. Area attacks, skills without a damage effect, and a confused monster's blows on its own side are not redirected; a boss's telegraph is turned when it is released, since its target is only chosen then (`interceptTarget`, `src/engine/interception.ts`; `StatusEffectDefinition.interceptsForSource`)
- `side-by-side` — `applyStatusEffect "side-by-side"` (rank variants `-ii`/`-iii`, 1 turn) on one other ally: raises their defense, attack and magic power. If the ally's own action then lands a damaging hit, the Knight gains `following-through` (defense and attack, 1 turn). A miss, a stun, a heal or a buff gives the Knight nothing. Both statuses tick as `special`, so each lasts through its bearer's next own action (`StatusEffectDefinition.onLandedHitSourceStatus`, `applyLandedHitFollowUps` in `src/engine/combat.ts`)
- `rally` — `modifyStat fear` (instant, whole party) + `applyStatusEffect "rallied"` (temporary attack buff, whole party)
- `heavy-charge` — `damage`/enemy — accuracy rolled **separately per enemy** (`04-fear-combat.md` section 4)
- `engage` — a `damage` hit on one enemy, then `applyStatusEffect "taunt"` + `applyStatusEffect "engaged"` (rank variants `-ii`/`-iii`) on the Knight for 1 turn (per-effect `target: "self"`): while it lasts, each monster hit that lands on the Knight is answered with a strike at that monster alone; the second counter ends it at once (`counterAttack`, section 1.3.13)
- `sword-judgment` — `damage` — **always hits**, its effectiveness scales down with fear via a dedicated ultimate formula (`04-fear-combat.md` section 4)

*Interpose protects one ally from single-target hits, while Rally is a whole-party buff. The Flags column marks skills that receive `isBuff: true` — see the `durationTurns` rule for buffs in section 1.6, the cooldown and speed rules in section 1.8, and `docs/technical-decisions.md` §4.7. MP costs, effects and cooldowns are in the table above, generated from `data/classes.json`.*

### 1.3.2 Mage — ranged magic damage, fragile; fire/lightning/ice school

<!-- docs:begin classSkills class=mage -->
*Generated from `data/classes.json` by `bun run docs:sync`. Do not edit.*

| Slot | Skill id | Name | Target | Cooldown | MP cost (R1/R2/R3) | Unlock level (R1/R2/R3) | Effects (R1/R2/R3) | Flags |
|---|---|---|---|---|---|---|---|---|
| 1 | `fireball` | Fireball | singleEnemy | — | 5 / 6 / 7 | 1 / 7 / 15 | damage 10 / 13 / 16 + 100 / 105 / 110% MAG (fire); status burning (2 turns, 30 / 40 / 50% chance) | magic |
| 2 | `lightning-bolt` | Lightning Bolt | singleEnemy | — | 6 / 7 / 8 | 1 / 7 / 15 | damage 12 / 15 / 19 + 100 / 110 / 115% MAG (lightning); status stunned (1 turn, 20 / 28 / 35% chance) | magic |
| 3 | `fire-pillar` | Fire Pillar | allEnemies | 2 | 14 / 15 / 16 | 10 / 25 / 45 | damage 12 / 15 / 19 + 80 / 85 / 90% MAG (fire); status burning (2 turns, 50 / 60 / 70% chance) | magic |
| 4 | `lightning-storm` | Lightning Storm | allEnemies | 3 | 16 / 17 / 18 | 15 / 40 / 65 | damage 15 / 20 / 30 + 80 / 90 / 100% MAG (lightning); status stunned (1 turn, 30 / 38 / 45% chance) | magic |
| 5 | `frost-lance` | Frost Lance | singleEnemy | 3 | 15 / 16 / 17 | 25 / 50 / 75 | damage 16 / 22 / 28 + 120 / 135 / 150% MAG (ice); status chilled (2 turns) | magic |
| 6 | `ice-age` | Ice Age | allEnemies | 5 | 20 / 21 / 22 | 35 / 70 / 100 | damage 20 / 25 / 35 + 110 / 120 / 130% MAG (ice); status chilled (2 turns) | ultimate · magic |
<!-- docs:end -->

How each skill works:

- `fireball` — `damage` + chance to `applyStatusEffect "burning"`
- `lightning-bolt` — `damage` + chance to `applyStatusEffect "stunned"`
- `fire-pillar` — `damage`/enemy + chance to `applyStatusEffect "burning"` **per enemy** (rolled separately for each target, both accuracy and proc)
- `lightning-storm` — `damage`/enemy + chance to `applyStatusEffect "stunned"` **per enemy**
- `frost-lance` — heavy single-target `damage` (`ice`) + a guaranteed `applyStatusEffect "chilled"`: a stackable speed cut; the second stack clears both and leaves the target `frozen`, which costs it its next turn like a stun (`onMaxStacks`, section 1.3.13)
- `ice-age` — `damage`/enemy + a guaranteed `chilled` on each, stacking with Frost Lance's — **always hits**, its effectiveness scales down with fear via a dedicated ultimate formula (`04-fear-combat.md` section 4)

*All of Mage's skills are `isMagic: true`, so the engine substitutes `magicPower` for `attack` in the same formula (`amount + mitigatedOffense(magicPower * offenseMultiplier, defense)`) — see the "Reading the Effects column" note under section 1.3 for how `offenseMultiplier` is read per skill/rank from `data/classes.json`.*

*Mage is purely fire/lightning/ice, with a kit focused on damage plus burn/stun procs. Arcane Bolt (slot 0) covers the "free action when out of mana" role. MP costs, damage amounts, and proc chances: `data/classes.json`.*

### 1.3.3 Rogue — single-target burst, highest speed in the party

The Rogue is the team's main damage source by design. Backstab and Flurry Assault are the burst; Poison Bomb and Poison Coat keep poison on the target, and Venomcraft adds to every hit on a poisoned target. Poison ticks off the target's max HP and skips defense (section 1.6, "Damage over time"), so the Rogue's lead over the rest of the party grows the deeper the run goes.

<!-- docs:begin classSkills class=rogue -->
*Generated from `data/classes.json` by `bun run docs:sync`. Do not edit.*

| Slot | Skill id | Name | Target | Cooldown | MP cost (R1/R2/R3) | Unlock level (R1/R2/R3) | Effects (R1/R2/R3) | Flags |
|---|---|---|---|---|---|---|---|---|
| 1 | `poison-coat` | Poison Coat | self | 4 | 3 / 4 / 5 | 1 / 7 / 15 | status poison-coated (3 turns, onHitDurationTurns 3); status venom-edge / venom-edge-ii (3 turns) | buff |
| 2 | `knife-throw` | Knife Throw | singleEnemy | — | 4 / 5 / 6 | 1 / 7 / 15 | damage 12 / 15 / 19 + 90 / 100 / 110% ATK | — |
| 3 | `backstab` | Backstab | singleEnemy | 1 | 8 / 9 / 10 | 10 / 25 / 45 | damage 15 / 20 / 25 + 115 / 125 / 140% ATK | — |
| 4 | `poison-bomb` | Poison Bomb | allEnemies | 3 | 10 / 11 / 12 | 15 / 40 / 65 | damage 10 / 20 / 30 + 50 / 55 / 60% ATK; status poisoned / poisoned-ii / poisoned-iii (3 turns) | — |
| 5 | `venom-brand` | Venom Brand | singleEnemy | 3 | 8 / 9 / 10 | 25 / 50 / 75 | damage 8 / 11 / 14 + 60 / 70 / 80% ATK; status poison-vulnerable (3 / 3 / 4 turns) | — |
| 6 | `flurry-assault` | Flurry Assault | singleEnemy | 5 | 16 / 17 / 18 | 35 / 70 / 100 | damage 12 / 15 / 20 + 45 / 55 / 65% ATK ×3 | ultimate |
<!-- docs:end -->

How each skill works:

- `poison-coat` — `applyStatusEffect "poison-coated"` (self-buff, **does not** deal damage itself — every `damage` effect this actor deals while the buff is active automatically carries `applyStatusEffect "poisoned"` onto the target hit; see "on-hit rider" in `docs/technical-decisions.md` §4.2)
- `knife-throw` — `damage`
- `backstab` — `damage`
- `poison-bomb` — `damage`/enemy + `applyStatusEffect "poisoned"` per enemy — accuracy rolled separately per enemy
- `venom-brand` — light `damage` + a guaranteed `applyStatusEffect "poison-vulnerable"`: every rank of `poisoned` on the target ticks harder while it lasts (section 1.3.13)
- `flurry-assault` — several consecutive `damage` hits — **always hits**, its effectiveness scales down with fear via a dedicated ultimate formula (`04-fear-combat.md` section 4)

*Poison Coat is a self-buff that "coats the weapon in poison" — its value comes indirectly through subsequent hits. Rogue has no dedicated defensive skill — the kit is 100% offense/debuff. MP costs, damage amounts, and cooldowns: `data/classes.json`.*

**On Poison Coat and the "buffs are always 1 turn" rule**: `poison-coat` is **not** forced down to a 1-turn duration the way Rally is, even though it is also a self-buff — see `poison-coat`'s `applyStatusEffect` effect in `data/classes.json` for its actual `durationTurns`. `poison-coated` carries no `modifyCombatStat` — it's a buff-rider (it toggles the "attacks auto-apply poison" mechanic). How long the poison each hit applies lasts is the `onHitDurationTurns` on that same effect, separate from the coat's own `durationTurns`; Serpent Oil's item effect declares its own. Its cooldown follows the shared "duration + 1" formula (§1.8, "Design notes").

### 1.3.4 Acolyte — healing + team-wide fear reduction

<!-- docs:begin classSkills class=acolyte -->
*Generated from `data/classes.json` by `bun run docs:sync`. Do not edit.*

| Slot | Skill id | Name | Target | Cooldown | MP cost (R1/R2/R3) | Unlock level (R1/R2/R3) | Effects (R1/R2/R3) | Flags |
|---|---|---|---|---|---|---|---|---|
| 1 | `prayer` | Prayer | singleAlly | 2 | 4 / 5 / 6 | 1 / 7 / 15 | fear -15 / -19 / -24; status fortify (2 turns) | — |
| 2 | `heal` | Heal | singleAlly | — | 6 / 7 / 8 | 1 / 7 / 15 | heal 16 / 22 / 30 + 90 / 100 / 110% MAG | magic |
| 3 | `purify` | Purify | singleAllyOrEnemy | 1 | 9 / 10 / 11 | 10 / 25 / 45 | remove one harmful status (on allies); damage 15 / 20 / 27 + 100 / 110 / 120% MAG (on enemies, holy) | magic |
| 4 | `mass-heal` | Mass Heal | allAllies | 2 | 10 / 11 / 12 | 15 / 40 / 65 | heal 20 / 25 / 35 + 60 / 70 / 85% MAG; remove every harmful damage-over-time status | magic |
| 5 | `sanctuary` | Sanctuary | allAllies | 4 | 12 / 13 / 14 | 25 / 50 / 75 | status sanctified / sanctified-ii / sanctified-iii (3 turns); status steadfast (2 turns); status cleansing-light / cleansing-light-ii / cleansing-light-iii (2 turns, target self) | buff · magic |
| 6 | `divine-descent` | Divine Descent | allAlliesAndEnemies | 5 | 20 / 21 / 22 | 35 / 70 / 100 | heal 25 / 30 / 40 + 70 / 75 / 80% MAG (on allies); fear -15 / -20 / -25 (on allies); damage 20 / 25 / 30 + 80 / 85 / 90% MAG (on enemies, holy) | ultimate · magic |
<!-- docs:end -->

How each skill works:

- `prayer` — `modifyStat fear` + `applyStatusEffect "fortify"` (2 turns) on the same ally. Its cooldown lets one ally keep `fortify` up continuously when Prayer is recast every time it comes off cooldown
- `heal` — `heal`
- `purify` — targeting an ally → `removeStatusEffect` (strips 1 debuff); targeting an enemy → `damage`
- `mass-heal` — `heal` + `removeStatusEffect` with `removesHarmfulDots`: every damage-over-time status on each ally goes
- `sanctuary` — every ally gets `sanctified` (a heal over time off the Acolyte's magic power, rank variants `-ii`/`-iii`) and `steadfast` (a `fearResistPercent` status, section 1.3.13); the Acolyte also gets `cleansing-light` (rank variants `-ii`/`-iii`) for 2 turns, which turns its basic attack into Cleansing Smite, a holy strike off magic power (`basicAttackOverride`, section 1.3.13)
- `divine-descent` — allies → `heal` + `modifyStat fear`; enemies → `damage` — **always hits**, its effectiveness scales down with fear via a dedicated ultimate formula (`04-fear-combat.md` section 4)

*Sanctuary is the only Acolyte skill with the buff flag. Prayer's `fortify` is a stat modifier like any other, but Prayer itself resolves in plain speed order (Acolyte is slow), so on the round it's cast a faster monster can act before the ally is fortified.*

*Acolyte does have real damage options (Purify targeting an enemy, Divine Descent, and the Smite basic attack) alongside its primary healer role. MP costs, heal/damage amounts, and cooldowns: `data/classes.json`.*

### 1.3.5 Viking — hybrid physical/lightning berserker, high risk/extremely high damage

Base stats (attack/magicPower/defense/maxHp/maxMp/aggro/speed) and `growthWeights`: `data/classes.json` — this section describes shape only, not current tuning (same caveat as the rest of this document).

`magicPower` feeds the damage portion of the passive proc `storm-empowered` (section 1.3.5.1); it is not used to scale active skills — all of the Viking's active skills are physical.

Basic attack (slot 0, same as every class — section 1.2): **Axe Slash** (`axe-slash`), physical.

<!-- docs:begin classSkills class=viking -->
*Generated from `data/classes.json` by `bun run docs:sync`. Do not edit.*

| Slot | Skill id | Name | Target | Cooldown | MP cost (R1/R2/R3) | Unlock level (R1/R2/R3) | Effects (R1/R2/R3) | Flags |
|---|---|---|---|---|---|---|---|---|
| 1 | `lightning-axe` | Lightning Axe | self | 4 | 8 / 9 / 10 | 1 / 7 / 15 | status storm-empowered / storm-empowered-ii / storm-empowered-iii (3 turns); status storm-recoil (1 turn) | buff |
| 2 | `frenzied-slash` | Frenzied Slash | singleEnemy | — | 5 / 6 / 7 | 1 / 7 / 15 | damage 9 / 12 / 15 + 95 / 100 / 105% ATK; status bleeding (3 turns, 50 / 60 / 70% chance); with status storm-empowered: ignores 30% defense | — |
| 3 | `throw-axe` | Throw Axe | singleEnemy | 2 | 9 / 10 / 11 | 10 / 25 / 45 | damage 16 / 20 / 25 + 100 / 107 / 115% ATK; with status storm-empowered: ignores 30% defense | — |
| 4 | `spinning-axe` | Spinning Axe | allEnemies | 3 | 14 / 15 / 16 | 15 / 40 / 65 | damage 15 / 20 / 30 + 70 / 77 / 85% ATK; status bleeding (3 turns, 30 / 40 / 50% chance); with status storm-empowered: ignores 30% defense | — |
| 5 | `desperate-cleave` | Desperate Cleave | singleEnemy | 3 | 12 / 13 / 14 | 25 / 50 / 75 | damage 14 / 19 / 24 + 110 / 125 / 140% ATK; with status storm-empowered: ignores 30% defense; caster below 50% HP: +60% offense, 40% lifesteal | — |
| 6 | `thunder-gods-fury` | Thunder God's Fury | allEnemies | 5 | 20 / 21 / 22 | 35 / 70 / 100 | damage 30 / 40 / 50 + 80 / 100 / 120% ATK (lightning); with status storm-empowered: ignores 60% defense, consumes it | ultimate |
<!-- docs:end -->

How each skill works:

- `lightning-axe` — `applyStatusEffect "storm-empowered"` + temporary defense debuff + temporary aggro buff
- `frenzied-slash` — `damage` (physical) + chance to `applyStatusEffect "bleeding"` — **conditionalBonus**: extra `ignoreDefensePercent` if currently carrying `storm-empowered`
- `throw-axe` — `damage` (physical) — same `storm-empowered` conditionalBonus
- `spinning-axe` — `damage`/enemy + chance to `applyStatusEffect "bleeding"` — same `storm-empowered` conditionalBonus
- `desperate-cleave` — heavy single-target `damage`; while the Viking is below its `casterHpBelowBonus` threshold the hit gains extra offense and lifesteal (section 1.3.13); under `storm-empowered` it also ignores part of the target's defense (`conditionalBonus`)
- `thunder-gods-fury` — `damage`/enemy — **always hits** (isUltimate), a bigger `storm-empowered` conditionalBonus, **and consumes `storm-empowered`** after use

*Skills 2-6 are all purely physical (not `isMagic`) — the Viking's magic damage only comes indirectly through the `storm-empowered` proc (1.3.5.1), not directly through the skill formula the way Mage/Acolyte work.*

#### 1.3.5.1 `storm-empowered` and `conditionalBonus`

Two schema fields (`src/types.ts`) exist only for the Viking:

**a) `onHitAoeDamage` on `StatusEffectDefinition`** — a buff that deals its own AoE damage every time the bearer lands a hit (basic attack or skill), similar to the on-hit rider mechanic (`onHitStatusEffectId`, used by `poison-coated` — section 1.3.3, `docs/technical-decisions.md` §4.2) but dealing AoE damage instead of applying a status to a single target:

```ts
onHitAoeDamage?: { amount: number; isMagic?: boolean; ignoreDefensePercent?: number; offenseMultiplierPercent?: number; damageType?: DamageType };
```

Status effect `storm-empowered` (shape — actual `amount`/`offenseMultiplierPercent`/`ignoreDefensePercent` live in `data/status-effects.json`, `durationTurns` on `lightning-axe`'s applying effect in `data/classes.json`; row also included in the summary table, section 1.6):

```json
{
  "id": "storm-empowered",
  "name": "Storm-Empowered",
  "onHitAoeDamage": { "amount": "<see data/status-effects.json>", "isMagic": true, "offenseMultiplierPercent": "<see data/status-effects.json>", "ignoreDefensePercent": "<see data/status-effects.json>", "damageType": "lightning" }
}
```

**b) `conditionalBonus` on `SkillDefinition`** — adds extra `ignoreDefensePercent` to a skill's `damage` effects *only when* the caster is currently carrying a specified status, optionally consuming that status after use (used for the slot-6 ultimate):

```ts
conditionalBonus?: {
  requiresStatusId: Id;
  ignoreDefensePercentBonus: number;
  consumesStatus?: boolean;
};
```

Placed at the `SkillDefinition` level (not `SkillEffect`) — it only triggers when the condition is met.

### 1.3.6 Plague Doctor — debuffer/support, favors effects over raw damage

Base stats and `growthWeights`: `data/classes.json`, same caveat as section 1.3.5.

Role: an AoE debuffer (burn/poison/blind/weaken), with 1 single-target heal skill and 1 dual-purpose heal+debuff ultimate.

Basic attack (slot 0): **Vial Toss** (`vial-toss`), `isMagic: true` (see the footnote under section 1.2).

<!-- docs:begin classSkills class=plague-doctor -->
*Generated from `data/classes.json` by `bun run docs:sync`. Do not edit.*

| Slot | Skill id | Name | Target | Cooldown | MP cost (R1/R2/R3) | Unlock level (R1/R2/R3) | Effects (R1/R2/R3) | Flags |
|---|---|---|---|---|---|---|---|---|
| 1 | `fire-vial` | Fire Vial | singleEnemy | — | 4 / 5 / 6 | 1 / 7 / 15 | damage 10 / 12 / 16 + 90 / 95 / 105% MAG (fire); status burning (2 turns, 60 / 70 / 80% chance) | magic |
| 2 | `healing-draught` | Healing Draught | singleAlly | — | 6 / 7 / 8 | 1 / 7 / 15 | heal 7 / 10 / 15 + 40 / 45 / 50% MAG; status mending / mending-ii / mending-iii (2 turns) | magic |
| 3 | `blinding-vial` | Blinding Vial | singleEnemy | 2 | 7 / 8 / 9 | 10 / 25 / 45 | damage 10 / 13 / 18 + 80 / 85 / 90% MAG; status blinded (2 turns, 70 / 80 / 90% chance) | magic |
| 4 | `spreading-toxic-fog` | Spreading Toxic Fog | allEnemies | 3 | 12 / 13 / 14 | 15 / 40 / 65 | damage 15 / 25 / 40 + 50 / 60 / 70% MAG (poison); status poisoned (3 turns, 60 / 70 / 80% chance); status weakened (2 turns, 40 / 50 / 60% chance) | magic |
| 5 | `volatile-flask` | Volatile Flask | allEnemies | 4 | 14 / 15 / 16 | 25 / 50 / 75 | damage 3 / 4 / 5 + 20 / 23 / 26% MAG (fire, 2–6 hits, +10% per debuff on the target / +12% per debuff on the target / +15% per debuff on the target) | magic |
| 6 | `total-plague` | Total Plague | allAlliesAndEnemies | 5 | 22 / 23 / 24 | 35 / 70 / 100 | heal 20 / 25 / 31 + 60 / 65 / 70% MAG (on allies); remove one harmful status (on allies); damage 10 / 13 / 16 + 70 / 75 / 85% MAG (on enemies); status poisoned (3 turns, on enemies, 80 / 85 / 90% chance); status burning (2 turns, on enemies, 80 / 85 / 90% chance) | ultimate · magic |
<!-- docs:end -->

How each skill works:

- `fire-vial` — `damage` + chance to `applyStatusEffect "burning"`
- `healing-draught` — `heal` on cast, plus `applyStatusEffect "mending"` (2 turns) that repeats the same heal at the start of each of the next 2 rounds — 3 heals in total. See `mending` below
- `blinding-vial` — `damage` + chance to `applyStatusEffect "blinded"`
- `spreading-toxic-fog` — `damage`/enemy + chance to `applyStatusEffect "poisoned"` + chance to `applyStatusEffect "weakened"`
- `volatile-flask` — `damage`/enemy struck 2-6 times each (`hitCountRange`), every strike growing with the number of debuffs on that enemy (`scalesWithDebuffCount`, section 1.3.13)
- `total-plague` — allies → `heal` + `removeStatusEffect`; enemies → `damage` + chance to `applyStatusEffect "poisoned"` + chance to `applyStatusEffect "burning"` — **always hits** (isUltimate)

*All skills are `isMagic: true`. The ultimate (slot 6) splits its effects by `appliesToRelation: "ally" | "enemy"` (2 sides) — the same mechanic as `divine-descent` (section 1.3.4).*

#### 1.3.6.1 `mending` — a heal over time that scales off the caster

Healing Draught's lingering heal. Each rank has its own status (`mending`/`-ii`/`-iii`), and each one's `heal` perTurnEffect carries an `offenseMultiplierPercent` on top of its flat `amount`, the same shape as an instant heal. A status's per-turn tick resolves with the bearer as its own source, so scaling it the usual way would read the bearer's `magicPower`. Instead, when a magic skill applies (or refreshes) a status whose `heal` perTurnEffects carry an `offenseMultiplierPercent`, the caster's `magicPower` at that moment is stored on the active status (`ActiveStatusEffect.sourceMagicPower`), and every tick heals `amount + sourceMagicPower × offenseMultiplierPercent`. A heal-over-time with no `offenseMultiplierPercent` does not scale off any caster: `regeneration` and the barter regens heal their flat `amount`, and a `maxHpPercent` heal works as described in section 1.6.

Healing Draught's first heal is a plain `heal` effect in the skill itself, with the same numbers as its rank's `mending`. That's what makes the first heal land on the cast instead of at the next round start, where a freshly applied heal-over-time first ticks. Recasting on an ally who still has `mending` refreshes it to 2 turns with the new caster's `magicPower`, and any ticks left over from the old application are lost.

<!-- docs:begin statusEffects ids=mending,mending-ii,mending-iii -->
*Generated from `data/status-effects.json` by `bun run docs:sync`. Do not edit.*

| id | Name | Mechanics |
|---|---|---|
| `mending` | Mending | heal 7 + 40% caster MAG per turn |
| `mending-ii` | Mending | heal 10 + 45% caster MAG per turn; rankOf mending; rankLevel 2 |
| `mending-iii` | Mending | heal 15 + 50% caster MAG per turn; rankOf mending; rankLevel 3 |
<!-- docs:end -->

#### 1.3.6.2 `blinded` — an accuracy penalty, rolled in `rollHits()`

Plague Doctor's other debuffs (`burning`, `poisoned`, `weakened`) are the shared statuses in section 1.6. `blinded` shape (current `accuracyPenaltyPercent` lives in `data/status-effects.json`, `durationTurns` on each applying effect in `data/classes.json`):

```json
{
  "id": "blinded",
  "name": "Blinded",
  "accuracyPenaltyPercent": "<see data/status-effects.json>",
  "perTurnEffects": []
}
```

`blinded` reduces the bearer's own chance to land its attacks/skills by a flat percentage for the duration, rather than weakening its `attack` stat — thematically "can't see" means "misses more", not "hits softer". The field is `StatusEffectDefinition.accuracyPenaltyPercent?: number`, read by `rollHits()` (`src/engine/resolver.ts`) from the source's active statuses whether the source is a character or a monster, combined with the fear-based penalty when both apply and clamped to 100%. Fear only applies to characters, so a status like `blinded` is what gives a *monster* a chance to miss.

`isHelpfulStatusEffect()` (`src/engine/resolver.ts`) counts any status with `accuracyPenaltyPercent` set as harmful: `blinded` has none of the other harmful markers (`stuns`/`vulnerableTo`, a `damage` `perTurnEffect`, a negative `modifyCombatStat`), so without that check it would read as a buff.

### 1.3.7 Archer — single-target damage, CC, critical hits, stat debuffs

**Base stats (`data/classes.json`)**: see the class stats table in section 1.1 — between Knight and Rogue on attack, reflecting a single-target physical striker, and in line with the roster's `BalancePoints` formula (section 1.1's "Base stats balancing formula").

Basic attack (slot 0): **Quick Shot** (`quick-shot`), physical, bow, sub-100% offense (ranged — see the footnote under section 1.2).

<!-- docs:begin classSkills class=archer -->
*Generated from `data/classes.json` by `bun run docs:sync`. Do not edit.*

| Slot | Skill id | Name | Target | Cooldown | MP cost (R1/R2/R3) | Unlock level (R1/R2/R3) | Effects (R1/R2/R3) | Flags |
|---|---|---|---|---|---|---|---|---|
| 1 | `aimed-shot` | Aimed Shot | singleEnemy | — | 5 / 6 / 7 | 1 / 7 / 15 | damage 16 / 21 / 26 + 90 / 95 / 105% ATK (crit 30 / 35 / 40%) | — |
| 2 | `overwatch` | Overwatch | self | 2 | 6 / 7 / 8 | 1 / 7 / 15 | status overwatched / overwatched-ii / overwatched-iii (1 turn) | buff |
| 3 | `volley-shot` | Volley Shot | allEnemies | 2 | 9 / 10 / 11 | 10 / 25 / 45 | damage 10 / 14 / 19 + 60 / 66 / 75% ATK | — |
| 4 | `crippling-shot` | Crippling Shot | singleEnemy | 2 | 10 / 11 / 12 | 15 / 40 / 65 | damage 16 / 21 / 27 + 80 / 90 / 100% ATK; status stagger (1 turn, 30 / 40 / 45% chance); status weakened (2 turns, 50 / 60 / 70% chance) | — |
| 5 | `piercing-arrow` | Piercing Arrow | singleEnemy | 2 | 11 / 12 / 13 | 25 / 50 / 75 | damage 14 / 19 / 24 + 100 / 112 / 125% ATK (crit 25%, ignores 50 / 55 / 60% defense) | — |
| 6 | `deadeye-shot` | Deadeye Shot | singleEnemy | 5 | 16 / 17 / 18 | 35 / 70 / 100 | damage 20 / 27 / 34 + 90 / 100 / 110% ATK (crit 100%) | ultimate |
<!-- docs:end -->

How each skill works:

- `aimed-shot` — `damage` + high `critChance` (signature crit skill)
- `overwatch` — `applyStatusEffect "overwatched"` — see section 1.3.7.1 for the interrupt mechanic
- `volley-shot` — `damage`/enemy — uses an `offenseMultiplierPercent` below 100, see below <!-- docs:intent -->
- `crippling-shot` — `damage` + chance to `applyStatusEffect "stagger"` (skips the target's next turn) + chance to `applyStatusEffect "weakened"` (defense debuff, reused from section 1.6)
- `piercing-arrow` — `damage` that ignores part of the target's defense (`ignoreDefensePercent`) + a crit chance
- `deadeye-shot` — `damage` — **always hits**, always crits, effectiveness scales down with fear via the ultimate formula (`04-fear-combat.md` §4)

**Volley Shot** hits for a reduced share of the caster's `attack` (its `offenseMultiplierPercent`, in the table above), weaker than a skill that uses `attack` at its full, un-scaled value — the trade for hitting every enemy. The field itself is described in section 1.7.5.

*No self-buff beyond Overwatch — Archer is close to 100% offense/control, matching its role ("single-target damage, CC, crit, stat debuff").*

#### 1.3.7.1 Overwatch — the interrupt mechanic

`overwatch` is `isBuff: true`, so it receives the "buff skills get a temporary speed bonus for turn-order purposes" rule (Design notes, below) — in practice this means it resolves before monster turns in the round it's cast.

Mechanic: while the caster carries `overwatched`, the moment resolution reaches **the next monster's queued turn** (i.e. the first monster in `turnQueue` that hasn't acted yet this round), the Archer reactively fires at that monster **before** the monster's action resolves:
- Roll accuracy as normal.
- **Hit** → deals the status's own `overwatchShot` damage (flat `amount` + `offenseMultiplierPercent` of the Archer's attack, rising per rank across `overwatched`/`-ii`/`-iii`), then rolls the status's `interruptChance`:
  - **Interrupted** → the monster's queued action for this round is discarded (its turn is skipped entirely — no damage/effect from it this round).
  - **Not interrupted** → the monster still takes its turn after the shot.
  - A shot that kills the monster ends its turn either way.
- **Miss** → the monster's queued action resolves normally.
- `overwatched` is consumed by the first monster reached, whatever happens (1 shot per cast).

The three statuses carry no `perTurnEffects` of their own; `"tickCategory": "statMod"` keeps them expiring at the end of the round they were cast in, like a stat-mod buff. Current numbers: `data/status-effects.json`, table below.

<!-- docs:begin statusEffects ids=overwatched,overwatched-ii,overwatched-iii -->
*Generated from `data/status-effects.json` by `bun run docs:sync`. Do not edit.*

| id | Name | Mechanics |
|---|---|---|
| `overwatched` | Overwatched | tickCategory statMod; triggersOverwatch; overwatchShot amount 0, offenseMultiplierPercent 90; interruptChance 0.7 |
| `overwatched-ii` | Overwatched | tickCategory statMod; triggersOverwatch; overwatchShot amount 10, offenseMultiplierPercent 95; interruptChance 0.75 |
| `overwatched-iii` | Overwatched | tickCategory statMod; triggersOverwatch; overwatchShot amount 15, offenseMultiplierPercent 100; interruptChance 0.8 |
<!-- docs:end -->

Overwatch is a hook in the round-resolution loop (`src/engine/combat.ts`'s `resolveRound`), not just a status effect: before each monster's queued action resolves, it checks whether any living character currently carries `overwatched`. It is a *reactive* character mechanic — it resolves on a monster's turn, while every other skill resolves on the caster's own turn.

### 1.3.8 Ninja — weaker raw damage than Archer/Rogue, stealth, a real decoy clone, bleeding, and finishing low-HP targets

**Base stats (`data/classes.json`)**: see the class stats table in section 1.1 — deliberately below both Archer and Rogue on attack, and in line with `BalancePoints`, same as Archer above.

Basic attack (slot 0): **Kunai Strike** (`kunai-strike`), physical, kunai, sub-100% offense (ranged — see the footnote under section 1.2).

<!-- docs:begin classSkills class=ninja -->
*Generated from `data/classes.json` by `bun run docs:sync`. Do not edit.*

| Slot | Skill id | Name | Target | Cooldown | MP cost (R1/R2/R3) | Unlock level (R1/R2/R3) | Effects (R1/R2/R3) | Flags |
|---|---|---|---|---|---|---|---|---|
| 1 | `smoke-bomb` | Smoke Bomb | self | 3 | 6 / 8 / 10 | 1 / 7 / 15 | status stealthed / stealthed-ii / stealthed-iii (2 turns); status smoke-cover / smoke-cover-ii / smoke-cover-iii (2 turns, target allAllies, not on summons) | buff |
| 2 | `shadow-strike` | Shadow Strike | singleEnemy | 4 | 8 / 10 / 12 | 1 / 7 / 15 | summon shadow-clone; damage 6 / 9 / 12 + 50 / 57 / 65% ATK | — |
| 3 | `throwing-knives` | Throwing Knives | singleEnemy | 2 | 6 / 7 / 8 | 10 / 25 / 45 | damage 10 / 14 / 18 + 80 / 85 / 90% ATK (40 / 45 / 50% extra hit); status bleeding (3 turns, 60 / 70 / 80% chance) | — |
| 4 | `shuriken-storm` | Shuriken Storm | allEnemies | 3 | 12 / 14 / 18 | 15 / 40 / 65 | damage 8 / 15 / 12 + 55 / 60 / 65% ATK (1–2 hits / 1–3 hits / 2–3 hits); status bleeding (3 turns, 60 / 70 / 80% chance) | — |
| 5 | `barbed-net` | Barbed Net | allEnemies | 4 | 14 / 15 / 16 | 25 / 50 / 75 | damage 5 / 7 / 9 + 40 / 45 / 50% ATK; status stagger (1 turn, 35 / 40 / 45% chance); status netted (3 turns) | — |
| 6 | `death-mark` | Death Mark | singleEnemy | 5 | 16 / 17 / 18 | 35 / 70 / 100 | damage 14 / 19 / 24 + 100 / 115 / 135% ATK (+5% per bleeding stack); status bleeding (3 turns); below 30% HP: +30 damage | ultimate |
<!-- docs:end -->

How each skill works:

- `smoke-bomb` — `applyStatusEffect "stealthed"` on the Ninja — untargetable, breaks on the Ninja's next attack — plus `applyStatusEffect "smoke-cover"` on every party member, the Ninja included (per-effect `target: "allAllies"`, `excludesSummonTargets`); see 1.3.8.1
- `shadow-strike` (Shadow Strike) — `damage` to the target, plus a `summon` that always lands on the Ninja regardless of the hit (resolved first, so a miss or dodge still leaves a clone). The hit itself can roll Afterimage's 2nd-clone chance, so a single cast can end with 2 clones: the cast's own `Shadow Clone` and the passive's `Shadow Clone II` (`secondCloneName`). The clone is combatant `shadow-clone` (flat, level/stat-independent `maxHp` — does **not** scale with the Ninja's own `maxHp`; high `aggro` — weighted only, not a forced taunt) — vanishes after a fixed number of actions taken (the cast's `maxActions`). Each basic attack the clone lands has a chance to apply `bleeding` (`SummonArchetype.basicAttackOnHit`, `data/summons.json`; rolled in `runSummonTurn`, `src/engine/combat.ts`). Whenever it's removed by dying or running out of actions (not by being dismissed/recast), it detonates: AoE `damage` to every enemy + a chance to apply `bleeding`. See section 1.7.2 and 1.7.6
- `throwing-knives` — `damage` + chance to `applyStatusEffect "bleeding"` (stacking — 1.7.4) + a chance to throw a 2nd knife (independent damage + bleeding roll) — no `executeBonus`; Death Mark alone carries the ninja's execute mechanic
- `shuriken-storm` — `damage`/enemy, each enemy struck several times — the hit count per rank is in the Effects column, rolled per enemy — each individual hit has a chance to `applyStatusEffect "bleeding"`
- `barbed-net` — light `damage`/enemy + chance to `applyStatusEffect "stagger"` + a guaranteed `netted`: each time a netted enemy acts, it may open a `bleeding` stack on itself (`onActStatus`, section 1.3.13)
- `death-mark` — `damage`, scaling per existing `bleeding` stack on the target (via `scalesWithStatusStacks`, 1.7.4), plus a flat `executeBonus` below an HP threshold — **always hits**, effectiveness scales down with fear via the ultimate formula, applies/refreshes 1 `bleeding` stack

Throwing Knives and Shuriken Storm use `offenseMultiplierPercent` (1.7.5). Death Mark's multiplier is dynamic: it grows with each existing `bleeding` stack on the target, read via `scalesWithStatusStacks` (1.7.4), on top of its own rank-scaled base — not a fixed multiplier.

*Base damage on skills 3-6 is intentionally tuned lower than Archer/Rogue's equivalents — Ninja's value comes from stealth, drawing hits off the team via Shadow Clone, and execute burst, not raw per-hit damage.*

#### 1.3.8.1 Stealth (untargetable) and the stealth-break bonus

Status `stealthed` carries `StatusEffectDefinition.untargetable: true`: while it is active, every place the engine builds a list of valid enemy targets for a `singleEnemy`/`allEnemies` skill skips the bearer entirely, the same way it skips a dead combatant. Breaks automatically the instant the Ninja lands an attack (basic attack or skill).

The breaking attack itself carries a bonus, via `StatusEffectDefinition.breakBonus: { basicAttackGuaranteedCrit?: boolean; skillDamageBonusPercent?: number }` on `stealthed`:
- If the breaking attack is the **basic attack** → guaranteed critical hit (for that hit only).
- If the breaking attack is a **skill** → that skill's damage is increased by `skillDamageBonusPercent`.

The same cast also covers the party in smoke for the same duration: status `smoke-cover` carries `StatusEffectDefinition.dodgePercent`, and while it is active every enemy attack aimed at the bearer rolls that chance to be dodged through `rollDodge` (`src/engine/artifacts.ts`), as an independent roll alongside Artifact `dodgeChance` and the Afterimage passive. Smoke Cover does not break when the bearer attacks. Summons are not covered.

<!-- docs:begin statusEffects ids=smoke-cover,smoke-cover-ii,smoke-cover-iii -->
*Generated from `data/status-effects.json` by `bun run docs:sync`. Do not edit.*

| id | Name | Mechanics |
|---|---|---|
| `smoke-cover` | Smoke Cover | dodgePercent 30 |
| `smoke-cover-ii` | Smoke Cover | dodgePercent 37; rankOf smoke-cover; rankLevel 2 |
| `smoke-cover-iii` | Smoke Cover | dodgePercent 45; rankOf smoke-cover; rankLevel 3 |
<!-- docs:end -->

### 1.3.9 Summoner — minions that heal, tank, and deal damage, scaled off the caster's own stats

**Base stats (`data/classes.json`)**: see the class stats table in section 1.1 — low attack/high magicPower like Acolyte/Plague Doctor, since Summoner's own combat output is secondary to its minions; low `aggro` since its minions (especially Stone Golem) are meant to draw enemy attacks instead. See the Balance Points table in section 1.1 for how it compares with the roster. Minion stat-derivation ratios off these numbers: `base + (percent/100) * owner[sourceStat]` per stat at cast time (`SkillEffect.summonCastId` → `data/summons.json`'s `casts`), the same mechanism Ninja's clone uses — see the cast-profile note at the start of 1.3.9.1 for how the table below maps onto that.

Basic attack (slot 0): **Hollow Pulse** (`hollow-pulse`), magic (`isMagic`, scales off `magicPower`), weak — Summoner leans on its minions, not its own combat.

<!-- docs:begin classSkills class=summoner -->
*Generated from `data/classes.json` by `bun run docs:sync`. Do not edit.*

| Slot | Skill id | Name | Target | Cooldown | MP cost (R1/R2/R3) | Unlock level (R1/R2/R3) | Effects (R1/R2/R3) | Flags |
|---|---|---|---|---|---|---|---|---|
| 1 | `summon-goblin` | Summon Goblin | self | 3 | 10 / 11 / 12 | 1 / 7 / 15 | summon summon-goblin; status skittish (2 turns) | buff |
| 2 | `summon-spirit` | Summon Spirit | self | 3 | 10 / 11 / 12 | 1 / 7 / 15 | summon summon-spirit; status spirit-bound (2 turns) | buff |
| 3 | `summon-golem` | Summon Golem | singleEnemy | 4 | 12 / 13 / 14 | 10 / 25 / 45 | summon summon-golem (target self); damage 12 / 18 / 26 + 90 / 105 / 120% ATK; status stone-skin (2 turns, target self) | buff |
| 4 | `totem-recall` | Totem Recall | self | 6 | 10 / 11 / 12 | 15 / 40 / 65 | summon totem-recall; status totems-strength (99 turns, target allAllies, min 10 / 15 / 20%, not on summons, lasts while the summon lives, amount 8 / 14 / 20) | buff |
| 5 | `command` | Command | self | 3 | 12 / 13 / 14 | 25 / 50 / 75 | cast one minion's signature skill as your own, off MAG, at 100 / 115 / 130% of its damage and healing (target self) | magic |
| 6 | `summon-hellfire-imp` | Summon Hellfire Imp | allEnemies | 4 | 20 / 21 / 22 | 35 / 70 / 100 | summon summon-hellfire-imp (target self); damage 8 / 13 / 18 + 80% MAG; status hellfire-kindled (2 turns, target self) | ultimate · magic |
<!-- docs:end -->

How each skill works:

- Every summon skill except Totem Recall also buffs the Summoner alone (not the party, not the minions) for 2 turns: Summon Goblin → `skittish` (`speed`), Summon Spirit → `spirit-bound` (`maxHp`), Summon Golem → `stone-skin` (`defense`), Summon Hellfire Imp → `hellfire-kindled` (`magicPower`); amounts are in the status table below. `spirit-bound` uses the `maxHp` combat stat: gaining it raises current HP by the same amount, so the HP already lost stays the same; when it fades max HP drops back and current HP is only trimmed if it would sit above the new max (`applyCombatStatDelta`, `src/engine/resolver.ts`).
- `summon-goblin` — summons `goblin-thrower` — low HP, low `aggro`, moderate `attack` (all scaled off the Summoner's own stats, 1.7.2). Each of its own turns it rolls between Rock Throw (ranged `damage`, singleEnemy) and a basic attack, weighted as in the table in 1.3.9.1. Vanishes after its `maxActions` actions.
- `summon-spirit` — summons `healer-spirit` — low HP/`aggro`. Each turn: by default heals the party character with the lowest %HP (never itself or another minion); it sometimes instead casts a party-wide heal (`allAllies`, characters only) that turn, weighted as in the table in 1.3.9.1. Vanishes after its `maxActions` actions.
- `summon-golem` — summons `stone-golem` — high HP, moderate `attack`, **high `aggro`**. Each turn: Stomp (`damage`, allEnemies) or a basic attack, weighted as in the table in 1.3.9.1. Vanishes after its `maxActions` actions. **On cast, also deals `damage` directly to the chosen enemy**
- `totem-recall` — Plants a passive totem (`recall-totem` — never acts, only leaves combat by actually dying; 1.3.9.2's `SummonArchetype.passive`) and applies an `attack` buff to every ally except summons, lasting **until the totem dies**, not a fixed duration — see 1.3.9.2 for the mechanism.
- `command` — `commandSummons` only: the player picks one of the Summoner's minions, then one of its signature skills, and the Summoner casts that skill as its own, off its magic power, at the rank's `powerPercent`; the minion gives up its own turn that round to the order, spends one of its `maxActions` and leaves if that was its last; a stunned minion can't take an order, and one stunned before the order lands cancels it; either way, or when the minion is killed first, the order costs no MP or cooldown. The Recall Totem takes no turns and can't be commanded (section 1.3.13)
- `summon-hellfire-imp` — summons `hellfire-imp` — moderate HP, high `attack`, low `aggro`; every attack it lands (basic or skill) has a chance to `applyStatusEffect "burning"`. Each turn: Hellfire Strike (high single-target `damage` + status `agony` = DoT + `attack` debuff) or a basic attack, weighted as in the table in 1.3.9.1. Vanishes after its `maxActions` actions. **On cast, also deals `damage` to allEnemies directly** — **always hits** (isUltimate), effectiveness scales down with fear via the ultimate formula

- Default cap (before the Bound Legion passive reaches its second rank, see §1.5): **1 minion** active at a time — casting a new summon skill dismisses whichever minion is currently active. Each later rank of the passive raises the cap (`maxActiveMinions` in the passive table in §1.5), for minions of **different types** simultaneously. Purely level-gated (the unlock levels are in that table), independent of anything being cast, with no separate "cast the buff to raise the cap" step (see §1.5 for the Bound Legion passive).
- All 4 summon skills (slots 1, 2, 3, 6) cost a large amount of MP.

<!-- docs:begin statusEffects ids=skittish,spirit-bound,stone-skin,hellfire-kindled -->
*Generated from `data/status-effects.json` by `bun run docs:sync`. Do not edit.*

| id | Name | Mechanics |
|---|---|---|
| `skittish` | Skittish | speed +3 |
| `spirit-bound` | Spirit-Bound | maxHp +15 |
| `stone-skin` | Stone Skin | defense +8 |
| `hellfire-kindled` | Hellfire-Kindled | magicPower +10 |
<!-- docs:end -->
- Every minion's stats scale off the Summoner's own stats at the moment of casting, without the Summoner's active status deltas (1.7.2) — a minion does not grow further as the Summoner grows mid-combat.
- Slot 6 is Summoner's only `isUltimate: true` skill, satisfying the "every class has exactly 1 ultimate in slot 6" rule (Design notes, below) even though its main payload (Summon Hellfire Imp) is also a minion-summon skill like slots 1-3 — the AoE `damage` component is what makes it a proper ultimate.

#### 1.3.9.1 Minion stats and their own signature-skill scale

Each minion's cast configuration (`SummonCast`: `skillId`, `archetypeId`, `maxActions`, `aggro`, and a `stat` formula per `maxHp`/`attack`/`defense`/`magicPower`) lives in `data/summons.json`'s `casts` array, not inline in `data/classes.json` — the summoning skill's `SkillEffect` just carries a `summonCastId` pointing at it; the cast's `skillId` names the skill whose rank it follows, so the cast and skill ids are independent. 1 cast profile is shared across all 3 of the skill's ranks; `SummonStatFormula.percent` is a plain number when it's the same at every rank, or a `[rank1, rank2, rank3]` tuple when it isn't (the engine resolves which rank is active from the caster's level via `effectiveSkillRank`). Each formula computes as `base + (percent / 100) * owner[sourceStat]` (`percent` = the fraction of the named owner stat, `base` = a flat add, `sourceStat` = which of the Summoner's own stats it reads — normally the same-named stat, but can cross over). The tables below are generated from `data/summons.json`.

<!-- docs:begin minions -->
*Generated from `data/summons.json` by `bun run docs:sync`. Do not edit.*

| Cast | Minion | Speed | Actions | Aggro | Max HP | Defense | Attack | Magic power | Action weights |
|---|---|---|---|---|---|---|---|---|---|
| `shadow-clone` | Shadow Clone | 1 | 2 | 20 | 20 | 60% owner defense + 5 | 0 | 0 | basicAttack 1 |
| `summon-goblin` | Goblin Thrower | 12 | 3 | 5 | 30% owner maxHp + 25 | 80% owner defense + 2 | 60 / 80 / 100% owner magicPower + 5 | 0 | rock-throw 40, basicAttack 60 |
| `summon-spirit` | Healer Spirit | 10 | 3 | 5 | 50% owner maxHp + 20 | 70% owner defense + 2 | 0 | 60 / 70 / 80% owner magicPower + 6 | spirit-heal-single 60, spirit-heal-party 40 |
| `summon-golem` | Stone Golem | 6 | 3 | 15 | 110% owner maxHp + 30 | 80% owner defense + 8 | 70 / 80 / 90% owner magicPower + 15 | 0 | stomp 40, basicAttack 60 |
| `summon-hellfire-imp` | Hellfire Imp | 16 | 3 | 5 | 80% owner maxHp + 19 | 80% owner defense + 8 | 0 | 80 / 90 / 110% owner magicPower + 21 | hellfire-strike 40, basicAttack 60 |
| `totem-recall` | Recall Totem | 1 | 1 | 10 | 50% owner maxHp + 20 | 0 | 0 | 0 | — |
<!-- docs:end -->

The minions' own skills:

<!-- docs:begin minionSkills -->
*Generated from `data/summons.json` by `bun run docs:sync`. Do not edit.*

| Skill id | Name | Target | Effects | Used by |
|---|---|---|---|---|
| `rock-throw` | Rock Throw | singleEnemy | damage 8 + 110% ATK | Goblin Thrower |
| `stomp` | Stomp | allEnemies | damage 10 + 90% ATK | Stone Golem |
| `hellfire-strike` | Hellfire Strike | singleEnemy | damage 10 + 130% MAG; status agony (3 turns, 60% chance) | Hellfire Imp |
| `spirit-heal-single` | Spirit Heal | singleAlly | heal 6 + 100% MAG | Healer Spirit |
| `spirit-heal-party` | Spirit Blessing | allAllies | heal 4 + 80% MAG | Healer Spirit |
<!-- docs:end -->

*Every minion's basic attack (the rest of its action-weight roll) uses the same `attack`/`magicPower` value above with `amount: 0`, the same "100% base, no bonus" shape as every character's own basic attack (section 1.2).*

**The `attack`/`magicPower` percent grows with the rank of the summon skill that called the minion out** (`summon-goblin`, etc.), the same 3-rank mechanism used by every other class-specific skill (section 1.4) — e.g. `goblin-thrower`'s `attack` (derived from the Summoner's own `magicPower`) uses a higher percent at rank 2/3 than rank 1. This is **not** a per-action-within-combat progression (the minion doesn't get stronger across its own 3 turns before vanishing) — it only changes across combats/levels, as the summon skill itself ranks up.

**`hellfire-imp`'s signature-skill flat term reads the same regardless of stat**: `SkillEffect.amount` (the flat term) is stat-agnostic in the damage formula (`finalDamage = amount + mitigatedOffense(offensiveStat * offenseMultiplier, ...)`), so its flat term applies the same whether the skill's `isMagic` flag routes through `attack` or `magicPower`.

**`goblin-thrower` and `stone-golem` have their `attack` formula read off the Summoner's own `magicPower`** (their own `magicPower` stays `0`, since neither uses magic damage itself) — the class is magic-leaning (`baseMagicPower` well above `baseAttack`), so a physically-attacking minion's power is funded by the Summoner's magic investment rather than its near-nonexistent own attack. Set via `sourceStat: "magicPower"` on the cast profile's `attack` formula — on `goblin-thrower`/`stone-golem` only; every other minion (and Ninja's clone) keeps `sourceStat: "attack"`.

**Healer Spirit's "default heal / occasional party heal" is 2 separate signature skills** (`spirit-heal-single` targeting the lowest-%HP ally, `spirit-heal-party` targeting `allAllies`), chosen via the archetype's `actionWeights` — the same weighted-random-pick mechanism a minion already uses to choose between its signature skill and a basic attack.

#### 1.3.9.2 Totem Recall — an ally buff that lasts while the totem lives

**The `minPercent`-override mechanic**: a status normally applies its own fixed, JSON-declared `modifyCombatStat` magnitude — but Totem Recall (1.3.9, slot 4) needs **1 status id** to express **3 different magnitudes** (1 per skill rank) without 3 near-duplicate status ids (the same reasoning that keeps `guard`/`rallied` as 1 status each with rank variants only where the shape genuinely needs a distinct `tickCategory`, section 1.4). An `applyStatusEffect` `SkillEffect` may carry `amount`/`minPercent` directly (the same `SkillEffect` fields other effect kinds use) to **override** the target status's own declared magnitude for that one application — `totems-strength`'s own JSON entry carries a placeholder magnitude that is never used unmodified; the real numbers live on Totem Recall's own rank effects in `data/classes.json`. Mage's and Viking's passives are the *other* shape this same problem can take — instead of 1 status id with an overridden magnitude, each names a genuinely different status id per rank (`onHitStatusEffectId` for Mage, `thresholdStatusEffectId` for Viking: `bloodrage` / `-ii` / `-iii`), matching Rogue's Poison Bomb, so the magnitude lives only on the status; the override mechanic here is for a case that doesn't otherwise need a distinct status identity per rank.

**Lasting until the totem dies** (1.3.9, slot 4): `ActiveStatusEffect.linkedSummonId` ties a status's expiry to a specific summon's lifetime rather than a turn countdown. Set via `SkillEffect.linksToCasterSummon` on the `applyStatusEffect` effect — combat.ts's `applySkillEffects` resolves a cast's `summon` override effect first (in array order) and threads the newly-spawned summon's id into any later effect in the same cast that asks for it. The buff itself still carries a long fixed `durationTurns` (effectively permanent for the fight) so the normal per-turn countdown never expires it first — in practice the totem dying is what ends it. Both places a summon can leave combat (`dismissSummon`, `expireSummonIfDone`) sweep every party member for a status with a matching `linkedSummonId` and force-expire it (`expireLinkedAllyBuffs`). `SkillEffect.excludesSummonTargets` keeps the buff off the caster's own totem (and any other minions) when resolving an `allAllies` target — without it, the totem would receive its own buff the instant it's summoned, since summons are ordinary allies for most targeting purposes.

**`SummonArchetype.passive`** (`src/types.ts`): a summon archetype with `passive: true` never takes a turn at all — no skill roll, no basic-attack fallback, and its `actionsTaken` never increments (so it can't expire by running out of actions either). Used by the totem (`recall-totem`) so its lifetime depends only on actually dying in combat, matching its "until something breaks it" description. Every other summon archetype (Ninja's clone, all 4 Summoner minions) picks between its signature skill and a basic attack via `actionWeights`.

### 1.3.10 Jester — debuffs, speed, and damage left to chance

**Base stats (`data/classes.json`)**: see the class stats table in section 1.1 — fast, light on defense, attack and magic power even, growing evenly until the passive tilts them.

Basic attack (slot 0): **Knife Flick** (`knife-flick`), physical, sub-100% offense (thrown — see the footnote under section 1.2).

<!-- docs:begin classSkills class=jester -->
*Generated from `data/classes.json` by `bun run docs:sync`. Do not edit.*

| Slot | Skill id | Name | Target | Cooldown | MP cost (R1/R2/R3) | Unlock level (R1/R2/R3) | Effects (R1/R2/R3) | Flags |
|---|---|---|---|---|---|---|---|---|
| 1 | `loaded-dice` | Loaded Dice | singleEnemy | — | 5 / 6 / 7 | 1 / 7 / 15 | damage 10 / 13 / 16 + 100 / 108 / 116% ATK (die faces 30%/60%/90%/120%/150%/180%); +1 dice | — |
| 2 | `jeer` | Jeer | singleEnemy | — | 5 / 6 / 7 | 1 / 7 / 15 | status weakened (2 turns); status provoked (1 turn, 75 / 80 / 85% chance); status confused (2 turns, 40 / 50 / 65% chance); +1 dice | — |
| 3 | `battle-ballad` | Battle Ballad | allAllies | 2 | 10 / 11 / 12 | 10 / 25 / 45 | status ballad / ballad-ii / ballad-iii (1 turn, not on the caster, not on summons); the rest of the party +10 speed for turn order this round | buff |
| 4 | `rigged-game` | Rigged Game | allEnemies | 3 | 12 / 13 / 14 | 15 / 40 / 65 | damage 12 / 15 / 20 + 75 / 85 / 100% MAG (magic); status confused (2 turns, 65 / 75 / 85% chance); +1 dice | magic |
| 5 | `double-or-nothing` | Double or Nothing | singleEnemy | 3 | 12 / 13 / 14 | 25 / 50 / 75 | damage 20 / 30 / 40 + 160 / 175 / 190% ATK; coin flip: 50% to resolve, on a loss no damage, status slowed on the caster (2 turns), status rigged on the caster (1 turns), cooldown reset; +2 dice | — |
| 6 | `finale` | Finale | allEnemies | 5 | 16 / 17 / 18 | 35 / 70 / 100 | every die in hand: 10 / 12 / 15 + 40 / 50 / 60% ATK each (die faces 50%/75%/100%/125%/150%/175%, alternatesWithMagic true) | ultimate |
<!-- docs:end -->

How each skill works:

- `loaded-dice` — `damage` whose offense multiplier is scaled by one of six die faces (`damageRollFaces`); adds 1 die to the hand
- `jeer` — no damage: a guaranteed `applyStatusEffect "weakened"` + chance to `applyStatusEffect "provoked"` for 1 turn, which turns every single-target attack of the target on the Jester; adds 1 die
- `battle-ballad` — `applyStatusEffect "ballad"` (rank variants `-ii`/`-iii`: attack and magic power for this round) on the rest of the party (`excludesCaster`), who also act ahead of their usual place this round (`allyTurnOrderBonus`)
- `rigged-game` — `damage`/enemy + chance to `applyStatusEffect "confused"` for 2 turns, which sends part of the target's attacks to its own side; adds 1 die
- `double-or-nothing` — heavy `damage` behind a `coinFlip`: a lost flip deals nothing, puts `slowed` and `rigged` (the next flip's win chance doubled) on the Jester and leaves the skill ready again; adds 2 dice either way
- `finale` — `throwDice`: every die in hand bursts on a random enemy, each rolling one of the effect's faces to scale its damage, physical and magic by turns (`alternatesWithMagic`) — **always hits** (isUltimate), effectiveness scales down with fear via the ultimate formula

The Jester's mechanics, all read from `data/*.json`:

- **The dice hand** — `CharacterClass.dice` `{ startCount, maxCount, maxPerTarget }`. The Jester starts every fight with `startCount` dice (`Character.dice`, cleared when the fight ends); a skill's `grantsDice` adds to the hand once it is cast, up to `maxCount`. The party panel shows the hand beside fear. Engine hooks: `startCombat`, `addDice`, `clearCombatResources`, `src/engine/combat.ts`.
- **`throwDice`** (a `SkillEffect` kind) — the whole hand is thrown; each die goes to a random enemy that has taken fewer than `maxPerTarget` this cast and rolls one of `damageRollFaces` to scale the effect's `amount` + `offenseMultiplierPercent`; with `alternatesWithMagic`, every second die scales off magic power instead of attack. Dice no enemy can take are lost with the rest. Engine hook: `throwDice`, `src/engine/combat.ts`.
- **`SkillEffect.damageRollFaces`** — on a `damage` effect, one face is rolled per target and multiplies the offense multiplier.
- **`SkillDefinition.coinFlip`** `{ winChance, loseSelfStatuses?, resetCooldownOnLose? }` — one roll per cast, at `winChance` times every `coinFlipWinChanceMultiplier` status on the caster (at most 1). A loss skips every `damage` effect, applies `loseSelfStatuses` to the caster and, with `resetCooldownOnLose`, clears the skill's cooldown.
- **`SkillDefinition.allyTurnOrderBonus`** — while the skill is queued, every other character adds it to its speed when this round's turn order is built (`turnOrderSortKey`). **`SkillEffect.excludesCaster`** leaves the caster out of an effect its own target includes.
- **`StatusEffectDefinition.forcesTargetOnSource`** (`provoked`) — the bearer's single-target attacks go to whoever applied the status (`ActiveStatusEffect.sourceId`) while that one can be targeted. **`StatusEffectDefinition.redirectToAlliesChance`** (`confused`) — each attack the bearer makes may go to every other monster (an area attack) or as many random ones as it had targets; a monster alone hits itself. A boss's telegraph picks its target when it is released, so `provoked` pulls it like any other single-target attack; it is never turned by `confused`. Engine hooks: `provokedBy`, `confusedTargets`, `src/engine/monsterAI.ts`.

Rigged Game is the kit's magic skill (`isMagic`, `damageType: "magic"`), Loaded Dice and Double or Nothing are physical, and Finale's `alternatesWithMagic` makes every second die scale off magic power — 12 dice are 6 physical and 6 magic, landing on random enemies. Which stat is stronger this round is the passive's call (section 1.5).

<!-- docs:begin statusEffects ids=ballad,ballad-ii,ballad-iii,provoked,confused,rigged -->
*Generated from `data/status-effects.json` by `bun run docs:sync`. Do not edit.*

| id | Name | Mechanics |
|---|---|---|
| `ballad` | Ballad | attack +6 (min 7.5%); magicPower +6 (min 7.5%) |
| `ballad-ii` | Ballad | attack +8 (min 10%); magicPower +8 (min 10%); rankOf ballad; rankLevel 2 |
| `ballad-iii` | Ballad | attack +10 (min 12.5%); magicPower +10 (min 12.5%); rankOf ballad; rankLevel 3 |
| `provoked` | Provoked | harmful; forcesTargetOnSource |
| `confused` | Confused | harmful; redirectToAlliesChance 0.55 |
| `rigged` | Rigged | coinFlipWinChanceMultiplier 2 |
<!-- docs:end -->

### 1.3.11 Paladin — tank and healer, holy damage

**Base stats (`data/classes.json`)**: see the class stats table in section 1.1 — high HP and defense, the slowest class, a little magic power.

Basic attack (slot 0): **Mace Strike** (`mace-strike`), physical, full offense.

<!-- docs:begin classSkills class=paladin -->
*Generated from `data/classes.json` by `bun run docs:sync`. Do not edit.*

| Slot | Skill id | Name | Target | Cooldown | MP cost (R1/R2/R3) | Unlock level (R1/R2/R3) | Effects (R1/R2/R3) | Flags |
|---|---|---|---|---|---|---|---|---|
| 1 | `lay-on-hands` | Lay on Hands | singleAlly | — | 5 / 6 / 8 | 1 / 7 / 15 | heal 10 / 12 / 15 (+10% of the caster's max HP / +11% of the caster's max HP / +12% of the caster's max HP, up to +40% as the target's HP falls to 20%) | — |
| 2 | `defiance` | Defiance | self | 3 | 6 / 8 / 8 | 1 / 7 / 15 | status challenge (2 turns); status defiance / defiance-ii / defiance-iii (2 turns); status enfeebled (2 turns) | buff |
| 3 | `cross-slash` | Cross Slash | singleEnemy | 2 | 9 / 10 / 11 | 10 / 25 / 45 | damage 7 / 10 / 14 + 60 / 65 / 70% ATK+MAG (holy); damage 6 / 8 / 10 + 50 / 55 / 60% ATK+MAG (holy); status condemned / condemned-ii / condemned-iii (3 turns) | — |
| 4 | `guardian-angel` | Guardian Angel | singleAlly | 5 | 12 / 13 / 14 | 15 / 40 / 65 | status guardian-angel / guardian-angel-ii / guardian-angel-iii (1 turn); not on the caster | buff |
| 5 | `vigil` | Vigil | allAlliesAndEnemies | 4 | 15 / 16 / 17 | 25 / 50 / 75 | heal 10 / 12 / 15 (on allies, +3% of the caster's max HP / +3.5% of the caster's max HP / +4% of the caster's max HP, up to +40% as the target's HP falls to 20%); damage 8 / 12 / 16 + 60 / 70 / 80% MAG (on enemies, holy); status searing-light (2 turns, on enemies, repeats on each channel pulse); status vigil-light (3 turns, on allies, not on summons); status vigil-channel (2 turns, target self); cannot miss or be dodged | magic |
| 6 | `martyrs-oath` | Martyr's Oath | allAllies | 5 | 16 / 17 / 18 | 35 / 70 / 100 | status martyrs-grace / martyrs-grace-ii / martyrs-grace-iii (1 turn) | buff · ultimate |
<!-- docs:end -->

How each skill works:

- `lay-on-hands` — `heal` of a flat amount plus `casterMaxHpPercent` of the Paladin's max HP, raised by `lowHpHealBonus` the lower the recipient's HP (nothing at full HP, the full bonus at its threshold and below)
- `defiance` — `challenge` + `defiance` (rank variants `-ii`/`-iii`) on the Paladin for 2 turns, and `enfeebled` on the Paladin itself: a monster whose direct hit lands on the Paladin gets every status in `debuffsAttackerOnHit.statusEffectIds` — `weakened`, plus `enfeebled` from rank 2 and `slowed` at rank 3
- `cross-slash` — two `damage` hits (`holy`) behind one accuracy roll, each scaling with the Paladin's attack plus magic power (`scalesWithAttackAndMagic`), then `condemned` (rank variants `-ii`/`-iii`) for 3 turns: its `weakPercent` adds to the target's race weakness to `holy`, the same way a trait's does, under the same 100% cap (`raceMultiplierFor`, `src/engine/resolver.ts`). The cuts that apply it don't benefit from it
- `guardian-angel` — `guardian-angel` (rank variants `-ii`/`-iii`) on another ally for the round (`targetsOtherAlliesOnly`): should the ally fall while it lasts, from any source, it rises at the status's `reviveHpPercent` of max HP and the status is spent
- `vigil` — a zone: allies `heal` (a flat amount plus `casterMaxHpPercent` of the Paladin's max HP, raised by `lowHpHealBonus` like Lay on Hands) and get `vigil-light` (`fearResistPercent`); enemies take `holy` magic `damage` that cannot miss or be dodged (`alwaysHits`) and a stack of `searing-light` (a defense debuff, up to 3 stacks). The Paladin gets `vigil-channel` (`channelSkillId`): on each of its next turns it repeats the skill's heal, damage and `repeatsOnChannelPulse` effects instead of acting, so the zone pulses three times in all and `searing-light` reaches 3 stacks
- `martyrs-oath` — `martyrs-grace` (rank variants `-ii`/`-iii`) on the party for the round: each direct hit an ally survives heals back the status's `healOnHitPercent` of the HP it took; a killing hit heals nothing (isUltimate)

**Channeling.** A character carrying a `channelSkillId` status needs no order: each round the command screen asks once — `[1] Hold` keeps it channeling (`holdChannel`), `[2] Break` ends the channel at once, takes the channeled skill's statuses off the party (`breakChannel`) and lets the character choose an action. Left alone, a channel holds; the engine counts a channeling character as ready (`allLivingCharactersHaveQueuedActions`) and runs the pulse on its turn (`runChannelPulse`, `src/engine/combat.ts`). A stunned channeler loses the pulse but not the channel's countdown. `vigil-channel` and `vigil-light` end with the fight (`endsWithCombat`). A status with `endsWithChannel` (`searing-light`) remembers who applied it and comes off every bearer at the end of the round in which that caster stopped channeling or fell, or at once when the channel is broken (`endChannelBoundStatuses`, `src/engine/combat.ts`).

<!-- docs:begin statusEffects ids=defiance,defiance-ii,defiance-iii,condemned,condemned-ii,condemned-iii,guardian-angel,guardian-angel-ii,guardian-angel-iii,vigil-channel,vigil-light,searing-light,martyrs-grace,martyrs-grace-ii,martyrs-grace-iii -->
*Generated from `data/status-effects.json` by `bun run docs:sync`. Do not edit.*

| id | Name | Mechanics |
|---|---|---|
| `defiance` | Defiance | tickCategory statMod; debuffsAttackerOnHit statusEffectIds weakened, durationTurns 2 |
| `defiance-ii` | Defiance | tickCategory statMod; debuffsAttackerOnHit statusEffectIds weakened / enfeebled, durationTurns 2; rankOf defiance; rankLevel 2 |
| `defiance-iii` | Defiance | tickCategory statMod; debuffsAttackerOnHit statusEffectIds weakened / enfeebled / slowed, durationTurns 2; rankOf defiance; rankLevel 3 |
| `condemned` | Condemned | tickCategory statMod; harmful; weakPercent holy 20 |
| `condemned-ii` | Condemned | tickCategory statMod; harmful; weakPercent holy 25; rankOf condemned; rankLevel 2 |
| `condemned-iii` | Condemned | tickCategory statMod; harmful; weakPercent holy 30; rankOf condemned; rankLevel 3 |
| `guardian-angel` | Guardian Angel | tickCategory statMod; reviveHpPercent 30 |
| `guardian-angel-ii` | Guardian Angel | tickCategory statMod; reviveHpPercent 40; rankOf guardian-angel; rankLevel 2 |
| `guardian-angel-iii` | Guardian Angel | tickCategory statMod; reviveHpPercent 50; rankOf guardian-angel; rankLevel 3 |
| `vigil-channel` | Vigil | channelSkillId vigil; endsWithCombat |
| `vigil-light` | Vigil's Light | fearResistPercent 80; endsWithCombat |
| `searing-light` | Searing Light | defense -3 (min -5%); stackable; maxStacks 3; endsWithChannel |
| `martyrs-grace` | Martyr's Grace | tickCategory statMod; healOnHitPercent 90 |
| `martyrs-grace-ii` | Martyr's Grace | tickCategory statMod; healOnHitPercent 110; rankOf martyrs-grace; rankLevel 2 |
| `martyrs-grace-iii` | Martyr's Grace | tickCategory statMod; healOnHitPercent 130; rankOf martyrs-grace; rankLevel 3 |
<!-- docs:end -->

### 1.3.12 Warlock — curses, damage over time, and silence

**Base stats (`data/classes.json`)**: see the class stats table in section 1.1 — magic power and MP, fragile.

Basic attack (slot 0): **Eldritch Bolt** (`eldritch-bolt`), `isMagic: true` + `damageType: "magic"`, reduced offense like the other magic basics (see the footnote under section 1.2).

<!-- docs:begin classSkills class=warlock -->
*Generated from `data/classes.json` by `bun run docs:sync`. Do not edit.*

| Slot | Skill id | Name | Target | Cooldown | MP cost (R1/R2/R3) | Unlock level (R1/R2/R3) | Effects (R1/R2/R3) | Flags |
|---|---|---|---|---|---|---|---|---|
| 1 | `hex` | Hex | singleEnemy | — | 5 / 6 / 7 | 1 / 7 / 15 | damage 6 / 8 / 10 + 60 / 66 / 72% MAG (magic); status hexed (3 turns) | magic |
| 2 | `blood-pact` | Blood Pact | singleAlly | 4 | 4 / 5 / 6 | 1 / 7 / 15 | status pact / pact-ii / pact-iii (3 turns); restoreMp 10 / 18 / 28; HP cost 10% max HP at full health, down to 3% below 20% | buff |
| 3 | `bind-tongue` | Bind Tongue | singleEnemy | 4 | 10 / 11 / 12 | 10 / 25 / 45 | damage 6 / 8 / 10 + 50 / 55 / 60% MAG (magic); status silenced (2 turns); status hexed (3 turns, 80% chance) | magic |
| 4 | `soul-rend` | Soul Rend | singleEnemy | 3 | 13 / 14 / 15 | 15 / 40 / 65 | damage 12 / 16 / 20 + 90 / 100 / 115% MAG (magic, +12% per hexed stack / +15% per hexed stack / +18% per hexed stack, 40% lifesteal, the rest of the party heals 33% of the lifesteal); remove hexed (1 stack) | magic |
| 5 | `withering-curse` | Withering Curse | allEnemies | 3 | 14 / 15 / 16 | 25 / 50 / 75 | damage 10 / 15 / 20 + 60 / 70 / 80% MAG (magic); status hexed (3 turns, 1–2 stacks); status enfeebled (2 turns, 40 / 50 / 60% chance) | magic |
| 6 | `doom` | Doom | singleEnemy | 5 | 20 / 21 / 22 | 35 / 70 / 100 | damage 40 / 50 / 60 + 120 / 135 / 160% MAG (magic); status hexed (3 turns, 4 stacks, each stack past the cap strikes another enemy for 20 + 70% MAG, at most 2× each / each stack past the cap strikes another enemy for 25 + 75% MAG, at most 2× each / each stack past the cap strikes another enemy for 30 + 80% MAG, at most 2× each) | ultimate · magic |
<!-- docs:end -->

How each skill works:

- `hex` — light `damage` + a guaranteed `applyStatusEffect "hexed"`: a stackable magic DoT that also lowers attack, up to 4 stacks; each new stack renews the whole stack's duration
- `blood-pact` — `applyStatusEffect "pact"` (a magic power buff, rank variants `-ii`/`-iii`) + `restoreMp` that returns more MP than the cast cost, on one ally of the player's choice (the Warlock included). The Warlock pays for it with HP as well as MP, whoever receives it (`hpCost`: a share of the Warlock's max HP that shrinks as its HP falls, never below 1 HP left)
- `bind-tongue` — light `damage` + a guaranteed `applyStatusEffect "silenced"` + a chance of `hexed`
- `soul-rend` — `damage` that grows per `hexed` stack on the target (`scalesWithStatusStacks`, section 1.7.4) and heals the Warlock for part of it (`lifestealPercent`); every other living party member heals `lifestealPartySharePercent` of that lifesteal, counted before the Warlock's own missing-HP cap (`shareLifesteal`, `src/engine/combat.ts`), then takes 1 `hexed` stack off (`removeStatusEffect` with `stacks`)
- `withering-curse` — `damage`/enemy + 1-2 `hexed` stacks on each (`stackCount`) + a chance of `enfeebled`
- `doom` — heavy single-target `damage` + 4 `hexed` stacks; each stack past the cap strikes another random enemy instead (`overflowDamage`, at most twice each, lost when the target stands alone) — **always hits** (isUltimate)

**Stacks.** `SkillEffect.stackCount` makes one `applyStatusEffect` add several stacks; `overflowDamage` turns the ones past the status's `maxStacks` into strikes on other enemies (`applyStacks`, `src/engine/combat.ts`). `removeStatusEffect` with `stacks` takes that many off and undoes the matching share of the stat change they applied (`removeStatusStacks`, `src/engine/resolver.ts`). `SkillDefinition.hpCost` is paid with the MP when the skill executes (`payHpCost`).

**Silence.** `StatusEffectDefinition.silences` locks every skill a monster would choose: a silenced monster uses its basic attack. A boss or elite still crosses into a new phase (and fires its phase-entry skill). A boss with a full telegraph meter cannot release while silenced: it only basic-attacks, the meter stays full, and it releases on its next turn without silence. `StatusEffectDefinition.eliteBossMaxTurns` caps any application of the status on an elite or boss, whatever duration the skill asks for — `silenced` lasts at most 1 turn on them. Engine hooks: `takeMonsterTurn`, `src/engine/monsterAI.ts`; `applyStatusEffectToActor`, `src/engine/resolver.ts`.

<!-- docs:begin statusEffects ids=hexed,pact,pact-ii,pact-iii,silenced -->
*Generated from `data/status-effects.json` by `bun run docs:sync`. Do not edit.*

| id | Name | Mechanics |
|---|---|---|
| `hexed` | Hexed | damage 4 or 1.5% max HP per turn; attack -3 (min -4%); stackable; maxStacks 4; perStackBonusPercent 100 |
| `pact` | Pact | magicPower +6 (min 20%) |
| `pact-ii` | Pact | magicPower +9 (min 30%); rankOf pact; rankLevel 2 |
| `pact-iii` | Pact | magicPower +12 (min 40%); rankOf pact; rankLevel 3 |
| `silenced` | Silenced | harmful; silences; eliteBossMaxTurns 1 |
<!-- docs:end -->

### 1.3.13 Slot 5 — the fifth class skill

Every class has a fifth class skill in slot 5, between its slot-4 skill and its ultimate (slot 6). Slot 5 unlocks each of its ranks between slot 4's and the ultimate's (the Unlock level column of each class table). Each skill's row is in its class's table above (sections 1.3.1-1.3.12).

| Class | Slot 5 | What it does |
|---|---|---|
| Knight | Engage | Strikes one foe, taunts for a turn, and answers the first two monster hits on whoever landed them |
| Mage | Frost Lance | A heavy ice hit that chills; a second chill freezes the target solid |
| Rogue | Venom Brand | A light cut that always leaves the target weak to poison |
| Acolyte | Sanctuary | A heal over time and a fear resist on the whole party; the Acolyte's basic attack turns holy for 2 turns |
| Viking | Desperate Cleave | A heavy hit that gains offense and lifesteal while the Viking is below half HP, and ignores part of the defense while Storm-Empowered |
| Plague Doctor | Volatile Flask | Bursts 2-6 times on every enemy, each burst harder per debuff on it |
| Archer | Piercing Arrow | A hit that ignores part of the target's defense, with a crit chance |
| Ninja | Barbed Net | Light damage on every enemy, a chance to stagger, and a net that bleeds them as they act |
| Summoner | Command | Casts one minion's skill as the Summoner's own, off its magic power |
| Jester | Double or Nothing | A heavy hit behind a coin flip; a lost flip slows the Jester and loads the next flip |
| Paladin | Vigil | A channeled zone that heals allies and sears enemies each turn it holds |
| Warlock | Withering Curse | Damage and 1-2 `hexed` stacks on every enemy, with a chance to enfeeble |

The mechanics these skills needed, all read from `data/*.json` (`src/types.ts`; the Jester's, Paladin's and Warlock's are in their own sections):

- **`StatusEffectDefinition.counterAttack`** `{ maxCounters, amount, offenseMultiplierPercent, target? }` (Engage's `engaged`/`-ii`/`-iii`). When a monster's direct hit lands on the bearer — a basic attack or a skill — the bearer strikes back, no accuracy roll: `target: "attacker"` hits only the monster that landed the blow (spending no counter if it is dead or untargetable), absent or `"allEnemies"` hits every targetable enemy. The count lives on the active status (`ActiveStatusEffect.countersStruck`); the counter that reaches `maxCounters` ends the status on the spot. The counter is the bearer's own session in the log. Engine hook: `triggerCounterAttack`, `src/engine/combat.ts`, called from `applySkillEffects` and the monster basic attack (`src/engine/monsterAI.ts`).
- **`StatusEffectDefinition.fearResistPercent`** (Sanctuary's `steadfast`). Every fear gain on the bearer is cut by it, combined multiplicatively with its `fearResist` from Artifacts and Ability. Engine hook: `resistedFearGain`, `src/engine/survival.ts`.
- **`SkillDefinition.casterHpBelowBonus`** `{ hpPercentThreshold, offenseMultiplierPercentBonus, lifestealPercent? }` (Desperate Cleave). Checked once when the skill resolves: below the threshold, every `damage` effect gains the offense bonus and the lifesteal. Engine hook: `applySkillEffects`.
- **`SkillEffect.scalesWithDebuffCount`** `{ percentPerDebuff }` (Volatile Flask). Each harmful status on the target when the hit lands adds to the offense multiplier, a stackable status counting once (`harmfulStatusCount`). With `hitCountRange`, every strike re-counts. Engine hook: the `"damage"` case of `resolveSkillEffect`, `src/engine/resolver.ts`.
- **`StatusEffectDefinition.onActStatus`** `{ statusEffectId, chance, durationTurns }` (Barbed Net's `netted`). Each time the bearer acts — not when stunned or interrupted — it rolls to put the status on itself. Engine hook: `applyOnActStatuses`, `src/engine/combat.ts`, at the top of a monster's, character's or summon's turn.
- **`commandSummons`** (a `SkillEffect` kind, Command) with **`SkillEffect.powerPercent`**. A Command is queued with an order — `ActionSource.command` `{ summonId, skillId }`, through `queueCommand` (plain `queueAction` refuses it) — naming one of the caster's minions that takes turns (`commandableSummons`: not passive, with a signature skill, still in the fight, not stunned) and one of that minion's `signatureSkillIds`. On the caster's turn it resolves as that skill cast by the caster (`commandedSkill`): the Command's MP cost and cooldown, the minion skill's target and effects, every `damage` and `heal` amount and offense multiplier at `powerPercent`, scaled off the caster's magic power. From the moment the order is queued the minion's turn that round belongs to it: whether the minion moves before or after the caster, it holds still (`runSummonTurn`), so the order always has an action to spend. The minion then spends that action and leaves if it has none left (`expireSummonIfDone`). A minion killed before the caster's turn wastes the order; a minion stunned at its own turn or at the caster's cancels it, since the stun takes the turn the order was owed. Neither costs MP, cooldown or one of the minion's actions. The command screen walks minion → skill → target (`pickCommandMinion`, `pickCommandSkill`, `src/ui/screens/combat.ts`).
- **`StatusEffectDefinition.onMaxStacks`** `{ statusEffectId, durationTurns }` (Frost Lance and Ice Age's `chilled`). The moment a stackable status reaches its `maxStacks`, every stack goes and the bearer gets the named status (`frozen`, a stun). Engine hook: `applyStatusEffectToActor`, `src/engine/resolver.ts`.
- **`StatusEffectDefinition.basicAttackOverride`** `{ name, amount, offenseMultiplierPercent, damageType?, isMagic? }` (Sanctuary's `cleansing-light`/`-ii`/`-iii`). While the bearer carries it, its slot-0 skill is that strike instead, in the skill list and in combat (`withBasicAttackOverride`, `src/engine/combat.ts`).
- **`SkillEffect.removesHarmfulDots`** (Mass Heal). A `removeStatusEffect` with it takes off every harmful damage-over-time status on the target. Engine hook: `removeStatusEffect`, `src/engine/resolver.ts`.

## 1.4 Skill Rank system — 3 ranks per skill, unlocked by character level

`SkillDefinition.ranks` exists in `data/classes.json` for every class-specific skill across all 12 classes.

### Concept

Each of the 72 class-specific skills (6 per class × 12 classes; the shared basic attack in slot 0 is excluded — it stays a single fixed version) has **3 ranks**. Rank 1 is unlocked at the skill's `unlockLevel` (section 1.3). Ranks 2 and 3 unlock automatically at higher character levels — no separate "learn"/"choose" action, consistent with the game's "leveling up just makes you stronger" design (`05-character-stats.md`: level-up fully restores HP/MP with no player choice involved).

**Rank-up does not change `cooldownTurns`** — cooldowns stay identical across every rank of a skill, to avoid disturbing combat pacing. Where a rank has more effect, `mpCost` is allowed to increase slightly to keep the mana economy proportional to the stronger output. Effect magnitudes (damage/heal/proc chance) are **hand-tuned per skill** for rank 2/3, matching the rule of assigning skill numbers "by hand based on power level, not a fixed formula" (see "Design notes" below) — there is no global "+X% per rank" formula applied uniformly.

### Rank-up level thresholds

Spread across the full level range; later-unlocking skills (higher slot) have a longer gap between ranks, and the last skill (slot 6, the class ultimate) reaches rank 3 exactly at the level cap. Slots 1 and 2 share the same thresholds (both unlock at the same starting level, treated as equally "starting kit"); every other slot uses its own thresholds derived from its unlock level. Every class uses the same per-slot thresholds. **Current thresholds**: `SkillRankDefinition.unlockLevel` per rank, `data/classes.json` — this document does not hand-maintain a copy of the table, since it drifts the moment ranks are retuned.

### Data model

`SkillDefinition` (`docs/technical-decisions.md` §4) has an optional field:

```
SkillDefinition {
  ...existing fields (id, name, mpCost, target, effects, slot, unlockLevel, cooldownTurns, isBuff?, isUltimate?, isMagic?)
  ranks?: SkillRankDefinition[]   // absent = the skill has no rank system (all monster skills, items)
}

SkillRankDefinition {
  rank: 1 | 2 | 3
  unlockLevel: number
  mpCost: number
  effects: SkillEffect[]
}
```

At cast time, the game resolves the character's current rank for a skill as the highest `rank` whose `unlockLevel <= Character.level`, then uses that rank entry's `mpCost`/`effects` instead of the skill's top-level `mpCost`/`effects` (which mirror rank 1). This is done via a lookup helper (`getEffectiveSkill(skill, characterLevel)`) used wherever a character's skill is cast or displayed (skill list UI, resolver).

### Knight — `guard`/`rallied` rank variants

The class-specific skills whose `modifyCombatStat` status scales with rank (Knight's Rally → `rallied`) use rank variants. `guard` has the same variants, kept for the monster skills that use it. Since `guard`/`rallied` are shared `StatusEffectDefinition`s with a fixed magnitude, scaling them per-rank uses rank-specific variants rather than mutating the shared status (so the base `guard`/`rallied` magnitude stays the same for any other skill/rank that reuses them). Shape (current magnitudes: `data/status-effects.json`):

```json
[
  { "id": "guard-ii", "name": "Guard II", "perTurnEffects": [{ "kind": "modifyCombatStat", "combatStat": "defense", "amount": "<see data/status-effects.json>" }] },
  { "id": "guard-iii", "name": "Guard III", "perTurnEffects": [{ "kind": "modifyCombatStat", "combatStat": "defense", "amount": "<see data/status-effects.json>" }] },
  { "id": "rallied-ii", "name": "Rallied II", "perTurnEffects": [{ "kind": "modifyCombatStat", "combatStat": "attack", "amount": "<see data/status-effects.json>" }] },
  { "id": "rallied-iii", "name": "Rallied III", "perTurnEffects": [{ "kind": "modifyCombatStat", "combatStat": "attack", "amount": "<see data/status-effects.json>" }] }
]
```

`taunt` and `poison-coated` are **not** given rank variants: `taunt`'s `targetPull` already claims a fixed share of every monster's pick at rank 1 on every `aiPattern` (the stronger pull is `challenge`, a status of its own), and `poison-coated` is a binary on-hit rider, not a magnitude stat. Against a boss, `taunt`, `challenge` and `provoked` act on a telegraph too: its target is only picked when it is released, so a pull applied any time before then decides who takes the blow.

### Poison Coat — rank-up adds a separate attack-buff status (Rogue)

**Poison Coat** (Rogue, slot 1) scales by applying a *second*, independent status alongside the base `poison-coated` at rank 2/3, rather than by growing `poison-coated` itself: `poison-coated` (the on-hit poison rider, `onHitStatusEffectId: "poisoned"`, no `perTurnEffects` of its own) is cast unchanged at every rank, and `poison-coat`'s rank 2/3 `effects` additionally apply `venom-edge`/`venom-edge-ii` — a pure `modifyCombatStat attack` status with no on-hit rider. They're two distinct status ids (not one combined `poison-coat-ii`/`poison-coat-iii` status) so each can be categorized cleanly by the turn-countdown system (`src/engine/resolver.ts`'s `statusCategory`): `poison-coated` has no per-turn effect and is "special" by shape, while `venom-edge` is a stat modifier and would be "statMod" by shape — but a stat-mod status ticks down unconditionally at round-end with no free round, while a "special" status doesn't tick until the bearer's own next turn, so left to shape-inference alone the two would drift out of sync despite always being cast together. `venom-edge`/`venom-edge-ii` instead set `"tickCategory": "special"` (a StatusEffectDefinition field that overrides the shape-inferred category) so both statuses always tick — and expire — on the same turn. `poison-coat`'s `applyStatusEffect` effects declare the same `durationTurns` at every rank, so the `cooldownTurns = durationTurns + 1` formula resolves to the same value at every rank — no conflict with the "cooldown never changes across ranks" rule. Shape (current magnitudes: `data/status-effects.json`):

```json
[
  { "id": "poison-coated", "name": "Poison-Coated", "onHitStatusEffectId": "poisoned", "perTurnEffects": [] },
  { "id": "venom-edge", "name": "Venom Edge", "tickCategory": "special", "perTurnEffects": [{ "kind": "modifyCombatStat", "combatStat": "attack", "amount": "<see data/status-effects.json>" }] },
  { "id": "venom-edge-ii", "name": "Venom Edge II", "tickCategory": "special", "perTurnEffects": [{ "kind": "modifyCombatStat", "combatStat": "attack", "amount": "<see data/status-effects.json>" }] }
]
```

`poison-coat`'s rank 2 `effects` apply `["poison-coated", "venom-edge"]`; rank 3 applies `["poison-coated", "venom-edge-ii"]`. The attack-bonus progression matches the step size used for `rallied-ii`/`rallied-iii` above, for consistency across all attack-buff statuses in this system. The on-hit poison rider itself (`poison-coated`'s `onHitStatusEffectId: "poisoned"`) is the same on every rank — rank-up only adds the attack buff, it does not touch the "poison level" applied on hit (that stays base `poisoned`, level 1, same as every other non-Poison-Bomb source per the note below).

### Poison Bomb — poison potency scales via leveled `poisoned` variants (exclusive to this skill)

Unlike Poison Coat, **Poison Bomb's rank-up does scale its poison** — this is the one skill in the whole system where the applied status itself gets stronger per rank, via 2 rank-exclusive variants of `poisoned`. Shape (current magnitudes: `data/status-effects.json`):

```json
[
  { "id": "poisoned-ii", "name": "Poisoned II", "perTurnEffects": [{ "kind": "damage", "amount": "<see data/status-effects.json>" }] },
  { "id": "poisoned-iii", "name": "Poisoned III", "perTurnEffects": [{ "kind": "damage", "amount": "<see data/status-effects.json>" }] }
]
```

**This scaling is exclusive to Poison Bomb.** Every other source of poison in the game — Poison Coat's on-hit rider, Snake's regular-monster skill (`02-monster.md`), and any future item/skill — keeps applying the plain, un-leveled `poisoned` ("poison level 1") regardless of the caster's rank in anything. There is no shared "global poison level"; `poisoned-ii`/`poisoned-iii` only ever come from Poison Bomb ranks 2/3.

### Storm-Empowered — rank scaling (Viking)

`storm-empowered` (Lightning Axe's self-buff, section 1.3.5.1) is the Viking's signature rider — its `onHitAoeDamage.amount` **is** the skill's core value, the same situation as Poison Bomb's `poisoned` above and Poison Coat's attack buff. It has 2 rank-exclusive variants scaling that amount up; `ignoreDefensePercent` stays fixed and `lightning-axe`'s applying effect declares the same `durationTurns` at every rank, so the `cooldownTurns = durationTurns + 1` formula holds at every rank. The splash's `magicPower` contribution is also scaled by `onHitAoeDamage.offenseMultiplierPercent` (80/90/100 at rank 1/2/3, `docs/technical-decisions.md` §4.8). Shape (current magnitudes: `data/status-effects.json`):

```json
[
  { "id": "storm-empowered-ii", "name": "Storm-Empowered II", "onHitAoeDamage": { "amount": "<see data/status-effects.json>", "isMagic": true, "offenseMultiplierPercent": "<see data/status-effects.json>", "ignoreDefensePercent": "<see data/status-effects.json>" } },
  { "id": "storm-empowered-iii", "name": "Storm-Empowered III", "onHitAoeDamage": { "amount": "<see data/status-effects.json>", "isMagic": true, "offenseMultiplierPercent": "<see data/status-effects.json>", "ignoreDefensePercent": "<see data/status-effects.json>" } }
]
```

The self-debuff piece of Lightning Axe (`defense`/`aggro`) and every skill's `conditionalBonus.ignoreDefensePercentBonus` stay **identical at every rank** — same reasoning as `taunt` above: these are enabling/auxiliary mechanics, not the thing being power-scaled. `bleeding`'s proc-chance scales per rank the same way Fireball/Lightning Bolt's burn/stun chances do — its own magnitude stays the shared, un-leveled version, consistent with the "poison/burn/stun magnitude doesn't scale, only its odds do" pattern used for Mage and Plague Doctor procs.

### Blinded — rank scaling (Plague Doctor)

No rank variants. `blinded` (Blinding Vial's debuff, section 1.3.6.2) follows the same pattern as Fireball/Lightning Bolt: only its proc-chance scales per rank, its magnitude (miss-chance percentage) stays fixed — it's an enemy-facing proc, not the caster's own signature buff, so it's treated like `burning`/`stunned`/`poisoned`, not like `guard`/`rallied`/`storm-empowered`. `poisoned`/`burning`/`weakened` procced by Toxic Fog/Total Plague stay the plain, un-leveled versions, consistent with the rule above that only Poison Bomb ever applies a leveled `poisoned` variant. Total Plague's `removeStatusEffect` (ally branch) is binary and unchanged at every rank, same treatment as Purify's ally branch.

### Rank tables — every class skill

Per-rank `mpCost`/`effects`/`unlockLevel` for every skill of every class (all 12): `data/classes.json`, under each skill's `ranks` array. The rank-variant statuses described above (`guard-ii/iii`, `rallied-ii/iii`, `venom-edge/venom-edge-ii`, `poisoned-ii/iii`, `storm-empowered-ii/iii`) live in `data/status-effects.json`. This document does not hand-maintain a copy of those tables — read the JSON directly for current numbers, since rank tuning changes independently of this doc.

## 1.5 Passive skills — 1 per class, always-on, level-gated

Every class has exactly 1 passive skill in addition to its 7 active skills (slots 0-6) — a `CharacterClass.passiveSkill: PassiveSkillDefinition` field, deliberately **not** an 8th entry in `skills[]` (`data/classes.ts` throws if any class doesn't have exactly `SKILLS_PER_CLASS`). A passive is never queued, cast, or chosen by the player — it's read purely off the character's current level via `getUnlockedPassiveRank(passive, level)` (`src/data/classes.ts`), which mirrors the `effectiveSkillRank` lookup but has no "has this been cast" concept at all, unlike a normal skill's rank.

**Unlock schedule — the same for all 12 classes**: rank 1 at level 5, rank 2 at level 20, rank 3 at level 35. This is a separate, uniform schedule from each class's own active-skill rank thresholds (section 1.4, which vary per skill/slot) — a passive's rank never depends on which active skills are unlocked or what's been cast this combat.

<!-- docs:begin passives -->
*Generated from `data/classes.json` by `bun run docs:sync`. Do not edit.*

| Class | Passive | Unlock level (R1/R2/R3) | Parameters (R1/R2/R3) |
|---|---|---|---|
| Knight | Watchful | 5 / 20 / 35 | maxHpPercent 5 / 10 / 15, defensePercent 7 / 10 / 14, interceptWeakestChancePercent 25 / 30 / 35 |
| Mage | Arcane Shred | 5 / 20 / 35 | onHitStatusEffectId shredded / shredded-ii / shredded-iii, durationTurns 3 |
| Rogue | Venomcraft | 5 / 20 / 35 | bonusPercent 15 / 20 / 30, bonusFlat 5 / 10 / 20 |
| Acolyte | Devotion | 5 / 20 / 35 | healBoostPercent 10 / 20 / 25, debuffResistPercent 30 / 40 / 50 |
| Viking | Blood Fury | 5 / 20 / 35 | hpThresholdPercent 40 / 45 / 50, thresholdStatusEffectId bloodrage / bloodrage-ii / bloodrage-iii |
| Plague Doctor | Contagion | 5 / 20 / 35 | procChancePercent 30 / 40 / 50, durationTurns 2 |
| Archer | Deadly Precision | 5 / 20 / 35 | critChancePercent 2 / 5 / 8, critMultiplierPercent 160 / 170 / 180 |
| Ninja | Afterimage | 5 / 20 / 35 | dodgePercent 5 / 10 / 15, secondCloneChancePercent 20 / 25 / 30 |
| Summoner | Bound Legion | 5 / 20 / 35 | minionMaxHpPercent 20 / 25 / 30, minionAttackPercent 10 / 13 / 17, maxActiveMinions 1 / 2 / 3 |
| Jester | Two-Faced | 5 / 20 / 35 | growthSwapWeights low 0.6, high 1.4 / low 0.55, high 1.5 / low 0.5, high 1.6 |
| Paladin | Retribution | 5 / 20 / 35 | reflectPercent 4 / 6 / 8 |
| Warlock | Ripened Curse | 5 / 20 / 35 | stackBurstPowerPercent 70 / 85 / 100, deathSpreadChancePercentPerStack 12 / 17 / 20 |
<!-- docs:end -->

How each passive works:

- **Knight — Watchful.** A multiplier on maxHp/defense after Artifact/Ability boosts and before status deltas (which stay flat, the same way the resolver applies them mid-fight). It adds no aggro. It also gives the Knight a per-rank chance (`interceptWeakestChancePercent`) to take a single-target monster hit aimed at the living party character with the lowest HP percentage, at most once per round (`CombatState.watchfulRound`); the Knight never covers itself, is skipped while stunned, and an Interpose redirect takes precedence. The Character Info screen shows the stat share as its own bracket. Engine hooks: `characterStatBreakdown` (`src/engine/party.ts`) and `interceptTarget` (`src/engine/interception.ts`)
- **Rogue — Venomcraft.** Triggers only when the target carries `passiveSkill.requiresTargetStatusId` (or a `rankOf` variant of it — `statusSatisfiesRequirement`, the same family-match `conditionalBonus` skills use); the bonus is a true flat amount (`ignoreDefensePercent` at its maximum plus a zero `offenseMultiplierPercent` zero out the usual attack-vs-defense term). Engine hook: `onDamageDealt` hook, `combatHooks.ts`
- **Mage — Arcane Shred.** Every hit stacks the status named by that rank's `onHitStatusEffectId` (`shredded`/`-ii`/`-iii`, 1 status id per rank — same rank-to-status mapping Rogue's own Poison Bomb skill uses for `poisoned`/`-ii`/`-iii`); the status lasts that rank's `durationTurns` and every hit refreshes it back to that value; each stack re-applies a fresh delta (`applyStatusEffectToActor`'s existing-status branch). Engine hook: `onDamageDealt` hook, `combatHooks.ts`; per-stack delta in `src/engine/resolver.ts`
- **Acolyte — Devotion.** Debuff resist combines multiplicatively with equipped Artifact/Ability `debuffResist` (`combinePercents`, same formula both already used independently); the heal boost applies only to a heal cast via the Acolyte's **own class skill** — not an item, not another class's skill — via the `ResolveContext.castByOwnClassSkill` flag `combat.ts` sets by checking the casting skill's id against the source's own class skill list. Engine hook: `acolyteDebuffResistPercent` + the `"heal"` case, both in `src/engine/combat.ts`/`resolver.ts`
- **Viking — Blood Fury.** Keeps the status the rank names (`thresholdStatusEffectId`: `bloodrage` / `-ii` / `-iii`, a `modifyCombatStat` on `attack` like any other buff — the bonus is that status's own magnitude, so the passive holds no percentage of its own) applied at the top of every non-`isBuff` Viking skill, so it's applied/removed to match the live HP ratio; self-damage gated separately by `landedDamageHit`. Engine hook: `applySkillEffects` (`syncPassiveThresholdStatus`), `src/engine/combat.ts`
- **Plague Doctor — Contagion.** Every damaging hit rolls the rank's `procChancePercent` as many times as `passiveSkill.procRolls` says (`data/classes.json`). Each success applies a random debuff from a 6-entry pool, lasting that rank's `durationTurns`: `poisoned`, `burning`, `weakened`, `blinded`, `slowed` (-5 speed), `enfeebled` (-4 attack or -15%, whichever cuts more). Engine hook: `onDamageDealt` hook, `combatHooks.ts`
- **Archer — Deadly Precision.** Chance is additive on top of the skill's own `critChance` (so a skill with none, like Quick Shot, can still crit); multiplier is whichever of the skill's own and the passive's is larger (so a skill with no `critMultiplierPercent` of its own, or one below the passive's floor, still benefits). Engine hook: `resolveOneDamageEffect`, `src/engine/combat.ts`
- **Ninja — Afterimage.** Dodge folds into `rollDodge` alongside equipped Artifact/Ability `dodgeChance`. The 2nd clone spawns through `spawnAdditionalSummon` (`combat.ts`), which skips `spawnSummon`'s "recasting the same archetype replaces it" eviction rule — that rule would otherwise dismiss the first clone the instant a 2nd spawned. The Ninja holds at most 1 clone of each origin: the passive spawns only while a cast clone is alive and no passive clone is (`Summon.fromPassive`), always named `secondCloneName`, and a recast replaces only the cast clone and leaves the passive's out of the minion cap, so it never evicts `Shadow Clone II`. Engine hook: `rollDodge`, `src/engine/artifacts.ts`; `applySkillEffects`, `src/engine/combat.ts`
- **Summoner — Bound Legion.** Both effects (the minion stat bonus and the active-minion cap) are purely level-gated, applied automatically at spawn time and read directly off the passive rank, with no cast step. Engine hook: `empowermentBonusFor` / `maxActiveMinionsFor`, `src/engine/combat.ts`
- **Jester — Two-Faced.** At the start of every round — after the party's actions are chosen, so the player never knows which way it will go — the two `growthSwapStats` (attack and magic power) trade growth weights at random: one grows at the rank's `growthSwapWeights.high`, the other at its `low`, in place of the class's own even weights (`data/growth-weights.json`). The log names the turn ("turns a new face") and each stat's difference from the class's own growth rides on a round-long status from `growthSwapStatusIds` (`sharp-face`/`dull-face` for attack, `bright-face`/`dim-face` for magic power), whose magnitude is that difference; the status ends with the round, or with the fight (`endsWithCombat`). The base stats, and the Character Info screen's base column, stay at the class's own 1:1 growth. At level 1 there is no growth yet, so the swap moves nothing until levels add up. Engine hook: `rollGrowthSwap` (`resolveRound`), `src/engine/combat.ts`
- **Paladin — Retribution.** A share (`reflectPercent`) of every direct hit taken is dealt back to the attacker, added to any `reflectDamagePercent` status the Paladin carries; a status tick is never reflected. With `ignoresFearEffects`, fear still builds on the Paladin but none of its combat penalties apply from rank 1: no accuracy or damage penalty, no lost control, no weaker ultimate. Engine hooks: `passiveReflectPercent`, `ignoresFearEffects` / `combatFearTier`, `src/engine/resolver.ts`
- **Warlock — Ripened Curse.** Once a target reaches `stackBurst.atStacks` of `hexed`, it loses `removeStacks` of them, then takes a free cast of `stackBurst.skillId` (Hex) at the rank's `stackBurstPowerPercent` of that skill's damage; the free cast cannot ripen the curse again. When an enemy carrying `deathSpread.statusEffectId` falls, from any cause, it rolls once at the rank's `deathSpreadChancePercentPerStack` times the stacks it carried (capped at a sure thing) to pass `deathSpread.stacks` stack(s) to another random living enemy of the same fight for `deathSpread.durationTurns`, where it can ripen like any other stack; the status leaves the body either way. A living Warlock with the passive unlocked is needed, and the best rank in the party rolls. Engine hooks: `stackBurst`, `spreadCurseFromFallen`, `src/engine/combat.ts`

## 1.6 Status effects

The statuses used by the character skill kits in sections 1.3.1-1.3.6 (English id/name, matching `data/status-effects.json`):

<!-- docs:begin statusEffects ids=interposed,side-by-side,following-through,engaged,guard,taunt,challenge,rallied,poison-coated,poisoned,burning,stunned,weakened,bleeding,storm-empowered,blinded -->
*Generated from `data/status-effects.json` by `bun run docs:sync`. Do not edit.*

| id | Name | Mechanics |
|---|---|---|
| `interposed` | Interposed | tickCategory special; interceptsForSource |
| `side-by-side` | Side by Side | defense +6 (min 10%); attack +12 (min 25%); magicPower +12 (min 25%); tickCategory special; onLandedHitSourceStatus statusEffectId following-through, durationTurns 1 |
| `following-through` | Following Through | defense +6 (min 10%); attack +12 (min 25%); tickCategory special |
| `engaged` | Engaged | tickCategory statMod; counterAttack maxCounters 2, amount 10, offenseMultiplierPercent 60, target attacker |
| `guard` | Guard | defense +6 (min 10%) |
| `taunt` | Taunt | aggro +40; targetPull 0.2 |
| `challenge` | Challenge | aggro +60; targetPull 0.4 |
| `rallied` | Rallied | attack +4 (min 5%) |
| `poison-coated` | Poison-Coated | onHitStatusEffectId poisoned |
| `poisoned` | Poisoned | damage 4 or 2.5% max HP per turn |
| `burning` | Burning | damage 6 or 3% max HP per turn |
| `stunned` | Stunned | stuns |
| `weakened` | Weakened | defense -6 (min -10%) |
| `bleeding` | Bleeding | damage 6 or 2% max HP per turn; stackable; maxStacks 5; perStackBonusPercent 100 |
| `storm-empowered` | Storm-Empowered | onHitAoeDamage amount 6, isMagic true, offenseMultiplierPercent 80, ignoreDefensePercent 30, damageType lightning |
| `blinded` | Blinded | accuracyPenaltyPercent 60 |
<!-- docs:end -->

What each is, and where it comes from:

- `interposed` — Buff (redirect, not a stat-buff); used by Interpose (Knight).
- `side-by-side` — Buff (raises defense, attack and magic power; follow-up on a landed hit); used by Side by Side (Knight). `-ii`/`-iii` are the rank variants.
- `following-through` — Buff; applied to the Knight when the ally carrying `side-by-side` lands a damaging hit. `-ii`/`-iii` are the rank variants.
- `engaged` — Buff (counter, not a stat-buff); used by Engage (Knight). `-ii`/`-iii` are the rank variants.
- `guard` — Buff; used by monster skills.
- `taunt` — Buff (aggro and a `targetPull` share of every monster's pick); used by Engage (Knight).
- `challenge` — Buff; a stronger `taunt` (more aggro, a larger `targetPull`); used by Defiance (Paladin).
- `rallied` — Buff; used by Rally (Knight).
- `poison-coated` — Buff (rider, not a stat-buff); used by Poison Coat (Rogue). (see `docs/technical-decisions.md` §4.2)
- `poisoned` — Debuff; used by on-hit rider of Poison Coat; Poison Bomb (Rogue); Toxic Fog, Total Plague (Plague Doctor).
- `burning` — Debuff; used by Fireball, Fire Pillar (Mage); Fire Vial, Total Plague (Plague Doctor).
- `stunned` — Control (debuff); used by Lightning Bolt, Lightning Storm (Mage). (see `docs/technical-decisions.md` §4.3)
- `weakened` — Debuff; used by Toxic Fog (Plague Doctor); also used by Elite/Boss-exclusive skills (`06-level-system.md` §6.12).
- `bleeding` — Debuff (physical DoT); used by Frenzied Slash, Spinning Axe (Viking).
- `storm-empowered` — Buff (rider, AoE-on-hit); used by Lightning Axe (Viking). (see section 1.3.5.1)
- `blinded` — Debuff; used by Blinding Vial (Plague Doctor). (see section 1.3.6.2)

Exact magnitudes/durations/proc chances for every row above: `data/status-effects.json`.

**Default `durationTurns` convention**: `durationTurns` is not a field of `StatusEffectDefinition` — it lives on the `applyStatusEffect` `SkillEffect` that applies the status (`docs/technical-decisions.md` §4), since the same status can be granted for a different number of turns by different sources. `applyStatusEffectToActor` (`resolver.ts`) falls back to a default of 1 turn when the applying effect doesn't set `durationTurns`.
- **Buffs (carrying `modifyCombatStat`, applied by the actor to itself/allies)**: default to that 1-turn fallback, matching the "buffs are always 1 turn" rule — no need to explicitly set `durationTurns` on the effect if it's 1, though it's still good practice to write it for clarity.
- **Debuffs/control effects (Poisoned, Burning, Stunned) and buff-riders that aren't stat-buffs (Poison Coat, Storm-Empowered)**: **must always declare `durationTurns` explicitly** on the applying effect, never relying on the default. A buff-rider's effect also declares `onHitDurationTurns`, the duration of the status each of its hits applies; a data test fails when one omits it.

**Combat-stat buff/debuff floor (`minPercent`)**: a flat `modifyCombatStat` amount has the same problem a flat DoT tick would have (see "Damage over time" below) — it's a lot at level 1, negligible at level 100. Guard/-ii/-iii, Rally/-ii/-iii, Venom Edge/-ii, Overwatch/-ii/-iii, Weakened, Corroded, Agony, and Storm Recoil's defense debuff all carry a `minPercent` on their `modifyCombatStat` entry in `data/status-effects.json`, so the applied delta is whichever of the flat amount or a percent of the actor's own stat is larger in magnitude — see `docs/technical-decisions.md` §4.8. `aggro`-only buffs (Taunt, Storm Recoil's aggro line) deliberately have none: `aggro` doesn't grow with character level, so a flat aggro bonus never becomes relatively negligible.

### Damage over time — `maxHpPercent`, Elite/Boss dampening, and "weak against X" vulnerability

Every DoT (`perTurnEffects` with `kind: "damage"`) ticks for a flat `amount` plus a percentage of the target's `maxHp`, via an optional field on `SkillEffect`, `maxHpPercent?: number`, on the DoT's `perTurnEffects` damage entry — the tick formula in `tickCategoryUnconditionally` (`src/engine/resolver.ts`) folds `target.maxHp * (effect.maxHpPercent ?? 0) / 100` into the flat `amount` before the Elite/Boss dampening and vulnerability multiplier below are applied. This keeps DoTs relevant late-run, since character/monster `maxHp` keeps growing with level across the game's infinite dungeon floors (`06-level-system.md`). A `heal` entry in `perTurnEffects` (a heal over time) with a `maxHpPercent` heals at least that share of the bearer's `maxHp` each tick, taking the larger of the flat `amount` and the percentage; it is not reduced for Elite/Boss targets.

**The DoTs (`data/status-effects.json`)**:

<!-- docs:begin statusEffects ids=poisoned,poisoned-ii,poisoned-iii,burning,bleeding,acid-burn,hexed -->
*Generated from `data/status-effects.json` by `bun run docs:sync`. Do not edit.*

| id | Name | Mechanics |
|---|---|---|
| `poisoned` | Poisoned | damage 4 or 2.5% max HP per turn |
| `poisoned-ii` | Poisoned II | damage 6 or 3% max HP per turn; rankOf poisoned |
| `poisoned-iii` | Poisoned III | damage 8 or 4% max HP per turn; rankOf poisoned |
| `burning` | Burning | damage 6 or 3% max HP per turn |
| `bleeding` | Bleeding | damage 6 or 2% max HP per turn; stackable; maxStacks 5; perStackBonusPercent 100 |
| `acid-burn` | Acid Burn | damage 5 or 2.5% max HP per turn |
| `hexed` | Hexed | damage 4 or 1.5% max HP per turn; attack -3 (min -4%); stackable; maxStacks 4; perStackBonusPercent 100 |
<!-- docs:end -->

Where each comes from:

- `poisoned` — Poison Coat, Poison Bomb (Rogue); Spreading Toxic Fog/Total Plague (Plague Doctor)
- `poisoned-ii` — Poison Bomb rank 2
- `poisoned-iii` — Poison Bomb rank 3
- `burning` — Fireball/Fire Pillar (Mage); Fire Vial/Total Plague (Plague Doctor)
- `bleeding` — Frenzied Slash/Spinning Axe (Viking); Throwing Knives/Shuriken Storm/Death Mark/Barbed Net's `netted` (Ninja); Blood Pact, on the Warlock itself — see 1.7.4 for the stacking mechanic
- `acid-burn` — Acid Spit (Slime)
- `hexed` — Hex/Bind Tongue/Withering Curse/Doom (Warlock); also lowers attack, stacks up to 4 times (section 1.3.12)

**DoT carries the deep floors — by design.** A direct hit goes through the attack-vs-defense mitigation (`mitigatedOffense`, `src/engine/resolver.ts`), which takes a larger share of it as monster defense grows with depth (`06-level-system.md` §6.10). A DoT tick skips defense and grows with the target's max HP. The deeper the floor, the more of a party's damage comes from the classes that keep a DoT up: the Rogue first (poison plus Venomcraft, section 1.3.3), then the Ninja (stacking bleed), the Plague Doctor (poison and burn) and the Warlock (stacking Hexed); the Viking and the Mage only now and then, and the Knight, Archer and Acolyte not at all. This is intended: the Rogue is the party's main damage source, and the other classes are not given defense-ignoring scaling to close the gap.

**Elite/Boss dampening — every DoT's total tick (flat + `maxHpPercent`) is multiplied by `combat.eliteBossDotMultiplier` (0.8) when the target's `tier` is `"elite"` or `"boss"`** (`Monster.tier`, `02-monster.md` §2's tier system). The tick still deals at least 1 damage unless the target's race is immune to its damage type, the same floor every hit gets in `resolveSkillEffect`. Exists specifically to keep `maxHpPercent` from becoming disproportionately strong against Elite/Boss's much larger HP pools — a flat-rate `%maxHp` tick would otherwise scale up faster on high-HP targets than intended. A DoT's status line says "(less on Elites and Bosses)" without the number.

**"Weak against X" vulnerability — one shared multiplier for every DoT**: a status carrying `StatusEffectDefinition.vulnerableTo: { statusEffectId: Id; multiplier: number }` (`vulnerabilityMultiplier()` in `src/engine/resolver.ts`) multiplies the named DoT's ticks on its bearer by `multiplier` (a target carrying "Weak Against Poison" takes its `poisoned` ticks multiplied by it), applied **after** the Elite/Boss dampening above. 4 statuses share this shape, all at the same `multiplier`: `poison-vulnerable`, `burning-vulnerable`, `bleeding-vulnerable`, `acid-burn-vulnerable`. The match follows a status's `rankOf` family (`statusSatisfiesRequirement`), so "Weak Against Poison" raises `poisoned-ii`/`-iii` ticks too. Rogue's Venom Brand is the party's one source of `poison-vulnerable` (section 1.3.13).

## 1.7 Shared engine mechanics

Engine fields a skill opts into, described once here rather than under one class. Most are used across classes or by monsters; the execute bonus (1.7.3) and the summon death burst (1.7.6) are currently used only by the Ninja.

### 1.7.1 Critical hits (`critChance` / `critMultiplierPercent`)

Optional fields on `SkillEffect`: `critChance?: number` (0-1, rolled independently of the accuracy roll, same pattern as an `applyStatusEffect` proc `chance`) and `critMultiplierPercent?: number` (shared default multiplier across every crit-capable skill unless a skill overrides it). Used by Archer's Aimed Shot, Piercing Arrow and Deadeye Shot (always crits), and by Ninja's stealth-break basic-attack guarantee (1.3.8.1).

**Base crit.** Every character, monster and summon also has `combat.baseCritChancePercent` (1)% to crit on each direct hit and each direct heal, added to the skill's own `critChance` and to the Archer's passive, so every crit-capable skill rises by that amount. A crit multiplies by `combat.defaultCritMultiplierPercent` (150)% unless the effect sets its own `critMultiplierPercent`. A multi-hit skill rolls once per hit and an area skill once per target, each with its own variance. Items, damage- and heal-over-time ticks, and the `autoDamage` of artifacts and abilities never crit; neither do HP costs (Dying, event costs, the Viking's self-damage).

### 1.7.2 Summoned combatant — shared by Ninja's clone and Summoner's minions

`CombatantRef` kind `{ kind: "summon"; id: Id }`; the owner is `Summon.ownerId`. A summon has its own HP/`aggro`/turn and takes a real slot in `turnQueue`, but is displayed **nested under its owner's own portrait** (e.g. a small "🐺 Clone: 12/12 HP" badge under the Ninja's/Summoner's HP bar) rather than occupying a new party-formation slot — so the summon is a "real combatant" (has HP, can be targeted and killed, acts on its own turn) without changing the fixed party-formation UI.

- **Stats**: derived from the owner's own stats at the moment of summoning, minus whatever the owner's active statuses add or take away (`ownerSourceStat`, `src/engine/combat.ts`: a buff or debuff lasting a few turns is not frozen into a minion that outlives it, the same rule for the death burst's offensive stat), via the cast profile named by `SkillEffect.summonCastId` (`data/summons.json`'s `casts`, 1 profile shared by a skill's 3 ranks — `base + (percent/100) * owner[sourceStat]` per stat, `sourceStat` normally the same-named owner stat but can cross over, e.g. a minion's `attack` sourced from the owner's `magicPower`; see 1.3.9.1 for concrete ratios) — a summon does not grow further as its owner grows mid-combat. **Exception: `speed` is not derived from the owner at all** — it's a flat, fixed trait of the archetype itself (`SummonArchetype.speed`, `data/summons.json`), the same value every time that archetype is summoned regardless of who casts it or how much the owner's own speed has grown/been buffed.
- **Acts immediately on cast**: a summon spawned mid-round isn't in that round's `turnQueue` (built before it existed). Right after `applySkillEffects` resolves the casting skill, `runCharacterTurn` (`src/engine/combat.ts`) gives the freshly-spawned summon its first action right then, in the same round, whatever its `speed`; from the next round on it acts in `turnQueue` order by its own `speed`. A second clone spawned by the Afterimage passive does not get this action, and neither does a passive summon (the Recall Totem), which never acts.
- **AI**: each summon type gets its own small action-weight table (`"basicAttack"` vs its 1 signature skill), the same shape as a monster archetype's `actionWeights` (`data/monsters.json`) — not a copy of monster AI, just the same weighted-random-pick pattern.
- **Lifespan**: a summon vanishes after it has **taken its turn N times** (N is the cast's `maxActions` in `data/summons.json`) — a skipped/stunned turn does **not** count toward N. It also vanishes immediately if its HP reaches 0. Either way of vanishing fires the summon's `deathBurst` if its cast profile has one (the table in 1.7.6 lists which) — see 1.7.6. If a summon is still alive and under N turns when its combat ends (the room is cleared or the party is wiped), it's silently dismissed the moment that combat is torn down (`Game.clearFinishedCombat`) — no `deathBurst`, since that's the cost of falling in battle, not of the fight simply ending. Otherwise a summon that outlives its own combat would linger indefinitely (visible as a stale HP badge under its owner) until its owner recasts the same archetype.
- **Aggro**: summons participate in the aggro-weighted targeting formula like any other combatant — a high-`aggro` summon (Ninja's clone, Summoner's Golem) draws enemy attacks more often by weight, but this is **not** a forced/absolute redirect (there is no targeting-override mechanic).
- **Heal targets**: a summon's own heal only ever lands on living characters — `resolveSummonSkillTargets` (`combat.ts`) restricts any heal-effect target list to them, unconditionally, so Healer Spirit can never end up healing itself or another minion. Unlike Totem Recall's buff, this isn't opt-in per skill via `excludesSummonTargets`; it's enforced for every summon-cast heal at the engine level, so a summon heal skill needs no opt-out flag of its own.
- **Cap**: how many summons 1 owner may have active at once defaults to 1; the Summoner's Bound Legion passive (§1.5) raises it at each later rank (`maxActiveMinions`, table in §1.5), purely from reaching that level — not tied to casting anything.

### 1.7.3 Execute bonus (`executeBonus`)

Optional field on `SkillDefinition`: `executeBonus?: { hpPercentThreshold: number; bonusDamagePercent?: number; bonusDamageFlat?: number }` — if the target's current HP is below `hpPercentThreshold` (as a % of its own `maxHp`) when the skill resolves, the skill's damage gets an extra bonus (percentage-of-base and/or a flat add, per skill). Used by Ninja's Death Mark. **Distinct from** the Boss "Execute" charge-up mechanic (`06-level-system.md` §6.12, `Monster.executeCooldownTurns`/`isChargingExecute`/`executeTargetId`) — same word, unrelated mechanic; that one is a monster-side charge-then-unleash finisher untied to the target's HP%, this one is a character-side conditional damage bonus keyed directly to the target's HP%.

### 1.7.4 Stackable status effects (`bleeding`)

Optional fields on `StatusEffectDefinition`: `stackable?: boolean`, `maxStacks?: number`, `perStackBonusPercent?: number` — when a stackable status is re-applied to a target that already carries it, instead of only refreshing `durationTurns` it also adds 1 stack (up to `maxStacks`), and its `perTurnEffects` damage is multiplied by `1 + (stacks - 1) × perStackBonusPercent/100` (`stacks` = current stack count, 1 on first application).

**`bleeding`'s concrete values** are in `data/status-effects.json` (`maxStacks`, `perStackBonusPercent`) — i.e. **plain linear/additive stacking**, each additional stack is worth one more full base tick (not a softened diminishing bonus). With the base tick from 1.6 (before Elite/Boss dampening and "weak against" vulnerability), the cap is exactly `maxStacks × base tick` per turn.

Stacking belongs to the **shared** `bleeding` status (Viking, section 1.3.5; Ninja, section 1.3.8) rather than a Ninja-exclusive copy, so every bleed source stacks — Viking's Frenzied Slash/Spinning Axe as well as Ninja's skills and the monster skills that apply it.

`SkillEffect.scalesWithStatusStacks?: { statusEffectId: Id; percentPerStack: number }` lets a skill **read** a target's current stack count to scale its own damage — Ninja's Death Mark uses it (the Ninja table in section 1.3.8, "per existing bleeding stack"), and so does Warlock's Soul Rend for `hexed` stacks (section 1.3.12). Every other conditional mechanic (`conditionalBonus`, Viking) only checks presence/absence of a status, not a magnitude.

### 1.7.5 Offense multiplier (`offenseMultiplierPercent`)

Without this field, a skill uses the caster's `attack`/`magicPower` **at full, un-scaled value** in `mitigatedOffense` — the only other levers are `ignoreDefensePercent` (scales the *target's* defense down) and the flat `amount` (added after mitigation), neither of which makes a skill weaker (or stronger) than "100% of attack" on the base term. <!-- docs:intent -->

The optional `SkillEffect` field `offenseMultiplierPercent?: number` (absent/`100` = unscaled <!-- docs:intent -->) does: `finalDamage = amount + mitigatedOffense(offensiveStat * (offenseMultiplierPercent ?? 100) / 100, effectiveDefense)`; `case "heal"` reads the same field the same way (`amount + magicPower * (offenseMultiplierPercent ?? 100) / 100`). Archer's Volley Shot and Ninja's Throwing Knives/Shuriken Storm scale their base offense **down** — a deliberate weaker-per-hit tradeoff for Volley Shot's AoE reach and Throwing Knives/Shuriken Storm's extra-hit-chance/hit-count upside.

`offenseMultiplierPercent` appears on almost every `damage`/`heal` effect across all 12 classes, with a value that typically **also climbs rank-to-rank** rather than staying fixed (e.g. Rogue's Backstab climbs across its ranks). The per-class tables above (section 1.3) show each skill's actual percent at every rank, not a universal default — always check `data/classes.json` for the current per-rank value rather than assuming 100%. <!-- docs:intent -->

### 1.7.6 Summon death burst (`SummonCast.onDeath`) — Ninja's Shadow Clone

Shadow Clone detonates once, dealing AoE `damage` to every living enemy plus a chance to apply 1 `bleeding` stack, whenever the clone leaves combat by **dying (a hit or a DoT tick) or running out of its actions**. The clone's cast-profile stats are the same at every rank, so the burst's numbers carry Shadow Clone's whole rank progression.

Optional field on `SummonCast` (`data/summons.json`): `onDeath?: { offenseMultiplierPercent, amount, sourceStat, statusEffectId?, statusEffectChance, durationTurns? }`, where `offenseMultiplierPercent`/`amount`/`statusEffectChance` follow the same scalar-or-`[r1, r2, r3]`-tuple convention as `SummonStatFormula.percent` (1.3.9.1) — resolved against the casting skill's active rank and frozen onto the summon at spawn time as `Summon.deathBurst`, the same "derived once, doesn't regrow with the owner" rule every other summon stat follows (1.7.2's first bullet). `sourceStat` is the **owner's** stat the burst's offense scales off (`"attack"` for Shadow Clone, since the clone's own `attack` is always 0 — it deals no damage on its own turns, only through this burst) — not the summon's own stat, since most summons (Ninja's clone especially) don't carry a meaningful one.

At trigger time, the burst is applied as an ordinary `damage` effect against every living enemy (`amount + mitigatedOffense(sourceStat * offenseMultiplierPercent/100, targetDefense)`), reusing `offensiveStatOverride` (`ResolveContext`, shared with Ability auto-damage) to substitute the frozen owner-stat snapshot in place of whatever the clone's own (always-0) `attack` would otherwise contribute, then a `statusEffectChance` roll per enemy for `statusEffectId`.

**Shadow Clone's concrete `onDeath`** (`data/summons.json`):

<!-- docs:begin deathBursts -->
*Generated from `data/summons.json` by `bun run docs:sync`. Do not edit.*

| Cast | On death (R1/R2/R3) |
|---|---|
| `shadow-clone` | damage 10 / 15 / 22 + 30 / 40 / 50% owner attack; status bleeding (3 turns, 30 / 33 / 37% chance) |
<!-- docs:end -->

**Triggering it reliably**: a summon can die on *any* actor's turn (an enemy's attack, another combatant's DoT tick), not just its own — `expireSummonIfDone` (the function that finalizes a done summon and fires its burst) is therefore called from more than one place in `resolveRound` (`src/engine/combat.ts`): once after the round's DoT-tick pass, and once after every combatant's turn, via a small sweep (`pruneDeadSummons`) over every summon still in `combat.combatants`. Once a summon is finalized it's removed from `combat.combatants`, so a later sweep call simply won't find it again — safe to call from multiple checkpoints without double-firing the burst.

**Deliberately excluded**: a manual dismiss (`dismissSummon` — recasting the same archetype to replace it, or eviction at the owner's minion cap) does **not** fire the burst. The detonation is meant to be the cost of the clone actually falling in battle, not a free repeatable AoE nuke from recasting Shadow Clone on demand.

## 1.8 Design notes

- Each class has exactly 1 "ultimate" skill in slot 6 — it **always hits, with no accuracy roll**, but its effectiveness (damage/heal) scales down by fear tier via a dedicated formula, replacing the usual hit/miss roll + flat damage-reduction combo used by ordinary skills (`04-fear-combat.md` section 4). Ultimates use `isUltimate: true` and a long `cooldownTurns` set per skill in `data/classes.json`, mostly the same value across classes (Summon Hellfire Imp's is shorter) — they do not use `usesPerCombat` (see the `usesPerCombat` bullet below).
- `modifyCombatStat` (attack/defense/aggro/speed buffs/debuffs) is always routed through `applyStatusEffect` — there is no effect that adjusts a combat stat instantly or permanently; every application carries a `durationTurns` on the applying `SkillEffect` (not on `StatusEffectDefinition` — see the "Default `durationTurns` convention" note in section 1.6).
- `StatusEffectDefinition` is shared by both buffs (e.g. "guard") and debuffs (e.g. "poisoned") — both expire via the `durationTurns` set by whichever effect applied them. Full table + default-duration convention: section 1.6.
- **Skills with a `chance` on 1 effect** (e.g. Fireball's burn proc) only roll for that specific effect, separate from the skill's overall accuracy roll — the main `damage` effect still always applies if the skill hits; only the secondary (proc) effect is probabilistic.
- **AoE skills** (`allEnemies`, or the "enemy" half of a two-sided skill): accuracy is rolled **separately for each target**, not once for the whole skill — one enemy dodging doesn't mean the whole group dodges.
- **Two-sided skills** (Purify, Divine Descent, Total Plague, Vigil): the effect applied depends on whether the target is an ally or an enemy, via each effect's own `appliesToRelation: "ally" | "enemy"` filter, rather than sharing one effect list — see `docs/technical-decisions.md` §4.4.
- **Cooldown** (`cooldownTurns`): every class-specific skill in slots 3-6 has a cooldown. Slots 1-2 vary by skill: Interpose, Side by Side, Poison Coat, Prayer, Lightning Axe, Overwatch, Smoke Bomb, Shadow Strike, Summon Goblin, Summon Spirit, Defiance and Blood Pact have one; Fireball, Lightning Bolt, Knife Throw, Heal, Frenzied Slash, Fire Vial, Healing Draught, Aimed Shot, Loaded Dice, Jeer, Lay on Hands and Hex don't. 2 formulas:
  - **Buff skills** (`isBuff: true`, the `buff` flag in each class's table): `cooldownTurns = the longest durationTurns among the skill's own applyStatusEffect effects + 1`. Some buff skills are set by hand instead: Interpose and Side by Side, which keep a fixed cooldown across ranks; Guardian Angel, whose cooldown runs longer than its 1-turn status; Summon Golem, whose cooldown runs longer than its `stone-skin` buff; Totem Recall, whose buff lasts until the totem dies rather than for its `durationTurns`; and Martyr's Oath, an ultimate.
  - **Other damage/utility skills + ultimates**: assigned by hand based on power level, not a fixed formula — `data/classes.json`.
- `usesPerCombat` is not used by any character skill — every skill uses `cooldownTurns`, including ultimates. The field still exists on `SkillDefinition`/`ItemDefinition` for Items (`07-items-artifacts.md` §7).
- **Buff skills always grant a temporary speed bonus** for turn-order purposes in the round they're used (the bonus amount: `src/engine/combat.ts`). This applies only to the skills marked `buff` in the Flags column of each class's table that don't summon (Interpose, Side by Side, Rally, Poison Coat, Sanctuary, Lightning Axe, Overwatch, Smoke Bomb, Battle Ballad, Defiance, Guardian Angel, Blood Pact, Martyr's Oath) — not to the Summoner's summon skills, which carry the `buff` flag (`turnOrderSortKey`, `src/engine/combat.ts`), and not to support skills that don't carry a status (Prayer, Heal, Mass Heal for Acolyte adjust instantly, without going through `applyStatusEffect`). This is a temporary bonus only for ordering turns within the current round — it is not added to the character's base `speed` — technical design in `docs/technical-decisions.md` §4.7.
- Every class-specific skill (all 12 classes, 72 skills total) carries a 3-rank power curve — see section 1.4 for the mechanism.
