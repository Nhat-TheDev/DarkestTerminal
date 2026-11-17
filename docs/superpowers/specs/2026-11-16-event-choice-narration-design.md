# Event Choice Narration — Design Specification

Status: proposed content and behavior, for review before implementation.
Date: 2026-11-16.
Implementation baseline: `feat/faith-temple-fixes` at `bb5046f3087ba693738c0316a87eb861a533e5b4`.
Scope: all 21 room events and all four temple religions. The scripted Gatekeeper and post-combat victory narration are optional extensions, not core acceptance requirements.

## 1. Purpose and boundaries

After a player commits an event or temple action, show what the party did and what happened in a dedicated, shared narration screen. The passage must belong to that scene and that particular choice or rolled outcome.

This is separate from Reflection. Narration is the storyteller's account of the action; Reflection is the player's subsequent interpretation of the experience. Narration must never select a stance, apply Reflection effects, or add another opinion choice.

Keep all gameplay costs, rewards, probabilities, eligibility, encounter frequency, and Reflection rules unchanged. Do not infer a reward was equipped, consumed, or kept merely because the event offered it.

All player-facing copy and repository documentation are English. The text in the tables below is proposed authored copy, not a claim that it exists in the current build. It is the implementation target once this spec is approved.

### Baseline behavior to preserve

Implementation must include the baseline branch's changes before adding narration. These are existing behavior, not work to implement again:

| Area | Implemented on the baseline | Remaining narration work |
| --- | --- | --- |
| Action confirmation | Event and temple commit keys use `ctx.confirm`: the same key twice executes; another key cancels without executing it | Emit narration only after successful execution; Continue acknowledges once without another confirmation |
| Choice information | Event and temple options already show Cost/Result through `optionDetailLines` | Show actual committed effects after the action; do not repeat odds or advertised gains as actual results |
| Temple donors | `templeDonors` toggles one or more living eligible members; `bloodGift` handles followers and other religions | Capture the committed donor set and each donor's actual HP loss |
| Temple safety | Give blood is locked at full Faith or without an eligible donor; all selected donors are checked before payment; payments preserve the configured HP floor, at least one HP | Preserve these checks; do not reintroduce automatic donors, Give everyone's blood, or fatal offerings |
| Main-panel overflow | Shift+Up/Down, mouse scrolling, and border overflow indicators already exist | Reuse them for narration, preserving the visible Continue footer |
| Random-play | `chooseTempleDonors` already drives the donor picker | Add narration acknowledgement and action/outcome evidence |

There is no pending narration field, shared narration screen, or narration save/load continuation in the inspected baseline. Temple success still logs its message and returns to the room; event routing still prioritizes pending artifact decisions ahead of the event exit.

Faith tuning and torch presentation on the baseline are dependencies to preserve, not additional scope. No balance values are copied into this specification or changed by this feature. Temple Reflection is not added.

## 2. Approach

Use one narration screen for event and temple actions. Existing panels, wrapping, scroll controls, save controls, and key-hint grammar remain in use. Do not create separate screen implementations for each event.

Alternatives considered:

| Approach | Consequence | Decision |
| --- | --- | --- |
| Put text in the log | Easy to miss; existing artifact/journal transitions can interrupt reading | Rejected |
| Add text only to the existing event exit screen | Misses repeated actions, combat entry, and temple actions | Rejected |
| Shared narration screen | Explicit reading step for every committed action, followed by its existing destination | Recommended proposal |

## 3. Screen contract

The main panel contains, in order:

1. The event name, or the temple religion's name.
2. One short passage, normally one or two sentences.
3. A separate `Result:` block when the action has resource, reward, or boon consequences. Derive its values from actual results; do not hardcode balance numbers in prose.

The footer is `[Enter] Continue`, composed through the existing key-hint system. Do not show Reflection answers on this screen. `Result:` is a gameplay summary, not a second storyteller paragraph.

Example target render for a failed rescue, with illustrative result values:

```text
Collapsed Floor

{{character}} reaches below the broken edge, but the stone shifts
under their weight. By the time the others pull them back, the
groaning has stopped.

Result: {{character}} HP −{{hpPaid}}; rescue failed.

[Enter] Continue
```

The template values above come from the committed action. A displayed character name, loss, or reward must never be invented by the UI.

### Input and visibility

- Only Enter dismisses the narration. Digits, Escape, and action hotkeys cannot execute another event action behind it.
- Existing scrolling and save/log menus remain available when permitted by the run state. Returning from a menu restores this same narration and read position.
- Start each new passage at scroll position zero, including consecutive passages of the same screen kind.
- Preserve the existing pre-action same-key confirmation. On the narration screen, one Enter acknowledges the passage immediately: do not call `ctx.confirm` again. Clear the armed/confirmed input state before routing onward, so the Enter that commits a temple donation cannot also dismiss its narration.
- No timed dismissal, mandatory typing effect, or additional confirmation beyond the baseline's pre-action confirmation.
- Keep the source event/temple visual while its narration is open, even if the action has already cleared the room. Combat entry narration shows the event context before the combat UI takes over.
- At 150×45, title, passage, result block, and Continue footer remain readable. Longer actual name lists may wrap and scroll; the footer remains visible. <!-- docs:intent -->

