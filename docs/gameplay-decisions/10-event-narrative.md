# §10. Event Narrative Layer (PROPOSED — not yet implemented)

*(item 10 of `00-index.md`)*

**Status**: design proposal only. Nothing in this file is built — `data/events.json`, `src/types.ts`
(`GameState`), and the event handlers in `src/engine/events/*.ts` all still match `08-events.md`
exactly. This spec exists so the narrative direction can be reviewed and revised before any code
changes, following the same spec-then-implement pattern used for the Artifact/Currency/Survival
rework.

**Depends on / extends**: `08-events.md` (§8) — this file only adds a narrative layer on top of
the mechanics already specified there. **No mechanic described in §8 changes** unless explicitly
called out below (§10.3 has 1 small, opt-in exception).

**Why this matters more than it might look like**: Darkest Terminal is an RPG/roguelike running
entirely on a TUI (`design-doc.md` §1.1) — there's no cutscene, no character portrait, no
illustrated environment. **Text is the only tool the game has to convey its world.** A weak or
generic event description isn't a minor content gap the way it might be in a game with art to
carry the mood instead — on this medium, the flavor text *is* the game's entire sense of place.
This makes **§10.1 (the worldview/text pass) the priority of this spec**, not an equal-weight 1-of-3
alongside §10.2/§10.3. The recurring-NPC and event-chain mechanics in §10.2/§10.3 exist to *serve*
that text — giving it more to react to and remember — not the other way around; if only 1 part of
this spec ships, it should be §10.1.

**Scope chosen** (4 of 5 possible directions — see "Out of scope" at the end for the 5th):
1. **§10.1 — A coherent worldview.** Rewrite/extend event flavor text so all 11 events read as
   pieces of one world instead of 11 unrelated vignettes.
2. **§10.2 — Recurring characters.** The 3 events with a personified NPC (Merchant, Wandering
   Hermit, Gambling Den) can be met more than once per run and remember it.
3. **§10.3 — Event chains.** A player's repeated choices at certain events unlock a changed
   encounter later in the same run.
4. **§10.5 — Post-event reflection choice.** Added after §10.1-§10.3 were reviewed — a short
   flavor-only choice after 9 of the 11 events, so the player pauses on the lore instead of
   clicking straight past it.

---

## 10.1 A coherent worldview

### The idea: the dungeon belongs to something called **the Sleeper**

Re-reading the *existing* flavor text (nothing quoted below is new) already half-implies a shared
mythology and nobody ever wrote it down:

- `desecrated-altar`: *"...touching it will surely wake **whatever sleeps beneath**."*
- `cursed-shrine`: *"A statue with **3 eyes**. One of them is open."*
- `twin-altars`: *"Two stone pedestals facing each other."*
- `blood-altar`: *"It demands a price paid in blood, nothing more, nothing less."*
- `sacrificial-circle`: *"The circle doesn't accept ordinary offerings — only something already enchanted."*
- `guardian-fight`: *"...something is guarding the treasure in this room."*

These 6 already read like they belong to the same cult. The proposal: name it explicitly, and use
that name to explain the events that currently feel unrelated or purely mechanical.

**The Sleeper** — an entity the dungeon was built to contain or worship (deliberately left
ambiguous which, in-universe — see "tone notes" below), never physically appears in the game.
Its presence is only ever felt through:

- **The Covenant** — a cult (extinct or still active, also left ambiguous) that built the shrines,
  altars, and guardians. Everything on this list is Covenant infrastructure:
  `guardian-fight`, `desecrated-altar`, `merchant`, `blood-altar`, `cursed-shrine`, `twin-altars`,
  `sacrificial-circle`.
- **The Hermit** — a Covenant priest who broke with it. Explains, in-fiction, why they're the
  *only* NPC who can strip a Cursed artifact (§8.6/§8.11): they know the Covenant's own rites and
  use them against it.
- **The Stranger** (Gambling Den) — explicitly **not** Covenant. An outsider who deals only in
  coin, never blood or artifacts as a *cost* (only as a rare *prize*, the round-4 jackpot). This
  already matches the existing mechanic (§8.10) — the fiction just makes it make sense.
- **Ordinary people** — `open-chest` and `collapsed-floor` stay mundane on purpose: remnants of
  past adventuring parties who didn't make it. No Covenant, no Sleeper, just the game's own
  permadeath theme reflected back at the player ("someone like you didn't make it out of here").

