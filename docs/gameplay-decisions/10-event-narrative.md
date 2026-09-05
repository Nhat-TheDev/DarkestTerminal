# §10. Event Narrative Layer

*(item 10 of `00-index.md`)*

**Status**: the shared worldview, recurring characters, event chains, and post-event reflection
originally proposed here are built and documented in `08-events.md` §8.13-§8.16. The hidden
ground-truth worldview behind that player-facing text (what the Sleeper/Covenant actually are,
never told to the player) lives in `11-world-bible.md`. Part C (variant pool, cross-event
continuity, chain tier 3, and the 8 new events) is now fully implemented — see Part A. This file's
remaining live content is the relationship graph (Part B, reference material for anyone extending
it) and the implemented mechanisms' data models and rationale (Part C, kept as the design record —
not a to-do list). Every quote below has already passed a craft review (cringe/slop/craft) and a
compliance check against `11-world-bible.md`.

---

## Part A — Implemented

**Chain tier 2** (`08-events.md` §8.15, `11-world-bible.md` §11.13): each of the 3 event chains now
escalates twice, not once. Gated by `circleRemembersThreshold2`/`bloodDebtThreshold2`/
`guardianGrudgeFiredCount` **and** `chainTier2MinFloorDepth: 15` together — a chain can't reach
tier 2 on counter alone. Live in `src/engine/dungeon.ts`, `src/engine/events/guardianFight.ts`,
`src/engine/events/shared.ts`; tested in `test/events.test.ts`.

**Framing narrative superseded**: this file used to record a deliberate choice not to give the
party a single reason for descending. `11-world-bible.md` §11.5 ("the Call") reversed that — still
never told to the player, but internally no longer an open question.

**Description variant pool, cross-event continuity, chain tier 3, and 8 new events** (Part C.1-C.5
below): all built. `data/events.json` carries every `crossEventVariants`/`descriptionVariants`/
tier-3 field and the 8 new event entries; `src/types.ts`, `src/data/events.ts`,
`src/engine/dungeon.ts`, `src/engine/events/{shared,guardianFight,bloodAltar,collapsedFloor,
sacrifice,openChest}.ts`, `src/engine/game.ts`, `src/engine/migration.ts`, and
`src/ui/screens/events.ts` carry the engine side. Tested in `test/events.test.ts`.

**Reflection stance payoff**: `11-world-bible.md` §11.13's resolved direction (flavor only, never
mechanical, never a strict classifier, each stance readable more than one way) is built as
`EventDefinition.stanceEcho?: { curious, wary, dismissive }` — `dominantReflectionStance()`
(`src/engine/dungeon.ts`) reads the party's most-picked stance across
`GameState.eventReflectionStances` (undefined if none recorded yet or tied) and appends the
matching line to a `returnDescription` visit. Wired for `wandering-hermit` only so far — he's the 1
of the 3 recurring figures whose own backstory (§11.8) makes him plausible to notice a pattern in
someone else. `merchant`/`gambling-den` could get their own `stanceEcho` later the same way.

**`collapsed-floor`'s own crossEventVariant + a specific `eventOutcomes` value**: outcome tag split
from a single generic `"attempted"` into `"rescued"`/`"failed"` (`collapsedFloorAttempt()`,
`src/engine/events/collapsedFloor.ts`) so a later `collapsed-floor` visit — and `blood-altar`'s pair
3 — can read whether the trapped person was actually reached in time, not just that a payment was
made. `old-count`/`doubled-back`'s existing "any resolution of collapsed-floor" conditions were
widened from `attempted`/`declined` to `rescued`/`failed`/`declined` to match.

**Item lore's `guaranteedArtifactId`** (`07-items-artifacts.md`): built —
`EventDefinition.guaranteedArtifactId?: Id`, checked in `openChest()`
(`src/engine/events/openChest.ts`) ahead of the standard roll. Wired for `waiting-supplies` only so
far, pointing at the already-existing `travelers-ration` (not the not-yet-added
`bundle-of-undelivered-letters`, since the 47-item catalog rewrite in `07-items-artifacts.md` is
still spec-only — using an id that doesn't exist in `data/artifacts.json` yet would throw at
runtime). `vigil-candle`/`broken-seal`/`half-a-warning` still roll the standard table until their
own dedicated items are actually added to the catalog.

**`the-delay` now `noArtifactReward: true`**: previously granted a free artifact like every other
common `instantReward` event, contributing to commons reading as an unbroken loot piñata. Converted
to the purest "no cost, no reward, information only" case — consistent with its own established
role as the template for events that need no lore/institution baggage at all (Part C.5).

---

## Part B — The relationship graph

19 events total, all live in `data/events.json` (`old-count`, `doubled-back`, `the-delay`,
`waiting-supplies`, `vigil-candle`, `broken-seal`, `half-a-warning`, and `still-breathing` were the
8 added by Part C).

### B.1 — What each event teaches the player

The single most important table in this file. "Learns" is never something the game states —
it's what an attentive player is positioned to infer after the scene, per `11-world-bible.md`
§11.11's "one observable change, let the player supply the cause."

| Event | Thread | Learns (inferred, never stated) |
|---|---|---|
| `blood-altar` | 1 | A blind toll has an exact, predictable price — no more, no less. |
| `sacrificial-circle` | 1 | Repeating the same trade enough times stops requiring their consent (Chain 2). |
| `twin-altars` | 1 | Some choices here are forced to be final; hesitation isn't an option. |
| `collapsed-floor` | 1 & 4 | Heroism and worship cost the identical thing to whatever's counting — the clearest single proof of §11.10's thesis. |
| `cursed-shrine` | 1 | Seeing the price in advance doesn't make it smaller, only less blind. |
| `guardian-fight` | 2 | Some tolls aren't offered as a choice — avoided long enough, they're taken anyway (Chain 1). |
| `desecrated-altar` | 2 | Same as `guardian-fight` — same mechanic, different location. |
| `broken-seal` (15) | 2 | The containment/communion split isn't just belief — someone fought over it, recently, violently. |
| `half-a-warning` (35) | 2 | Switching sides between containment and communion isn't just doctrinally frowned on — it gets people killed. |
| `merchant` | 3 | Commerce here is ritualized to the point of erasing the person performing it. |
| `wandering-hermit` | 3 | Exact balance is a discipline, not a virtue — learned the hard way, not chosen freely. |
| `gambling-den` | 3 | Not everyone down here is touched by the deeper pattern — some just profit from those who are. |
| `waiting-supplies` | 3 & 4 | Others made this same descent, with the same intent to return, and didn't. |
| `still-breathing` (70) | 3 | The spiral was never invented — it was copied from something real. |
| `open-chest` | 4 | People die here doing ordinary things. No charge, no lesson — just mortality. |
| `doubled-back` | 4 | Space itself doesn't always account for where someone went. |
| `old-count` | 4 | Obsessive repetition happened to someone else here first — an echo of drift (§11.5) in a stranger's story, not the party's own. |
| `the-delay` | 4 | Their own senses aren't fully reliable here — the clearest "this is a dream" evidence that needs no Covenant framing at all. |
| `vigil-candle` (15) | 5 | Physical law doesn't fully hold here. No new fact — the first *felt*, physical proof of it. |

### B.2 — Thread diagrams