## 4. When narration happens

| Interaction | Narration? | Reason |
| --- | --- | --- |
| Complete a successful action or leave the event | Yes | This is a committed choice |
| Roll a loss or fail a rescue after paying its cost | Yes | Failure is a committed outcome |
| Open an offer's detail | No | Browsing only |
| Open the payer or artifact picker | No | The substantive action has not happened |
| Open the temple donor picker or toggle a donor | No | Donor selection is still a preview |
| Arm or cancel the existing confirmation | No | No action has executed |
| Change a page or cancel a picker/detail view | No | Navigation only |
| Choose an unaffordable/locked/invalid action | No | Preserve the existing error; no action occurred |
| Equip, replace, or discard a reward | No new event narration | Existing artifact decision feedback remains responsible |
| Choose a Reflection answer or leave Reflection silently | No new narration | Reflection remains a separate existing system |
| Move between ordinary rooms | No | Outside this feature |

Do not replay the prior choice's narration when navigating back to an event menu.

## 5. Order and continuation

Execute the action once, capture its actual outcome and narration context, and present the passage before the next interactive screen. Enter only acknowledges the passage: it cannot pay, roll, grant a reward, start a new round, or reapply an effect.

For every committing key covered by the baseline: choose → existing same-key confirmation → execute once → narration → one Enter → continuation. Preserve errors and validation at their existing stage; no rejected action produces narration. For temple donation specifically: Give blood → donor picker → select members → Enter to arm → Enter to commit → narration → Enter to Continue → room. Toggling donors or arming confirmation changes no HP/Faith. Cancelling an armed confirmation leaves the selection intact and consumes that cancel key; a subsequent Escape returns to the temple.

| Action type | Screen order |
| --- | --- |
| Event closes without a reward | Action → narration → existing journal/Reflection/room routing |
| Event grants an artifact | Action → narration → existing artifact decisions → existing journal/Reflection/room routing |
| Event remains open, such as merchant refresh | Action → narration → event choices |
| Repeatable sacrifice | Sacrifice → narration → artifact decisions → ritual choices |
| Gambling round won with more rounds available | Roll → round-win narration → stop/continue choices |
| Enter a guardian/altar fight | Prepare combat → entry narration → combat; no turn resolves during narration |
| Win a guardian/altar fight | Existing combat reveal/results → existing rewards and follow-up routing; no new victory narration in core scope |
| Lose or escape a fight | Existing combat outcome flow; do not invent an additional event victory/escape scene |
| Temple action | Existing confirmation → action → narration → room; Give blood affects only selected donors and cannot kill them |

Reflection may be suppressed by its existing outcome gate, repeat chance, or a journal scene. Narration is always shown for the committed action, independently of those rules. Do not force Reflection after every passage or after an intermediate action.

If a completed event has no Reflection, journal scene, or other remaining content, Continue returns to the room. Do not require an extra Enter on an exit screen containing only the event title. Existing ending/defeat bookkeeping must still run exactly once.

## 6. Event content: actions and outcomes

Keys in the first column identify narration cases. They describe semantics, not keyboard positions. Keyboard digits remain dynamic for paginated lists and conditional options. Every row is a distinct committed action/outcome unless explicitly marked as a replacement variant.

### 6.1 Open Chest (`open-chest`)

Current action: open the chest or collect the offered find. The room has three authored entrance variants, including one with no chest.

| Case / condition | Narration |
| --- | --- |
| `take.chest` — base cracked oak chest | The lid catches on its rusted bands. You work it open and lift the find clear of the stone dust. |
| `take.lockbox` — damp lockbox entrance variant | The swollen lid gives under your hands. You lift the find out, leaving the snapped key in its lock. |
| `take.gear` — neatly stacked gear entrance variant | You unbuckle the pack without disturbing the boots beside it. There is something inside that can still be used. |
| `take.habit` — escalated entrance text | The blunt pry bar slips once before the lid gives. You know where to put your hands now. |

Result: artifact offered. Continue: artifact decision, then existing exit routing. Do not describe taking the whole pack or equipping its contents.

### 6.2 Guardian Fight (`guardian-fight`)

| Case | Narration |
| --- | --- |
| `fight` — ordinary encounter | The party raises its weapons and steps beyond the torchlight. The scraping comes toward you. |
| `fight.forced1` — doorway blocked | There is no room to pass it. The party turns its weapons toward the doorway. |
| `fight.forced2` — scraping on the stairs | The party reaches the room with weapons already out. This time the scraping does not stop. |
| `fight.forced3` — deeply worn claw marks | The party steps across the worn tracks and closes ranks. The same stretch of stone lies between you again. |
| `leave` — ordinary or buildup encounter | You keep the torch between the party and the dark corner as you withdraw. The claws scrape once more behind you. |