| Event id | Faction | Why (1 line) |
|---|---|---|
| `open-chest` | — (mundane) | belongings of a dead adventurer |
| `guardian-fight` | Covenant | a bound construct/ward guarding Covenant ground |
| `merchant` | Covenant | a pilgrim trading relics scavenged from deeper floors |
| `desecrated-altar` | Covenant | a Sleeper shrine, disturbed |
| `blood-altar` | Covenant | a pact-altar, blood is literally the toll |
| `cursed-shrine` | Covenant | the Covenant's idol — the "3 eyes" watch how deep the party has gone |
| `twin-altars` | Covenant | a Covenant rite that tests a pilgrim by forcing an irreversible choice |
| `sacrificial-circle` | Covenant | Covenant ritual ground — trades enchanted-for-enchanted only |
| `wandering-hermit` | ex-Covenant (apostate) | the only source that can strip a curse |
| `gambling-den` | outsider | explicitly not Covenant — coin only, never blood/artifacts as cost |
| `collapsed-floor` | — (mundane) | another trapped adventurer, not a Covenant device |

**Tone notes** (so a future writer doesn't drift):
- Never confirm whether the Sleeper is real, a delusion of the Covenant, or already dead. The game
  never resolves this — matches the terminal/ASCII aesthetic and the "personal side project, not a
  serious product" framing in `design-doc.md` (no cutscene budget, no lore dump screens).
- No event ever *names* the Sleeper or the Covenant to the player — not in dialogue, not in narrator
  prose either. The player only ever sees a **trace**: an unexplained mark, brand, or pattern that
  recurs across otherwise-unrelated events, and is meant to notice the repetition and get curious
  without being told what it means. Any name for the faction resolves later, at deeper floors — this
  section only earns the player the *feeling* that something out there is watching, never the name.
  Adding an explicit "The Covenant of the Sleeper" line (dialogue *or* narration) would over-explain
  and undercut this — an earlier draft of the table below did exactly that and was corrected.

### Proposed rewritten `description` text (drafts, not final)

Only the 5 events whose current text doesn't yet carry a Covenant thread are touched here; the 6
quoted in the table above already work as-is and are left unchanged.

| Event id | Current | Proposed |
|---|---|---|
| `open-chest` | *"A cracked oak chest sits crooked amid a pile of rubble, its lid ajar as if waiting for someone curious enough to come closer."* | *"A cracked oak chest sits crooked amid a pile of rubble. Whoever carried it this far didn't carry it any further."* (ties to "mundane remnant" without changing length/tone) |
| `merchant` | *"A trembling oil lamp casts light on a cloth spread with strange wares. A hooded figure bows in greeting, waving you closer."* | *"A trembling oil lamp casts light on a cloth spread with strange wares — each one bears a spiral mark burned into it. A hooded figure bows in greeting, waving you closer."* |
| `sacrificial-circle` | *"Old dried blood stains the stone. The circle doesn't accept ordinary offerings — only something already enchanted."* | *"Old dried blood stains the stone in a pattern too deliberate to be an accident. The circle doesn't accept ordinary offerings — only something already enchanted."* |
| `wandering-hermit` | *"An old man sits meditating amid the rubble, eyes closed. 'I don't sell. I trade.'"* | *"An old man sits meditating amid the rubble, a spiral mark scarred into his forearm. 'I don't sell. I trade.'"* |
| `gambling-den` | *"A stranger shuffles 3 overturned cups, sneering in the dark. 'Give me what you have. I'll double it, or keep it for good.'"* | *"A stranger shuffles 3 overturned cups, sneering in the dark — no brand on his skin, no altar in sight. 'Give me what you have. I'll double it, or keep it for good.'"* |

**Effort/risk**: lowest of the 3 directions. Pure content edit to `data/events.json`'s
`description` field, 5 rows. No code, no new state, no test changes. Could ship on its own.

---

## 10.2 Recurring characters

Only the 3 **personified** events qualify — the ones with a "someone" in the flavor text, not a
place or a mechanic: `merchant` (the pilgrim), `wandering-hermit` (the apostate), `gambling-den`
(the stranger). The other 8 events are locations/rituals, not characters, and don't get a "we've
met" callback.

### Data model

```ts
// src/types.ts — GameState, new field
export interface GameState {
  // ...unchanged...
  /** Ids of personified events (merchant/wandering-hermit/gambling-den) already met this run —
      drives the "return" flavor text in 10.2. Resets on New Game, persists through save/load. */
  metNarrativeNpcIds: Id[];
  /** Outcome of the player's most recent Gambling Den visit — undefined until the 1st visit closes.
      Drives which `returnDescription` variant `gambling-den` shows on the next visit (see below) —
      without this, the return line has no way to know what actually happened last time.
      "declined" covers `gamblingDenLeave()` fired before any round was played — a real path
      (§8.10), and text asserting a win/loss would be false for it. */
  lastGamblingDenOutcome?: "won" | "lost" | "declined";
}
```

```ts
// data/events.json — new OPTIONAL field, only set on the 3 personified events
EventDefinition {
  // ...unchanged...
  returnDescription?: string   // shown instead of `description` from the 2nd encounter onward
}
```

`gambling-den` needs 3 return variants instead of 1 plain string, since the line must branch on
`lastGamblingDenOutcome`. Simplest option that stays inside the existing `returnDescription?: string`
shape: store all 3 variants in `returnDescription` as a small lookup the render code switches on,
rather than adding a 2nd JSON field only 1 event uses:

```ts
// data/events.json — gambling-den only, replaces the single returnDescription string
"returnDescription": {
  "won": "The stranger deals a fresh hand without looking up. \"Didn't expect a winner to come back for more.\"",
  "lost": "The stranger deals a fresh hand without looking up. \"Back for more? I like watching the same face lose twice.\"",
  "declined": "The stranger deals a fresh hand without looking up. \"Changed your mind, or just scared?\""
}
```
(`EventDefinition.returnDescription` becomes `string | Record<"won" | "lost" | "declined", string>` —
only `gambling-den` uses the object form, the other 2 events keep the plain string. `resolveEventEntry`
picks the right branch off `state.lastGamblingDenOutcome`. Setting the field: `rollRound()`'s loss
branch and jackpot branch set `"lost"`/`"won"`, `gamblingDenStop()` sets `"won"` (banking a pot the
player chose to walk away with still counts as a win), `gamblingDenLeave()` sets `"declined"` — all 4
in `src/engine/events/gamblingDen.ts`.)

### Where this plugs into existing code

`resolveEventEntry` (`src/engine/dungeon.ts:68`) currently does:
```ts
const event = getEvent(room.rolledEventId);
state.message = event.description;
```
This becomes:
```ts
const event = getEvent(room.rolledEventId);
const alreadyMet = state.metNarrativeNpcIds.includes(event.id);
const returnText = typeof event.returnDescription === "string"
  ? event.returnDescription
  : event.returnDescription?.[state.lastGamblingDenOutcome ?? "declined"];
state.message = alreadyMet && returnText ? returnText : event.description;
if (event.returnDescription && !alreadyMet) state.metNarrativeNpcIds.push(event.id);
```
The same `alreadyMet` check needs to reach the UI screens in `src/ui/screens/events.ts`
(`eventMerchant`, `eventHermit`, `eventGamblingDen` render cases) via `currentEventDescription()` —
the helper added in the previous session already centralizes exactly this lookup, so this is a
1-function change, not a 3-call-site change.

**Why an array of ids, not a boolean per event**: `metNarrativeNpcIds` is already generic enough to
extend to more personified NPCs later without another `GameState` field — matches the "no
speculative code" rule in the sense that it's the *smallest* structure that still generalizes,
not a structure built for hypothetical future NPCs that don't exist yet.

### Proposed `returnDescription` drafts

| Event id | Return text (2nd+ meeting) |
|---|---|
| `merchant` | *"The same hooded figure — or one just like it. The wares are new, but the bow is exactly as before."* |
| `wandering-hermit` | *"The old man's eyes are already open, like he knew you'd be back. 'Trade again? I don't forget a fair deal.'"* |
| `gambling-den` (won) | *"The stranger deals a fresh hand without looking up. 'Didn't expect a winner to come back for more.'"* |
| `gambling-den` (lost) | *"The stranger deals a fresh hand without looking up. 'Back for more? I like watching the same face lose twice.'"* |
| `gambling-den` (declined) | *"The stranger deals a fresh hand without looking up. 'Changed your mind, or just scared?'"* |

**Effort/risk**: small. 2 new `GameState` fields (need `migration.ts` defaults for old saves — see
`migrateGameState` pattern already used for `coins`/`satiety`), 1 new optional JSON field (string or
a 3-key object, gambling-den only), a small branch in `resolveEventEntry`, reuse of the existing
`currentEventDescription()` helper. No change to any event's mechanics — Merchant/Hermit/Gambling Den
still work exactly as in §8.4, §8.10, §8.11.

---

## 10.3 Event chains (persistent consequences within a run)

Deliberately scoped to **3 small, independent chains** rather than a general branching-narrative
system — each reuses a counter the player's own choices already produce, and each changes flavor
text only unless marked "mechanical" below.

### Data model

```ts
// src/types.ts — GameState, new field
export interface GameState {
  // ...unchanged...
  /** Running counters that unlock the escalated event variants in 10.3. Never decrease
      (guardianFightsSkipped is the one exception — see Chain 1, it resets after firing). */
  narrativeCounters: {
    guardianFightsSkipped: number;   // Game.skipGuardianFight() calls this run
    artifactsSacrificed: number;     // sacrifice() calls this run (08-events.md §8.9)
    altarPaymentsCount: number;      // count of successful bloodAltarPay() + collapsedFloorAttempt() calls
  };
}
```

### Chain 1 — "The Guardian's Grudge" (`guardianFightsSkipped`)

Reuses the Skip mechanic added in the previous session (`Game.skipGuardianFight`,
`src/engine/events/guardianFight.ts`) — currently a pure escape hatch with no narrative payoff.

3 states now instead of 2, keyed off the same counter — a quiet buildup at 2, then the forced
encounter at 3. The buildup line is deliberately *not* a warning: it's 1 small word swapped into an
otherwise-normal description, easy to miss on a skim, meant for a player who's paying attention to
catch a hint of what's coming — a player who doesn't notice is accepted as a fine outcome, not a
bug to fix later.

- Increment `narrativeCounters.guardianFightsSkipped` inside `guardianFightSkip()`.
- **At 2**: the *next* room that rolls `guardian-fight` or `desecrated-altar` shows a subtle variant
  of its description — Skip is still offered, nothing mechanical changes, just 1 quiet detail added.
  - `guardian-fight` at 2: *"The scrape of claws on stone echoes from a dark corner — something is
    guarding the treasure in this room, and this time it doesn't look away."* (only change from the
    base line: "just caught your scent" → "doesn't look away" — same length, same rhythm, meant to
    slide past on a skim)
  - `desecrated-altar` at 2: *"The stone altar glows with a pale red light, pulsing as if breathing —
    touching it will surely wake whatever sleeps beneath, and it's been stirring since you walked
    past the last one."* (adds a 6-word clause referencing a prior skip, otherwise unchanged)
