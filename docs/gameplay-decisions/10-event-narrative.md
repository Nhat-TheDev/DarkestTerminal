# §10. Event Narrative Layer

*(item 10 of `00-index.md`)*

**Scope**: the narrative layer over the event system — how events relate to each other, how one
event's text reacts to what the party did at another, how the event chains escalate with depth,
the discovery curve at floors 15/35/70, the narrative-layer events' specs, the Wanderer, and the
floor-100/120 ending system. The player-facing mechanics are in `08-events.md`: the shared
worldview, recurring characters, chains and reflection in §8.2-§8.6, and each event's own entry
from §8.7 on. The hidden ground-truth worldview behind this text (what the Sleeper/Covenant actually are, never told
to the player) lives in `12-world-bible.md`, which also settles the party's single reason for
descending (§12.5, "the Call") — never told to the player either. Every quote below has passed a
craft review (cringe/slop/craft) and a compliance check against `12-world-bible.md`.

---

## Part A — The relationship graph

19 events, all in `data/events.json`. `the-wanderer`, `the-one-who-stayed`, and `the-gatekeeper`
are not part of this graph; each has its own section below.

### A.1 — What each event teaches the player

The single most important table in this file. "Learns" is never something the game states —
it's what an attentive player is positioned to infer after the scene, per `12-world-bible.md`
§12.11's "one observable change, let the player supply the cause."

| Event | Thread | Learns (inferred, never stated) |
|---|---|---|
| `blood-altar` | 1 | A blind toll has an exact, predictable price — no more, no less. |
| `sacrificial-circle` | 1 | Repeating the same trade enough times stops requiring their consent (Chain 2). |
| `twin-altars` | 1 | Some choices here are forced to be final; hesitation isn't an option. |
| `collapsed-floor` | 1 & 4 | Heroism and worship cost the identical thing to whatever's counting — the clearest single proof of §12.10's thesis. |
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
| `old-count` | 4 | Obsessive repetition happened to someone else here first — an echo of drift (§12.5) in a stranger's story, not the party's own. |
| `the-delay` | 4 | Their own senses aren't fully reliable here — the clearest "this is a dream" evidence that needs no Covenant framing at all. |
| `vigil-candle` (15) | 5 | Physical law doesn't fully hold here. No new fact — the first *felt*, physical proof of it. |

### A.2 — Thread diagrams

