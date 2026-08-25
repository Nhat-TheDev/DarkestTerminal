# Decompose God Classes — Refactor Spec

**Status**: proposed, not yet implemented.
**Scope**: `src/ui/app.ts`, `src/engine/game.ts`, `src/engine/combat.ts`, `test/engine.test.ts`.
**Non-goal**: no behavior change. Every item below is a pure structural move —
same logic, same public entry points (`Game`'s methods, `App`'s constructor),
different file boundaries. `bun test` must pass unmodified (module paths
aside) before and after each phase.

**Why now**: four related code-review findings all point at the same root
cause — responsibilities that started small and grew by accretion, one
`case`/method/hook at a time, until the file/function became the only place
a given kind of change could land. This doc turns each finding into a
concrete target file layout so the next person touching this code has a
place to put things that isn't "wherever the giant switch already is."

---

## 1. `src/ui/app.ts` — 1349 lines, one `App` god class

### Current shape
- Free functions at module scope (lines 1–167): layout/formatting helpers
  (`centerText`, `truncateText`, `mergeBlocksHorizontally`, `monsterStyle`),
  domain selectors (`inventoryEntries`, `buildRewardEntries`,
  `ownedArtifactIds`, `cursedEquippedEntries`, `skillEntries`), the `UiState`
  union (25 variants) and its 4 satellite types, and `eventUiState()`.
- `class App` (169–1349): layout construction in the constructor,
  `handleKey()` — a single ~340-line `switch (this.ui.kind)` covering all 25
  states — `goBack()` (another `switch`), `render()` and its ~15 render
  helpers (battlefield/sprite composition, `renderMain()` — a ~280-line
  `switch` — and `renderFooter()` — a third `switch`).
- Net effect: every new screen (9 of the 25 `UiState` variants are
  `event*`) requires edits to `UiState`, `eventUiState()`, `handleKey()`,
  `renderMain()`, and `renderFooter()` — five call sites in one file for one
  new feature.

### Target layout

**`src/ui/state.ts`** — pure, App-independent:
- `UiState` and its satellites: `PickTargetSource`, `ItemDetailOrigin`,
  `ArtifactDetailOrigin`, `RewardEntry`.
- `eventUiState(eventId)`.
- Domain selectors used by both key-handling and rendering:
  `inventoryEntries`, `buildRewardEntries`, `ownedArtifactIds`,
  `cursedEquippedEntries`, `skillEntries`.

**`src/ui/layout.ts`** — pure formatting, no `App` or `Game` reference:
- Constants: `SLOT_WIDTH`, `SLOT_GAP`, `DIVIDER_WIDTH`, `EMPTY_ENEMY_WIDTH`,
  `UNIT_BLOCK_HEIGHT`.
- `centerText`, `truncateText`, `mergeBlocksHorizontally`, `monsterStyle`.

**`src/ui/screens/` — the screen-context pattern**

Introduce one small interface that any screen module can act against,
instead of each screen needing the whole `App`:

```ts
// src/ui/screens/context.ts
export interface ScreenContext {
  game: Game;
  setUi(next: UiState): void;
  reportUnusable(reason: string): void;
  logInfo(text: string): void;       // today: this.logHistory.push({ text, kind: "info" })
  syncUiToGameState(): void;
}
```

`App` implements this trivially (its existing private methods already have
these exact shapes) and passes `this` (typed as `ScreenContext`) into screen
modules. Each screen module exports 3 pure functions with an identical
shape, so `App` stays a thin dispatcher:

```ts
handleKey(ctx: ScreenContext, ui: <ThatScreen'sUiStates>, key: KeyEvent, digit: number | null): void
renderMain(game: Game, ui: <ThatScreen'sUiStates>): string | StyledText
renderFooter(ui: <ThatScreen'sUiStates>): string
```

