# §10. Event Narrative Layer — open questions

*(item 10 of `00-index.md`)*

**Status**: the narrative layer this file originally proposed (a shared worldview, recurring
characters, event chains, post-event reflection) has been built and is now documented as part of
`08-events.md` §8.13-§8.16, alongside the mechanics it layers on top of. This file no longer
describes a separate feature — it only keeps the design questions that came up while writing §10
and were deliberately left undecided, so they aren't lost once the rest of the proposal was merged
into the events doc.

---

## Open question — deeper chain escalation (§8.15)

Each of the 3 event chains (`08-events.md` §8.15) currently has exactly 1 escalation threshold —
once crossed, the escalated text is permanent for the rest of the run (Chain 2/3 never reset).
Since floor depth is unlimited (`06-level-system.md`), any sufficiently long run eventually hits
both. There's an intent to layer in further escalation tiers past the current single threshold per
chain (i.e. more than 1 step of "how deep is this"), but no design for what those further tiers
would say or when they'd trigger — deferred until that idea is fleshed out.

## Open question — does a reflection stance ever pay off? (§8.16)

`GameState.eventReflectionStances` records the player's most recent `curious`/`wary`/`dismissive`
pick per event, but nothing currently reads it back. Whether a chosen stance should ever feed into
later content (an escalated Chain description, a recurring NPC's return line, a deeper-floor
reveal) is explicitly undecided — the choice is saved so that door stays open, not because a
concrete payoff is designed yet.

## Considered and not chosen — framing narrative

A 5th direction was floated alongside the 4 that shipped: an overarching reason the party
descends, revealed in stages by floor. Not selected. Nothing in the shipped §8.13 worldview
assumes it — the Sleeper/Covenant lore was written intentionally ambiguous enough to still support
a framing narrative later without contradiction (the "why is the party doing this" question is
left fully open on purpose).