Fight variants replace, rather than append to, the ordinary fight passage. Do not offer Leave in a forced encounter. Existing combat results and victory-gated Reflection remain unchanged; post-combat narration is an optional extension.

Result: entry has no additional resource consequence. Continue: combat on entry; preserve existing rewards and exit flow on victory.

### 6.3 Merchant Encounter (`merchant`)

| Case | Narration |
| --- | --- |
| `purchase` | You set the coins beside {{artifact}}. The hooded figure draws the payment off the cloth and slides the purchase toward you. |
| `refresh` | You lay down the fee. The figure gathers the wares into the cloth, then unfolds a different selection in the same place. |
| `leave` | The party steps away from the cloth without buying. The figure folds its hands over the goods. |

All entrance and return variants use these passages. Result: actual coins paid and artifact offered, or refresh fee paid. Refresh returns to the refreshed shop; Purchase closes the visit as it does today. Merely opening or closing an offer detail produces no narration.

### 6.4 Desecrate the Altar (`desecrated-altar`)

| Case | Narration |
| --- | --- |
| `fight` | You bring a weapon down on the carved edge. The red light breaks across the stone, and the party braces for what comes out of it. |
| `fight.forced1` | The red light covers the threshold. The party advances through it with weapons raised. |
| `fight.forced2` | You pass beneath the red-lit frame and strike at the altar. The others close in behind you. |
| `fight.forced3` | Your blade catches in an old score at the altar's base. You pull it free and strike across the spiral again. |
| `leave` | The party keeps clear of the altar and backs through the doorway. Its light still reaches the floor behind you. |

Use the same combat-entry and forced-choice rules as Guardian Fight, retaining the existing victory/reward flow. Do not claim the altar always goes dark: an existing Reflection variant describes it still glowing.

### 6.5 Blood Altar (`blood-altar`)

Opening the character picker is not a completed choice. After a valid payer is selected, use their actual name.

| Case | Narration |
| --- | --- |
| `pay` | {{character}} holds a cut hand over the cup. The blood reaches it, and the party lifts {{artifact}} from the pedestal. |
| `pay.tier1` | {{character}} holds out a hand while another readies the bandage. The payment falls into the cup before anyone speaks. |
| `pay.tier2` | {{character}} opens a hand over the cup, finding room between the old marks. The others wait with the bandage ready. |
| `pay.tier3` | {{character}} lowers a hand over the cup. The party makes space around the pedestal without being asked. |
| `leave` | The party keeps its hands away from the cup and passes the pedestal. The liquid stays short of the rim. |

Escalated payment rows replace the base payment passage; the result block identifies the offered artifact in every case. Determine the narration tier from the entrance context before this payment increments its counter, so crossing a threshold does not invent scars or prior preparation in the current scene. Do not add the counter again.

Result: actual payer HP lost and artifact offered. No payment or effect on Leave. Existing Reflection runs only when eligible under its current rules.

### 6.6 Cursed Shrine (`cursed-shrine`)

| Case | Narration |
| --- | --- |
| `accept` | You lift {{artifact}} from the shrine. Grey wax flakes from its resting place; the party's torch catches the open eye above it. |
| `decline` | The offering stays where it lies. You step around the candle stubs on the way back to the door. |

Do not reveal an unknown curse through narration. The result and artifact detail use the actual item's existing visibility rules. Do not say the artifact is equipped yet; a separate decision follows. Both cases keep existing Reflection eligibility.

### 6.7 Twin Altars (`twin-altars`)

| Case | Narration |
| --- | --- |
| `chooseFirst` | You lift {{artifact}} from the first pedestal. The second splits along its carving and falls across the narrow space between them. |
| `chooseSecond` | You lift {{artifact}} from the second pedestal. The first breaks inward, sending dust over the crack between your boots. |

The UI already promises that the unchosen altar shatters. These passages make that event visible; they do not grant both artifacts or change forced-equip behavior. Use First/Second rather than left/right, which the current menu does not establish spatially.

Result: chosen artifact offered, compulsory equip as already defined. Continue: existing forced artifact decision, then exit routing.

### 6.8 Ritual Circle (`sacrificial-circle`)

| Case | Narration |
| --- | --- |
| `sacrifice` | You lay {{oldArtifact}} at the open end of the spiral and withdraw your hand. When you reach down again, {{newArtifact}} lies in its place. |
| `sacrifice.tier1` | You set {{oldArtifact}} where the packs have been put down. {{newArtifact}} is waiting when you reach into the circle again. |
| `sacrifice.tier2` | You kneel in front of the open spiral and place {{oldArtifact}} on the stone. The space holds {{newArtifact}} when you lift your hand. |
| `sacrifice.tier3` | Your knees settle into the worn places. You leave {{oldArtifact}} at the opening and draw back {{newArtifact}}. |
| `leave.untouched` — no sacrifice this visit | The party gathers its packs without crossing the broom marks. Nothing has been laid inside the spiral. |
| `leave.afterOffering` — at least one sacrifice this visit | The party shoulders its packs and steps away from the open end of the spiral. The space before it is empty again. |