**`src/ui/screens/events.ts`** (first concrete deliverable — matches the
review's callout, ~1/3 of `renderMain` and a large chunk of `handleKey`):
- Covers all 9 `event*` `UiState` kinds: `eventMerchant`,
  `eventMerchantPickPayer`, `eventCursedShrine`, `eventTwinAltars`,
  `eventTwinAltarsPickCharacter`, `eventTwinAltarsPickUnequip`,
  `eventHpGamble`, `eventHpGamblePickPayer`, `eventArtifactPick`,
  `eventHermit`, `eventHermitPickArtifact` (11, not 9 — recount includes the
  two-step flows).
- Moves the corresponding `case` blocks out of `handleKey` (lines
  516–652 today), `renderMain` (lines 1190–1289), and `renderFooter`
  (the `event*` cases at 1326–1341).
- `App.handleKey`'s switch keeps one line per event case:
  `case "eventMerchant": ... : eventsScreen.handleKey(this, this.ui, key, digit); break;`
  (repeated per event `kind`, or collapsed via a `kind.startsWith("event")`
  guard before the main switch — pick whichever keeps exhaustiveness
  checking on the remaining non-event cases).

**Remaining screens — same pattern, follow-up passes.** Once
`ScreenContext` exists and `events.ts` proves the shape, the rest of
`handleKey`/`renderMain`/`renderFooter` splits along the same seams:

| File | `UiState` kinds | Approx. current lines (handleKey / renderMain) |
|---|---|---|
| `screens/room.ts` | `room`, `rest` | 348–370 / 1023–1031, 1124–1127 |
| `screens/combat.ts` | `pickAction`, `pickSkill`, `pickItemInCombat`, `pickTarget`, `roundResolved`, `combatOver` | 371–429 / 1129–1188 |
| `screens/inventory.ts` | `pickItemOutOfCombat`, `itemDetail` | 451–467 / 1075–1092 |
| `screens/artifacts.ts` | `artifactMenu`, `artifactDetail`, `pickCharacterForArtifact` | 468–515 / 1033–1073 |
| `screens/rewards.ts` | `roomReward` | 430–450 / 1098–1122 |
| `screens/save.ts` | `saveMenu` | 482–494 / 1094–1096 |
| `screens/gameover.ts` | `gameover` | 653–654 / 1020–1021 |

`trySelectSkill` and `trySelectItem` (713–761) are shared by
`pickSkill`/`pickTarget` — they stay as `ScreenContext`-shaped helper
functions callable from `screens/combat.ts`, not methods on `App`.

**What stays in `app.ts`**: the constructor (renderer/layout wiring — this
is OpenTUI plumbing, not game logic, and doesn't belong in `ui/layout.ts`
which is pure string formatting), the top-level `handleKey`/`render`
dispatchers, `goBack()` (it's a single small state-transition table, cheap
to keep centralized so back-navigation stays reviewable in one place), and
the battlefield/sprite composition (`renderBattlefield`,
`renderCharacterLines`, `buildSideBlock`, etc.) — these already read from
`this.game.state` directly and are cohesive as "the pixel-art panel," not
per-screen.

### Sequencing
1. `state.ts` + `layout.ts` (pure extraction, zero risk — do first).
2. `screens/context.ts` + `screens/events.ts` (the named deliverable).
3. Remaining `screens/*.ts` files, one PR each, in the table's order —
   `combat.ts` last since it's the largest and most state-sensitive.

---

## 2. `src/engine/game.ts` — `Game`, 36 methods, 4 mixed responsibilities

### Current shape
`Game` mixes: dungeon movement (`move`, `postMoveCheck`,
`connectedRoomChoices`, `advanceToNextFloor`), combat delegation (`queue`,
`queueItem`, `autoTargets`, `resolve`, `readyToResolve`,
`clearFinishedCombat`), out-of-combat item/artifact use
(`useItemOutOfCombat`, `equipArtifact`, `unequipArtifact`), and **16 event
methods** (`merchantPurchase`/`merchantLeave`, `bloodAltarPay`/`Leave`,
`cursedShrineDecide`, `twinAltarsChoose`, `sacrifice`/`sacrificeLeave`,
`gamblingDenBet`/`Leave`, `hermitRemoveCurse`/`hermitRerollFortune`/`Leave`,
`collapsedFloorAttempt`/`Leave`) plus 2 private helpers shared only by those
16 (`payHpPercent`, `closeEvent`) — 18 of the 36 methods, exactly half the
class, exist to serve the 7 room-event minigames.

### Target layout

**`src/engine/events/shared.ts`**:
```ts
export function payHpPercent(character: Character, percent: number): number | null
export function closeEvent(state: GameState): void
```

**One file per event, exporting plain functions over `(state, ctx, ...)`**
(matches the existing convention in `party.ts`/`survival.ts` — free
functions taking state explicitly, not classes):

| File | Functions |
|---|---|
| `events/merchant.ts` | `merchantPurchase(state, offerIndex, payerCharacterId)`, `merchantLeave(state)`, `MERCHANT_PRICE_PERCENT` (moved from `game.ts`) |
| `events/bloodAltar.ts` | `bloodAltarPay(state, ctx, characterId)`, `bloodAltarLeave(state)`, `BLOOD_ALTAR_HP_PERCENT` |
| `events/cursedShrine.ts` | `cursedShrineDecide(state, accept)` |
| `events/twinAltars.ts` | `twinAltarsChoose(state, offerIndex, characterId, unequipArtifactId?)` |
| `events/sacrifice.ts` | `sacrifice(state, ctx, sacrificeArtifactId)`, `sacrificeLeave(state)` |
| `events/gamblingDen.ts` | `gamblingDenBet(state, ctx, artifactId)`, `gamblingDenLeave(state)` |
| `events/hermit.ts` | `hermitRemoveCurse(state, characterId, artifactId)`, `hermitRerollFortune(state, ctx, artifactId)`, `hermitLeave(state)` |
| `events/collapsedFloor.ts` | `collapsedFloorAttempt(state, ctx, characterId)`, `collapsedFloorLeave(state)`, `COLLAPSED_FLOOR_HP_PERCENT` |

Each function's body is a direct copy of the current `Game` method body with
`this.state` → `state` and `this.ctx` → `ctx`; none of these methods touch
any other `Game` internals today, so this is a mechanical extraction.

**`Game` keeps every method as a one-line delegate**, so `App` (and
`test/engine.test.ts`) need zero call-site changes:

```ts
merchantPurchase(offerIndex: number, payerCharacterId: Id) {
  return merchantPurchase(this.state, offerIndex, payerCharacterId);
}
```

`Game` re-exports `MERCHANT_PRICE_PERCENT`, `BLOOD_ALTAR_HP_PERCENT`,
`COLLAPSED_FLOOR_HP_PERCENT` from their new homes so `app.ts`'s existing
`import { MERCHANT_PRICE_PERCENT, ... } from "../engine/game"` doesn't need
to change either (or `app.ts` can be pointed at the event files directly —
either works, pick one during implementation and keep it consistent).

Result: `Game` drops from 36 to 20 methods, all either dungeon
movement/combat delegation or thin one-line event delegates; the actual
event *logic* — where a new event's rules would be written — lives in
`events/`, one file per event, so a new event is a new file plus one
delegate line, not a new case sprinkled through a 426-line class.

---

## 3. `src/engine/combat.ts` — `applySkillEffects` as a magnet function

### Problem
`applySkillEffects` (lines 538–571) is the single place every on-hit
mechanic has been bolted onto, in a fixed inline sequence: miss roll →
dodge roll → per-effect chance roll → ultimate scaling →
`resolveSkillEffect` → on-hit status rider → reflect damage → lifesteal →
poison-on-hit → heal-on-kill. The order is meaningful (a double-dip bug
between two of these was already fixed once) but is currently implicit —
you have to read the whole function top to bottom to know what runs after
what, and adding mechanic #7 means finding the right place to splice another
`if` into that sequence.

### Target: explicit hook pipeline

**`src/engine/combatHooks.ts`** (new file, so hooks are unit-testable
independent of the full `applySkillEffects` loop):

```ts
export interface SkillEffectHooks {
  /** Fires once per effect that successfully lands on a living target, any effect kind. */
  onHit?(source: Actor, target: Actor, log: LogEntry[]): void;
  /** Fires after a "damage" effect resolves with appliedAmount > 0. */
  onDamageDealt?(source: Actor, target: Actor, damage: number, ctx: EngineContext, log: LogEntry[]): void;
  /** Fires when a damage effect's target was alive before and dead after. */
  onKill?(source: Actor, target: Actor, log: LogEntry[]): void;
}

// Order matters and is now declared, not implied by call-site position:
export const combatHooks: SkillEffectHooks[] = [
  onHitStatusRiderHook,   // was applyOnHitRider — character source only
  reflectDamageHook,      // was applyArtifactReflectDamage — character target, enemy-facing only
  lifestealHook,          // was applyArtifactLifesteal — character source only
  poisonOnHitHook,        // was rollPoisonOnHit — character source only
  healOnKillHook,         // was applyArtifactHealOnKill — character source only, onKill
];
```

Each existing mechanic (`applyOnHitRider`, `applyArtifactReflectDamage`,
`applyArtifactLifesteal`, the `rollPoisonOnHit` call, `applyArtifactHealOnKill`)
becomes one hook implementation with the same guard condition it has today,
just named and isolated instead of inlined. `applySkillEffects` itself
shrinks to the roll logic (miss/dodge/per-effect chance/ultimate scaling)
plus three loop points that run `combatHooks`:

```ts
for (const hook of combatHooks) hook.onHit?.(source, target, log);
// ...after a damage effect resolves with appliedAmount > 0:
for (const hook of combatHooks) hook.onDamageDealt?.(source, target, appliedAmount, ctx, log);
// ...if that damage killed the target:
for (const hook of combatHooks) hook.onKill?.(source, target, log);
```

This doesn't change behavior (the hook list runs in the same order the
inline calls do today) — it makes the order a single readable array instead
of implicit control flow, and turns "add a new on-hit/on-kill mechanic"
into "append one hook object," not "find the right spot in a 34-line
function." **Do this before adding skill/class #22** per the review note —
it's the piece most likely to get a new dependent mechanic soon, and it's
much cheaper to insert a hook into an explicit array than to splice another
branch into the current inline version.

