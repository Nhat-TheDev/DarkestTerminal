# §10. Event Narrative Layer — open questions

*(item 10 of `00-index.md`)*

**Status**: the narrative layer this file originally proposed (a shared worldview, recurring
characters, event chains, post-event reflection) has been built and is now documented as part of
`08-events.md` §8.13-§8.16, alongside the mechanics it layers on top of. This file no longer
describes a separate feature — it only keeps the design questions that came up while writing §10
and were deliberately left undecided, so they aren't lost once the rest of the proposal was merged
into the events doc. The hidden ground-truth worldview behind §8.13 (what the Sleeper/Covenant
actually are, never told to the player) is now written up separately in `11-world-bible.md`.

---

## Resolved — deeper chain escalation (§8.15)

Each of the 3 event chains (`08-events.md` §8.15) currently has exactly 1 escalation threshold —
once crossed, the escalated text is permanent for the rest of the run (Chain 2/3 never reset).
Since floor depth is unlimited (`06-level-system.md`), any sufficiently long run eventually hits
both. There was an intent to layer in further escalation tiers past the current single threshold
per chain, with no design yet for what those tiers would say or when they'd trigger.

**Lore direction resolved in `11-world-bible.md` §11.13** — a tier-2 escalation should read as a
further step toward the unawareness described there. Draft lines (not final, not yet checked
against `anti-cringe-slop`-style craft review):

- Chain 1, tier 2 (a 2nd+ forced encounter, after the counter has reset and climbed again): drop
  the personal framing entirely — "There's no story left in this anymore. It finds you; you
  fight. That's the whole of it now."
- Chain 2, tier 2: escalate from *the circle acting without asking* to *the party's own hand
  moving before deciding* — agency itself starts to blur, not just consent.
- Chain 3, tier 2: escalate from *the altar not needing to ask* to *the character no longer
  visibly reacting to the cost* — desensitization as the stage after automaticity.

Exact numeric thresholds are still an open balance decision, not a lore one — deferred to whoever
implements this. They should land noticeably further out than tier 1.

## Resolved — does a reflection stance ever pay off? (§8.16)

`GameState.eventReflectionStances` records the player's most recent `curious`/`wary`/`dismissive`
pick per event, but nothing currently reads it back. Whether a chosen stance should ever feed into
later content was explicitly undecided — the choice was saved so that door stayed open, not
because a concrete payoff was designed yet.

**Resolved in `11-world-bible.md` §11.13**: yes, as flavor only (never a mechanical effect —
§8.16's "purely characterization" rule is unchanged). Which direction each stance should nudge
future text is written up there. The trigger mechanics (reading an aggregate over
`eventReflectionStances`, when/where to apply it) are still unimplemented — deferred to whoever
builds this.

## Superseded — framing narrative

A 5th direction was floated alongside the 4 that shipped: an overarching reason the party
descends, revealed in stages by floor. Originally not selected — the "why is the party doing
this" question was left fully open on purpose, and the Sleeper/Covenant lore was written
ambiguous enough to support a framing narrative later without contradiction.

**This has since been reversed.** `11-world-bible.md` §11.5 now commits to a single hidden reason
("the Call") for why any given party descends. It's still never told to the player — nothing in
§8.13's player-facing ambiguity changes — but internally, the "left fully open" decision recorded
above no longer holds. See `11-world-bible.md` for the full worldview this note is now part of.

---

## Proposal — pacing narrative delivery across a randomized run

**The problem**: event rooms roll randomly (§8.1), split only by rarity tier. There's no way to
force sequencing. Two failure modes follow directly from that:

1. A party can get unlucky in the other direction too — go an entire run without a single chain
   escalation or a second meeting with a recurring NPC, and never brush up against any of §11's
   worldview at all. Right now, the only things gating "deeper" content are behavior counters
   (Chain thresholds) and same-run repetition (NPC return text) — both are a function of how long
   a given run happens to last, not of anything the game deliberately paces.
2. The reverse is also possible: a short, lucky run could roll a chain-escalated encounter on
   floor 3. Nothing currently prevents "deep" content from surfacing before a player has any
   context for it — which matters for the specific experience being asked for here: floor 1
   should read as a clean, classic roguelike, with anything stranger only surfacing as the run
   goes on.

**Recommendation: add floor depth as its own eligibility gate, independent of the common/rare
tiers.** `08-events.md` §8.1 already splits the roll into 2 tiers by weight; a depth gate is the
same kind of filter, just keyed on `Floor.depth` instead of rarity. This doesn't touch anything
about *how* an eligible event resolves — only *which* events (or which text variant of an
eligible event) can be rolled at all below a given floor. Concretely, this decouples "does the
mystery ever surface" from luck: below the gate, nothing past baseline flavor text can appear, no
matter how the dice land. Above it, deeper content becomes *possible* — still randomly rolled, but
now rolled from a pool that's earned by depth rather than found by chance. Exact floor numbers are
a balance decision, deferred — same status as every other numeric threshold in §8.15/§11.13.

This also gives Chain tier-2 (already drafted above) a natural home: gate its eligibility to the
same depth band rather than a pure behavior counter, so tier-2 content can't appear on an
improbably fast-accumulating early run either.

**Recommendation: a small number of new, rare, depth-gated events**, rather than retrofitting all
11 existing ones with depth variants. A handful of existing events already carry enormous
narrative weight for their size (`cursed-shrine` is 2 sentences); adding depth-variant text to all
11 multiplies the authoring surface for a mystery that works better sparse than dense. One or two
new events, gated to only roll past the depth threshold, give a concrete "this isn't just a
roguelike" beat without diluting the restraint the other 11 depend on. Following
`11-world-bible.md` §11.11's motif toolkit and one-observable-change rule:

**Concept — "the mark that shouldn't be there" (working title, not yet in `data/events.json`)**:
the party finds the spiral mark (§11.6) somewhere it has no business being — carved into something
from the inside, already burned into an artifact before anyone in the party has touched it,
scratched into the back of a party member's own gear. No combat, no explanation, 1 observable
wrong detail per §11.11. Grants an artifact through the standard decision flow like every other
event (§7.2), so it doesn't read as a "wasted" room mechanically — the reveal rides along the
existing reward loop instead of interrupting it. Rare tier, depth-gated. Worth considering a
"once per run" flag (not currently a field on `EventDefinition`) so the crack in the pattern stays
a crack — repeating it on the same run would cheapen exactly the effect it's built for.

Two further concepts in the same family, sketched but not drafted, both usable once the depth
gate exists:

- **A "recognition" beat**: an otherwise-anonymous encounter (a guardian, an altar) shows an
  unmistakable sign of remembering something specific to *this* party — breaking the pattern every
  other recurring text in the game has held to (the Merchant, the Hermit, the Stranger all repeat
  identically, never referencing anything but the fact of a return visit). The first time
  something *doesn't* repeat identically is precisely why it would land.
- **A faction-collision beat**: physical evidence of `11-world-bible.md` §11.6's containment vs.
  communion split turning into open conflict — a location marked in both directions, or mid
  interruption. A concrete payoff for the newly-added spiral-direction vocabulary, without ever
  naming "Covenant" or explaining what the conflict is about.

None of this is implemented — it's a direction to react to before any of it touches
`data/events.json` or the engine.