Each successful sacrifice produces its own narration, then reward decisions, then returns to the still-open ritual menu. Do not close the ritual after one offering. Leaving produces the appropriate separate passage. Tier selection uses the context before the action as with Blood Altar. Track sacrifices in this visit, not a previous visit's persistent outcome tag.

Result: actual old artifact removed; actual replacement offered. Reflection remains deferred until the visit closes.

### 6.9 Wandering Gambling Den (`gambling-den`)

| Case | Narration |
| --- | --- |
| `enter.win` — first round won, more remain | You set the stake on the crate. The stranger lifts the cup and pushes more coins beside yours, leaving the pot on the crate. |
| `enter.loss` — first round lost | You set the stake on the crate. The cup comes up, and the stranger draws the coins to his side. |
| `continue.win` — a later nonfinal round won | You leave the whole pot on the crate. The stranger lifts the cup and adds to the pile before setting it down again. |
| `continue.loss` | You push the whole pot forward. The stranger lifts the cup, then sweeps the pile off the crate. |
| `jackpot` — final round won, regardless of round-count configuration | The last cup comes up. Instead of counting out coins, the stranger sets two objects on the crate and draws the empty cups back toward himself. |
| `stop` — bank the existing pot | You draw the pot off the crate and close your purse. The stranger sets the cups in a row while you count. |
| `leave` — decline the initial stake | You leave your purse closed. The stranger slides the cups back into place on the bare crate. |

A win, loss, or jackpot is selected from the actual rolled branch. Do not roll a second time to choose copy. A final-round win uses Jackpot even if configuration makes the first round final. Banked coins go in the purse only in Stop; a nonfinal win increases the pot, not spendable coins.

Result: actual stake paid, current pot, actual banked coins, or two artifacts offered, as appropriate. A loss ends the visit; a nonfinal win returns to Stop/Continue. Jackpot retains the existing sequential decisions for both artifacts. No automatic next round.

### 6.10 Wandering Hermit (`wandering-hermit`)

| Case | Narration |
| --- | --- |
| `exchange` | You place {{oldArtifact}} and the coins on the cleared stone. The old man takes both and sets {{newArtifact}} within reach. |
| `leave` | The party leaves the cleared patch of stone empty. The old man draws his hands back toward the small fire. |

These passages work when his eyes were open, shut, or watching the party on entry. Do not automatically copy the existing Reflection's claim about closed eyes into the new narration. No new curse or rarity rules.

Result: actual fee, removed artifact, replacement offered. Exchange closes this event; it is not repeatable during the visit. Opening/cancelling the artifact picker does not produce a passage.

### 6.11 Collapsed Floor (`collapsed-floor`)

| Case | Narration |
| --- | --- |
| `rescue.success` | {{character}} reaches below the broken edge and catches the trapped figure. The others haul them both onto solid stone, and something is pressed into the rescuer's hand. |
| `rescue.failure` | {{character}} reaches below the broken edge, but the stone shifts under their weight. By the time the others pull them back, the groaning has stopped. |
| `leave` | The party picks its way around the broken floor. The weak voice below has no answer from above. |

The success passage never assumes who the rescued person is, whether they join the party, or what happens to them later. The failure passage does not kill the payer: the existing valid payment must leave them alive. Do not invent another rescue attempt, new NPC state, or Reflection; none exists for this event today.

Result: actual payer HP lost and artifact offered on success; actual HP lost with no reward on failure; no cost on Leave.

### 6.12 Old Count (`old-count`)

One committed choice: Move on, which currently also grants an artifact.

| Case | Narration |
| --- | --- |
| `moveOn` | You lift the usable find from beneath the wall and turn back toward the passage. The last tally stays unfinished. |
| `moveOn.habit` — escalated entrance | Your hands go to the find beneath the marks first. You leave the room without adding a stroke of your own. |

The find refers to the artifact already granted by the event, not an extra reward. Do not assume the party takes a tally, completes the marks, or learns who made them. Continue: artifact decision, then existing Reflection/journal routing.

### 6.13 Doubled Back (`doubled-back`)

| Case | Narration |
| --- | --- |
| `moveOn` | You gather the find from the dust and retrace your steps. Your own prints now run both ways beside the older trail. |
| `moveOn.habit` — escalated entrance | The party walks straight to the end of the prints, then carries the find back along its own tracks. |

The new prints belong to the party; do not resolve where the older person went. The usable find is the artifact already offered by current gameplay. Continue: artifact decision, then existing routing.

### 6.14 The Delay (`the-delay`)

| Case | Narration |
| --- | --- |
| `moveOn` | You turn the torch toward the passage. Its light crosses the pool and settles on the stone beside it. |

Do not perform one of the later Reflection actions here: no hand over the water, deliberate timing experiment, or decision to dismiss it. There is no artifact reward. Continue: existing Reflection/journal routing.

### 6.15 Waiting Supplies (`waiting-supplies`)