### Target: extract monster AI

**`src/engine/monsterAI.ts`** (new file, ~120 lines moving out of
`combat.ts`):
- `pickMonsterTarget(actor, livingChars, rng)`
- `pickMonsterAction(archetype, tier, rng)` + the `MonsterAction` type
- `resolveMonsterSkillTargets(skill, actor, livingChars, rng)`
- `pickAggroWeighted(characters, rng)`
- `runMonsterTurn(ref, combat, ctx)`

`runMonsterTurn` calls `applySkillEffects` and `hasStunningStatus`, both
currently private to `combat.ts` — both need `export` added.
`resolveRound` in `combat.ts` then imports `runMonsterTurn` from
`monsterAI.ts` (it already imports `runCharacterTurn`-equivalent logic
inline; after this move it calls the monster-turn dispatch the same way it
calls `runCharacterTurn` today). Note this creates a two-directional import
(`combat.ts` → `monsterAI.ts` for `runMonsterTurn`, `monsterAI.ts` →
`combat.ts` for `applySkillEffects`/`hasStunningStatus`) — this is fine
under ESM/Bun as long as neither side reads the other's binding at module
top level (both uses here are inside function bodies, called well after
both modules finish loading), but call it out in the PR description so a
reviewer doesn't mistake it for an accidental cycle.