- **At 3** (threshold unchanged): the *next* room that rolls `guardian-fight` or `desecrated-altar`
  uses the already-drafted escalated description and **does not offer Skip** — mechanically identical
  fight, `enterGuardianFight()` is the only option shown.
  - Proposed text: *"There's nowhere left to walk past this — the thing you kept avoiding has
    stopped waiting to be noticed."*
- Resets the counter back to 0 after that forced encounter (so it can trigger again later in a
  long run rather than firing exactly once) — this also resets the "at 2" buildup line back to
  available for the next cycle.

This needs a 3rd optional `EventDefinition` field beyond `returnDescription` — proposed
`chainBuildupDescription?: string` (shown at count 2) and reuse of the existing escalated-text idea
above as `chainForcedDescription?: string` (shown at count 3, Skip hidden). Only `guardian-fight` and
`desecrated-altar` set these 2 fields.

**Mechanical exception #1** (opt-in, can be dropped and keep this a pure-flavor chain): the forced
encounter could also apply `eventGuardianStatMultiplier` a second time (stacking to a harder
fight) to make "kept avoiding it" carry real weight. Flag this as **optional** — the chain works
as pure narrative without it.

### Chain 2 — "The Circle Remembers" (`artifactsSacrificed`)

- Increment `narrativeCounters.artifactsSacrificed` inside `sacrifice()` (`src/engine/events/sacrifice.ts:9`)
  each time it succeeds.
