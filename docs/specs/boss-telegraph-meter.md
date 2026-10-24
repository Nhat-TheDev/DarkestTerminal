# Boss telegraph meter

A boss's telegraph stops being a surprise roll. Each boss with a telegraph shows a short meter of diamond icons
under its HP; one icon fills per boss turn, and on the turn the last one fills the boss releases its telegraph.
The party sees the hit coming and spends the turns before it protecting each other: pulling the blow onto a tank,
or knocking the boss's turn away so the release slips to its next turn.

Branch: `feat/boss-telegraph-meter`, cut from `release/version-v1.2.0`.

## Why

Today a boss picks its telegraph by weighted random once its cooldown allows, spends one turn charging, and
releases on the next. The warning is one turn long and the target is locked on the charge turn, so a taunt
used after the warning cannot change who gets hit. The fight reads as "a big hit lands on someone". The meter
turns it into a race the party can see: several turns of warning, a known moment, and tools that change the
outcome. That is also what lets telegraphs hit as hard as they are meant to (see "Damage rules"): a blow the
party had turns to answer can be allowed to kill.

## Goals

- Every boss that has a telegraph skill shows a meter of 3 to 5 icons. The length is set per boss in data.
- One icon fills at the start of each of the boss's own turns, **including a turn it then loses to a stun or an
  Overwatch interrupt**. A stun never empties or rewinds the meter.
- On the turn the last icon fills, the boss releases its telegraph instead of choosing an action (the user's
  words: "on the turn the icons have all changed colour, the boss uses the telegraph that turn"). A meter of
  length N therefore releases on the boss's N-th turn after it was last empty. If that turn is lost (stunned,
  Overwatch interrupt), the meter stays full and the boss releases on its next turn it can act; a full meter
  adds no further icon.
