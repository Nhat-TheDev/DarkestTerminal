# Gameplay / Content — Decisions (index)

**Related**: `../design-doc.md` section 1

Each major topic gets its own file for easier reading/editing. Section numbers (§1, §6.9,
...) are used so files can cross-reference each other — e.g. "see `06-level-system.md` §6.9".

| File | Section | Content |
|---|---|---|
| [`01-class-skill.md`](./01-class-skill.md) | §1 | Stats and Balance Points, the 9 classes and their skills (§1.3), the 3-rank skill power-scaling system (§1.4), each class's always-on passive (§1.5), status effects used by skills (§1.6), and the engine mechanics shared across classes (§1.7) — `data/classes.json` |
| [`02-monster.md`](./02-monster.md) | §2 | Monster scaling formula by floor, aggro-based targeting, AI patterns (incl. the `aiPattern: "defensive"` low-HP logic), regular-monster skill kits, monster tiers (normal/Elite/Boss) — `data/monsters.json` |
| [`03-survival-stats.md`](./03-survival-stats.md) | §3 | Fear + Satiety thresholds, Exhausted/Dying, Camp, Rest room (incl. Camp Reflection, a party self-analysis mechanism) — `data/balance-config.json` |
| [`04-fear-combat.md`](./04-fear-combat.md) | §4 | How fear feeds back into combat, per-target AoE accuracy rolls, ultimates |
| [`05-character-stats.md`](./05-character-stats.md) | §5 | How HP/MP work, growth by level |
| [`06-level-system.md`](./06-level-system.md) | §6 | Level system, EXP, infinite dungeon-floor level, Elite/Boss, Elite/Boss-exclusive skills — `data/level-growth.json` |
| [`07-items-artifacts.md`](./07-items-artifacts.md) | §7 | Consumable items + Artifacts (permanent relics within a run, one-shot equip/discard decision), rarity, drop sources, lore-bearing descriptions |
| [`08-events.md`](./08-events.md) | §8 | Event rooms: shared worldview, recurring characters and mechanics (Cursed Artifact, chains, reflection), then the event catalog by rarity |
| [`09-currency.md`](./09-currency.md) | §9 | Cursed Coins — drop rule, spend across Merchant/Gambling Den/Wandering Hermit |
| [`10-event-narrative.md`](./10-event-narrative.md) | §10 | The narrative layer on top of Event rooms — relationship graph across all events, cross-event continuity, description variants, chains and the discovery curve, the narrative-layer events (see also `08-events.md` §8.2-§8.6 and the event catalog from §8.7); The Wanderer (a rare no-reward encounter); and the Ending System (floor 100/120 <!-- docs:intent --> — Stay / Let Go / conditional Leave (bad-default, rare escape) / conditional Continue (true), incl. the floor-120 founder fight and Ending 1's cross-run persistence layer ; the normal-death texture is not yet built, §F.6) |
| [`11-abilities.md`](./11-abilities.md) | §11 | Abilities — a persistent, cross-run meta-progression system: 1 talent per character chosen from a permanently-unlocked pool, earned mid-run from Elite/Boss kills, at risk of being struck from the pool on party wipe — `data/abilities.json`, `profile.json` save |
| [`12-world-bible.md`](./12-world-bible.md) | §12 | **Hidden lore, never shown to the player.** What the Sleeper and the Covenant actually are, why the party descends, and what the 3 recurring NPCs (merchant/wandering-hermit/gambling-den) represent — ground truth for writing future flavor text consistent with §8.2's player-facing ambiguity |


Other files in `docs/` (`technical-decisions.md`) reference this document via the path `gameplay-decisions/<file>.md §N`.
