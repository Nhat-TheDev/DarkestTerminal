# Gameplay / Content — Decisions (index)

**Related**: `../design-doc.md` section 1, `../../dungeon-crawler-data-model.ts`

Each major topic gets its own file for easier reading/editing. Section numbers (§1, §6.9,
...) are used so files can cross-reference each other — e.g. "see `06-level-system.md` §6.9".

| File | Section | Content |
|---|---|---|
| [`01-class-skill.md`](./01-class-skill.md) | §1 | 4 classes, 6 skills/class, status effects used by skills |
| [`02-monster.md`](./02-monster.md) | §2 | Monster scaling formula by floor, aggro-based targeting, AI patterns, 3 monster tiers (normal/Elite/Boss) |
| [`03-survival-stats.md`](./03-survival-stats.md) | §3 | Numeric thresholds for fear/hunger/thirst, 4 fear tiers |
| [`04-fear-combat.md`](./04-fear-combat.md) | §4 | How fear feeds back into combat, per-target AoE accuracy rolls, ultimates |
| [`05-character-stats.md`](./05-character-stats.md) | §5 | How HP/MP work, growth by level |
| [`06-level-system.md`](./06-level-system.md) | §6 | Level system 1-100, EXP, infinite dungeon-floor level, Elite/Boss, Elite/Boss-exclusive skills |
| [`07-items-artifacts.md`](./07-items-artifacts.md) | §7 | Consumable items + Artifacts (permanent relics within a run), rarity, drop sources |
| [`08-events.md`](./08-events.md) | §8 | Event rooms: event types split by rarity tier |
| [`09-new-classes-viking-plaguedoctor.md`](./09-new-classes-viking-plaguedoctor.md) | §9 | **Not yet implemented** — proposal for 2 new classes, Viking & Plague Doctor; see "Future Direction" in `../design-doc.md` |

Other files in `docs/` (`technical-decisions.md`, `minigame-decisions.md`) reference this document via the path `gameplay-decisions/<file>.md §N`.