| Case | Narration |
| --- | --- |
| `moveOn` | You loosen the cord and divide the bundle. Half goes with the party; the rest is wrapped and tied again at the base of the wall. |

This is consistent with the existing Reflection prompt, which says the party took half and retied the rest. Do not eat the supplies, grant Satiety, take the whole bundle, or change the knot to express a stance. Those are later Reflection decisions where authored.

Result: the existing artifact offered and the actual Exploration Kits added, including any capacity-limited quantity. Narration does not promise a fixed kit count or a full pack. Preserve the existing Reflection text; accept its brief recap rather than silently editing it in this feature.

### 6.16 Vigil (`vigil-candle`)

| Case | Narration |
| --- | --- |
| `moveOn` | You lift the folded cloth from beside the candle. The pooled wax stays undisturbed. |

Do not extinguish or tend the flame, touch it, decide it is ordinary, or use the cloth as a bandage. Those claims would preempt a Reflection or item decision. Result: the existing cloth artifact offered. Continue: artifact decision, then existing routing.

### 6.17 Broken Seal (`broken-seal`)

| Case | Narration |
| --- | --- |
| `moveOn` | You take the loose plate from the torn lock and step clear of the hatch. The chain is still cold when you let it fall. |

Do not climb into the hatch, open it a second time, kick it, or explain what broke the seal. Result: existing lock-plate artifact offered. The same copy must work with mortar scattered inward or outward.

### 6.18 Half a Warning (`half-a-warning`)

| Case | Narration |
| --- | --- |
| `moveOn` | You take the small chalk stub from below the writing. Its dust marks your fingers beside the unfinished scratches. |

Do not finish the inscription or erase any word; that remains available to a later Reflection choice. Result: existing chalk artifact offered. Do not claim a fragment was learned unless the journal system actually grants it.

### 6.19 Still Breathing (`still-breathing`)

| Case | Narration |
| --- | --- |
| `moveOn` | The party turns toward the passage. The warm draft lifts the cloth caught in the wall. |

Do not cut the cloth free, scrub hands, hide marked goods, name the source of the draft, or declare the dungeon alive. Those would either preempt Reflection or turn an ambiguous observation into a new revelation. No artifact reward.

### 6.20 The Wanderer (`the-wanderer`)

| Case | Narration |
| --- | --- |
| `moveOn` | You turn the light toward the passage. The figure's hands catch its edge. |

Use for all existing entrance variants: seated by a wall, restringing a bow, on a step, or silently nodding after Camp Reflection. Do not assert a particular object, repeat dialogue not present on this visit, give a name, leave a candle, or make a vow not to look back. No artifact reward.

### 6.21 The One Who Stayed (`the-one-who-stayed`)

| Case | Narration |
| --- | --- |
| `moveOn` | The party moves past the small fire. The figure stays beside it, their worn gear catching the light until the passage turns. |

Do not identify the figure as a specific former party member, revive or recruit them, invent a reply, or promise that the party will return. The entrance already supplies the retired class's gear; repeating the class name is optional, not a new runtime dependency. No reward or Reflection is added.

### 6.22 Optional extension: The Gatekeeper (`the-gatekeeper`)

This scripted opening already has choice-specific prose and remains unchanged in core scope. If separately included, reuse its exact existing strings instead of writing a second version of his dialogue.

| Choice | Narration source | After Continue |
| --- | --- | --- |
| Leave coins | `ui.gatekeeperPaid`: warning and blessing gesture | Existing map offer, using `ui.gatekeeperMap` and Take the map |
| Keep coins | `ui.gatekeeperRefused`: brief laugh and stepping aside | Same map offer |
| Take the map | `ui.gatekeeperMapTaken`: putting the hide in the pack | Existing entrance path choice |

For this optional extension, move these passages into the shared presentation and do not repeat them on the subsequent Gatekeeper screen. Persist the map-taking phase, which the baseline holds only in UI state, and resume it without repeating the toll or map action. The map offer remains a real choice, not an implied action in the Paid/Refused narration. Entering the dungeon is ordinary movement and does not need another passage.

Result: actual toll and existing blessing on Paid; map acknowledgement on Take. Do not expand his warning or reveal what waits below. The event remains scripted and outside the random room pool. No Reflection is introduced.

## 7. Temple content

Each religion has three committed actions: Give blood, Ask a boon, and Leave. Give blood uses the existing donor picker; living followers and members of other religions may be selected together when `bloodGift` permits them. There is no separate outsider offering and no automatic contribution by every eligible member.

Narration has a religion-specific passage plus exact result lines for the selected donors. A passage must work for one donor or several, with any eligible religion mix. Eligibility and HP/Faith amounts remain owned by `bloodGift` and the balance data, not by narrative case selection.

### 7.1 Light and Glory (`light-and-glory`)

