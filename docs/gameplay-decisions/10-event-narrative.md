# §10. Event Narrative Layer (PROPOSED — not yet implemented)

*(item 10 of `00-index.md`)*

**Status**: design proposal only. Nothing in this file is built — `data/events.json`, `src/types.ts`
(`GameState`), and the event handlers in `src/engine/events/*.ts` all still match `08-events.md`
exactly. This spec exists so the narrative direction can be reviewed and revised before any code
changes, following the same spec-then-implement pattern used for the Artifact/Currency/Survival
rework.

**Depends on / extends**: `08-events.md` (§8) — this file only adds a narrative layer on top of
the mechanics already specified there. **No mechanic described in §8 changes** unless explicitly
called out below (§10.4 has 2 small, opt-in exceptions).

**Why this matters more than it might look like**: Darkest Terminal is an RPG/roguelike running
entirely on a TUI (`design-doc.md` §1.1) — there's no cutscene, no character portrait, no
illustrated environment. **Text is the only tool the game has to convey its world.** A weak or
generic event description isn't a minor content gap the way it might be in a game with art to
carry the mood instead — on this medium, the flavor text *is* the game's entire sense of place.
This makes **§10.1 (the worldview/text pass) the priority of this spec**, not an equal-weight 1-of-3
alongside §10.2/§10.3. The recurring-NPC and event-chain mechanics in §10.2/§10.3 exist to *serve*
that text — giving it more to react to and remember — not the other way around; if only 1 part of
this spec ships, it should be §10.1.

**Scope chosen** (3 of 4 possible directions — see "Out of scope" at the end for the 4th):
1. **§10.1 — A coherent worldview.** Rewrite/extend event flavor text so all 11 events read as
   pieces of one world instead of 11 unrelated vignettes.
2. **§10.2 — Recurring characters.** The 3 events with a personified NPC (Merchant, Wandering
   Hermit, Gambling Den) can be met more than once per run and remember it.
3. **§10.3 — Event chains.** A player's repeated choices at certain events unlock a changed
   encounter later in the same run.

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
- No event ever *names* the Sleeper or the Covenant to the player in dialogue — the player is
  meant to infer the connection across a run/multiple runs, the same way the 3-eyed statue already
  reads as *something* without saying what. Adding an explicit "The Covenant of the Sleeper" line
  of dialogue would over-explain and undercut this.

### Proposed rewritten `description` text (drafts, not final)

Only the 5 events whose current text doesn't yet carry a Covenant thread are touched here; the 6
quoted in the table above already work as-is and are left unchanged.

| Event id | Current | Proposed |
|---|---|---|
| `open-chest` | *"A cracked oak chest sits crooked amid a pile of rubble, its lid ajar as if waiting for someone curious enough to come closer."* | *"A cracked oak chest sits crooked amid a pile of rubble. Whoever carried it this far didn't carry it any further."* (ties to "mundane remnant" without changing length/tone) |
| `merchant` | *"A trembling oil lamp casts light on a cloth spread with strange wares. A hooded figure bows in greeting, waving you closer."* | *"A trembling oil lamp casts light on a cloth spread with strange wares — relics too old to be anyone's but the Covenant's. A hooded figure bows in greeting, waving you closer."* |
| `sacrificial-circle` | *"Old dried blood stains the stone. The circle doesn't accept ordinary offerings — only something already enchanted."* | *"Old dried blood stains the stone in a pattern too deliberate to be an accident. The circle doesn't accept ordinary offerings — only something already enchanted."* |
| `wandering-hermit` | *"An old man sits meditating amid the rubble, eyes closed. 'I don't sell. I trade.'"* | *"An old man sits meditating amid the rubble, a Covenant brand scarred through on his forearm. 'I don't sell. I trade.'"* |
| `gambling-den` | *"A stranger shuffles 3 overturned cups, sneering in the dark. 'Give me what you have. I'll double it, or keep it for good.'"* | *"A stranger shuffles 3 overturned cups, sneering in the dark — no Covenant mark on them, no altar nearby. 'Give me what you have. I'll double it, or keep it for good.'"* |

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
}
```

```ts
// data/events.json — new OPTIONAL field, only set on the 3 personified events
EventDefinition {
  // ...unchanged...
  returnDescription?: string   // shown instead of `description` from the 2nd encounter onward
}
```

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
state.message = alreadyMet && event.returnDescription ? event.returnDescription : event.description;
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
| `gambling-den` | *"The stranger deals a fresh hand without looking up. 'Back for more? I like watching the same face lose twice.'"* |

**Effort/risk**: small. 1 new `GameState` field (needs `migration.ts` default for old saves — see
`migrateGameState` pattern already used for `coins`/`satiety`), 1 new optional JSON field, a
2-branch change in `resolveEventEntry`, reuse of the existing `currentEventDescription()` helper.
No change to any event's mechanics — Merchant/Hermit/Gambling Den still work exactly as in §8.4,
§8.10, §8.11.

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
  /** Running counters that unlock the escalated event variants in 10.3. Never decrease. */
  narrativeCounters: {
    guardianFightsSkipped: number;   // Game.skipGuardianFight() calls this run
    artifactsSacrificed: number;     // sacrifice() calls this run (08-events.md §8.9)
    hpPaidToAltars: number;          // cumulative HP cost paid at blood-altar + collapsed-floor
  };
}
```