**Thread 1 — The Balance core** (§12.4, §12.12's Submission/Scarcity/Informed-risk row)

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

**Thread 2 — The Covenant schism** (§12.6's containment/communion split)

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
                                   blood-altar (pair 17 — echoes back into Thread 1)
```

**Thread 3 — The three NPCs** (§12.7-12.8's contact line)

```
Thread 1 ──────────────────► wandering-hermit ◄────────── Thread 2
                                     (general sensed imbalance, either direction — he's ex-Covenant,
                                      §12.8 — but never named as such, and never specific)

Thread 1 ──────────────────► gambling-den
                                     (Thread-1-to-Stranger only — never NPC-to-NPC, §12.7)

merchant ───────────────────► waiting-supplies
merchant ◄─────────────────── still-breathing (floor 70)
```

**Thread 4 — Traces of those before** (deliberately outside Covenant, §8.2)

```
open-chest ─────┬──────► doubled-back
                │
collapsed-floor ┘──────► old-count
   (bridges Thread 1 and Thread 4 at once — §12.10's own point, same shape, different story)

the-delay stays unconnected — pure dream-logic, no institution, no remnant-of-a-person framing
```

**Thread 5 — Depth escalation** (reveal *order*, not text-variants — §12.11: "closer, not a new area")

```
floor 15 ── vigil-candle (pure atmosphere, deliberately unconnected)
         └─ broken-seal (Thread 2)
floor 35 ── half-a-warning (deepens Thread 2, echoes into Thread 1 via pair 17)
floor 70 ── still-breathing (recontextualizes the spiral itself, echoes into Thread 3 via pair 16)
```

Pacing rationale, one sentence per milestone: floor 15 is where the party first notices a history
before them (someone was here, something happened); floor 35 is where that history turns out to
involve real conflict between people (the containment/communion split cost someone their life);
floor 70 is where the dungeon's own material contradicts how that history explained itself (the
symbol both sides fought over wasn't theirs to begin with). Each step deepens *what's known*, never
*what's resolved* — §12.9 stays untouched throughout.

### A.3 — Deliberately absent bridges

Thread 2↔4, Thread 3↔4, Thread 4↔5 don't connect, and shouldn't: all 3 would tie the
deliberately-mundane, no-Covenant events (§8.2) to Covenant/dream-contact material, crossing the
exact boundary those events exist to hold. Checked, not overlooked.

---

## Part B — Cross-event continuity, description variants & stance echo

### B.1 — Cross-event continuity

**Compliance rule** (the one rule every pair below was checked against): every variant is the
*party's own* behavior or perception changing — never an NPC, a Guardian, or the dream recognizing
or reacting to the party's specific history (`12-world-bible.md` §12.4, §12.11). *"It already
knows you paid the blood price"* — violation. *"Your hand is already open before you've chosen who
pays"* — compliant; the party drifted (§12.5), nothing external changed. One narrow exception:
the Hermit may show a *general* sensed-imbalance reaction ("something uneven walked in"), per his
established character (§12.8) — never specific ("you visited blood-altar").

**Density cap**: the strongest version of drift — the body acting before the mind decides ("your
hand is already moving") — is reserved for exactly 2 pairs across the whole graph: pair 3 (the
literal return to `blood-altar`) and pair 17 in C.3 (the `half-a-warning`-informed return, where
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

**Resolution priority in `pickEventText()`** (`src/engine/dungeon.ts`), first match wins: chain
state — Chain 1's room-pinned buildup/forced/forced2/forced3 on the guardian events, Chain 2/3's
escalated3/escalated2/escalated (highest tier first), Chain 4's escalation on the free-take events
→ `returnDescription` on a return visit to a recurring figure, with its `stanceEcho` (B.3) and
`campReflectionUnawareEcho` lines appended → **`crossEventVariants`** (first array entry whose
condition matches) → **`descriptionVariants`** (the pick pinned to the room) → `description`
fallback. Chain states return immediately and never
also show a cross-event variant — stacking 2 special states in one scene violates the
one-observable-change rule.

**Outcome tags to record** (only where the generic `"resolved"` fallback isn't precise enough):

| Event | Tag | Set where |
|---|---|---|
| `blood-altar` | `"paid"` / `"declined"` | `bloodAltarPay()` / `bloodAltarLeave()`, before `closeEvent()` |
| `collapsed-floor` | `"rescued"` / `"failed"` / `"declined"` | `collapsedFloorAttempt()` (whether the trapped person was reached in time) / the skip path |
| `sacrificial-circle` | `"sacrificed"` | `sacrifice()`, on any successful call |
| `wandering-hermit` | `"traded"` | `hermitExchangeFortune()`, on a completed trade (gates its reflection) |
| `guardian-fight` / `desecrated-altar` | `"resolved"` / `"skipped"` | `game.ts`'s combat-victory reward block (the win path never reaches `closeEvent()`) / the skip path |

The `collapsed-floor` split is what lets a later `collapsed-floor` visit (its own 2 variants,
below) read whether the trapped person was actually reached, not just that a payment was made.
Pair 3 takes either `rescued` or `failed` (any attempt), and "any resolution of `collapsed-floor`"
(pairs 12-13) means `rescued`/`failed`/`declined`. The guardian
events' `"skipped"` tag keeps pairs 8 and 15 tied to an actual won fight, never a skip.

**All 15 pairs**:

1. `collapsed-floor` ← `blood-altar`=`paid`: *"A section of floor has dropped away along a long crack. A weak groan echoes up from below. Whoever paid at the altar is the first to kneel at the edge."*
2. `collapsed-floor` ← `blood-altar`=`declined`: *"A section of floor has dropped away along a long crack. A weak groan echoes up from below. Whoever kept their hand closed at the altar stands at the edge with both hands in their sleeves."*
3. `blood-altar` ← (`collapsed-floor`=`rescued`/`failed` OR `sacrificial-circle`=`sacrificed`): *"Ancient
   carvings on the stone pedestal ooze a dark, still-warm liquid, a spiral unwound and open at its
   center. Two of you roll up a sleeve at the same time."*
4. `guardian-fight`/`desecrated-altar` ← (`blood-altar`=`paid` OR `sacrificial-circle`=`sacrificed`),
   own imagery per id (each keeps the imagery it already uses elsewhere — `desecrated-altar` never
   uses guardian-fight's claws or dark corner), each closing on one detail that fits both triggers (a blood payment or an artifact
   sacrifice): `guardian-fight`: *"Claws scrape on stone in a dark corner, beside a closed spiral. The spiral on the artifact in your pack turns the other way."* · `desecrated-altar`: *"The stone altar glows with a pale red light. Someone in the party wipes their palms dry before going closer."*
5. `twin-altars` ← (`blood-altar`=`paid` OR `sacrificial-circle`=`sacrificed`): *"Two stone pedestals face each other, each carved with a spiral, open at the center. The cups set into them are dark at the bottom, the same dark as at the last altar."*
6. `sacrificial-circle` ← `blood-altar`=`paid`: *"Old dried blood traces a spiral across the stone, open at one end and too deliberate to be an accident. It's the same dark brown as the stain on your sleeve cuff."*
7. `wandering-hermit` ← (`blood-altar`=`paid` OR `sacrificial-circle`=`sacrificed`): *"An old man sits cross-legged amid the rubble, a spiral mark scarred into his forearm. His eyes are open when you arrive. He lays a clean rag on the stone beside him before you've said a word."*
8. `wandering-hermit` ← (`guardian-fight`=`resolved` OR `desecrated-altar`=`resolved`) — a 2nd,
   independent entry on the same field; if both this and #7 match, #7 wins (array order, "first
   match wins," no new rule): *"An old man sits cross-legged amid the rubble, a spiral mark scarred
   into his forearm. His eyes go to the guardian ash on your boots, then to the mark on his own
   arm."*
9. `gambling-den` ← (`blood-altar`=`paid` OR `sacrificial-circle`=`sacrificed`): *"A stranger shuffles three cups on an upturned crate, his forearms bare and unmarked. He asks what you've already paid today, and starts shuffling before you answer."*
10. `cursed-shrine` ← (`blood-altar`=`paid` OR `sacrificial-circle`=`sacrificed`): *"A statue with three eyes. One of them is open. Its lowest lid is chipped, the way stone chips under a knife point."*
11. `waiting-supplies` ← `merchant` (any resolution): *"A bundle sits wrapped and tied at the base of the wall, where someone would leave it to come back for later. The rope is knotted in a spiral, the same mark burned into the merchant's goods. Dust lies thick on it."*
12. `doubled-back` ← (`open-chest` OR `collapsed-floor`, any resolution): *"Footprints lead into this room and stop. None lead back out. The tread is worn down at the heel, like yours."*
13. `old-count` ← (`open-chest` OR `collapsed-floor`, any resolution): *"Someone scratched tally
    marks into the wall here, hundreds of them, all by the same hand, in neat rows. The last row
    stops mid-stroke. Under it, a pack strap rotted through at the buckle."*
14. `broken-seal` ← `blood-altar`=`paid` OR `sacrificial-circle`=`sacrificed` (communion-leaning
    reading): *"A stone hatch, chained shut and mortared at the edges. Half a spiral is stamped into what's left of the lock, the other half torn away with whatever broke it open. Chips of mortar lie on the stone beneath it, fallen inward."*
15. `broken-seal` ← `guardian-fight`=`resolved` OR `desecrated-altar`=`resolved` (containment-leaning
    reading) — 2nd independent entry, same base scene, opposite ending: *"...Chips of mortar are scattered
    across the floor, thrown outward."*

**`collapsed-floor` ← its own earlier outcome**: 2 more entries on `collapsed-floor`, ahead of
pairs 1-2 in its array, so a repeat visit reads the last rescue attempt before any `blood-altar`
history:

- ← `collapsed-floor`=`rescued`: *"A section of floor has dropped away along a long crack. A weak
  groan echoes up from below. The rope from the last one is still in your pack, frayed where it ran
  over the edge."*
- ← `collapsed-floor`=`failed`: *"A section of floor has dropped away along a long crack. A weak
  groan echoes up from below. The last one like this stopped halfway through a breath."*

Pairs 16-17 (`merchant` ← `still-breathing` and `blood-altar` ← `half-a-warning`) are listed
under C.3, since they depend on events defined there.

**Base descriptions for `waiting-supplies` and `broken-seal`** (what a party that hasn't resolved
the source event sees): `waiting-supplies`' base is pair 11 with the spiral and the merchant taken
out of the knot ("The rope is knotted tight, every turn laid the same way. Dust lies thick on the
knot."), since matching it to the merchant's goods presupposes having met `merchant`; `broken-seal`'s base is the
2 sentences both its variants share, with the final sentence (which way the mortar chips
fell) added only by whichever variant matches. Their `reflection` text is in
`data/events.json`.

**Rejected — 3-way link between `merchant`/`wandering-hermit`/`gambling-den`**: incompatible,
not deferred. §12.7: "This line doesn't include the Stranger." §12.8: the three are
"parallel, non-intersecting stories." Any version of "the Stranger's line changes because you met
the Hermit" needs either the Stranger knowing about the Hermit (breaks §12.7/§12.8 outright), or a
per-NPC memory system the game doesn't have. If wanted later, it needs its own design
pass.

### B.2 — Description variant pool

**Why**: by floor 10 — reached by essentially every player — each common-tier event has repeated
2-3 times (per a depth-band simulation), and without variants every repeat is byte-for-byte
identical text. This affects every run, including ones that end before any depth-gated content is
reachable.

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

**`open-chest`** (stays outside the Balance, §12.12 — no spiral in any variant):
- *(description)* "A cracked oak chest sits crooked amid a pile of rubble. Whoever carried it this
  far didn't carry it any further."
- "A rusted lockbox is wedged under a collapsed beam, the key still in it, snapped off at the
  shaft."
- "Someone stacked their gear in a neat pile before they stopped needing it: boots, belt, an
  unopened pack."

**`guardian-fight`** (spiral kept in 1 of 3, not all — repeating it everywhere is its own checklist
tell):
- *(description)* "A chest sits in the far corner. Beside it, a closed spiral is scratched into the
  wall, and something in the dark is scraping claws on the stone. The scraping stops."
- "Something breathes in the dark ahead, at the same slow pace whether you move or not."
- "Loose stone shifts under something heavy, back where the light doesn't reach. The shifting stops
  when you stop."

**`merchant`**:
- *(description)* "A lamp gutters over a cloth spread with goods, each with a spiral mark burned into it. A hooded figure bows."
- "Firelight catches on a row of small objects laid out with care, each one marked the same way.
  A hooded shape straightens as you approach, already reaching for the first item."
- "A cloth is spread flat across the stone, weighted at the corners against a draft that isn't
  there. The hooded figure doesn't look up until you're close enough to see the mark on every
  piece."

**`desecrated-altar`**:
- *(description)* "The stone altar glows with a pale red light, pulsing as if breathing. A spiral is
  cut into the base, closed like a knot."
- "A pulse of red light rises and falls along the altar's edge, patient as a held breath."
- "The altar's glow catches in a carved spiral at its base, sealed shut, older than the stone
  around it."

The other events (`blood-altar`, `cursed-shrine`, `twin-altars`, `sacrificial-circle`,
`wandering-hermit`, `gambling-den`, `collapsed-floor`, and the narrative-layer events in C.3 and
D: `old-count`, `doubled-back`, `the-delay`, `waiting-supplies`, `vigil-candle`, `broken-seal`,
`half-a-warning`, `still-breathing`) have no variants yet: `descriptionVariants` is optional per event and can be added one event at a time.
`the-wanderer` uses the same field for its own pool.

### B.3 — Reflection stance echo

`12-world-bible.md` §12.13's direction — flavor only, never mechanical, never a strict classifier,
each stance readable more than one way — is `EventDefinition.stanceEcho?: { curious, wary,
dismissive }`. `dominantReflectionStance()` (`src/engine/dungeon.ts`) reads the party's most-picked
stance across `GameState.eventReflectionStances` (undefined if none recorded yet or tied) and
appends the matching line to a `returnDescription` visit. Only `wandering-hermit` carries one: he's
the 1 of the 3 recurring figures whose own backstory (§12.8) makes him plausible to notice a pattern
in someone else. `merchant`/`gambling-den` could take their own `stanceEcho` the same way.

---

## Part C — Chains & discovery curve

### C.1 — Chain tier 2

Chains 1-3 (`08-events.md` §8.5, `12-world-bible.md` §12.13) each escalate past their first
tier: tier 2 here, tier 3 in C.2. Tier 2 is gated by `circleRemembersThreshold2`/
`bloodDebtThreshold2`/`guardianGrudgeFiredCount` **and** `chainTier2MinFloorDepth: 15` together —
a chain can't reach tier 2 on counter alone. Engine side: `src/engine/dungeon.ts`, `src/engine/events/guardianFight.ts`,
`src/engine/events/shared.ts`.

### C.2 — Chain tier 3

**Why**: with 2 tiers only, floor 16 and floor 120 would read identically — nothing would gate
past tier 2 (floor 15), and both `vigil-candle`/`broken-seal` are `onceLifetime`, spent early in a
long run. That contradicts `12-world-bible.md` §12.3's own claim that depth is continuous ("closer to whatever is left of
Sleeper's actual dreaming core"), not a single step. **Deliberately not** a new `onceLifetime`
event at this tier — 2 is already a small per-run budget; better to extend the *existing*
escalating threads one step further than multiply one-shot content few runs reach.

```ts
// on EventDefinition
chainForced3Description?: string;      // Chain 1, per-id like tiers 1-2
chainEscalated3Description?: string;   // Chain 2/3
// reflection
escalated3Prompt?: string;
// Room.chainVariant
"buildup" | "forced" | "forced2" | "forced3"
// narrativeCounters — reuses guardianGrudgeFiredCount >= 2
```

```json
// data/balance-config.json → events
"circleRemembersThreshold3": 20,
"bloodDebtThreshold3": 16,
"chainTier3MinFloorDepth": 35
```

Tier 3 checked *before* tier 2 in `pickEventText()`/`pickReflectionPrompt()` — strictly higher bar
(threshold3 **and** depth3), so meeting it always means tier 2's own bar is also met. Text
continues the tier-1→tier-2 throughline (dependence → unawareness, §12.5): tier 3 is the point
where the habit has left marks of its own. Every line below is physical evidence of repetition —
claw marks worn deep, a spiral scored through more than once, knees fitting worn places exactly, a
callus where the cuts go — and none of them says how the party feels about it or claims they've
stopped deciding. The marks are the party's own work, which is what keeps this drift rather than
possession: agency (§12.5/§12.11) stays real, and the player is left to read what it adds up to.

- Chain 1, tier 3 (per-id): `guardian-fight`: *"Claw marks run from the corner to the foot of the
  stairs, worn deep, back and forth."* · `desecrated-altar`: *"The spiral at the altar's base has
  been scored through with a blade, more than once. The cuts look like yours."*
  Reflection: `guardian-fight`: *"You walk through the ash on the way out without slowing."* ·
  `desecrated-altar`: *"The altar goes dark behind you. Your blade has stone dust in its edge again."*
- Chain 2, tier 3 (`sacrificial-circle`): *"Old dried blood traces a spiral across the stone. The
  worn places at its open end fit your knees exactly."*
  Reflection: *"On the way out, someone asks how many that makes. Two of you give different
  numbers."*
- Chain 3, tier 3 (`blood-altar`): *"The liquid creeps toward the cup. Three of you have a scar in
  the same place on the left palm."*
  Reflection: *"There's a callus now where the cuts go."*

### C.3 — Discovery curve: floors 15 / 35 / 70

**Compliance distinction that makes this whole section possible**: `12-world-bible.md` §12.9's
open list constrains *verdicts* (is the Covenant right, does Sleeper wake, did the Stranger win) —
not the *quantity of evidence* a player can be handed toward their own theory. Depth can keep
escalating in concrete, specific *information*, not just intensity, without ever resolving §12.9.
Floor 15 already does this (`broken-seal` is real evidence, not just mood; `vigil-candle` stays
pure atmosphere on purpose — not every discovery needs to be a clue).

Each depth gate here (15/35/70) is the event's own `minFloorDepth` in `data/events.json`, the same
way `forceEquip` and other event-specific values live on the event. `data/balance-config.json`
holds no event depth gate — only the chain tiers' (`chainTier2MinFloorDepth`,
`chainTier3MinFloorDepth`).

**Floor 35 — "Half a Warning"**

> "Someone carved this fast, and never finished it. What's left: 'saw what happened to the one who
> tried to carry both. I won't write what was left of them. Choose one side. Don't waver.'"

```
reflection.prompt: "The last stroke runs off the end of the word and down the wall."
curious: "Twice you read the last word, then the blank after it."
wary: "You read it once and walk on fast."
dismissive: "Scratch marks on a wall. You've walked past a hundred."
```

Testimony, not doctrine — "I won't write what was left of them" implies something severe without
spending the restraint budget describing it (§12.11's show-don't-state). Seeds `waiting-supplies`:
its bundle's knot, "every turn laid the same way" — never switched — reads differently once a player has
found testimony that switching gets people killed.

`id: "half-a-warning"`, `kind: "instantReward"`, `tier: "rare"`, `minFloorDepth: 35`,
`onceLifetime: true`, `guaranteedArtifactId: "worn-chalk-stub"` (`07-items-artifacts.md`'s
"Event-tied artifacts") — the carving tool implied by the scene, not a random roll.

**Floor 70 — "Still Breathing"**

> "The walls curve like ribs here. Grown into one of them is a strip of old cloth with a mark burned
> into it, the same mark as on the goods you've traded for."

```
reflection.prompt: "Outside the room, you check the seams of your own pack."
curious: "You press a thumb against the wall. It gives, a little."
wary: "You turn your marked goods face-in, at the bottom of the pack."
dismissive: "Cloth rots into strange shapes. You say it aloud until it sounds true."
```

One dominant reveal, deliberately. Stacking several facts in one scene (walls are ribs, the
growth is human material, the spiral is a copy, the process is ongoing) reads as a lore dump, not a
discovery. So "walls are ribs" is only a likeness ("curve like ribs") rather than its own beat, and
the whole line builds toward the 1 real reveal: a trade-mark grown into bone, identical to the
party's own. The "copied, not invented" conclusion is never stated — it's left entirely to
inference, per §12.11's show-don't-tell rule, at the game's single deepest lore moment. Whether the
growth is ongoing or long finished is never stated either; the reflection prompt only confirms the
match "stroke for stroke", and the curious option's wall that "gives, a little" is as far as the
text goes toward an answer. Never "consuming" or "hunting" (§12.4 — passive and
involuntary, like the whirlpool-finds-the-drain framing, never implying Dream has intent). Doesn't
confirm any §12.9 item: the embedded object is generic, never tied to a specific named figure.

`id: "still-breathing"`, `kind: "instantReward"`, `tier: "rare"`, `minFloorDepth: 70`,
`onceLifetime: true`, `noArtifactReward: true`. **No artifact, no stat effect of any kind**: a
reveal strong enough not to need a mechanical reward attached is the point; needing one would be a
sign the reveal wasn't landing.

**Pairs 16-17 — how the milestones echo forward** (§12.5's drift shouldn't stop meaning anything
once the scene that taught it ends; numbered on from B.1's 15):

16. `merchant` ← `still-breathing` (resolved): *"A lamp gutters over a cloth spread with goods,
    each with a spiral mark burned into it. A hooded figure bows. The cloth is the same weave as the
    strip grown into that wall."*
17. `blood-altar` ← `half-a-warning` (resolved): *"Ancient carvings on the stone pedestal ooze a dark,
    still-warm liquid, a spiral unwound and open at its center. Someone's knife is out, and someone
    else has a hand on their wrist."*

Only these 2 — knowing the warning doesn't stop the drift, it just adds a beat of resistance, a hand
on a wrist, without saying which hand wins (more honest to §12.5 than a version where knowledge
simply fixes behavior). Not wired into every event after every milestone — that would violate the same
one-observable-change discipline holding the rest of this file together.

---

## Part D — Narrative-layer events

**Event-tied artifacts**: `EventDefinition.guaranteedArtifactId?: Id` is checked in `openChest()`
(`src/engine/events/openChest.ts`) ahead of the standard roll, so the party gets the object the
scene describes rather than a random one (`07-items-artifacts.md`'s "Event-tied artifacts"):
`waiting-supplies` → `travelers-ration`, `vigil-candle` → `vigil-cloth`, `broken-seal` →
`torn-lock-plate`, `half-a-warning` → `worn-chalk-stub`.

**`vigil-candle`** ("Vigil") — Thread 5, floor 15:

> "A candle burns at the end of a dusty corridor with no footprints in it. The wax has pooled thick
> on the floor, but the flame is a new candle's height. A cloth lies folded beside it."

```
reflection.prompt: "You left it burning."
curious: "You hold a hand near the flame. It's warm."
wary: "Hands in your sleeves, well clear of the flame."
dismissive: "Wax runs strangely sometimes. You leave it to burn."
```

`kind: "instantReward"`, `tier: "rare"`, `minFloorDepth: 15`, `onceLifetime: true`,
`guaranteedArtifactId: "vigil-cloth"` — a specific item (`07-items-artifacts.md`'s "Event-tied
artifacts") rather than a roll off the standard table, since the scene already describes exactly
what's sitting there (beside the candle, like an abandoned offering).

**`broken-seal`** ("Broken Seal") — Thread 2, floor 15. Base text and both `crossEventVariants`
readings are in B.1, entries 14-15. Same mechanics as `vigil-candle`, `guaranteedArtifactId:
"torn-lock-plate"`.

**`old-count`** — Thread 4, common tier:

> "Someone scratched tally marks into the wall here, hundreds of them, all by the same hand, in
> neat rows. The last row stops mid-stroke."

```
reflection.prompt: "On the way out, you glance back once at the half-finished mark."
curious: "You count the last full row before you go."
wary: "You keep to the far side of the corridor, away from the wall."
dismissive: "Somebody's nervous habit. Not yours to worry about."
```

`kind: "instantReward"`, `tier: "common"`. Cross-event variant in B.1, entry 13.

**`doubled-back`** — Thread 4, common tier:

> "Footprints lead into this room and stop. None lead back out. The room is empty."

```
reflection.prompt: "You check the walls for a door. The stone is solid all the way round."
curious: "Your boot hovers over the last print, then steps around it."
wary: "You leave the way you came, stepping in your own prints."
dismissive: "Feet backtrack all the time. You just missed the tracks."
```

`kind: "instantReward"`, `tier: "common"`. Cross-event variant in B.1, entry 12.

**`the-delay`** — Thread 4 (unconnected by design), common tier:

> "Still water pools at the edge of the room, dark enough to mirror the torchlight. Your reflection
> catches up to you a half-second late, every time you move."

```
reflection.prompt: "Somewhere behind you, water drips a beat after each step."
curious: "You pass a hand over the water once more and count the delay."
wary: "You keep your eyes forward the rest of the way down."
dismissive: "Tired eyes. When you look back, the water is just water."
```

`kind: "instantReward"`, `tier: "common"`, `noArtifactReward: true` — the purest "no cost, no
reward, information only" case among the common `instantReward` events. No cross-event variant,
deliberately — pure dream-logic,
no institution, no remnant-of-a-person framing to bridge from. **Template for future common-tier
events**: no NPC, no spiral, no lore exposition — one small, unexplained physical wrongness, felt
and then walked away from. When a new low-stakes event is wanted, this is the shape to reach for
before reaching for another Covenant-adjacent scene.

**`waiting-supplies`** — Thread 3 & 4, common tier. Base text and `merchant`-sourced variant are in
B.1, entry 11. `guaranteedArtifactId: "travelers-ration"`.

**`the-gatekeeper`** — the scene that opens every run, outside the dungeon (`08-events.md` §8.7). The
party are fortune-seekers who came down for treasure that would change their lives. The man at the
gate is neither priest nor guide: he keeps it, watches parties go in, and never says how many come
out. The toll is framed as something left with him by custom, not a purchase. He is deliberately
unlike the Wandering Hermit, the other old man in the roster: he stands rather than sits, asks
for a customary sum the party may refuse where the Hermit names his price, and is met before the
first room rather than among the rubble.

---

## Part E — The Wanderer

A rare, no-reward encounter — 1 of 3 lore-delivery channels outside the event system proper (the
other 2: Item/Artifact lore-bearing descriptions, `07-items-artifacts.md`; Camp Reflection, a party
self-analysis mechanism at rest, `03-survival-stats.md`).

**Not** 1 of the 3 established recurring figures (§12.7-12.8) and **not** a fixed identity — no
`returnDescription`, a different individual every encounter. This is why it doesn't need the same
"decide first whether they belong on §12.7's line of contact" gate §12.8 requires for a new
*recurring* figure — there's no single character here to place on that line at all, only a
recurring *situation* (Thread 4, "Traces of Those Before," Part A.2) finally given a voice.
Deliberately compatible with §12.9's open questions: no variant of this event ever confirms whether
a given wanderer is really still alive down there, made it out, or is something else entirely.

**Mechanics**: `id: "the-wanderer"`, `kind: "instantReward"`, `tier: "rare"`, `noArtifactReward:
true` (reuses the exact pattern `still-breathing` established, Part C.3 — no new `EventKind`),
`minFloorDepth: 10` (a light gate — encountering a fellow lost soul reads better once the party's
been down a while; low enough to still be common relative to the floor-70-deep events). **Not**
`onceLifetime` — can recur any number of times in a run, each time picked from the same
`descriptionVariants` pool below, so "always someone different" is enforced by the pool being
randomized per room (Part B.2's existing mechanism), not by any new once-per-identity tracking.

### E.1 — Content: 3 base variants + 1 conditional

**Variant 1** — temporal confusion:

> "A figure sits with their back against the wall, turning something small over in their hands,
> too dark to see what. 'How long's it been?' they ask, not really to you. 'Feels shorter every
> time I ask.'"

**Variant 2** — a repeated, broken action:

> "A figure leans against the far wall, restringing a bow that has no string. 'The quiet floors,'
> they say. 'Watch those.'"

**Variant 3** — mistaken recognition:

> "A figure looks up as you approach, then straightens like they expected someone else. 'Not you,
> then,' they mutter, and sit back down facing the stairs."

**Variant 4 — conditional, via `crossEventVariants`**, `{"eventId": "camp-reflection", "outcome":
"unaware"}` (reuses the exact synthetic bridge tag Camp Reflection already writes for
`wandering-hermit`, `03-survival-stats.md` — no new tracking, a 2nd reader of the same 1 tag):

> "A figure sits against the wall, turning something small over in their hands. They nod to you.
> You nod back and keep walking."

Only reachable once the party's own Camp Reflection has reached Unawareness — the payoff is
Variant 1's scene with the question gone: the same figure, the same small object, and nobody on
either side asking how long it's been. Craft note: written to require Variant 1 having been
*possible* (thematically, not mechanically — no data dependency), so the missing question lands
only for a reader who's seen it asked before; for anyone else it is just two nods.

**Reflection** (shared across all 4 variants — same reasoning `merchant` shares 1 reflection across
its several variants):

```
prompt: "Whoever that was, they didn't ask your names, and you didn't offer them."
curious: "The whole way down, you listen for an answering voice."
wary: "You don't look back to check if they're still where you left them."
dismissive: "One more voice talking to itself. Not your problem."
```

### E.2 — World-bible constraints

No variant states whether the figure is alive, a remnant, or something else (§12.9). No variant
names "Sleeper," "Covenant," or "the Balance." Agency stays fully with the party throughout — the
figure never controls or compels anything, only talks; Variant 4's absence-of-a-question is the
*party's* drift being shown, not anything done to them. Doesn't touch any of the 3 established
figures' own storylines (§12.7-12.8) — a wanderer's dialogue never references the Hermit, the
hooded figure, or the Stranger, staying a wholly separate thread.

---

## Part F — The Ending System (floor 100 / floor 120)

**Scope**: a fully **optional content layer** — it does not change the infinite-descent/permadeath
loop. The overwhelming majority of runs still end in ordinary permadeath well before floor 100. This is a branch for the rare run that survives
that far, not a new default destination. Lore-authoring for the whole game ends at floor 120 — the
dungeon keeps generating past that depth for anyone who wants to keep playing, but no new story
content is designed to appear there.

### F.1 The floor-100 checkpoint

Once the party defeats floor 100's own boss (still alive), the run pauses on a **guaranteed story
beat**, not a normal event roll — mechanically distinct from `rollEvent()`'s probabilistic system,
since this must fire every single time a run clears that boss, unconditionally. Floor 100 itself
plays out as an ordinary floor up to that point — normal rooms, events, and ambushes included.
`Game.advanceToNextFloor()` (`src/engine/game.ts`) checks the cleared depth against
`ENDING_CHECKPOINT_FLOOR_DEPTH` (`src/data/endings.ts`) and sets `pendingEndingCheckpoint` instead
of building the next floor; `syncUiToGameState()` (`src/ui/app.ts`) shows it ahead of every other
screen. Floor 120 is flagged on arrival instead, and only after Continue: once the new depth
equals `FOUNDER_FLOOR_DEPTH`, the floor is built and `pendingFounderDialogue` replaces the entry
room's ambush check, with the same screen priority.

**3 mutually exclusive modes**, decided by 2 gates checked in the order below the moment floor 100's
boss falls — never all 4 endings competing on 1 menu:

| Condition | What the checkpoint offers |
|---|---|
| **Either Leave trigger fires** (below) — checked first, overrides everything else | **Leave only** (§F.4) — no Stay, no Let Go, nothing else. |
| Camp Reflection Tier 4, Unawareness (`03-survival-stats.md`) | **Stay**, **Let Go**, or **Continue** (§F.5, the path to the true ending). |
| Anything else | **Stay** (§F.2) or **Let Go** (§F.3). |

**Leave has 2 independent triggers, either one sufficient on its own:**

**1. "The blood debt breaks"**: Chain 3, "Blood Debt" (§8.5), reaching its tier-3 escalation at some
point this run — `narrativeCounters.altarPaymentsCount >= events.bloodDebtThreshold3` (16 payments,
the same counter and threshold already tracked for `blood-altar`'s `chainEscalated3Description`) —
**and** the most recently recorded outcome of an `hpGamble` event (`blood-altar`, read from
`GameState.eventOutcomes`, already written per Part B.1's table) reads `"declined"`. Both pieces of state already exist for
other reasons; this condition only reads the 2 of them together.

**2. "The ledger never opens"**: Chain 4, "Taken, Never Given" (`freeRewardsTakenCount`, §8.5),
reaching its 1 escalation — the party has taken from 12+ of the 7 zero-cost reward events combined
(`open-chest`, `old-count`, `doubled-back`, `waiting-supplies`, `vigil-candle`, `broken-seal`,
`half-a-warning`) **and** never once paid at `blood-altar` or fed `sacrificial-circle`
(`altarPaymentsCount === 0 && artifactsSacrificed === 0`). It reads nothing beyond Chain 4's own
counter, which §8.5 specifies in full.

**Why 2 triggers instead of 1**: they're deliberately 2 different roads to the same absence, not 2
unrelated mechanics bolted together. A single Camp Reflection Untouched-tier gate (a party that
barely engaged with anything) is nearly unreachable by floor 100 (resolving almost any event
increments `loreExposureCount`) and collapses 2 genuinely different stories into 1 vague "didn't do
enough" reading. Trigger 1 is a party that engaged
*the most* with 1 specific reciprocal exchange — enough to live through the stone's most corroded
text — and then, on some later visit, didn't pay. Trigger 2 is a party that was never in a reciprocal
exchange with anything down here to begin with, only ever on the receiving end. Nothing here decides
to punish either one. Both are the same shape as everything else in this bible (§12.4): there's simply
no longer (trigger 1) or never was (trigger 2) a standing exchange that recognizes this party as
someone worth keeping. For trigger 1, whether the decline was chosen (enough HP to pay, paid anyway
16+ times, then refused) or forced (nobody had HP to spare that visit) is never distinguished in the
text — deliberately; the significant fact is only that the pattern broke, not why. §F.4's actual
wording never specifies which trigger fired, on purpose — the ending reads identically either way.

**Why Continue's condition, specifically**: reusing `loreExposureCount`/`campReflectionTier` needs no new tracking at all, and
it's thematically exact — the true ending is "keep going despite total terror," and the 1 existing
mechanism that measures a party's *capacity to stop registering fear as a reason to stop* is Camp
Reflection's Unawareness tier. A party able to take this choice isn't brave in the ordinary sense;
they've drifted far enough that the normal reasons to turn back have stopped landing on them the
way they used to (§12.5) — the same erosion treated as a quiet tragedy through the rest of the game
becomes, here, the literal precondition for the deepest content. That reframing is the point.

None of these conditions are ever stated to the player. A party whose blood debt never breaks and
never reaches Unawareness never sees any hint that Leave or Continue exist as options; nothing should
read as "you failed to unlock" anything, since no condition anywhere in this system is ever surfaced.

### F.2 Ending 1 — Stay

> "To stay — to be part of what holds this floor together."

Resolution, once chosen:

> "The way back up is where it always was. No one climbs it. Packs come off and are left on the stone; the torch burns down to a height it does not drop below again. Much later, another party comes down this corridor. They do not know your names. Something in how they move through it is easier than it should be."

Plain declaratives with 2 physical frames (the packs, the torch) before the abstraction — not the
negate-then-correct spine that Let Go ("None of you feel yourselves stop") and Leave ("There is no
staying here…") already open on.

Deliberately doesn't explain the mechanism (how staying "helps" — left open, matching §12.9's own
discipline about not over-explaining what the dungeon's structure actually is). The run ends here —
a distinct resolution screen (`GameState.gameOver: "stay"`), not `"defeat"` (this isn't a loss).

**The payoff, on a later run**: `the-one-who-stayed` (`data/events.json`), a rare,
per-profile-once event — not a variant of `the-wanderer` (Part E), a deliberately
different, more personal shape: it names the specific class that stayed.

> "A figure crouches at the edge of the torchlight in {{class}} gear, worn the way yours is, only
> longer. They look up without surprise. 'You got further than we did,' they say."

A party holds `party.size` classes picked from the whole class roster, so a living character of
that exact class is often standing in the party when this is read. The text marks the figure as **a
different one** through the gear alone — worn the way yours is, "only longer" — which turns a
bug-like reading into uncanny doubling without a line explaining it. The
closing line is one only this character could say, not a stock returning-ally quip.

**Named by class, not by name**: this game has no personal-name system; `Character.name` is always
the class's own display name (`createCharacter(id, cls.name, cls)`, `src/engine/game.ts`).
`{{class}}` is filled at read time from `GameState.retiredCharacterClassId`. Naming the class only
is the same "nobody down here exchanges names" principle (`12-world-bible.md`) the rest of this
file holds to.

No combat, no cost — matches the established "just talk, no transaction" shape (Part E).
`noArtifactReward: true`: a pure dialogue-only beat.

**The persistence layer**, `src/engine/profile.ts`: a small `slotN.profile.json` per save slot,
living beside that slot's run file, but never importing `save.ts`/`game.ts` (they import it).
Holds `{ version, unlockedAbilityIds, retiredCharacters: { classId }[], shownRetiredCharacterEvent:
boolean, runCount, memoryUnlocked, memoryIntroShown }` — `version` and `unlockedAbilityIds` come from `AbilityProfile`
(`src/types.ts`), the ability unlocks that share the file. A retired character belongs to the slot
it retired in: only a later run in that same slot can meet them. `addRetiredCharacter()` is called the moment Ending 1 is
chosen (`Game.pickEndingChoice`); a fresh `Game` reads the profile once at construction and, if a
retired character exists and the payoff hasn't already been shown in any previous run, pre-fills
`GameState.retiredCharacterClassId` and leaves `"the-one-who-stayed"` *out* of the freshly-built
`firedOnceEventIds` — otherwise the id is pre-inserted there, so it can never roll. No changes needed
to `rollEvent()` itself; eligibility is entirely encoded by whether that 1 id starts excluded.
`markRetiredCharacterEventShown()` fires from `Game.openChest()` the moment the event actually
resolves, persisting the "already shown" fact across every future run in the slot, not just this one.

`deleteSlot()` (`src/engine/save.ts`) removes only the run file, so the profile survives a run's
permadeath slot-clear and is never read as a save; only `clearSlot()`, used when New Game
overwrites a slot that still holds a run, removes it too.

### F.3 Ending 2 — Let Go

> "To let go, together, all at once — however far down that actually leads."

Resolution:

> "None of you feel yourselves stop. It comes gradually: the awareness that whatever is dreaming does not tell you apart from everything else it holds. The last clear thought any of you has, before the difference stops mattering, is of the sky above the entrance, the town you set out from, the years before any of this. None of it was ever outside. It was a farther room of the same dream, dreamed calmly enough that no one standing in it needed to notice."

**The plot twist, precisely**: the party's home world — everything before the descent — was never
outside Sleeper's dream either; the dungeon and the surface are the same dream at different
distances from whatever's actually happened. This is a **different axis of revelation** from the
true ending's (§F.5), not a duplicate — it's cosmic scope, not institutional history, and it
resolves nothing on §12.9's list (doesn't say whether Sleeper wakes, doesn't touch the Covenant,
doesn't touch any of the 3 recurring figures). What it deliberately leaves open: whether this means
nothing was ever "real," whether every person who never descended is dreamed the same way, whether
waking (for Sleeper, or for anyone) was ever a coherent idea to begin with. A distinct resolution
screen (`gameOver: "letGo"`), same as Ending 1 — not `defeat`.

### F.4 Ending — Leave (a dead end, and 1 way through it)

Reached only when 1 of §F.1's 2 Leave triggers fires — there was never a Stay or Let Go offered here,
only this:

> "There is no staying here and no going further. Only the way back up is offered."

What every such party finds, regardless of anything else about the run:

> "The corridor you climbed through isn't here anymore. Where it should be, there's only wall —
> smooth, seamless, older than anything else on this floor. However you got down here, that's not
> how you're getting back up."

> "There has to be another way. There's always been another way. You start looking — and that's
> when you hear how many of them have been standing behind you the whole time you were looking at
> the wall instead."

**Default outcome — bad ending, unknown fate**: unless the condition below is met, this is where it
ends.

> "Someone gets half a word out. Nobody gets a clean look at how many there are."

Deliberately not a confirmed death and not a confirmed survival — "unknown fate" is the actual
content of this ending, not a placeholder for one. Framed as a genuine bad ending (the only path this
floor offered a party with no standing exchange left to draw on — whether because it broke, or never
opened — turned out to be a trap, not a mercy), distinct from ordinary `defeat` (no HP hits 0 on
screen, no fight plays out — the game never shows what happens, on purpose).

**The way through — conditional, and rare**: if any character in the party has a specific artifact
(`waystone-shard`, below) currently equipped, the ambush above never lands. Instead:

> "A seam answers from further along the same dead-end wall, sealed shut, humming at a pitch none of you would have caught if you weren't already listening for anything. It isn't stone. It has been failing for longer than any of you have been alive."

> "The shard fits. The seam opens as if it remembered how. On the other side is air: ordinary, undeserved air."

**This is the actual good ending** — the only fully confirmed, unambiguous escape in the whole
system. Gated by inventory (a specific rare artifact), not by any drift/reflection state — a
genuinely different *kind* of gate from Continue's, on purpose. Deliberately **not** found the way
any other artifact is, though — see below.

**The artifact — `waystone-shard`** (Unique, `07-items-artifacts.md`'s Category D, "Older Than the
Mark" — this predates the Covenant too, a 3rd item for that category):

> "A shard of something that was never carved, only grown that way — smooth on every broken edge
> except where it snapped. This was already broken long before anyone started marking these walls
> with a spiral."

Confirms only that whatever this came from predates and is unrelated to the Covenant — never
confirms who or what actually built it, never confirms this exit exists reliably for any other
party, never confirms the dungeon "allows" this or simply failed to notice. All genuinely open.

**Drop source, restricted — deliberately excluded from the free-take pool**: unlike every other
artifact in the catalog, `waystone-shard` never appears via the standard `treasureOrEvent` roll used
by `open-chest` and the rest of Chain 4's 7 zero-cost events (§8.5) — it would undercut the whole
point of Chain 4 if the item that guarantees the good ending could turn up in the exact pool that
also feeds the *bad* one. It's also excluded from Elite kills, `merchant`, `cursed-shrine`,
`twin-altars`, and `sacrificial-circle`. It appears from exactly **2** sources instead:

- **A Boss kill** (`02-monster.md` §2, every `bossFloorInterval` floors) — part of the normal `boss`
  rarity roll (`artifactRarityWeights`, `07-items-artifacts.md` §7.2 — every rarity can come up,
  weighted by floor depth), so the shard is only possible when that roll lands on Unique, its own
  rarity. No special logic needed beyond the exclusion above.
- **`blood-altar`** (§8.15) — but only once `narrativeCounters.altarPaymentsCount >=
  events.bloodDebtThreshold2` (8 payments, the same counter Chain 3 already tracks). Below that
  count, a `blood-altar` payment rolls normally, `waystone-shard` excluded like everywhere
  else. This is deliberate: the escape key only becomes reachable once a party has already
  paid the stone enough times to be approaching the depth where Chain 3's own tier-2 escalation kicks
  in — "an event that requires paying a lot," not a lucky first visit.

**The intended irony, spelled out once**: the same behavior that can eventually *cause* Leave's bad
branch (paying the stone again and again, deep enough to reach tier 3, §F.1) is the same behavior
that opens the only door to Leave's good branch. Paying a lot doesn't guarantee finding the shard —
it's still a roll, same as any other artifact — but paying nothing at `blood-altar` guarantees never
finding it there at all. A party's own relationship with 1 specific exchange decides which version of
Leave it's even possible to reach, long before floor 100 ever arrives.

**A consequence worth stating explicitly**: trigger 2, "the ledger never opens" (§F.1), *requires*
`altarPaymentsCount === 0` — a party reaching Leave that way has, by definition, never once visited
`blood-altar` with a payment landing, so a Boss kill is its *only* possible source for the shard.
Trigger 1's party, by contrast, has had 8+ separate payment-roll chances at it by the time their debt
even can break. The 2 triggers aren't just narratively different roads to the same absence (above) —
they're also statistically very different odds of already holding the way out by the time they arrive.
Not a bug to fix: a party that gave nothing back anywhere earns a harder shot at the good branch than
a party whose one long exchange simply broke.

**Mechanism**: `ArtifactDefinition.restrictedDropSources?: ("boss" | "hpGamble")[]`
(`src/types.ts`) — when present, an id is filtered out of every roll except the ones named.
`rollArtifact()`/`pickArtifactOfRarity()` (`src/data/artifacts.ts`) take an opt-in
`allowRestrictedSource` param; `bloodAltarPay()` (the `hpGamble` kind) passes `"hpGamble"` once the threshold above is
met, `Game.resolve()`'s Boss-kill branch passes `"boss"` only when `monster.tier === "boss"`. Every
other caller (`openChest.ts` and the rest of Chain 4's events, `sacrifice.ts`, Elite kills, Collapsed
Floor's own `"boss"`-rarity-table roll) passes nothing and stays excluded automatically. The opt-in
is per call site, never inferred from the rarity table's name, because Collapsed Floor reuses the
`"boss"` table without being a Boss kill — a dedicated test checks it never rolls the shard.

Compliance: neither branch names "Sleeper," "Covenant," or "the Balance"; neither resolves anything
on §12.9's list. The bad branch doesn't contradict §12.9's "no evidence anyone comes back" item —
that item is specifically about *death*; this is a live party facing an ambush whose *outcome* is
what stays unconfirmed, a different thing entirely. Both branches are distinct resolution screens
(`gameOver: "leaveAmbushed"` / `"leaveEscaped"`),
neither the same as Stay/Let Go/Continue nor as each other — the good branch should read as
unambiguously survived, the bad branch as unresolved, never as a confirmed death.

### F.5 Ending 3 — Continue (the path to the true ending)

Available only under §F.1's condition.

> "To keep going, past the point where any of you can call this a choice."

Choosing it does not end the run — floor generation resumes normally from floor 101 onward, unchanged,
until floor 120.

**Floor 120 — the final encounter.** On arrival, before any combat:

> "A vast, wrong shape drifts in the dark ahead of you — more brain than body, ropes of nerve-thick
> tissue trailing beneath it where legs should be, reaching without ever quite touching the ground.
> It has no face left to speak from. Something in the room remembers how his voice sounded anyway."

Dialogue, before the fight — 6 short lines, kept short on purpose (a villain who explains himself at
length stops being frightening), **staged in 3 movements with a physical beat between each**:

> "You made it further than any of them."
> "I didn't come down here to build anything. I came down because everyone I was supposed to save
> was already gone, and I couldn't stop asking the ground to give them back."
> "It never gave anyone back. It just... kept listening. So I kept asking. Eventually I stopped
> noticing I was still asking."
>
> *He is closer than he was. None of you saw him cross the distance.*
>
> "The others who followed me down, over the years — I taught them how to ask properly. That's all
> any of it ever was."
> "I don't remember the last time I was only a person. I'm not sure there's a difference anymore,
> between what's still me and what's still just... dreaming."
>
> *Somewhere behind the walls, something takes a breath the room is too small to hold.*
>
> "You could have turned back, once. Now you can keep asking, the way I did, until there's nothing left to tell you apart from what you asked for."

**The 2 interleaved beats are load-bearing, not decoration**: without them this would be 6
uninterrupted lines delivered to a silent room with 1 static image — restrained in
*length*, but still the monologue shape, and nothing for the player's eye to move to for the whole
scene. Both beats also follow §12.11's own preferred register: a thing that has moved without
anyone seeing it move, and a sound the space shouldn't be able to make.

**This scene is the 1 deliberate exemption to §12.11's "one observable change per event" rule** —
stated here so a future writer inherits the exception knowingly rather than either copying it as
license or "fixing" the scene. It carries 5 reveals at once (he was a person; grief drove him; he
taught the others; he is fused with something; he offers a way out). That's exactly what §12.11
warns reads as exposition, and the warning is correct — it's accepted here because this is the
single scene in the game whose entire purpose is the account, at the deepest point a run can reach,
after 120 floors of the opposite discipline. The exemption is that narrow: 1 scene, 1 time, at the
floor where lore-authoring ends. Nowhere else.

**The rhyme, deliberate**: this is what Ending 1 (§F.2) looks like carried far enough, for far too
long. "Staying" is framed there as quiet and almost gentle; this is what it becomes given enough
time — a direct, load-bearing warning rather than 2 unrelated endings coexisting by coincidence.

**What this resolves vs. what it doesn't** (a partial resolution, by design):

| Resolved | Stays open |
|---|---|
| A specific human founded the Covenant, driven by grief over a loss he couldn't undo (§12.5's "the Call" finding purchase on a mind already cracked open) | Whether Sleeper as a *whole* ever wakes, or only ever continues dying — this is 1 person fused with a *fragment*, never proof of the entire entity's trajectory |
| The Covenant's rituals, taught and repeated across generations, had *some* real effect on which locations held their shape (§12.6) | Whether that effect is what the Covenant themselves believed it was, or something else their ritual only approximated |
| Something answers, or at least "keeps listening" — a fragment of awareness persists and can be locally reached | Whether the containment or communion reading was ever the correct one — the founder's own account is his, not confirmed as authoritative |
| The founder is real, was once an ordinary person, and is still (in some sense) there | What the Guardians are, whether the hooded figure is a continuous person, what happened to the Hermit's companion — all untouched |

The founder's own account is framed as **his own**, not an authorial confirmation — a party that
picks `wary` or `dismissive` reflection stances earlier in the run is fully entitled to read every
line above as a dying, corroded mind's self-serving myth rather than history. Nothing in the
delivery ever confirms which reading is correct. This is what keeps the design rule "don't rob
the player's own judgment" intact even while giving real, citable answers to some of it.

**The fight**: `the-founder` (`data/monsters.json`), a Boss-tier `MonsterArchetype` with
`roles: ["boss"]` and `finalBoss: true`, so it's excluded from every normal Elite/Boss-room roll
and only ever spawned by `Game.enterFounderFight()`. `finalBoss` is what carries that exclusion
(`GUARD_ROOM_ARCHETYPES` in `src/data/monsters.ts` filters it out explicitly). "Stronger than
any existing boss" comes entirely from floor depth (120, deeper than any other boss) via the same
depth-scaling every monster already uses — no bespoke stat multiplier needed. Its kit is its own
and, like every guard-room archetype's, data-declared (`06-level-system.md` §6.12): ropes that reach
several targets ("Paid In Full"), one that strikes everyone through defense ("The Same Price"), a
gaze that blinds and raises fear ("What's Left Listening"), a telegraphed heavy hit ("Everything You
Asked For"), and two phase skills. It carries no `elite` action weights and no elite sprite, because
it can never spawn at Elite tier.

**After victory**: the party can continue past floor 120 to "hunt down the cult's remnants" — pure
flavor over the infinite-descent loop, which continues as normal.

**Events that permanently disappear**, from this point in the run onward: every event tied to the
Covenant as an institution — `guardian-fight`, `desecrated-altar`, `merchant`, `blood-altar`,
`cursed-shrine`, `twin-altars`, `sacrificial-circle`, `wandering-hermit`, `broken-seal`,
`half-a-warning` — plus `still-breathing`, made narratively redundant once the bigger reveal above
has already landed. **Mechanism**: each of these events carries `removedOnFounderVictory: true` in
`data/events.json` (`FOUNDER_VICTORY_REMOVED_EVENT_IDS`, `src/data/endings.ts`); the founder's
defeat bulk-inserts all 11 ids into `GameState.firedOnceEventIds` in 1 pass, and `rollEvent()`
(`src/data/events.ts`) excludes a `removedOnFounderVictory` event whose id is in that array, the
same check it applies to spent `onceLifetime` events. Staying in the pool, unaffected: `open-chest`,
`collapsed-floor`, `old-count`, `doubled-back`, `the-delay`,
`waiting-supplies`, `vigil-candle` (mundane/pure-dream-logic, no institutional tie), `gambling-den`
(the Stranger, explicitly not Covenant, §12.8), `the-wanderer` (Part E), and Ending 1's
retired-character event (§F.2).

### F.5a The journal's Last page

Stay, Let Go and both Leave endings can show journal echoes (`data/journal.json` `echoes` with `on.kind: "ending"`): a detail
that agrees with a reading the party's journal holds, never a verdict. The ending text stays as it is; when it showed any echo, the
game-over screen offers `[Enter] Last page`, which lists each echo under the reading it agrees with. Defeat shows none. A journal
line on one of `12-world-bible.md` §12.9's questions gets an echo on every reading or on none, so whatever the Last page shows there
agrees with whichever reading was written.

### F.6 Normal endings — permadeath, with a little texture

Everything above is the rare branch. The overwhelming majority of runs end in ordinary permadeath —
`GameState.gameOver: "defeat"`, well before floor 100 — and that stays the default outcome. The
design adds only 1-2 short epilogue lines, varied by *how* the run ended, instead of a single flat
conclusion regardless of cause:

- **Died in combat** (HP reached 0 mid-fight): the standard conclusion — the game's actual default
  ending, which doesn't need new text to justify itself.
- **Died to exhaustion** (the Dying DOT, `03-survival-stats.md`, killed the party without a monster
  landing the last hit): 1 line acknowledging the difference — something failed to keep the party
  fed and rested long enough, not a fight lost. A 1-sentence addition, not a scene.

**Not yet built.** Which system dealt the finishing blow isn't cleanly known when `gameOver` is
set: `GameState.gameOver = "defeat"` is written from 2 places (`Game.resolve()`'s
`combat.outcome === "defeat"` branch, and `postMoveCheck()`'s every-character-dead safety net), and
`postMoveCheck()` runs at the end of every `resolve()` regardless of which branch fired — so "which
function set it" isn't a reliable signal. `applyDyingDamage` (`src/engine/survival.ts`) can also
fire *inside* a combat round (`combat.ts`), so a fight and the Dying DOT can both contribute to the
same kill. Telling them apart needs a small dedicated flag (e.g. tagging the round/action that
reduced the last living character to 0 HP). Low priority: this is texture on the most common
outcome, not a designed ending competing with §F.2-F.5 above.