- Once it reaches a threshold (proposed: **5**, since Ritual Circle allows repeat sacrifices in one
  visit per §8.9 — this counts across the whole run/`GameState` lifetime, i.e. every sacrifice from
  every visit added together, not reset per room visit or per floor), every *subsequent*
  `sacrificial-circle` room uses an escalated description.
  - Proposed text: *"The circle recognizes your hand before you kneel. It doesn't ask anymore."*
- No mechanical change — `rollArtifactWithMinRarity` behaves exactly as in §8.9.

### Chain 3 — "Blood Debt" (`altarPaymentsCount`)

Originally scoped as a cumulative-HP counter; changed to a plain payment count after review. Both
`bloodAltarPay()`/`collapsedFloorAttempt()` compute `cost` as `floor(maxHp × percent / 100)`
(`src/engine/events/shared.ts` `payHpPercent`) — a % of the character's *current* `maxHp`, which
grows every level-up within the same run (`05-character-stats.md`). Summing raw `cost` would have
conflated 2 different things: how often a character pays blood tribute (the behavior this chain is
meant to track) vs. how strong that character has grown (unrelated) — a level-15 character paying
once could out-weigh a level-2 character paying 4 times. Counting visits instead of HP sidesteps
this entirely and needs no HP-curve math, so the "60% of typical maxHP" open question is dropped.