### Chain 1 — "The Guardian's Grudge" (`guardianFightsSkipped`)

Reuses the Skip mechanic added in the previous session (`Game.skipGuardianFight`,
`src/engine/events/guardianFight.ts`) — currently a pure escape hatch with no narrative payoff.

- Increment `narrativeCounters.guardianFightsSkipped` inside `guardianFightSkip()`.
- Once it reaches a threshold (proposed: **3**), the *next* room that rolls `guardian-fight` or
  `desecrated-altar` uses an escalated description and **does not offer Skip** — mechanically
  identical fight, `enterGuardianFight()` is the only option shown.
  - Proposed text: *"There's nowhere left to walk past this — the thing you kept avoiding has
    stopped waiting to be noticed."*
- Resets the counter back to 0 after that forced encounter (so it can trigger again later in a
  long run rather than firing exactly once).

**Mechanical exception #1** (opt-in, can be dropped and keep this a pure-flavor chain): the forced
encounter could also apply `eventGuardianStatMultiplier` a second time (stacking to a harder
fight) to make "kept avoiding it" carry real weight. Flag this as **optional** — the chain works
as pure narrative without it.

### Chain 2 — "The Circle Remembers" (`artifactsSacrificed`)

- Increment `narrativeCounters.artifactsSacrificed` inside `sacrifice()` (`src/engine/events/sacrifice.ts:9`)
  each time it succeeds.
- Once it reaches a threshold (proposed: **5**, since Ritual Circle allows repeat sacrifices in one
  visit per §8.9 — this should be a cross-run total, not per-visit), every *subsequent*
  `sacrificial-circle` room uses an escalated description.
  - Proposed text: *"The circle recognizes your hand before you kneel. It doesn't ask anymore."*
- No mechanical change — `rollArtifactWithMinRarity` behaves exactly as in §8.9.

### Chain 3 — "Blood Debt" (`hpPaidToAltars`)

- Increment `narrativeCounters.hpPaidToAltars` by the `cost` value already computed in
  `bloodAltarPay()` and `collapsedFloorAttempt()` (`src/engine/events/bloodAltar.ts:12`,
  `src/engine/events/collapsedFloor.ts:13`) — both already return this number.
- Once cumulative cost crosses a threshold (proposed: **60% of a single character's typical
  maxHP at the current floor** — needs a concrete number once character HP curves are checked
  against `05-character-stats.md`, left as an open question rather than guessed here), the next
  `blood-altar` room uses an escalated description.
  - Proposed text: *"The stone recognizes the taste. It doesn't need to ask this time — it already
    knows you'll pay."*
- No mechanical change.

**Effort/risk**: medium. 1 new `GameState` field (3 sub-counters, same migration-default pattern as
§10.2), a 1-line increment inside 3 existing functions, and a description-selection branch similar
to §10.2's but keyed by counter threshold instead of "met before." Chain 1's optional mechanical
exception is the only place this section touches balance, and it's explicitly optional.

---

## 10.4 Summary of new `GameState` fields (both §10.2 and §10.3)

```ts
export interface GameState {
  // ...all existing fields unchanged...
  metNarrativeNpcIds: Id[];
  narrativeCounters: {
    guardianFightsSkipped: number;
    artifactsSacrificed: number;
    hpPaidToAltars: number;
  };
}
```

Both are additive or defaulted for old saves via `migrateGameState` (`src/engine/migration.ts`) —
`metNarrativeNpcIds: []` and `narrativeCounters: { guardianFightsSkipped: 0, artifactsSacrificed: 0, hpPaidToAltars: 0 }`
when absent, following the exact pattern already used there for `coins`/`satiety`.

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

## Out of scope (4th direction, not chosen)

**Framing narrative** — an overarching reason the party descends, revealed in stages by floor —
was offered as an option and not selected. Nothing in this spec assumes it; if it's picked up
later, §10.1's Sleeper/Covenant lore is written intentionally ambiguous enough to still support it
without contradiction (the "why is the party doing this" question is left fully open here on
purpose).