- After the release the meter is empty; the boss's next turn fills its first icon again.
- The meter starts empty when the fight starts.
- The player only knows that the release is coming, never who it will hit. A single-target telegraph picks its
  target at release, through the normal targeting (aggro, `targetRules`, `provoked`, taunt's `targetPull`),
  and Interpose still takes the blow for its ward. An area telegraph hits every living party member at release.
- The telegraph is no longer in the boss's weighted action pool; the meter is the only way it is used.
- Telegraph damage may kill a character outright (one-shot) when the numbers call for it.
- Rebalance boss damage skills to the damage rules below, and replace the balance test's telegraph cap, which
  cannot hold under those rules.

## Non-goals

- No meter for elites. No telegraph is reachable at elite tier today (`06-level-system.md`, kit rules) and that
  stays.
- No meter for bosses without a telegraph. Orc Chieftain and Void Amalgamation have none on purpose ("no
  patience", "no intent"); they keep that identity.
- No new player skills. The party uses the control it already has (stuns, Overwatch, taunt/Challenge/Provoke,
  Interpose, guards, heals).
- No change to how a normal monster acts.

## Anti-goals

- A meter the player cannot read at a glance, or that lies (shows full when the boss will not release, or
  releases a turn earlier than it shows).
- A stun that rewinds or resets the meter. The user decided: a stun only blocks the release, the meter keeps
  filling.
- Revealing the target before the release.

## Decided by the user

- Meter length 3 to 5 icons per boss, set from the boss's character: a slow boss gets a longer meter (toward 5),
  a fast one a shorter meter (toward 3); a boss whose telegraph hits hard gets 4 to 5, one whose telegraph hits
  lightly needs only 3. When the two pull apart, the length lands between them. Two bosses in the same band never
  share a length. Agreed lengths (this spec is deleted once built; the values then live only in data):

  | Band | Boss | Meter |
  |---|---|---|
  | 1 | Skeleton Guard | 5 |
  | 1 | Giant Spider | 4 |
  | 2 | Zombie Knight | 5 |
  | 2 | Vampire Lord | 4 |
  | 3 | Dark Knight | 3 |
  | 3 | Lich | 5 (a caster) |
  | 4 | Ancient Golem | 5 |
  | 4 | Dragon | 4 |
  | 5 | The Founder | 4 |

- Ancient Golem's telegraph (`sealing-blow`) also stuns the whole party for a turn when it lands.
- Dark Knight and Lich aim their telegraph by a status tag (`challenged`, `marked`). When someone carries the tag,
  the release hits that character, as today; this is an accepted exception to "the target is unknown". When nobody
  carries it, the release picks its target through the normal targeting, so a taunt can pull it.
- A telegraph may kill a character outright at any band, but the simulated party, which never taunts or stuns,
  must still win every fight: one release can take one character down, never the whole party.
- Icons: white diamond for an empty step, black diamond for a filled one (`◇` and `◆`).
- Stun (and any lost turn): the meter still fills; the boss just cannot release that turn, and releases on its
  next turn.
- Taunt and turn interruption are the intended counters.
- **Silence** stops the release: a silenced boss with a full meter cannot use its telegraph and only basic-attacks
  that turn. The meter stays full and the boss releases on its next turn without silence (the designer's reading:
  the same delay a lost turn gives, but the boss still acts). This replaces today's rule that a charged telegraph
  is released through silence (`docs/gameplay-decisions/01-class-skill.md`, "Silence"; `src/types.ts` on
  `silences`).
- Target unknown until the release.
- One-shot kills from a telegraph are acceptable.
- **Damage rules** for boss skills:
  - A telegraph scales at 190% to 280% of attack plus a flat amount. A boss with low attack sits at the low end
    of that range and makes up for it with a larger flat amount and a status effect.
  - Every other damaging skill scales at no more than 170% of attack, plus a flat amount.
  - A multi-hit or area skill sits lower in its range; its flat amount and the status it applies carry the rest.
  - Tuning is done through the flat amount and the attached status first, the percentage second.

## Constraints

- Everything tunable lives in `data/*.json` (repo `CLAUDE.md`): meter length per boss archetype, skill damage,
  attached statuses. The engine names no archetype or skill.
- UI text in `data/strings.json`, English. Footer and key hints follow the "Key hints" rules in
  `docs/developer-guide.md` (the meter is body content, not a key hint).
- Saves from `OLDEST_LOADABLE_SAVE_VERSION` (1.1.0) on must still load. 1.1.x saves have no charge state at all
  (`Monster.charging` does not exist on `main`), so no 1.1.x save can be mid-telegraph. The new meter state on a
  monster must default sensibly when missing.
- The Monsters panel at the minimum terminal (150x45) must still fit a boss with its statuses.
- `bun test`, `bun run typecheck`, `bun run docs:sync --check` pass. Docs that describe telegraph behaviour
  (`docs/gameplay-decisions/06-level-system.md` "How an elite or boss turn is chosen" and its kit rules,
  `02-monster.md`, `01-class-skill.md` where silence/stun/Interpose meet a telegraph) are updated in the same
  change.

## Calls made by the designer (Claude), open to change

- **Where the meter shows:** on its own line under the boss's HP bar in the Monsters panel, e.g.
  ` ◆◆◆◇`. Not on the Battlefield.
- **`chargeEffects`** (today only Dragon's `inferno`, which makes it airborne while it charges) resolve on the
  boss turn that fills the second-to-last icon, with a duration that lasts through the release turn, so the
  Dragon is in the air for the turn before its breath and the breath itself. A telegraph without
  `chargeEffects` has no separate charge turn.
- **Confusion** keeps today's rule: a telegraph is never turned onto the boss's own side. The intended counters
  are the ones the user named (taunt-style pulls and lost turns) plus Interpose.
- **Log:** the release keeps its existing log line. No extra line per icon; the meter is the warning.
- **Cooldown fields on telegraph skills** (`cooldownTurns`, `initialCooldownTurns`) no longer drive the
  telegraph and are removed from those skills. The kit rule "no two telegraphs share a cadence" is replaced by "two
  bosses in the same band never share a meter length"; with 9 bosses and 3 lengths, a fully unique cadence is
  impossible, and the band is where two bosses are compared.
- **Phases:** a phase's `weights` no longer list the telegraph. A phase may change the meter length if a boss
  needs it (optional field), so a wounded boss can release faster.
- **Balance test:** the per-band `telegraphCap` (a share of the lowest-HP class's max HP) is replaced by checks
  on the data rules above (telegraph within its range, other skills under their cap) and by keeping "no
  non-telegraph skill reaches the lowest-HP class's max HP". The DPR and rounds bands are re-fitted after the
  rebalance from a fresh simulation and the results are shown to the user before they are committed.
- **Simulation:** `test/balanceSim.ts` fights through the real engine, so the meter is simulated for free. Its
  party does not use taunt or stuns on purpose, so it measures the uncountered worst case.

- **Elites** take the 170% cap too: every elite skill is also a boss skill, so `diseased-blade`, `measured-cut`
  and `stoneshear` drop for both tiers, and the elite bands are re-fitted with the boss bands.

- **Ancient Golem's stun** lands on every living party member while the damage stays on one target (so a taunt
  still decides who takes the blow). If a skill effect cannot yet target differently from its skill, the builder
  adds that as a data field rather than special-casing the Golem.

## Left to the builder

- Field names (`telegraphMeter` / `meterLength` or similar) and where the meter count lives on `Monster`.
- Exact per-skill numbers and per-boss meter lengths within the rules, found by running the balance report; the
  numbers live only in data, never in this spec.
- Which status each low-attack telegraph gets, chosen from the existing `data/status-effects.json` catalog
  (no new statuses unless none fits).
- Whether the game editor exposes the meter length (it should if it already edits telegraph AI fields).
- How the headless UI tests and `tools/random-play` cover the meter.

## What this replaces

This spec is transient: once built, fold what still holds into `docs/gameplay-decisions/06-level-system.md`
and `02-monster.md`, then delete it.