- Increment `narrativeCounters.altarPaymentsCount` by 1 on every successful `bloodAltarPay()` and
  `collapsedFloorAttempt()` call (`src/engine/events/bloodAltar.ts:12`,
  `src/engine/events/collapsedFloor.ts:13`) — "successful" meaning `payHpPercent` didn't return
  `null` (the character had enough HP to pay).
- Once it reaches a threshold (proposed: **4** — same order of magnitude as Chain 1's 3 and Chain
  2's 5, no stronger justification than that; revisit once playtesting shows how often these 2
  event types actually come up), the next `blood-altar` room uses an escalated description.
  - Proposed text: *"The stone recognizes the taste. It doesn't need to ask this time — it already
    knows you'll pay."*
- No mechanical change.

**Effort/risk**: medium. 1 new `GameState` field (3 sub-counters, same migration-default pattern as
§10.2), a 1-line increment inside 3 existing functions, and a description-selection branch similar
to §10.2's but keyed by counter threshold instead of "met before." Chain 1's optional mechanical
exception is the only place this section touches balance, and it's explicitly optional.

**Open direction, not yet specified**: once a chain fires (Chain 2/3 especially, since they don't
reset), the escalated text becomes the permanent state for the rest of a long run — given floor
depth is unlimited (`06-level-system.md:71`), any run that goes deep enough will eventually hit both.
That's being kept as-is rather than designed around, because there's an intent to layer in further
escalation tiers past the current single threshold (i.e. more than 1 step of "how deep is this" per
chain) — deferred to a future revision of this section once that idea is fleshed out, not blocking
the rest of §10.3.

---

## 10.5 Post-event reflection choice