**Thread 1 — The Balance core** (§11.4, §11.12's Submission/Scarcity/Informed-risk row)

```
        ┌──────────────┐
   ┌───►│ blood-altar  │◄──┐
   │    └──────┬───────┘   │
   │           │↕           │
   │    ┌──────▼──────────┐│
   │    │sacrificial-circle││
   │    └──────┬──────────┘│
   │           │            │
┌──┴────────┐  │      ┌─────┴──────┐
│collapsed- │  └─────►│ twin-altars│
│  floor    │         └────────────┘
└───────────┘
        │
        ▼
  ┌──────────────┐
  │ cursed-shrine │  ← reads Thread 1 exposure generally (blood-altar OR sacrificial-circle)
  └──────────────┘
```

`blood-altar` ↔ `collapsed-floor`: bidirectional, share Chain 3's counter. `blood-altar` ↔
`sacrificial-circle`: bidirectional, both communion-leaning. `twin-altars`, `cursed-shrine`: read
Thread 1 exposure, don't write back to it (1-directional in).

**Thread 2 — The Covenant schism** (§11.6's containment/communion split)

```
Thread 1 (communion use) ──────► guardian-fight / desecrated-altar (containment)
                                          │
                                          │ (party's own recent lean colors the reading)
                                          ▼
                                   broken-seal (floor 15)
                                          │
                                          │ (depth escalation, not a text-variant edge)
                                          ▼
                                   half-a-warning (floor 35)
                                          │
                                          ▼
                                   blood-altar (pair 8 — echoes back into Thread 1)
```

**Thread 3 — The three NPCs** (§11.7-11.8's contact line)

```
Thread 1 ──────────────────► wandering-hermit ◄────────── Thread 2
                                     (general sensed imbalance, either direction — he's ex-Covenant,
                                      §11.8 — but never named as such, and never specific)

Thread 1 ──────────────────► gambling-den
                                     (Thread-1-to-Stranger only — never NPC-to-NPC, §11.7)

merchant ───────────────────► waiting-supplies
merchant ◄─────────────────── still-breathing (floor 70)
```

**Thread 4 — Traces of those before** (deliberately outside Covenant, §8.13)

```
open-chest ─────┬──────► doubled-back
                │
collapsed-floor ┘──────► old-count
   (bridges Thread 1 and Thread 4 at once — §11.10's own point, same shape, different story)

the-delay stays unconnected — pure dream-logic, no institution, no remnant-of-a-person framing
```

**Thread 5 — Depth escalation** (reveal *order*, not text-variants — §11.11: "closer, not a new area")

```
floor 15 ── vigil-candle (pure atmosphere, deliberately unconnected)
         └─ broken-seal (Thread 2)
floor 35 ── half-a-warning (deepens Thread 2, echoes into Thread 1 via pair 8)
floor 70 ── still-breathing (recontextualizes the spiral itself, echoes into Thread 3 via pair 7)
```

Pacing rationale, one sentence per milestone: floor 15 is where the party first notices a history
before them (someone was here, something happened); floor 35 is where that history turns out to
involve real conflict between people (the containment/communion split cost someone their life);
floor 70 is where the dungeon's own material contradicts how that history explained itself (the
symbol both sides fought over wasn't theirs to begin with). Each step deepens *what's known*, never
*what's resolved* — §11.9 stays untouched throughout.

### B.3 — Deliberately absent bridges

Thread 2↔4, Thread 3↔4, Thread 4↔5 don't connect, and shouldn't: all 3 would tie the
deliberately-mundane, no-Covenant events (§8.13) to Covenant/dream-contact material, crossing the
exact boundary those events exist to hold. Checked, not overlooked.

---

## Part C — Implemented (design record)

Kept as the data model and rationale behind what's now live — not a to-do list. One deviation from
the original spec below: `events.hintTier2MinFloorDepth`/`deepEventMinFloorDepth`/
`hardcoreEventMinFloorDepth` balance-config fields were dropped during implementation — nothing in
code ever reads a depth gate from balance-config, only from `event.minFloorDepth` directly, so
those fields would have been inert. The literal depth numbers (15/35/70) live directly on each
event in `data/events.json` instead, matching how `forceEquip` and other event-specific values
already work.

### C.1 — Cross-event continuity

**Compliance rule** (the one rule every pair below was checked against): every variant is the
*party's own* behavior or perception changing — never an NPC, a Guardian, or the dream recognizing
or reacting to the party's specific history (`11-world-bible.md` §11.4, §11.11). *"It already
knows you paid the blood price"* — violation. *"Your hand is already open before you've chosen who
pays"* — compliant; the party drifted (§11.5), nothing external changed. One narrow exception:
the Hermit may show a *general* sensed-imbalance reaction ("something uneven walked in"), per his
established character (§11.8) — never specific ("you visited blood-altar").

**Density cap**: the strongest version of drift — the body acting before the mind decides ("your
hand is already moving") — is reserved for exactly 2 pairs across the whole graph: pair 3 (the
literal return to `blood-altar`) and pair 8 in C.4 (the `half-a-warning`-informed return, where
the point is specifically that knowing better doesn't stop it). Every other Thread-1-exposure pair
below stays in the same emotional register — foreknowledge, dulled reaction, a pattern being
noticed — without repeating that exact motor-control image. A single Thread-1-heavy run can trigger
5+ of these variants; if all of them showed the same "body moved on its own" beat, the motif would
read as a system announcing itself rather than a moment landing.

**Data model**:

```ts
// src/types.ts
interface EventOutcomeCondition { eventId: Id; outcome: string; }
interface CrossEventVariant {
  when: EventOutcomeCondition[];
  match: "all" | "any";   // AND / OR
  description: string;
}
// on EventDefinition
crossEventVariants?: CrossEventVariant[];
```

```ts
// GameState
/** Outcome tag per event id, set when that event's defining choice resolves. Never reset mid-run.
    Most events only need the generic "resolved" fallback (set once, in closeEvent(), guarded by
    "not already set" so a specific tag written earlier in the same call is never clobbered) — only
    events named in some crossEventVariant's `when` need a specific tag from their own handler. */
eventOutcomes: Partial<Record<Id, string>>;
```

**Resolution priority in `pickEventText()`** (extends the existing pipeline):
`returnDescription` → chain buildup/forced/forced2/forced3 → chain escalated/escalated2/escalated3
→ **`crossEventVariants`** (first array entry whose condition matches) → **`descriptionVariants`**
random pool → `description` fallback. Chain states return immediately and never also show a
cross-event variant — stacking 2 special states in one scene violates the one-observable-change
rule.

**Outcome tags to record** (only where the generic `"resolved"` fallback isn't precise enough):

| Event | Tag | Set where |
|---|---|---|
| `blood-altar` | `"paid"` / `"declined"` | `bloodAltarPay()` / `bloodAltarLeave()`, before `closeEvent()` |
| `collapsed-floor` | `"attempted"` / `"declined"` | `collapsedFloorAttempt()` (either outcome — payment is what matters) / the skip path |
| `sacrificial-circle` | `"sacrificed"` | `sacrifice()`, on any successful call |

**All 15 pairs, final text**:

1. `collapsed-floor` ← `blood-altar`=`paid`: *"One wrong step and you fall through to the floor
   below. A weak groan echoes up from the crack. It sounds like the last one did. You don't say so
   out loud."*
2. `collapsed-floor` ← `blood-altar`=`declined`: *"One wrong step and you fall through to the
   floor below. A weak groan echoes up from the crack. You hesitate. You know exactly how easy it
   would be to just keep walking."*
3. `blood-altar` ← (`collapsed-floor`=`attempted` OR `sacrificial-circle`=`sacrificed`): *"Ancient
   carvings on the stone pedestal ooze a dark, still-warm liquid, a spiral unwound and open at its
   center. Your hand is already open before you've chosen who pays."*
4. `guardian-fight`/`desecrated-altar` ← (`blood-altar`=`paid` OR `sacrificial-circle`=`sacrificed`),
   same closing line, own imagery per id (an anti-cringe-slop pass caught the original draft
   sharing guardian-fight's claws/dark-corner text verbatim on desecrated-altar, which has never
   once used that imagery anywhere else — the same category of mistake tier 1's
   `chainForcedDescription` was already fixed for): `guardian-fight`: *"The scrape of claws on
   stone echoes from a dark corner. You've stopped waiting for it to be nothing."* ·
   `desecrated-altar`: *"The stone altar glows with a pale red light, pulsing as if breathing.
   You've stopped waiting for it to be nothing."*
5. `twin-altars` ← (`blood-altar`=`paid` OR `sacrificial-circle`=`sacrificed`): *"Two stone
   pedestals face each other, each carved with a spiral, open at the center. You already know which
   one you'll choose, the way you know a room's cold before you feel it. Choose 1: the other
   shatters the instant you touch its twin."*
6. `sacrificial-circle` ← `blood-altar`=`paid`: *"Old dried blood traces a spiral across the stone,
   open at one end and too deliberate to be an accident. You've felt this exact ask before."*
7. `wandering-hermit` ← (`blood-altar`=`paid` OR `sacrificial-circle`=`sacrificed`): *"An old man
   sits meditating amid the rubble, a spiral mark scarred into his forearm. His eyes are already
   open when you arrive, like he'd already felt something uneven walk in."*
8. `wandering-hermit` ← (`guardian-fight`=`resolved` OR `desecrated-altar`=`resolved`) — a 2nd,
   independent entry on the same field; if both this and #7 match, #7 wins (array order, "first
   match wins," no new rule): *"An old man sits meditating amid the rubble, a spiral mark scarred
   into his forearm. Something about you carries the same mark the guardians carry. He doesn't ask
   what you did to it."* (Implementation note: `"resolved"` — the win path's outcome tag,
   `game.ts`'s combat-victory block — not `"entered"`, which is never a value written anywhere;
   this doc previously said `entered` in error.)
9. `gambling-den` ← (`blood-altar`=`paid` OR `sacrificial-circle`=`sacrificed`): *"A stranger
   shuffles 3 overturned cups, sneering in the dark, no brand on his skin, no altar in sight. You're
   already doing the math on what you can afford to lose before he's finished explaining the
   rules."*
10. `cursed-shrine` ← (`blood-altar`=`paid` OR `sacrificial-circle`=`sacrificed`): *"A statue with
    3 eyes. One of them is open. You've stopped counting how many times that's true."*
11. `waiting-supplies` ← `merchant` (any resolution): *"A bundle sits wrapped and tied at the base
    of the wall, exactly where someone would leave it to come back for later. The rope is knotted
    in a spiral, pulled tight, in the same careful knot you've started to recognize. Nobody's
    coming back for this."*
12. `doubled-back` ← (`open-chest` OR `collapsed-floor`, any resolution): *"Footprints lead into
    this room and stop. None lead back out. You've seen traces like this before, this run. You're
    starting to lose count of how many."*
13. `old-count` ← (`open-chest` OR `collapsed-floor`, any resolution): *"Someone scratched tally
    marks into the wall here, hundreds of them, all by the same hand, in neat rows. The last row
    stops in the middle, mid-stroke. You've started noticing these more, the deeper you go."*
14. `broken-seal` ← `blood-altar`=`paid` OR `sacrificial-circle`=`sacrificed` (communion-leaning
    reading): *"A stone hatch, chained shut and mortared at the edges. Half a spiral is stamped
    into what's left of the lock, the other half torn away with whatever broke it open. The chain
    wasn't unlocked. It was torn from the outside, by something that wanted in."*
15. `broken-seal` ← `guardian-fight`=`resolved` OR `desecrated-altar`=`resolved` (containment-leaning
    reading) — 2nd independent entry, same base scene, opposite ending: *"...It was torn from the
    inside, by something that wanted out."* (Implementation note: guardian-fight/desecrated-altar's
    win path never calls `closeEvent()`, so their win-triggered outcome tag is written directly at
    the combat-victory reward block in `game.ts`, right alongside where their reflection already
    gets triggered from the same spot — value is `"resolved"`, not `"entered"`, matching every other
    event's generic fallback tag.)

`merchant` ← `still-breathing` and `blood-altar` ← `half-a-warning` are listed under C.4, since
they depend on events defined there.

**Base descriptions authored during implementation** — the spec above gave `waiting-supplies` and
`broken-seal` only their conditional `crossEventVariants` text, no neutral base description for a
party that hasn't resolved the source event yet (a real gap, not a deferred decision). Filled in
minimally, consistent with the established tone: `waiting-supplies`' base drops only the
"in the same careful knot you've started to recognize" clause (which presupposes having met
`merchant` already); `broken-seal`'s base is the crossEventVariant text's shared first 2 sentences,
with the interpretive final sentence ("The chain wasn't unlocked...") added only by whichever
variant matches. Both also needed a `reflection` block, likewise not specified — see
`data/events.json` for the final text.

**Rejected — 3-way link between `merchant`/`wandering-hermit`/`gambling-den`**: not deferred,
actually incompatible. §11.7: "This line doesn't include the Stranger." §11.8: the three are
"parallel, non-intersecting stories." Any version of "the Stranger's line changes because you met
the Hermit" needs either the Stranger knowing about the Hermit (breaks §11.7/§11.8 outright), or a
per-NPC memory system well beyond what's being built here. If wanted later, it needs its own design
pass.

### C.2 — Description variant pool

**Why**: a depth-band simulation found that by floor 10 — reached by essentially every player —
each common-tier event has already repeated 2-3 times with byte-for-byte identical text. This
affects 100% of runs, including ones that end before any depth-gated content is reachable. Build
first, before everything else in this file.

```ts
// on EventDefinition
/** pickEventText()'s fallback step picks uniformly among [description, ...descriptionVariants] —
    description is always option 0. Picked once at room-roll time, pinned to
    Room.descriptionVariantIndex so re-renders stay consistent. */
descriptionVariants?: string[];
```

```ts
// Room
descriptionVariantIndex?: number;  // 0 = description, 1..N = descriptionVariants[index - 1]
```

**Worked examples, the 4 highest-exposure common events** (each variant keeps the event's
identity markers, varies sensory anchor and sentence shape — not the spiral forced into every
variant, or 3 variants become the same template with nouns swapped):

**`open-chest`** (stays outside the Balance, §11.12 — no spiral in any variant):
- *(existing)* "A cracked oak chest sits crooked amid a pile of rubble. Whoever carried it this
  far didn't carry it any further."
- "A rusted lockbox is wedged under a collapsed beam, the key still in it, snapped off at the
  shaft."
- "Someone stacked their gear in a neat pile before they stopped needing it: boots, belt, an
  unopened pack."

**`guardian-fight`** (spiral kept in 1 of 3, not all — repeating it everywhere is its own checklist
tell):
- *(existing)* "The scrape of claws on stone echoes from a dark corner. A spiral, coiled tight and
  closed, is scratched into the wall beside it. Something is guarding the treasure in this room,
  and it just caught your scent."
- "Something breathes evenly in the dark ahead. It's been holding still since before you walked
  in."
- "Loose stone shifts under something heavy, back where the light doesn't reach. It's already
  turned toward you."

**`merchant`**:
- *(existing)* "A trembling oil lamp casts light on a cloth spread with strange wares. Each one
  bears a spiral mark burned into it. A hooded figure bows in greeting, waving you closer."
- "Firelight catches on a row of small objects laid out with care, each one marked the same way.
  A hooded shape straightens as you approach, already reaching for the first item."
- "A cloth is spread flat across the stone, weighted at the corners against a draft that isn't
  there. The hooded figure doesn't look up until you're close enough to see the mark on every
  piece."

**`desecrated-altar`**:
- *(existing)* "The stone altar glows with a pale red light, pulsing as if breathing. A spiral is
  cut into the base, closed like a knot. Touching it will surely wake whatever sleeps beneath."
- "A pulse of red light rises and falls along the altar's edge, patient as a held breath. Whatever
  it's under hasn't needed to be quiet until now."
- "The altar's glow catches in a carved spiral at its base, sealed shut, older than the stone
  around it. Touching it will surely wake whatever sleeps beneath."

Remaining events (`blood-altar`, `cursed-shrine`, `twin-altars`, `sacrificial-circle`,
`wandering-hermit`, `gambling-den`, `collapsed-floor`, and the 8 events in C.5 below): same
mechanism, text not yet authored — not a blocker, `descriptionVariants` is optional per event and
can be added incrementally.

### C.3 — Chain tier 3

**Why**: floor 16 and floor 120 currently read identically — nothing gates past tier 2 (floor 15),
and both `vigil-candle`/`broken-seal` are `onceLifetime`, spent early in a long run. Contradicts
`11-world-bible.md` §11.3's own claim that depth is continuous ("closer to whatever is left of
Sleeper's actual dreaming core"), not a single step. **Deliberately not** a new `onceLifetime`
event at this tier — 2 is already a small per-run budget; better to extend the *existing*
escalating threads one step further than multiply one-shot content few runs reach.

```ts
// on EventDefinition
chainForced3Description?: string;      // Chain 1, shared verbatim like tier 2
chainEscalated3Description?: string;   // Chain 2/3
// reflection
escalated3Prompt?: string;
// Room.chainVariant
"buildup" | "forced" | "forced2" | "forced3"
// narrativeCounters — no new field; reuse guardianGrudgeFiredCount >= 2
```

```json
// data/balance-config.json → events
"circleRemembersThreshold3": 20,
"bloodDebtThreshold3": 16,
"chainTier3MinFloorDepth": 35
```

Tier 3 checked *before* tier 2 in `pickEventText()`/`pickReflectionPrompt()` — strictly higher bar
(threshold3 **and** depth3), so meeting it always means tier 2's own bar is also met. Text
continues the tier-1→tier-2 throughline (dependence → unawareness, §11.5): tier 2 was the
encounter's *specificity* eroding; tier 3 is the *decision* eroding — the party stops noticing
they're choosing at all. Every line below keeps one concrete thing the party still recalls doing
(swinging, kneeling, checking for a wound) — proof it was them, not the dream, that acted — while
the part that's gone missing is only ever *why* or *when they decided to*. That distinction is what
keeps this dissociation rather than memory-editing or possession: agency (§11.5/§11.11) stays real,
it's just stopped being witnessed by the people exercising it.

- Chain 1, tier 3: *"You knew it was over before you'd worked out how it started."*
  Reflection: *"The swing already happened by the time you noticed you'd thrown it."* (Reworded
  from an earlier draft that read *"You remember swinging. You don't remember deciding to"* —
  identical sentence template to Chain 2's tier-3 description below, caught on an anti-cringe-slop
  pass; same underlying idea, different construction.)
- Chain 2, tier 3 (`sacrificial-circle`): *"You remember kneeling. You don't remember choosing to
  come back."*
  Reflection: *"None of you can say, right now, whose idea it was — only that nobody argued."*
- Chain 3, tier 3 (`blood-altar`): *"None of you can say who volunteered this time — only that
  someone always does."*
  Reflection: *"You checked for the wound out of habit. You knew it was there before you found
  it."*

### C.4 — Discovery curve: floors 15 / 35 / 70

**Compliance distinction that makes this whole section possible**: `11-world-bible.md` §11.9's
open list constrains *verdicts* (is the Covenant right, does Sleeper wake, did the Stranger win) —
not the *quantity of evidence* a player can be handed toward their own theory. Depth can keep
escalating in concrete, specific *information*, not just intensity, without ever resolving §11.9.
Floor 15 already does this (`broken-seal` is real evidence, not just mood; `vigil-candle` stays
pure atmosphere on purpose — not every discovery needs to be a clue).

**Floor 35 — "Half a Warning"**

> "Someone carved this fast, and never finished it. What's left: 'saw what happened to the one who
> tried to carry both. I won't write what was left of them. Choose one side. Don't waver.'"

```
reflection.prompt: "Whoever wrote that stopped mid-word. You don't know if they ran out of time,
or ran out of nerve."
curious: "Something made them stop mid-word. You can't stop turning it over."
wary: "A warning like that doesn't need the rest of the sentence."
dismissive: "Old graffiti. Everyone thinks their scratch marks matter."
```

Testimony, not doctrine — "I won't write what was left of them" implies something severe without
spending the restraint budget describing it (§11.11's show-don't-state). Seeds `waiting-supplies`:
its bundle, tied "in a spiral, pulled tight" — never switched — reads differently once a player has
found testimony that switching gets people killed.

`id: "half-a-warning"`, `kind: "instantReward"`, `tier: "rare"`, `minFloorDepth: 35`,
`onceLifetime: true`, `guaranteedArtifactId: "worn-chalk-stub"` (`07-items-artifacts.md`'s
"Event-tied artifacts") — the carving tool implied by the scene, not a random roll.

**Floor 70 — "Still Breathing"**

> "Ribs, not walls — and something's grown into them that shouldn't be there: a thread of old cloth,
> with a mark burned into it the exact same way as every mark you've traded for this whole run."

```
reflection.prompt: "Something you've traded for is already part of this room. You don't know how
long it's been growing there."
curious: "You keep doing the math on how much of this used to be someone's."
wary: "You're not sure you want anything you're carrying to end up matching."
dismissive: "Cloth rots into strange shapes. Doesn't mean anything."
```

One dominant reveal, deliberately — an earlier draft stacked 5 facts in a single scene (walls are
ribs, moss is human material, the spiral is a copy, the process is ongoing, and the copy was stated
as fact rather than shown) and read as a lore dump rather than a discovery. An anti-cringe-slop pass
caught the last of those: the draft that stopped at 4 facts still stated the "copied, not invented"
conclusion outright instead of showing the one piece of evidence (a trade-mark grown into bone,
identical to the party's own) and trusting the player to draw it themselves — the exact thing
§11.11's show-don't-tell rule warns against for the game's single deepest lore moment. The
conclusion is now left entirely to inference. A later pass caught that even this version still read
as 2 stacked beats (walls-are-ribs as its own reveal, then the mark, as a separate 2nd one) — the
"walls are ribs" observation is now folded into a subordinate clause ("Ribs, not walls —") rather
than its own 2-sentence beat, so the entire line builds toward the 1 real reveal (the matching mark)
instead of delivering 2 in sequence. Cut from the stated text and pushed into the
reflection prompt as an open question instead of an asserted fact: whether the growth is ongoing or
long finished. Never "consuming" or "hunting" (§11.4 — passive and
involuntary, like the whirlpool-finds-the-drain framing, never implying Dream has intent). Doesn't
confirm any §11.9 item: the embedded object is generic, never tied to a specific named figure.

`id: "still-breathing"`, `kind: "instantReward"`, `tier: "rare"`, `minFloorDepth: 70`,
`onceLifetime: true`. **No artifact, no stat effect of any kind** — a fear-relief mechanic was tried and cut: a reveal strong enough not to
need a mechanical reward attached is the point; needing one is itself a sign the reveal wasn't
landing.

**Pairs 7-8 — how the milestones echo forward** (§11.5's drift shouldn't stop meaning anything once
the scene that taught it ends):

- `merchant` ← `still-breathing` (resolved): *"A trembling oil lamp casts light on a cloth spread
  with strange wares. Each one bears a spiral mark burned into it. A hooded figure bows in
  greeting, waving you closer. You don't look at the cloth the way you used to."*
- `blood-altar` ← `half-a-warning` (resolved): *"Ancient carvings on the stone pedestal ooze a dark,
  still-warm liquid, a spiral unwound and open at its center. You hesitate half a step longer than
  you used to, before your hand decides for you."*

Only these 2 — knowing the warning doesn't stop the drift, it just adds a beat of resistance before
the same reflex wins anyway (more honest to §11.5 than a version where knowledge simply fixes
behavior). Not wired into every event after every milestone — that would violate the same
one-observable-change discipline holding the rest of this file together.

### C.5 — New events, full specs (implemented, live in `data/events.json`)

**`vigil-candle`** ("Vigil") — Thread 5, floor 15:

> "A candle burns at the end of a corridor no one has walked in years — the dust around it
> undisturbed, the wax pooled thick and old, but the flame hasn't shrunk. Something sits beside it:
> folded hands, folded cloth, the shape of someone who sat down and never got back up. Whatever left
> it there isn't coming back for it."

```
reflection.prompt: "You didn't blow it out. You didn't want to be the one who did."
curious: "Wax doesn't last that long on its own. You noticed, and kept walking anyway."
wary: "Some things burn for a reason. You'd rather not be part of it."
dismissive: "A trick of the wax, probably. Nothing worth thinking about twice."
```

`kind: "instantReward"`, `tier: "rare"`, `minFloorDepth: 15`, `onceLifetime: true`,
`guaranteedArtifactId: "vigil-cloth"` — a specific item (`07-items-artifacts.md`'s "Event-tied
artifacts") rather than a roll off the standard table, since the scene already describes exactly
what's sitting there (beside the candle, like an abandoned offering).

**`broken-seal`** ("Broken Seal") — Thread 2, floor 15. Base text and both `crossEventVariants`
readings are in C.1, entries 14-15. Same mechanics as `vigil-candle`, `guaranteedArtifactId:
"torn-lock-plate"`.

**`old-count`** — Thread 4, common tier:

> "Someone scratched tally marks into the wall here, hundreds of them, all by the same hand, in
> neat rows. The last row stops in the middle, mid-stroke."

```
reflection.prompt: "Something interrupted the last mark. You didn't stay to find out if it came
back."
curious: "Whatever they were counting toward, you keep wondering if they ever reached it."
wary: "Counting like that isn't really about the number anymore."
dismissive: "Somebody's nervous habit. Not yours to worry about."
```

`kind: "instantReward"`, `tier: "common"`. Cross-event variant in C.1, entry 13.

**`doubled-back`** — Thread 4, common tier:

> "Footprints lead into this room and stop. None lead back out. The room is empty, and there's
> nowhere else they could have gone."

```
reflection.prompt: "You checked the walls anyway. You're not sure what you expected to find."
curious: "Rooms don't just eat people. You'd like to understand this one's trick."
wary: "You don't linger long enough to test whether it does it twice."
dismissive: "Feet backtrack all the time. You just missed the tracks."
```

`kind: "instantReward"`, `tier: "common"`. Cross-event variant in C.1, entry 12.

**`the-delay`** — Thread 4 (unconnected by design), common tier:

> "Still water pools at the edge of the room, dark enough to mirror the torchlight. Your reflection
> catches up to you a half-second late, every time you move."

```
reflection.prompt: "You didn't stay long enough to see if it eventually stopped catching up."
curious: "Half a second doesn't sound like much. You're still not sure where it goes."
wary: "You keep your eyes forward the rest of the way down."
dismissive: "Tired eyes playing tricks. Nothing more."
```

`kind: "instantReward"`, `tier: "common"`. No cross-event variant, deliberately — pure dream-logic,
no institution, no remnant-of-a-person framing to bridge from. **Template for future common-tier
events**: no NPC, no spiral, no lore exposition — one small, unexplained physical wrongness, felt
and then walked away from. When a new low-stakes event is wanted, this is the shape to reach for
before reaching for another Covenant-adjacent scene.

**`waiting-supplies`** — Thread 3 & 4, common tier. Base text and `merchant`-sourced variant are in
C.1, entry 11.

---

## Part D — Build status

All 4 pieces are live, built in the order originally planned here (variant pool, then cross-event
continuity, then chain tier 3, then the 8 new events).

**Touched**: `src/types.ts` (`CrossEventVariant`/`EventOutcomeCondition`, `descriptionVariants`,
`onceLifetime`/`minFloorDepth`/`noArtifactReward`/`instantRewardActionLabel`, tier-3 fields,
`GameState.eventOutcomes`/`firedOnceEventIds`, `Room.descriptionVariantIndex`/`chainVariant`
extended), `data/events.json` (every `crossEventVariants`/`descriptionVariants` entry, tier-3
fields, 8 new event entries), `data/balance-config.json` + `src/data/balanceConfig.ts`
(`circleRemembersThreshold3`, `bloodDebtThreshold3`, `chainTier3MinFloorDepth` — the 3 proposed
event-level depth-gate fields were dropped, see Part C's header note), `src/data/events.ts`
(`rollEvent()` depth + once-lifetime filtering), `src/engine/dungeon.ts` (`resolveEventEntry`'s
variant-index roll and depth/once-lifetime-aware roll, tier-3 checks and `crossEventVariants`
resolution in `pickEventText`), `src/engine/events/guardianFight.ts` (tier-3 `chainVariant`
branch), `src/engine/events/shared.ts` (`isTier3Escalated`, `pickReflectionPrompt`'s tier-3 check,
`closeEvent`'s generic-outcome and `firedOnceEventIds` marking, `REFLECTION_EVENT_IDS` extended),
`src/engine/events/bloodAltar.ts` + `collapsedFloor.ts` + `sacrifice.ts` (outcome-tag writes),
`src/engine/events/openChest.ts` (`noArtifactReward` branch), `src/engine/game.ts` (new
`GameState` field init, and the win-path outcome-tag write for guardian-fight/desecrated-altar,
since their combat-victory path never calls `closeEvent()`), `src/engine/migration.ts` (save
migration guards), `src/ui/screens/events.ts` (Skip-visibility for `forced3`, action-label
override), `test/events.test.ts`, `docs/gameplay-decisions/08-events.md` §8.1/§8.13/§8.15 (sync).

---

## Part E — The Wanderer

A rare, no-reward encounter — 1 of 3 lore-delivery channels outside the event system proper (the
other 2: Item/Artifact lore-bearing descriptions, `07-items-artifacts.md`; Camp Reflection, a party
self-analysis mechanism at rest, `03-survival-stats.md`).

**Not** 1 of the 3 established recurring figures (§11.7-11.8) and **not** a fixed identity — no
`returnDescription`, a different individual every encounter. This is why it doesn't need the same
"decide first whether they belong on §11.7's line of contact" gate §11.8 requires for a new
*recurring* figure — there's no single character here to place on that line at all, only a
recurring *situation* (Thread 4, "Traces of Those Before," Part B.2) finally given a voice.
Deliberately compatible with §11.9's open questions: no variant of this event ever confirms whether
a given wanderer is really still alive down there, made it out, or is something else entirely.

**Mechanics**: `id: "the-wanderer"`, `kind: "instantReward"`, `tier: "rare"`, `noArtifactReward:
true` (reuses the exact pattern `still-breathing` established, Part C.5 — no new `EventKind`),
`minFloorDepth: 10` (a light gate — encountering a fellow lost soul reads better once the party's
been down a while; low enough to still be common relative to the floor-70-deep events). **Not**
`onceLifetime` — can recur any number of times in a run, each time picked from the same
`descriptionVariants` pool below, so "always someone different" is enforced by the pool being
randomized per room (Part C.2's existing mechanism), not by any new once-per-identity tracking.

### Content — 3 base variants + 1 conditional

**Variant 1** — temporal confusion:

> "A figure sits with their back against the wall, turning something small over in their hands,
> too dark to see what. 'How long's it been?' they ask, not really to you. 'Feels shorter every
> time I ask.'"

**Variant 2** — a repeated, broken action:

> "A figure leans against the far wall, methodically restringing a bow that has no string left to
> restring. 'Don't trust the quiet floors,' they say. 'The loud ones already told you what they
> want.'"

**Variant 3** — mistaken recognition:

> "A figure looks up as you approach, then straightens like they expected someone else. 'Not you,
> then,' they mutter, and go back to what they were doing before you got here — which, from here,
> is nothing at all."

**Variant 4 — conditional, via `crossEventVariants`**, `{"eventId": "camp-reflection", "outcome":
"unaware"}` (reuses the exact synthetic bridge tag Camp Reflection already writes for
`wandering-hermit`, `03-survival-stats.md` — no new tracking, a 2nd reader of the same 1 tag):

> "A figure sits exactly where you'd expect one to be by now. They don't ask how long it's been.
> Neither do you."

Only reachable once the party's own Camp Reflection has reached Unawareness — the payoff is
specifically that the party no longer thinks to ask Variant 1's question themselves anymore. Craft
note: written to require Variant 1 having been *possible* (thematically, not mechanically — no
data dependency), so the absence lands only for a reader who's seen the shape of the question
before.

**Reflection** (shared across all 4 variants — same reasoning `merchant` shares 1 reflection across
its several variants):

```
prompt: "Whoever that was, they didn't ask your names, and you didn't offer them."
curious: "Whoever's still down here talking to themselves — you'd guess there's more than 1."
wary: "You don't look back to check if they're still where you left them."
dismissive: "Another lost soul talking to itself. Not your problem."
```

### Compliance check against `11-world-bible.md`

No variant states whether the figure is alive, a remnant, or something else (§11.9). No variant
names "Sleeper," "Covenant," or "the Balance." Agency stays fully with the party throughout — the
figure never controls or compels anything, only talks; Variant 4's absence-of-a-question is the
*party's* drift being shown, not anything done to them. Doesn't touch any of the 3 established
figures' own storylines (§11.7-11.8) — a wanderer's dialogue never references the Hermit, the
hooded figure, or the Stranger, staying a wholly separate thread.

### Build order and files touched

`data/events.json` (new event entry: `descriptionVariants` for variants 1-3, `crossEventVariants`
for variant 4, `reflection`, `noArtifactReward: true`, `minFloorDepth: 10`), `test/events.test.ts`
(coverage: variant pool distribution, the Unaware-tier crossEventVariant only firing once that tag
is set, no artifact granted). No engine changes needed — every mechanism this event uses
(`descriptionVariants`, `crossEventVariants`, `noArtifactReward`, reflection) already exists.

---

## Part F — The Ending System (floor 100 / floor 120)

**Scope, confirmed**: a fully **optional content layer** — it does not change the existing
infinite-descent/permadeath loop. The overwhelming majority of runs still end in ordinary
permadeath well before floor 100, exactly as today. This is a branch for the rare run that survives
that far, not a new default destination. Lore-authoring for the whole game ends at floor 120 — the
dungeon keeps generating past that depth for anyone who wants to keep playing, but no new story
content is designed to appear there.

### F.1 The floor-100 checkpoint

On reaching floor 100 (still alive), the run pauses on a **guaranteed story beat**, not a normal
event roll — mechanically distinct from `rollEvent()`'s probabilistic system, since this must fire
every single time a run reaches this depth, unconditionally.

**2 independent gates**, checked in this order the moment floor 100 is reached — never all 4 endings
competing on 1 menu:

| Condition | What the checkpoint offers |
|---|---|
| **Either Leave trigger fires** (below) — checked first, overrides everything else | **Leave only** (§F.4) — no Stay, no Let Go, nothing else. |
| Camp Reflection Tier 4, Unawareness (`03-survival-stats.md`) | **Stay**, **Let Go**, or **Continue** (§F.5, the path to the true ending). |
| Anything else | **Stay** (§F.2) or **Let Go** (§F.3). |

**Leave has 2 independent triggers, either one sufficient on its own:**

**1. "The blood debt breaks"**: Chain 3, "Blood Debt" (§8.15), reaching its tier-3 escalation at some
point this run — `narrativeCounters.altarPaymentsCount >= events.bloodDebtThreshold3` (16 payments,
the same counter and threshold already tracked for `blood-altar`'s `chainEscalated3Description`) —
**and** the most recently recorded `blood-altar` outcome (`GameState.eventOutcomes["blood-altar"]`,
already written per Part C.1's table) reads `"declined"`. Nothing new to track: both pieces of state
already exist for other reasons — this condition is a pure read of the 2 of them together.

**2. "The ledger never opens"**: Chain 4, "Taken, Never Given" (`freeRewardsTakenCount`, §8.15),
reaching its 1 escalation — the party has taken from 12+ of the 7 zero-cost reward events combined
(`open-chest`, `old-count`, `doubled-back`, `waiting-supplies`, `vigil-candle`, `broken-seal`,
`half-a-warning`) **and** never once paid at `blood-altar` or fed `sacrificial-circle`
(`altarPaymentsCount === 0 && artifactsSacrificed === 0`). Also nothing new to track beyond Chain 4's
own counter, which §8.15 specifies in full.

**Why 2 triggers instead of 1**: they're deliberately 2 different roads to the same absence, not 2
unrelated mechanics bolted together. An earlier draft of this gate used Camp Reflection's Untouched
tier alone — a party that barely engaged with anything. Dropped because it's nearly unreachable by
floor 100 (resolving almost any event increments `loreExposureCount`) and because it collapsed 2
genuinely different stories into 1 vague "didn't do enough" reading. Trigger 1 is a party that engaged
*the most* with 1 specific reciprocal exchange — enough to live through the stone's most corroded
text — and then, on some later visit, didn't pay. Trigger 2 is a party that was never in a reciprocal
exchange with anything down here to begin with, only ever on the receiving end. Nothing here decides
to punish either one. Both are the same shape as everything else in this bible (§11.4): there's simply
no longer (trigger 1) or never was (trigger 2) a standing exchange that recognizes this party as
someone worth keeping. For trigger 1, whether the decline was chosen (enough HP to pay, paid anyway
16+ times, then refused) or forced (nobody had HP to spare that visit) is never distinguished in the
text — deliberately; the significant fact is only that the pattern broke, not why. §F.4's actual
wording never specifies which trigger fired, on purpose — the ending reads identically either way.

**Why Continue's condition, specifically** (flagging for confirmation — the 1 open design parameter
in this spec): reusing `loreExposureCount`/`campReflectionTier` needs no new tracking at all, and
it's thematically exact — the true ending is "keep going despite total terror," and the 1 existing
mechanism that measures a party's *capacity to stop registering fear as a reason to stop* is Camp
Reflection's Unawareness tier. A party able to take this choice isn't brave in the ordinary sense;
they've drifted far enough that the normal reasons to turn back have stopped landing on them the
way they used to (§11.5) — the same erosion treated as a quiet tragedy through the rest of the game
becomes, here, the literal precondition for the deepest content. That reframing is the point.

None of these conditions are ever stated to the player. A party whose blood debt never breaks and
never reaches Unawareness never sees any hint that Leave or Continue exist as options; nothing should
read as "you failed to unlock" anything, since no condition anywhere in this system is ever surfaced.

### F.2 Ending 1 — Stay

> "To stay — to let whatever's still holding this floor together keep holding, and be part of what
> holds it."

Resolution, once chosen:

> "None of you climb back out. The floor doesn't collapse, doesn't call, doesn't ask for anything
> further — you simply don't leave, the way a room doesn't leave the house it's part of. Somewhere,
> much later, another party will walk this same corridor. They won't know your names. But something
> about how they move through it will be, just slightly, easier than it should be."

Deliberately doesn't explain the mechanism (how staying "helps" — left open, matching §11.9's own
discipline about not over-explaining what the dungeon's structure actually is). The run ends here —
a distinct resolution screen, not `GameState.gameOver: "defeat"` (this isn't a loss).

**The payoff, on a later run**: a new, rare, per-profile-once event — not a variant of `the-wanderer`
(Part E), a deliberately different, more personal shape: it names the specific character who stayed.

> "A figure crouches at the edge of the torchlight, and for a moment none of you can place why they
> look familiar — until someone does. It's {{name}}, the {{class}} who never came back up. They
> don't seem surprised to see you. 'Took you long enough,' they say, and for just a moment, sound
> like they used to."

No combat, no cost — matches the established "just talk, no transaction" shape (Part E). What it
grants, if anything, is left as an open design question (a small, unexplained blessing implied by
"easier than it should be" above would fit; a pure dialogue-only beat would also fit — a call to
make once the persistence layer below actually exists).

**This needs new architecture, not just new content**: `GameState` resets every run, so nothing
about who stayed and as what character survives past the current save. This needs a persistent
record **outside** the current per-run save file — something like a small profile-level store (e.g.
`{ retiredCharacters: { name, class }[] }`) written once at the moment Ending 1 is chosen, read by
a later run's event-roll to decide whether "the one who stayed" event is even eligible. **This spec
does not attempt to design that persistence layer** — it requires understanding how saves are
currently stored and versioned (`docs/technical-decisions.md`, the save-version-guard work already
in this repo's history) before proposing a shape for it. Flagging this explicitly rather than
guessing.

### F.3 Ending 2 — Let Go

> "To let go, together, all at once — however far down that actually leads."

Resolution:

> "None of you feel yourselves stop. There isn't a moment where it happens — only, gradually, the
> awareness that whatever's dreaming doesn't distinguish between you and everything else it's
> already holding. The last clear thought any of you has, before the distinction stops mattering:
> the sky above the entrance, the town you set out from, the years before any of this — none of it
> was ever outside this. It was never a separate place you were returning to. It was just a
> farther room in the same dream, dreamed calmly enough that nobody standing in it ever needed to
> notice."

**The plot twist, precisely**: the party's home world — everything before the descent — was never
outside Sleeper's dream either; the dungeon and the surface are the same dream at different
distances from whatever's actually happened. This is a **different axis of revelation** from the
true ending's (§F.5), not a duplicate — it's cosmic scope, not institutional history, and it
resolves nothing on §11.9's list (doesn't say whether Sleeper wakes, doesn't touch the Covenant,
doesn't touch any of the 3 recurring figures). What it deliberately leaves open: whether this means
nothing was ever "real," whether every person who never descended is dreamed the same way, whether
waking (for Sleeper, or for anyone) was ever a coherent idea to begin with. A distinct resolution
screen, same as Ending 1 — not `defeat`.

### F.4 Ending — Leave (a dead end, and 1 way through it)

Reached only when 1 of §F.1's 2 Leave triggers fires — there was never a Stay or Let Go offered here,
only this:

> "There isn't a stay, and there isn't a further — only the way back up. Nothing else is offered.
> Nothing about that turns out to mean it'll be easy."

What every such party finds, regardless of anything else about the run:

> "The corridor you climbed through isn't here anymore. Where it should be, there's only wall —
> smooth, seamless, older than anything else on this floor. However you got down here, that's not
> how you're getting back up."

> "There has to be another way. There's always been another way. You start looking — and that's
> when you hear how many of them have been standing behind you the whole time you were looking at
> the wall instead."

**Default outcome — bad ending, unknown fate**: unless the condition below is met, this is where it
ends.

> "None of you get a clean look at how many there are. There wasn't a plan, and there wasn't time
> to make one. What happened to the party after that isn't something anyone will ever get to tell."

Deliberately not a confirmed death and not a confirmed survival — "unknown fate" is the actual
content of this ending, not a placeholder for one. Framed as a genuine bad ending (the only path this
floor offered a party with no standing exchange left to draw on — whether because it broke, or never
opened — turned out to be a trap, not a mercy), distinct from ordinary `defeat` (no HP hits 0 on
screen, no fight plays out — the game never shows what happens, on purpose).

**The way through — conditional, and rare**: if any character in the party has a specific artifact
(`waystone-shard`, below) currently equipped, the ambush above never lands. Instead:

> "Something else answers, from further along the same dead-end wall — not the wall giving way, but
> a seam in it, sealed shut, humming at a pitch none of you would have caught if you weren't already
> listening for anything. It isn't stone. It's failing, and it's been failing for longer than any
> of you have been alive."

> "The shard fits like it always meant to. The seam doesn't so much open as remember how to. What's
> on the other side isn't the corridor you came down. It's air. Actual, ordinary, undeserved air."

**This is the actual good ending** — the only fully confirmed, unambiguous escape in the whole
system. Gated by inventory (a specific rare artifact), not by any drift/reflection state — a
genuinely different *kind* of gate from Continue's, on purpose. Deliberately **not** found the way
any other artifact is, though — see below.

**New artifact — `waystone-shard`** (Unique, `07-items-artifacts.md`'s Category D, "Older Than the
Mark" — this predates the Covenant too, a 3rd item for that category):

> "A shard of something that was never carved, only grown that way — smooth on every broken edge
> except where it snapped. This was already broken long before anyone started marking these walls
> with a spiral."

Confirms only that whatever this came from predates and is unrelated to the Covenant — never
confirms who or what actually built it, never confirms this exit exists reliably for any other
party, never confirms the dungeon "allows" this or simply failed to notice. All genuinely open.

**Drop source, restricted — deliberately excluded from the free-take pool**: unlike every other
artifact in the catalog, `waystone-shard` never appears via the standard `treasureOrEvent` roll used
by `open-chest` and the rest of Chain 4's 7 zero-cost events (§8.15) — it would undercut the whole
point of Chain 4 if the item that guarantees the good ending could turn up in the exact pool that
also feeds the *bad* one. It's also excluded from Elite kills, `merchant`, `cursed-shrine`,
`twin-altars`, and `sacrificial-circle`. It appears from exactly **2** sources instead:

- **A Boss kill** (`02-monster.md` §2, every `bossFloorInterval` floors) — part of the normal `boss`
  rarity-weight roll (Unique/Epic only, `07-items-artifacts.md` §7.2), no special logic needed beyond
  the exclusion above.
- **`blood-altar`** (§8.5) — but only once `narrativeCounters.altarPaymentsCount >=
  events.bloodDebtThreshold2` (8 payments, the same counter Chain 3 already tracks). Below that
  count, a `blood-altar` payment rolls exactly as it does today, `waystone-shard` excluded like
  everywhere else. This is deliberate: the escape key only becomes reachable once a party has already
  paid the stone enough times to be approaching the depth where Chain 3's own tier-2 escalation kicks
  in — "an event that requires paying a lot," not a lucky first visit.

**The intended irony, spelled out once**: the same behavior that can eventually *cause* Leave's bad
branch (paying the stone again and again, deep enough to reach tier 3, §F.1) is the same behavior
that opens the only door to Leave's good branch. Paying a lot doesn't guarantee finding the shard —
it's still a roll, same as any other artifact — but paying nothing at `blood-altar` guarantees never
finding it there at all. A party's own relationship with 1 specific exchange decides which version of
Leave it's even possible to reach, long before floor 100 ever arrives.

**Mechanism needed, not yet built**: `ArtifactDefinition.restrictedDropSources?: Array<"boss" |
"blood-altar">` (new, `src/types.ts`) — when present, an id is filtered out of every roll except the
ones named. `rollArtifact()` (`src/data/artifacts.ts`) needs an opt-in override so `bloodAltarPay()`
can request `waystone-shard` be included once the threshold above is met; every other caller
(`openChest.ts` and the rest of Chain 4's events, `sacrifice.ts`, the Elite/Boss kill paths that
don't pass the override) continues to exclude it automatically.

Compliance: neither branch names "Sleeper," "Covenant," or "the Balance"; neither resolves anything
on §11.9's list. The bad branch doesn't contradict §11.9's "no evidence anyone comes back" item —
that item is specifically about *death*; this is a live party facing an ambush whose *outcome* is
what stays unconfirmed, a different thing entirely. Both branches are distinct resolution screens,
neither the same as Stay/Let Go/Continue nor as each other — the good branch should read as
unambiguously survived, the bad branch as unresolved, never as a confirmed death.

### F.5 Ending 3 — Continue (the path to the true ending)

Available only under §F.1's condition.

> "To keep going, past the point where any of you can say this is still a choice you'd recommend."

Choosing it does not end the run — floor 100 continues normally, monster/floor generation unchanged,
until floor 120.

**Floor 120 — the final encounter.** On arrival, before any combat:

> "What's left of him doesn't have a face to speak from anymore, but something in the room still
> remembers how his voice sounded — a vast, wrong shape drifting in the dark, more brain than body,
> ropes of nerve-thick tissue trailing beneath it where legs should be, reaching without ever quite
> touching the ground."

Dialogue, before the fight (6 short lines, deliberately restrained — no long-winded villain
monologue, §anti-cringe-slop's own standing rule):

> "You made it further than any of them."
> "I didn't come down here to build anything. I came down because everyone I was supposed to save
> was already gone, and I couldn't stop asking the ground to give them back."
> "It never gave anyone back. It just... kept listening. So I kept asking. Eventually I stopped
> noticing I was still asking."
> "The others who followed me down, over the years — I taught them how to ask properly. That's all
> any of it ever was."
> "I don't remember the last time I was only a person. I'm not sure there's a difference anymore,
> between what's still me and what's still just... dreaming."
> "You can still turn back. Or you can keep asking, the way I did, until there's nothing left to
> tell you apart from what you asked for."

**The rhyme, deliberate**: this is what Ending 1 (§F.2) looks like carried far enough, for far too
long. "Staying" is framed there as quiet and almost gentle; this is what it becomes given enough
time — a direct, load-bearing warning rather than 2 unrelated endings coexisting by coincidence.

**What this resolves (the "partial" the user asked for) vs. what it doesn't:**

| Resolved | Stays open |
|---|---|
| A specific human founded the Covenant, driven by grief over a loss he couldn't undo (§11.5's "the Call" finding purchase on a mind already cracked open) | Whether Sleeper as a *whole* ever wakes, or only ever continues dying — this is 1 person fused with a *fragment*, never proof of the entire entity's trajectory |
| The Covenant's rituals, taught and repeated across generations, had *some* real effect on which locations held their shape (§11.6) | Whether that effect is what the Covenant themselves believed it was, or something else their ritual only approximated |
| Something answers, or at least "keeps listening" — a fragment of awareness persists and can be locally reached | Whether the containment or communion reading was ever the correct one — the founder's own account is his, not confirmed as authoritative |
| The founder is real, was once an ordinary person, and is still (in some sense) there | What the Guardians are, whether the hooded figure is a continuous person, what happened to the Hermit's companion — all untouched |

The founder's own account is framed as **his own**, not an authorial confirmation — a party that
picks `wary` or `dismissive` reflection stances earlier in the run is fully entitled to read every
line above as a dying, corroded mind's self-serving myth rather than history. Nothing in the
delivery ever confirms which reading is correct. This is the mechanism that keeps the user's
explicit requirement — "don't rob the player's own judgment" — intact even while giving real,
citable answers to some of it.

**The fight**: a new Boss-tier `MonsterArchetype` (`02-monster.md`), stronger than any existing boss
— full kit design (skills, stat scaling at floor 120) is a separate task from this spec, flagged
here as needed, not designed here.

**After victory**: the party can continue past floor 120 to "hunt down the cult's remnants" — no new
mechanic needed for this framing; it's flavor over the existing infinite-descent loop continuing as
normal.

**Events that permanently disappear**, from this point in the run onward: every event tied to the
Covenant as an institution — `guardian-fight`, `desecrated-altar`, `merchant`, `blood-altar`,
`cursed-shrine`, `twin-altars`, `sacrificial-circle`, `wandering-hermit`, `broken-seal`,
`half-a-warning` — plus `still-breathing`, made narratively redundant once the bigger reveal above
has already landed. **No new mechanism needed**: `closeEvent()` already excludes any id present in
`GameState.firedOnceEventIds` from future rolls (`src/data/events.ts`'s `rollEvent()`) — the true
ending's resolution simply bulk-inserts all 11 of the ids above into that array in 1 pass. Staying
in the pool, unaffected: `open-chest`, `collapsed-floor`, `old-count`, `doubled-back`, `the-delay`,
`waiting-supplies`, `vigil-candle` (mundane/pure-dream-logic, no institutional tie), `gambling-den`
(the Stranger, explicitly not Covenant, §11.8), `the-wanderer` (Part E), and Ending 1's new
retired-character event (§F.2).

### F.6 Normal endings — the existing permadeath conclusion, given a little texture

Everything above is the rare branch. The overwhelming majority of runs still end the way they
already do — `GameState.gameOver: "defeat"`, well before floor 100 — and that stays completely
unchanged as the default outcome. The only addition here is small: 1-2 short epilogue lines, varied
by *how* the run ended, instead of a single flat conclusion regardless of cause.

- **Died in combat** (HP reached 0 mid-fight): the existing conclusion, unchanged — this is the
  game's actual default ending and doesn't need new text to justify itself.
- **Died to exhaustion** (the Dying DOT, `03-survival-stats.md`, killed the party without a monster
  landing the last hit): 1 new line acknowledging the difference — something failed to keep the
  party fed and rested long enough, not a fight lost. Exact wording not drafted here; a 1-sentence
  addition, not a scene.

No new mechanism needed beyond checking which system dealt the finishing blow (already
distinguishable — `applyDyingDamage` vs. ordinary combat resolution, both in `src/engine/`) at the
moment `gameOver` is set. Deliberately minimal: this is texture on the existing, overwhelmingly most
common outcome, not a 5th designed ending competing for the same weight as §F.2-F.5 above.

### F.7 What this spec does not attempt

This is a design spec, not an implementation plan — several pieces here are flagged rather than
built out, because they're genuinely separate-sized problems:

- The floor-100 checkpoint's trigger mechanism (a guaranteed, non-rolled story beat at an exact
  depth) doesn't exist anywhere in the current event/room system and needs its own design pass.
- New `GameState.gameOver` outcomes (or an entirely separate resolution-screen concept) alongside
  the existing `"victory" | "defeat"` — up to 5 distinct ones now (Stay / Let Go / Leave-ambushed /
  Leave-escaped / Continue's outcome), needs a look at every place that field is currently read.
- The cross-run persistence layer for Ending 1 (§F.2) — explicitly not designed here; needs
  investigation into the existing save/version-guard system first.
- Floor 120's boss `MonsterArchetype` — kit, stats, skills all undesigned; this spec only fixes the
  visual and the pre-fight dialogue.
- `waystone-shard` (§F.4) needs to actually be added to `data/artifacts.json` before its check can
  do anything — same caveat as the 3 event-tied items in `07-items-artifacts.md`: referencing an id
  that doesn't exist in the real catalog yet would throw at runtime. Its `restrictedDropSources`
  mechanism (§F.4) is a separate, larger piece on top of that: a new `ArtifactDefinition` field, a
  `rollArtifact()` override path, and the `bloodAltarPay()` threshold check all need to be built
  before the Boss/blood-altar-only sourcing does anything — until then, treat the item as spec-only.
- Whether/how any of the floor-100 gating conditions (§F.1) — the blood debt breaking, the free-take
  ledger never opening, or Camp Reflection reaching Unawareness — should be visible to a curious
  player in any form (a hint, an achievement-style unlock notice) or stay entirely silent — leaning
  toward entirely silent, consistent with how no other mechanic's exact thresholds are ever shown, but
  not locked here.