| Choice | Narration |
| --- | --- |
| `giveBlood` | Blood falls beneath the gold-leaf sun. Cloth is passed to those who gave, beside the cold brass lamps. |
| `boon` | The party gathers beneath the gold-leaf sun to ask a boon. The cold brass lamps catch the torchlight overhead. |
| `leave` | You pass the damp broom and leave the swept floor as you found it. The brass lamps remain cold. |

The boon passage suggests the setting, not HP recovery. Actual defense effects remain in the result/stat presentation.

### 7.2 Plague and Healing (`plague-and-healing`)

| Choice | Narration |
| --- | --- |
| `giveBlood` | Blood falls into the stone basin. Bandages from the stack beside it are passed to those who gave. |
| `boon` | You hold your hands over the warm basin and ask for relief. Camphor catches in your throats as the party gathers close. |
| `leave` | The party passes beneath the hanging herbs without touching the basin. The bandages stay stacked beside the warm water. |

Result: actual Faith spent and the active boon. Its HP/MP recovery occurs through the existing movement logic, not when Ask a boon is selected or Continue is pressed. Do not report immediate healing or claim every wound or status effect is cured.

### 7.3 Night and Silence (`night-and-silence`)

| Choice | Narration |
| --- | --- |
| `giveBlood` | Blood darkens the ash in the bowls. Cloth is torn beside the shelf, its sound muffled by the felt. |
| `boon` | The party stands before the shelf without speaking. When you turn toward the door, the torch burns low against the felt. |
| `leave` | You take the torch back through the doorway. The ash in the bowls has not been disturbed. |

Do not turn the boon into permanent invisibility, stealth, or a combat turn. Actual speed effects remain unchanged.

### 7.4 Fury and Blood (`fury-and-blood`)

| Choice | Narration |
| --- | --- |
| `giveBlood` | Blood runs along the trough toward the wet drain. Those who gave steady themselves on the iron rings. |
| `boon` | The party grips the worn iron rings and asks for strength. Rust comes away on your hands when you let go. |
| `leave` | The party passes the empty trough without taking hold of the rings. The drain is still wet. |

Do not imply a forced frenzy, granted weapon, Fear change, or extra sacrifice. Actual offense effects remain unchanged.

### 7.5 Donor selection, limits, and rejection

The donation narration is created only after `templeGiveBlood(donorIds)` succeeds. Reuse the baseline's preview and validation; do not infer the donor set from the party's religions after payment.

| Condition | Narration / result rule |
| --- | --- |
| One eligible donor commits | One passage; that donor's name and actual HP loss in Result |
| Several donors commit, including mixed religions | One passage for the donation; list every selected donor once and no unselected member |
| A selected follower qualifies for the lower payment band | Same passage; use their actual HP decrease and the actual total Faith gain |
| An eligible member is not selected | No HP loss and no claim they were too weak or refused |
| No donor is selected | Existing error; no confirmation, narration, payment, or room clear |
| A member is dead or ineligible | Existing refusal; no donation narration |
| Any donor in a committed selection is rejected | Preserve all-or-nothing payment validation: no donor pays, no narration, temple stays open |
| Faith is already full | Give blood remains locked; no narration or resource change |
| Nominal selected gains exceed the remaining Faith capacity | Keep every selected donor's full existing HP cost; show the capped actual Faith increase, not the sum of advertised gains |
| Boon lacks Faith or another action is rejected | Existing error; no narration or resource change |
| A pending confirmation is cancelled | No narration; retain donor selection until explicitly changed or backed out |

Do not add weak-member or death appendices. Unselected members may simply have been left out by the player. The baseline's payment floor keeps every accepted donor alive, so fatal temple narration, death bookkeeping changes, and dead-run save handling are not needed for this feature. Preserve existing game-over priority and save rules.

The upper/lower follower bands and other-religion costs do not need separate invented rituals. Reuse one `giveBlood` passage per religion and show the committed individual costs. The system formats any donor names using the actual selected set, without assuming plural donors.

### 7.6 Persistence boundary for the picker and confirmation

The baseline stores `selectedIds` in `UiState.templeDonors`, and armed confirmation is also UI-only. This feature does not add persistence for an uncommitted selection or confirmation. Loading such a save may return to the open temple without selected donors and without spending anything.

Once the action succeeds, save the committed donor/result data with pending narration. A reload must show that same passage, named donors, actual losses, and next step, without reopening a donor picker, requiring the action confirmation again, or charging another payment.

## 8. Content variants and continuity

### Rules for choosing text

1. Choose the committed action and actual outcome.
2. Apply an explicit source-scene replacement variant if this spec defines one.
3. Otherwise use that action's base passage, authored to fit every current scene variant.
4. Fill names and values captured during resolution. Do not re-read unrelated later state to decide what happened.

No extra RNG draw is permitted for narration. Pin any selected entrance variant and pre-action escalation tier before mutating counters or marking NPCs met. In particular, the narration may not switch to a return-visit passage midway through the first meeting.

Blood Altar and Ritual Circle tiers use the entrance/pre-action context. Guardian forced variants use the pinned room chain variant. Open Chest uses the actual description variant selected for that room. Unknown future scene variants cannot silently fall through to a specific, incompatible physical object; validation or authoring must supply compatible copy.

