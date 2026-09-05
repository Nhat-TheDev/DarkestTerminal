# Gameplay / Content — Decisions (index)

**Related**: `../design-doc.md` section 1

Each major topic gets its own file for easier reading/editing. Section numbers (§1, §6.9,
...) are used so files can cross-reference each other — e.g. "see `06-level-system.md` §6.9".

| File | Section | Content |
|---|---|---|
| [`01-class-skill.md`](./01-class-skill.md) | §1 | Class roster (6 classes, incl. Viking & Plague Doctor), skills per class, the 3-rank skill power-scaling system, status effects used by skills — `data/classes.json` |
| [`02-monster.md`](./02-monster.md) | §2 | Monster scaling formula by floor, aggro-based targeting, AI patterns (incl. the `aiPattern: "defensive"` low-HP logic), regular-monster skill kits, monster tiers (normal/Elite/Boss) — `data/monsters.json` |
| [`03-survival-stats.md`](./03-survival-stats.md) | §3 | Fear + Satiety thresholds, Exhausted/Dying, Camp, Rest room — `data/balance-config.json` |
| [`04-fear-combat.md`](./04-fear-combat.md) | §4 | How fear feeds back into combat, per-target AoE accuracy rolls, ultimates |
| [`05-character-stats.md`](./05-character-stats.md) | §5 | How HP/MP work, growth by level |
| [`06-level-system.md`](./06-level-system.md) | §6 | Level system, EXP, infinite dungeon-floor level, Elite/Boss, Elite/Boss-exclusive skills — `data/level-growth.json` |
| [`07-items-artifacts.md`](./07-items-artifacts.md) | §7 | Consumable items + Artifacts (permanent relics within a run, one-shot equip/discard decision), rarity, drop sources |
| [`08-events.md`](./08-events.md) | §8 | Event rooms: event types split by rarity tier |
| [`09-currency.md`](./09-currency.md) | §9 | Cursed Coins — drop rule, spend across Merchant/Gambling Den/Wandering Hermit |
| [`10-event-narrative.md`](./10-event-narrative.md) | §10 | **Merged into §8.** The narrative layer on top of Event rooms — shared Covenant/Sleeper worldview, recurring NPCs, event chains, post-event reflection — is implemented and documented at `08-events.md` §8.13-§8.16. This file now only keeps the design questions left undecided along the way |
| [`11-abilities.md`](./11-abilities.md) | §11 | **Design spec, not yet implemented.** Abilities — a persistent, cross-run meta-progression system: 1 talent per character chosen from a permanently-unlocked pool, earned mid-run from Elite/Boss kills, at risk of being struck from the pool on party wipe — `data/abilities.json` (planned), new `profile.json` save |

Other files in `docs/` (`technical-decisions.md`, `minigame-decisions.md`) reference this document via the path `gameplay-decisions/<file>.md §N`.
