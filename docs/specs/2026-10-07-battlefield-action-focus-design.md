# Battlefield action focus + paced log — design

Status: draft for review. Transient: once implemented, fold the lasting parts into `docs/developer-guide.md` (Battlefield / Log sections) and delete this file.

## Problem

During a round the player only learns who attacks whom by reading the log. The battlefield gives no cue.

## Goal

While a round resolves, the battlefield shows which units take part in the action currently being narrated: everyone else is greyed out, and icons mark who is attacking, who is being attacked and who is being helped. The log is paced to match, split into a short per-room log on the main screen and a longer per-run log on its own screen.

## Hard requirement: battlefield and log never drift

The highlight must appear in the same frame as the log line that narrates it, never after.

1. **Single source of truth.** Lit/grey state and icons are derived from the `session` of the most recently revealed log entry. There is no separate animation state or timer.
2. **Single clock.** One reveal timer. Each tick appends the log line, updates the HP/MP snapshot and the highlight, then calls `render()` once.
3. **The hold lives in the same schedule.** Session N+1 (first log line and new highlight together) starts only after session N has been held for its full duration. Until then the previous session's lines and highlight are both on screen.
4. **Skip is atomic.** Any key flushes every pending line, the final snapshot and the normal colours in one `render()`.
5. **Round end is atomic.** When the last session's hold ends, the battlefield returns to normal colours and the main panel returns to the command prompt in the same frame. `revealing` stays true until then (today it ends right after the last line).
6. **Tested.** With a manual clock, a test checks at every tick that the session `render()` actually used equals the session of the last visible log line, and that the frame carries exactly the icons that session names; it also covers skip, round end, a quicksave during a reveal, and the party-wipe round.

## Behaviour

Applies only while a round resolves. The command phase renders at normal colours.

### Sessions

A session is one actor's action: a contiguous block of log entries that the engine already groups per actor in `resolveRound` (`tagLogRange`).

- A session lasts at least **1.5 s**.
- Its log lines appear one at a time, **0.1 s apart**, starting at the session's first frame. A session with more than 15 lines lasts `lines × 0.1 s` instead; nothing is truncated.
- Several lines at once (two buffs on one target, an AoE on four targets) are still one session.
- Round-start and round-end effects with no actor (DoT ticks, stat-modifier expiry, dying damage, artifact auto-damage) form **one session per block** (all DoT ticks together, all stat-modifier expiries together, and so on), so a block costs one 1.5 s hold, not one per unit. The units whose tick actually logged are lit; no icons.
- A minion's immediate turn right after being summoned is part of its owner's session. An Overwatch shot is the watcher's own session, shown before the monster's turn it interrupts.

### Battlefield

- Within a session every unit that is not a participant is rendered grey: sprite pixels, chip, label and HP text. Grey is a luminance-based desaturation, darkened; the exact factor is tuned by eye. The switch is instant, with no fade.
- Participants keep their normal colours.
- Icons sit in a fixed band above the sprite frame: one icon row, then one blank row, then the sprite area. The fixed band keeps icons clear of tall sprites (bosses fill the frame today) and at one height for all units. The battlefield grows by 2 rows. Each unit's icons are centred over the middle of its own sprite, not its nominal slot (a sprite wider than a slot shifts the row).

| Role in the session | Icon | Colour |
| --- | --- | --- |
| Attacker | sword | blue if party, red if monster |
| Attacked (hit or missed) | shield | blue if party, red if monster |
| Receives a buff | buff glyph | blue if party, red if monster |
| Receives a heal | heal glyph | blue if party, red if monster |
| Target of a debuff-only skill | debuff glyph (inverted triangle), instead of the shield | blue if party, red if monster |
| Caster of a debuff-only skill | sword | blue if party, red if monster |
| Caster of a buff or heal | support glyph `⚚` | blue if party, red if monster |

Debuff-only is decided per skill, not per target: a skill counts as debuff-only when none of its effects is a damage effect reaching the opposing side. A skill that deals damage and also debuffs shows the shield on every opposing target it names, including targets reached only by the debuff (a single-target hit with an all-enemies debuff shows a shield on all of them); the debuff is treated as a rider on the hit.

Blue is the player's side, red is the enemy's, regardless of who attacks. Example: a monster attacking all characters shows a red sword on the monster and a blue shield on each character. When one unit has more than one role in a session (a caster who buffs itself, or a skill that hits an enemy and buffs the caster), its glyphs are shown side by side in the icon row, e.g. `⚚▲` for a self-buff; the glyph set is one constant so it can be swapped.

Glyphs are Unicode characters. Candidate set: sword `⚔`, shield `⛨`, buff `▲`, debuff `▼`, heal `✚`, support caster `⚚`. Each must render as a single cell in the target terminals; the implementation checks widths and picks single-width alternatives if any candidate renders as an emoji or double-width.

## Data model (engine)

`src/types.ts`:

```ts
interface LogSession {
  id: number;            // index in combat.log of the first entry the session tagged; unique within the combat; entries of one session share it
  actorId: Id | null;    // null for actor-less sessions
  attackedIds: Id[];     // targets on the opposing side of a skill that deals damage (hit or missed)
  debuffedIds: Id[];     // targets on the opposing side of a debuff-only skill
  buffedIds: Id[];       // same-side targets of a buff or status buff
  healedIds: Id[];       // same-side targets of a heal
  affectedIds: Id[];     // actor-less sessions only (DoT tick, dying damage): the units to light, no icons
}
interface LogEntry { /* existing fields */ session?: LogSession }
```

`src/engine/combat.ts`: `runCharacterTurn`, `runMonsterTurn`, `runSummonTurn` and the overwatch path report the actor and resolved targets; the loop in `resolveRound` tags the block with the session the same way `tagLogRange` tags snapshots. The relation of a target to the actor (opposing vs same side) and the effect kind (buff vs heal) come from the resolved skill, not from log text. Round-start and round-end blocks get actor-less sessions listing the affected units.

A summon has no sprite, so every id in a session that belongs to a summon is replaced by its owner's id (`unitId`). `session.id` is the index of the first entry the session actually tags (assigned when it is tagged, so nested sessions cannot collide), which makes it unique within a combat and stable across a save round trip. Every place where a turn narrates a unit notes it: skill targets (before the accuracy roll, so a miss still marks its target), basic attacks, a boss's execute charge, on-hit AoE damage, summon death bursts, artifact auto-damage.

Log entries that belong to no session (combat start, reward lines, toasts, `finalizeRound` messages) carry none. They are revealed at 0.1 s per line with no 1.5 s hold, and the battlefield stays at normal colours while they show.

Nothing here is a balance value, so no `data/*.json` change. Pacing constants (1.5 s, 0.1 s, 50, 500) sit next to `LOG_REVEAL_INTERVAL_MS` in `src/ui/app.ts`.

## Reveal engine (`src/ui/app.ts`)

Replaces the 800 ms-per-line `scheduleReveal`/`flushPendingReveal` with a session-based schedule: it reveals a session's lines at 0.1 s intervals, holds until 1.5 s from the session start, then starts the next. The first line of the first session shows on the first tick of the round, not after a delay. HP/MP/status/coin snapshots keep freezing per line exactly as they do now.

## Logs

- **Room log (main screen):** at most **50** entries, only for the current room, cleared when the player enters another room. Replaces `LOG_HISTORY_SIZE = 20`. The box stays 8 lines tall and scrollable (`↑`/`↓`), pinned to the bottom by default.
- **Run log (own screen):** the latest **500** entries of the run, opened with **`[l] Log`** (a global hint, available on every screen except the log screen itself), scrolled with `↑`/`↓`, closed with `Esc`. Inside it only those keys and `Ctrl+C` work; every other key is swallowed, so the screen cannot reach save/quicksave through the back door and its footer advertises only `[Esc] Back`. It opens while a reveal is running and does not interrupt it. In memory only: it is empty after loading a save.
- Toasts and out-of-combat info lines (`logInfo`, `pushToast`, `reportUnusable`) go to both logs. The room log is cleared by the first write or render after the room changes, so the line announcing the new room survives.
- The round that wipes the party ends the combat before the screen draws it; the unread tail of the finished combat's log is still revealed (to both logs) before the game-over screen takes over.
- A save loaded mid-fight does not replay the rounds already in its combat log.
- A line queued while a reveal is running (a quicksave toast, say) never rewinds the displayed HP/MP/coins to the start of the round.

## Files

- `src/types.ts`: `LogSession`, `LogEntry.session`.
- `src/engine/logSession.ts` (new), `src/engine/combat.ts`, `src/engine/monsterAI.ts`: build and tag sessions.
- `src/ui/revealQueue.ts` (new): the single reveal clock.
- `src/ui/battlefieldFocus.ts` (new), `src/ui/sprites.ts` (`spriteSlotLayout`): grey conversion, icon colours, icon band placement.
- `src/ui/app.ts`: reveal driver, dimming, icons, room/run logs, `[l]` key.
- `src/ui/layout.ts`: two extra rows in the battlefield frame (`UNIT_BLOCK_HEIGHT` and its users).
- `src/ui/screens/log.ts` (new), `src/ui/state.ts`, `src/ui/keyHints.ts`, `data/` UI strings: log screen and `[l] Log` hint.
- `docs/developer-guide.md`: Battlefield and Log sections; note the new terminal height.

## Testing

- Engine: sessions tagged correctly for single attack, AoE, miss, buff, heal, debuff-only, damage plus debuff, mixed skill, summon turn, actor-less ticks.
- UI (fake clock): per-tick sync invariant, pacing (1.5 s minimum, 0.1 s lines, long-session extension), skip, round end, room log cap 50 and clear on room change, run log cap 500, `[l]` open/close, key-hint grammar (`test/keyHints.test.ts`).
- `bun test`, `bun run typecheck`, `bun run docs:sync --check`.
- Look at it running in the real TUI (see the `tui-testing` skill) to tune grey and confirm glyph widths.

## Out of scope

- Dimming the Expedition and Monsters panels.
- Fade animation.
- Saving the run log.
- Any change to who targets whom or to combat rules.