### What is deliberately left ambiguous

Do not explain the open/closed spirals, identify the Wanderer, establish a rescued stranger's fate, make the breathing walls a confirmed creature, or add a new relationship between religions. A sensory detail may carry the scene without proving the world's hidden rules.

Do not assume a torch, glove, special weapon, or NPC posture beyond what the selected entrance supports. This game's scenes already establish a party torch; no new equipment requirement is introduced.

### Existing Reflection remains separate

- Preserve existing prompts, answer text, effects, stances, conditions, and RNG behavior.
- A passage must not enact a later answer first: no kicking the hatch, tending the flame, erasing the warning, eating supplies, or leaving a candle before that choice.
- Before a remaining Reflection, end narration with the completed action or preparation to leave; do not relocate the party outside the room while the next prompt still takes place inside it.
- Leave branches need their own narration even when Reflection is not eligible.
- The two deliberate recaps in existing prompts (such as Waiting Supplies retelling the division) may remain. Do not move a prompt out of Reflection and thereby remove its context.
- Existing prompts that assume a purchase or closed eyes on an NPC variant are pre-existing editorial inconsistencies. Track separately; new narration must not rely on those assumptions or broaden them.

## 9. Result presentation

The result block is built from the action's actual resource and state changes, captured before any later artifact equip/discard can overwrite the normal message.

| Event/action | Result contents |
| --- | --- |
| Artifact find/accept/altar choice | Artifact offered, with its actual name; say “offered”, not “equipped” |
| Merchant purchase/refresh | Actual coins paid; purchase artifact or offers refreshed |
| Blood Altar / rescue attempt | Named payer's actual HP decrease; rolled success/failure and reward if any |
| Ritual / Hermit exchange | Removed artifact; replacement offered; actual fee when applicable |
| Gambling nonfinal win | Actual stake paid on entry if any; pot after the win, explicitly a pot |
| Gambling loss | Actual stake/pot lost, with no second subtraction; no reward |
| Gambling Stop | Actual coins banked |
| Gambling jackpot | Both actual artifacts offered, without also claiming the pot was banked |
| Waiting Supplies | Actual items added and offered artifact; respect inventory capacity |
| Temple blood | Selected contributors' actual HP decreases and actual total Faith increase after the cap; no death result |
| Temple boon | Actual Faith spent and current boon; no immediate HP/MP recovery claim |
| Gatekeeper Paid, optional extension only | Actual toll and existing blessing summary |
| No-effect Leave/Move on/Fight entry | Omit the result block unless gameplay actually changed a reportable resource |

Reuse the baseline's `ui.optionResult`, resource labels, and applicable formatting helpers, including `optionDetailLines`. Choice Cost/Result lines are prospective information, whereas this block reports actual committed effects; do not reuse projected odds, nominal Faith totals, or possible rewards as if they occurred. Do not represent an unclaimed reward as already equipped or double-log resource changes. Keep existing action logs; persisting full narration history is outside core scope.

## 10. Implementation-facing contract

This section specifies behavior and ownership; it is not authorization to change product code before approval.

- Author event passages alongside event content in `data/events.json`, addressed by semantic action/outcome case, with explicit source-scene overrides where needed.
- Author temple passages per religion in `data/religions.json`. Shared grammar/result labels live in `data/strings.json`.
- Leave Gatekeeper presentation and its current save restrictions unchanged in core scope.
- Content loaders validate required action coverage, nonempty text, placeholders, and override targets. Adding a new event of an existing kind must include the narration cases its legal actions can produce.
- Engine code selects action/outcome semantics and emits one pending narration record. Engine/UI code never compares a literal event or religion content ID.
- Proposed saved state: nullable `pendingChoiceNarration` containing source room identity, event/religion reference, semantic case, resolved title/text, and structured `result` data, including committed donors where applicable. Do not name a saved result field `snapshot`: the baseline's `saveBody` replaces every property of that name with `[]`. Reuse existing resumable state for downstream destinations; introduce an explicit continuation phase only where existing state is insufficient.
- A pending record survives quick save, save-menu round trips, quitting, and loading. Old supported saves lacking it load with no narration pending; do not backfill narration for actions already performed.
- Capture any per-visit offering/choice context required for correct branch text. Do not infer this visit's action from an outcome persisted across multiple visits.
- Continue consumes only the pending narration and routes onward. Game-level acknowledgement methods own state mutations; the UI never edits `GameState` directly.
- Shared narration takes presentation priority over combat entry, artifact decisions, and journal/Reflection follow-ups produced by the action. It must not mask an existing game-over/ending flow or the optional Gatekeeper phase. No fatal narration flow is added: accepted temple donations cannot kill on this baseline.
- Preserve `ctx.confirm`, its cancel semantics, existing choice Cost/Result previews, `bloodGift` eligibility, and `templeDonors`. A successful action opens narration only after its confirmation completes; Continue does not arm another confirmation or forward its Enter to the next screen.
- Uncommitted donor selection and armed confirmation remain UI-only. Capture donor names, actual HP before/after, and actual capped Faith delta on success; do not add preview-selection save migration or automatic donor selection.
- Rendering/resizing/reopening menus/loading do not advance turns, roll RNG, reapply costs, produce another reward, or arm a second Reflection.
- Keep `chooseTemple` and `chooseTempleDonors` as the existing selection policy; add a narration case that returns Continue explicitly. Distinguish evidence by semantic action/outcome and temple religion so passages are not collapsed into one screen kind. Random runs alone do not guarantee coverage of mixed donors, low-band payments, cap overflow, boon, or rejected actions; use directed scenarios/tests too.
- Update developer documentation and headless UI expectations for the new reading step. Do not alter README mechanics detail or rebalance data.