A 4th direction, added after §10.1-§10.3 were already reviewed — the goal is different from §10.1-3:
those make the *world* feel coherent; this makes sure the player actually *stops and reads* it,
instead of clicking through an event's resolution straight into the next room without registering
what just happened. After an eligible event resolves, show 1 short reflective line plus 2-3 response
options the player picks from — purely characterization, **no reward/stat/mechanical effect of any
kind**. Whether a chosen stance ever feeds back into later content (an escalated Chain description,
a recurring NPC's return line, a deeper-floor reveal) is explicitly **undecided** — the choice is
saved so that door stays open, not because a concrete payoff is designed yet.

### Scope — which events

**9 of 11** — every event except `open-chest` and `collapsed-floor`. Those 2 are the ones §10.1
deliberately kept mundane (no Covenant, no NPC, "someone like you didn't make it out of here") —
giving them a reflection beat would work against that by implying there's something to reflect on.

### Frequency

- **1st time the player resolves a given event id this run**: always shown (100%).
- **Every time after that**: a chance, proposed **50%** (user asked for "40-60%" — picking the
  midpoint as the tunable default; belongs in `data/balance-config.json` under `events`, e.g.
  `reflectionRepeatChance: 0.5`, not hardcoded).

### Data model

```ts
// src/types.ts — GameState, new field
export interface GameState {
  // ...unchanged...
  /** Player's most recent post-event reflection choice per event id (§10.5) — overwritten on each
      re-trigger, not a history log. Purely flavor today; kept as groundwork for future content that
      reacts to how the player has responded to the mystery so far — not yet designed, see above. */
  eventReflectionStances: Partial<Record<Id, "curious" | "wary" | "dismissive">>;
}
```

```ts
// data/events.json — new OPTIONAL field, on the 9 in-scope events only
EventDefinition {
  // ...unchanged...
  reflection?: {
    prompt: string;                                    // the reflective line shown after resolution
    options: { curious: string; wary: string; dismissive: string };  // 1 short reaction line each
  };
}
```

Reusing the same 3-way stance (`curious` / `wary` / `dismissive`) across all 9 events instead of
bespoke per-event choice sets keeps this a **1 UI template, 1 enum** feature rather than 9 different
choice shapes — matches how §10.2 reused 1 boolean-ish check (`alreadyMet`) across 3 NPCs instead of
per-NPC state shapes. Only the *flavor text* is bespoke per event; the *meaning* of picking each
stance is shared.

### Where this plugs into existing code — the part that isn't free

**`closeEvent()` is not actually the universal hook** — an earlier draft of this section assumed it
was; checked against the real call sites and 1 event pair breaks that assumption. Every *choice-based*
event handler (7 of 9: merchant, blood-altar, cursed-shrine, twin-altars, sacrificial-circle,
wandering-hermit, gambling-den) does end by calling `closeEvent(state)` (`src/engine/events/shared.ts:13`,
`(state: GameState) => void`). But `guardian-fight`/`desecrated-altar` (both `kind: "combatReward"`)
only call it on the **Skip** path (`guardianFightSkip`) — the **Fight-and-win** path never calls
`closeEvent` at all. Winning clears the room through `Game.resolve()`'s shared combat-resolution
branch instead (`src/engine/game.ts:274-280`, `if (this.state.combat.outcome === "victory") { ...
room.cleared = true; ... }`), the same method every regular combat room's victory goes through — it
isn't event-specific. So this section needs **2 hooks**, not 1: `closeEvent()` for the 7 choice-based
events + the Skip half of the 2 combat events, and a 2nd check inside `Game.resolve()`'s victory
branch (gated to only fire when the cleared room's event was `combatReward`) for the Fight-and-win
half.

The "50% on repeat" roll also needs `ctx.rng`, and **not every caller of `closeEvent` currently has
`ctx: EngineContext` in scope** (`Game.resolve()` already has `ctx` via `this.ctx`, so the 2nd hook
above doesn't have this problem):

| Has `ctx` already | Doesn't have `ctx` yet |
|---|---|
| `bloodAltarPay`, `collapsedFloorAttempt`, `gamblingDenEnter`, `gamblingDenContinue` (both via the shared `rollRound` helper), `hermitExchangeFortune` | `bloodAltarLeave`, `collapsedFloorLeave`, `cursedShrineDecide`, `gamblingDenStop`, `gamblingDenLeave`, `guardianFightSkip`, `hermitLeave`, `merchantPurchase`, `merchantLeave`, `sacrificeLeave`, `twinAltarsChoose` |

Note `cursedShrineDecide`, `merchantPurchase`, and `twinAltarsChoose` are **not** cancel/leave paths —
they're the actual primary resolution for those 3 events. Threading `ctx` through the right-column
functions (mechanical — `ctx` already exists at their call sites in `game.ts`, just not passed down)
is needed so the 50% repeat-roll works consistently across all 9 events; skipping that thread would
leave those events' repeat-visits always silently skipping the reflection instead of rolling for it,
an inconsistency worth avoiding rather than shipping quietly. This, plus the 2-hook split above, is
why this section is medium-effort despite being "just a dialogue box."

A new UI screen state is also needed (shown after either hook runs, before returning to the dungeon
view) — the exact routing hook wasn't traced here since it depends on how `src/ui/app.ts`'s screen
state machine is structured; that's Phase-1-of-implementation work, not spec work.

### Content — 2 worked examples (template for the remaining 7)

Writing quality here matters the same way it did for §10.1 (`design-doc.md` §1.1 — text is the whole
game) — proposing all 9 in 1 pass risks the same generic-first-draft problem §10.1 hit. These 2 are a
template to validate tone before writing the rest as a dedicated pass:

**`guardian-fight`**
- Prompt: *"The guardian's ashes still carry a trace of incense, not decay. Something tended this
  room, once."*
- curious: *"Worth remembering — someone built this on purpose."*
- wary: *"Better not to think about who."*
- dismissive: *"Just a monster. Move on."*

**`merchant`**
- Prompt: *"The hooded figure never once lifted the hood, not even to count your coin."*
- curious: *"You find yourself wondering what's under there."*
- wary: *"You don't ask. Some things are better left covered."*
- dismissive: *"Not your business. You got what you came for."*

Remaining 7 (`desecrated-altar`, `blood-altar`, `cursed-shrine`, `twin-altars`, `sacrificial-circle`,
`wandering-hermit`, `gambling-den`) follow the same shape — deferred to the writing pass.

**Effort/risk**: medium — content volume is the largest of any section here (9 prompts × 3 options =
27 short lines, plus 9 setup lines), the `ctx`-threading fix above touches ~11 function signatures +
their call sites in `game.ts`, and the trigger needs 2 separate hooks (`closeEvent()` plus
`Game.resolve()`'s victory branch) instead of 1, though each individual change is mechanical, not
risky. No mechanical/reward effect anywhere in this section, by design.

---

## 10.4 Summary of new `GameState` fields (§10.2, §10.3, §10.5)

```ts
export interface GameState {
  // ...all existing fields unchanged...
  metNarrativeNpcIds: Id[];
  lastGamblingDenOutcome?: "won" | "lost" | "declined";
  narrativeCounters: {
    guardianFightsSkipped: number;
    artifactsSacrificed: number;
    altarPaymentsCount: number;
  };
  eventReflectionStances: Partial<Record<Id, "curious" | "wary" | "dismissive">>;
}
```

All are additive or defaulted for old saves via `migrateGameState` (`src/engine/migration.ts`) —
`metNarrativeNpcIds: []`, `lastGamblingDenOutcome` left `undefined`,
`narrativeCounters: { guardianFightsSkipped: 0, artifactsSacrificed: 0, altarPaymentsCount: 0 }`, and
`eventReflectionStances: {}` when absent, following the exact pattern already used there for
`coins`/`satiety`.

---

## Suggested phasing (if approved)

Each phase is independently shippable and doesn't block on the next one — but they are **not**
equal priority (see "Why this matters" above). §10.1 should land first and get the most editorial
attention, since on a TUI it's carrying weight that would otherwise be split across art/audio/UI
in a non-terminal game:

1. **§10.1 — priority.** Content-only, `data/events.json` text edits, zero code risk. Worth a
   dedicated writing/review pass on its own, not just "good first PR" — this is the deliverable
   that actually reaches the player's imagination every single event room, every run. §10.2/§10.3
   only pay off if this text is already doing its job.
2. **§10.2** — adds `metNarrativeNpcIds`, touches `resolveEventEntry` + `currentEventDescription()`.
   Only worth doing once §10.1's per-event voice is settled, since the "return" lines in §10.2 need
   to match a tone that's already been locked in.
3. **§10.3** — adds `narrativeCounters`, touches 3 event handler functions + migration. Chain 1's
   mechanical exception (stat-multiplier stacking) should be a separate decision/PR from the rest
   of §10.3, since it's the only part that isn't pure flavor.
4. **§10.5** — adds `eventReflectionStances`, hooks both `closeEvent()` and `Game.resolve()`'s victory
   branch, threads `ctx` through ~11 function signatures, plus a new UI screen state and 9 events'
   worth of reflection content. Same dependency as §10.2: the reflection lines need §10.1's voice
   already locked in. Largest content
   volume of the 4 sections — worth planning as its own dedicated writing pass, same as §10.1.

## Out of scope (5th direction, not chosen)

**Framing narrative** — an overarching reason the party descends, revealed in stages by floor —
was offered as an option and not selected. Nothing in this spec assumes it; if it's picked up
later, §10.1's Sleeper/Covenant lore is written intentionally ambiguous enough to still support it
without contradiction (the "why is the party doing this" question is left fully open here on
purpose).
