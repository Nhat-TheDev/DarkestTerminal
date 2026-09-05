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

## Part A2 — Design resolved, implementation pending

**Reflection stance payoff**: `11-world-bible.md` §11.13 resolved that a consistent
`curious`/`wary`/`dismissive` stance should eventually nudge later text — as flavor only, never
mechanically, and never as a strict classifier. Reading `GameState.eventReflectionStances` back and
applying it anywhere is still unimplemented — no code, no data, not started.

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
8. `wandering-hermit` ← (`guardian-fight`=`entered` OR `desecrated-altar`=`entered`) — a 2nd,
   independent entry on the same field; if both this and #7 match, #7 wins (array order, "first
   match wins," no new rule): *"An old man sits meditating amid the rubble, a spiral mark scarred
   into his forearm. Something about you carries the same mark the guardians carry. He doesn't ask
   what you did to it."*
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
`wandering-hermit`, `gambling-den`, `collapsed-floor`, and the 8 not-yet-built events below): same
mechanism, text not yet authored — not a blocker for locking this mechanism, can be added
incrementally.

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
`onceLifetime: true`. Standard artifact table.

**Floor 70 — "Still Breathing"**

> "The walls breathe here. Not walls. Ribs. Threads of old cloth are grown into the bone, not over
> it, and one of them still carries a mark burned the exact same way as every mark you've traded
> for this whole run."

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
conclusion is now left entirely to inference. Cut from the stated text and pushed into the
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

### C.5 — New events, full specs (not yet in `data/events.json`)

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

`kind: "instantReward"`, `tier: "rare"`, `minFloorDepth: 15`, `onceLifetime: true`. Artifact sits
*in* the scene (beside the candle, like an abandoned offering) rather than a separate loot beat.

**`broken-seal`** ("Broken Seal") — Thread 2, floor 15. Base text and both `crossEventVariants`
readings are in C.1, entries 14-15. Same mechanics as `vigil-candle`.

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