## 11. Acceptance criteria

### Catalog and editorial coverage

- All 21 room events are covered, including the 11 instant-reward scenes. Gatekeeper remains unchanged unless its optional extension is separately included.
- Every legal committed action and all applicable random outcomes select an authored passage; no “Left.” fallback and no universal room-exit sentence.
- All 12 religion/action combinations (Give blood, Ask a boon, Leave for each religion) have distinct temple copy; donation copy works with one or several selected donors. No Give everyone's blood, automatic weak-member appendix, or fatal-offering branch remains.
- Open Chest's three physical scene variants and its escalated entrance use compatible passages. Guardian/altar forced states and offering tiers use their specified replacements.
- Passages preserve existing lore ambiguity and do not enact Reflection choices.

### Behavior and persistence

- A declined action and an accepted action from the same event show different passages.
- Intermediate menus, item details, donor/payer/artifact pickers, donor toggles, pagination, rejected inputs, confirmation arming/cancellation, and Reflection answers show no new passage.
- Failed rescue, successful rescue, gambling loss, intermediate win, Stop, and jackpot use distinct actual-result branches.
- Successful repeat sacrifices each narrate once; leaving before any sacrifice and leaving after a sacrifice differ for this visit even on a return encounter.
- Narration is visible before reward choices and before the first combat input. Existing post-combat reveal, rewards, defeat, and Reflection flow remain unchanged; no victory narration is required.
- Existing journal priority and Reflection eligibility resume correctly after acknowledgement. No empty second exit screen is added.
- Save/load while narrating resumes the same passage and correct next screen, without another payment/roll/reward. A supported older save resumes normally with no pending passage.
- A single donor, several donors of mixed religions, and a lower-band follower all narrate only the actual committed contributors and their HP costs. Unselected members remain unchanged, and accepted donors stay alive.
- Faith already full, empty selection, and rejected donors produce no narration, payment, or temple clear. Cap overflow retains all selected costs while reporting only the actual Faith increase.
- Loading after commitment retains donor/result data and returns from Continue to the room without another payment. Loading before commitment does not spend resources or restore an armed confirmation; picker-selection persistence is not required.
- Boon narration reports Faith spent and the boon without healing immediately. Existing recovery still happens only through its current movement trigger.

### UI and verification

- At 150×45 and wider layouts, content wraps, scrolling works, each new passage starts at the top, and the Continue footer remains available. <!-- docs:intent -->
- Digit spam cannot accept a second action or select a Reflection answer behind narration. One Enter acknowledges one passage.
- Existing pre-action confirmation still requires the same key twice; another key cancels without performing that key's normal action. The committing key does not also dismiss narration, and Continue requires no confirmation.
- Log/save menu round trips return to the same narration without losing result data or duplicating log entries.
- Random-play continues through every new screen and retains branch-specific evidence; it cannot idle on the temple or a repeated narration.
- Existing donor policy, Cost/Result preview tests, confirmation tests, HP-floor tests, and panel scrolling tests remain in place. Extend their expected destination only where the new narration step requires it; do not rewrite baseline mechanics.
- Before implementation is declared complete: full `bun test`, `bun run typecheck`, `bun run docs:sync --check`, and targeted random-play evidence of event, temple, combat-entry, and reward continuation paths. These commands must run on an implementation containing the stated baseline.

### Optional extensions

Gatekeeper migration requires separate inclusion of section 6.22, a saved map-taking phase, and save/load coverage without repeating payment or taking the map twice.

Post-combat victory narration requires a separate continuation contract: finish the existing combat presentation, show a victory passage once, and retain the pending reward summary and decisions across save/load. The combat handler currently routes directly to `roomReward`, so a change to `syncUiToGameState` alone cannot provide that ordering. No such phase or victory passages are required in core scope.

## 12. Review status

The shared narration screen, exact passages, and actual-result block remain design proposals for review. The implementation baseline is `feat/faith-temple-fixes` at the commit stated above; its donor selection, confirmation, Cost/Result previews, HP floor, and scroll controls are existing behavior to preserve. Gatekeeper migration and post-combat victory narration are optional extensions. No game code, mechanics, or existing Reflection content is changed by this specification.