After this, `combat.ts` keeps: combat lifecycle (`startCombat`,
`resolveRound`, `finalizeRound`, `isCombatOver`), queueing
(`queueAction`/`queueItemAction`/`checkSkillUsable`/`checkItemUsable`),
targeting (`autoResolveTargets`, `resolveExecutionTargets`), turn order
(`buildTurnQueue`, `turnOrderSortKey`), `runCharacterTurn`, and
`applySkillEffects` itself (now much shorter) — i.e. combat
orchestration, with monster decision-making and on-hit side-effects each
in their own file.

---

## 4. `test/engine.test.ts` — 1202 lines, one file

(Measured directly from `main` — the review's "2016 lines" likely reflects
a slightly different snapshot; treat the split below as targeting whatever
the file's current content is, not a specific line count.)

### Current shape
Ten `describe` blocks in one file, already logically separated by
`describe()` but not by file: floor layout, character creation, resolver,
aggro-weighted targeting, combat round structure, new skill mechanics,
elite/boss skill kit, items, artifacts, events. Every block re-derives
nothing shared except three helpers defined once at the top:
`makeCtx(seed)`, `spawnInto(ctx, archetypeId, depth)`,
`pickAnyAction(ctx, combat, ref)`.

### Target layout

**`test/helpers.ts`** — the three shared helpers above, exported, no
`describe`/`test` calls of their own. Every split-out file imports from
here instead of redefining or copy-pasting them.

| New file | `describe` block(s) moved in |
|---|---|
| `test/resolver.test.ts` | "resolver" |
| `test/combat-ranks.test.ts` | "combat round structure", "aggro-weighted targeting" (turn order, speed/`isBuff` initiative, MP/cooldown timing, dead-target redirect, multi-round victory) |
| `test/character-skills.test.ts` | "new skill mechanics" (Shield Guard, stun, Poison Coat on-hit rider, Purify dual-relation, ultimate scaling) |
| `test/monster-skills.test.ts` | "elite/boss skill kit" (action-weight pool, boss execute telegraph, elite cleave/strike, boss debuff) |
| `test/items.test.ts` | "items" |
| `test/artifact-effects.test.ts` | "artifacts" (aggregation helpers + all the `combat.ts`/`survival.ts`/`Game` integration tests currently tagged "(...integration)") |
| `test/events.test.ts` | "events" (rollEvent/rollArtifact* + every `Game` event-method test — pairs naturally with the `engine/events/*.ts` split in §2) |
| `test/engine.test.ts` (trimmed) | "floor layout" (or fold into `floorPatterns.test.ts`, which already carries a comment pointing at this file for the cross-check — worth resolving the duplication either direction), "character creation" |

This mapping is 1:1 with the module boundaries from §1–§3: once
`engine/events/*.ts` exists, `events.test.ts` importing directly from
`engine/events/merchant.ts` etc. (in addition to/instead of via `Game`) is
a natural option; once `monsterAI.ts` exists, `monster-skills.test.ts` can
import `pickMonsterAction`/`resolveMonsterSkillTargets` directly for
narrower unit tests alongside the existing `combat.ts`-integration ones.

---

## Suggested execution order

1. **§3 pipeline hooks** first, in isolation — it's the one piece flagged
   as blocking future work (next skill/class), and it's the smallest,
   lowest-risk change (one function's internals, no cross-file API change).
2. **§2 `Game` event extraction** — mechanical, no behavior change, unblocks
   the `events.test.ts` split.
3. **§1 `ui/state.ts` + `ui/layout.ts` + `screens/events.ts`** — depends on
   nothing above; can run in parallel with 1–2 if convenient.
4. **§3 `monsterAI.ts` extraction** — do after the hooks split so
   `runMonsterTurn`'s calls into `applySkillEffects` are already calling the
   shorter, hook-based version.
5. **§4 test split** — do last, after the corresponding source modules
   exist, so each new test file's imports point at its final home instead
   of needing a second pass.
6. **§1 remaining screens** (`room.ts`, `combat.ts`, `inventory.ts`,
   `artifacts.ts`, `rewards.ts`, `save.ts`, `gameover.ts`) — follow-up
   passes, one file per PR, no urgency beyond "next time that screen needs
   a change, extract it first."

Each numbered step should land as its own PR/commit: `bun test` green,
`bun run typecheck` (or equivalent) clean, and a diff that is verifiably
just code movement (no reordering of logic beyond what's called out above)
makes each step trivial to review in isolation.
