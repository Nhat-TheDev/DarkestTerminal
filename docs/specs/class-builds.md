# Spec: Class builds — passive pairs and rank 4 (M1c)

Not yet implemented. This spec is transient: once M1c ships, fold the directions into
`docs/gameplay-decisions/01-class-skill.md`, then delete this file. It fills in §4.3–§4.5 of
[`strata-run-structure.md`](./strata-run-structure.md).

This spec gives each mechanic and its intent, never its numbers. Numbers are set in
`data/classes.json` during implementation and tuned with `random-play` and `game-editor`.

## Shared rules

- Every class has two build directions. Each of its four passive pairs (levels 4, 9, 14 and 20)
  sets one passive from each direction against the other, and each direction has two of the
  class's five rank 4s. The fifth rank 4 serves both. A character takes three rank 4s, so it can
  follow one direction fully or split.
- Within a pair, the two passives are worth about the same at that level. Later pairs define the
  direction more than earlier ones.
- A passive is conditional and specific to its class. It never grants a flat stat, lifesteal,
  damage reflection, dodge, a survive-at-1-HP save, speed, a generic crit bonus or MP regeneration:
  abilities already cover those (`11-abilities.md`), and a passive must not duplicate one.
- A passive may change a class's own skills, its class passive and its summons, including the
  ultimate.
- Rank 4 changes how the skill plays. A class's five rank 4s are close to equal in strength; a rank
  4 that adds little damage makes up for it in its effect. The ultimate has no rank 4.
- Turn-skipping effects below (`frozen`, a longer `silenced`, a forced basic attack) need a rule
  against Elites and Bosses, which today have no resistance to control. The rule (a shorter
  duration, a lower chance, or no effect at Boss tier) is set in data during implementation and
  applies to stuns as well.
- Directions are a design tool. They are not data and are never shown in game.

## Data shape

- `classes.json`: each class gains `passivePairs`, four entries of `{ level, options: [passive,
  passive] }`, where each passive has `id`, `name`, `description` and its effects. Each of the five
  non-ultimate skills gains a fourth entry in `ranks`.
- Every mechanic below is built from generic effect kinds and conditions in the resolver
  (`src/engine/resolver.ts`) and combat hooks, never from code that names a class or a passive.
  The new kinds are listed at the end of this file.
- New status effects named here are added to `status-effects.json`.

---

## Knight

- **Bulwark**: the hit meant for someone else. Interpose, Watchful and Rally carry the party
  through.
- **Reprisal**: every blow is answered. Engage and Heavy Charge turn the hits the Knight takes into
  damage.

| Level | Bulwark | Reprisal |
|---|---|---|
| 4 | **Shield Wall**: a hit the Knight takes in an ally's place, through Interpose or Watchful, deals less damage. | **Marked Foe**: the first enemy to hit the Knight each round is marked; the Knight's next damaging skill deals more to it. |
| 9 | **Rearguard**: Watchful's intercept chance rises for an ally below half HP. | **In Kind**: Engage's counter deals more against an attacker that hit an ally this round. |
| 14 | **Closed Ranks**: while the Knight is above half HP, Rally also grants `fortify` to the party. | **No Retreat**: while taunting, each hit the Knight takes this round raises its attack until the round ends. |
| 20 | **Last Shield**: once per combat, a hit that would kill an ally the Knight is interposing for lands on the Knight instead. | **Iron Answer**: Heavy Charge deals more for each hit the Knight took since its last turn. |

Rank 4:

- Interpose (Bulwark): covers two allies at once.
- Rally (Bulwark): rallied allies ignore the next fear they would gain this round.
- Engage (Reprisal): the taunt lasts one more turn, and each counter applies `enfeebled`.
- Heavy Charge (Reprisal): goes through its target and strikes a second enemy for less.
- Side by Side (both): the follow-up also triggers when the ally is hit, not only when it lands a
  blow.

## Mage

- **Pyre**: fire that spreads and keeps burning. Fireball and Fire Pillar across the whole line.
- **Stormglass**: lightning and ice that lock one target down and break it.

| Level | Pyre | Stormglass |
|---|---|---|
| 4 | **Kindling**: a fire hit on a burning target extends its `burning` by one turn. | **Static**: a lightning hit on a `chilled` target has a higher stun chance. |
| 9 | **Kindled Air**: fire damage against a burning target ignores part of its defense. | **Brittle**: ice damage against a stunned target ignores part of its defense. |
| 14 | **Fed Fire**: fire damage rises for each burning enemy in the room. | **Conductor**: Lightning Bolt arcs to a second enemy when its first target is chilled. |
| 20 | **Ash**: each `burning` tick also applies `shredded`, adding to Arcane Shred. | **Absolute Zero**: Frost Lance on a stunned, chilled target leaves it `frozen` (new): it loses its next turn and takes more from the next hit. |

Rank 4:

- Fireball (Pyre): bursts on a burning target and sets one neighbour burning.
- Fire Pillar (Pyre): the floor stays alight for a round; enemies that act in it take fire damage.
- Lightning Bolt (Stormglass): forks to a second enemy for less.
- Lightning Storm (Stormglass): an enemy already stunned takes more damage instead of rolling the
  stun again.
- Frost Lance (both): `chilled` also pushes the target later in the turn order.

## Rogue

- **Venom**: poison that builds and does the killing. Poison Coat and Poison Bomb.
- **Cutthroat**: one target, dropped before it acts. Knife Throw and Backstab.

| Level | Venom | Cutthroat |
|---|---|---|
| 4 | **Slow Acting**: poisons the Rogue applies last one turn longer. | **First Blood**: the Rogue's first damaging skill each combat deals more. |
| 9 | **Tainted Blood**: poisoned enemies deal less damage. | **Opportunist**: Backstab deals more against a target below half HP. |
| 14 | **Rot**: poison ticks the Rogue applied can crit, using the Rogue's own crit chance. | **Gone Again**: after a kill, the Rogue acts first next round. |
| 20 | **Bitter Sap**: Poison Bomb also spreads Venom Brand's `poison-vulnerable` from a branded target to every enemy it hits. | **Clean Kill**: a kill with Knife Throw or Backstab refunds that skill's MP. |

Rank 4:

- Poison Coat (Venom): each coated hit adds a second poison stack.
- Poison Bomb (Venom): the cloud lingers a round and poisons again.
- Knife Throw (Cutthroat): a second knife flies at another enemy.
- Backstab (Cutthroat): ignores part of defense when the target is not aiming at the Rogue.
- Venom Brand (both): the branded target also takes more from the next hit any ally lands.

## Acolyte

- **Mercy**: wounds closed faster than they open. Heal and Mass Heal.
- **Zeal**: the light turned outward. Purify and Sanctuary punish what hurts the party.

| Level | Mercy | Zeal |
|---|---|---|
| 4 | **Gentle Hands**: Heal heals more on an ally below half HP. | **Witness**: Smite deals more to an enemy that damaged an ally this round. |
| 9 | **Overflow**: healing past an ally's max HP becomes a short `mercy-ward` (new) that absorbs damage. | **Judgement**: Purify on an enemy also strips one helpful status from it. |
| 14 | **Calm Voice**: Prayer also lowers a second ally's fear by half as much. | **Kindled Faith**: each heal the Acolyte casts adds a stack; its next holy damage spends them for more. |
| 20 | **Unfailing**: Mass Heal heals more for each ally below half HP. | **Wrath**: Purify's damage rises with each harmful status the Acolyte has removed this combat. |

Rank 4:

- Heal (Mercy): a second ally is healed for half.
- Mass Heal (Mercy): the party heals again at the start of the next round, for less.
- Purify (Zeal): on an enemy, also applies `seared` (new): it takes more holy damage.
- Sanctuary (Zeal): an enemy that attacks an ally inside the circle takes holy damage.
- Prayer (both): the ally cannot gain fear for the rest of the round.

## Viking

- **Berserker**: power bought with its own blood. Frenzied Slash and Desperate Cleave below half
  HP.
- **Stormcaller**: the storm in the axe. Lightning Axe and Spinning Axe.

| Level | Berserker | Stormcaller |
|---|---|---|
| 4 | **Red Mist**: while `bloodrage` is active, the Viking's fear cannot rise past the second tier. | **Charged Edge**: while storm-empowered, the basic attack deals extra lightning damage. |
| 9 | **Pain Fed**: each hit taken during `bloodrage` raises the Viking's attack for the rest of the combat. | **Ground Strike**: while storm-empowered, Spinning Axe deals lightning damage and can stun. |
| 14 | **Blood Price**: during `bloodrage`, Frenzied Slash costs HP instead of MP. | **Thunderhead**: `storm-recoil` hurts less, and part of it strikes a random enemy. |
| 20 | **Trance**: during `bloodrage`, the fear damage penalty does not apply to the Viking. | **Eye of the Storm**: storm-empowered lasts one more turn, and the first lightning hit each turn refreshes it once. |

Rank 4:

- Frenzied Slash (Berserker): during `bloodrage`, `bleeding` lands two stacks.
- Desperate Cleave (Berserker): below a third of max HP, it cannot miss and ignores part of
  defense.
- Lightning Axe (Stormcaller): one ally's next attack also carries the storm.
- Spinning Axe (Stormcaller): while storm-empowered, it strikes every enemy twice.
- Throw Axe (both): the axe comes back and hits a second enemy on the return.

## Plague Doctor

- **Pestilence**: debuffs piled up until they pay out. Fire Vial and Toxic Fog feed Volatile
  Flask.
- **Physician**: the doctor half. Healing Draught and Blinding Vial keep the party standing.

| Level | Pestilence | Physician |
|---|---|---|
| 4 | **Festering**: `blinded` enemies take more damage from damage over time. | **Bedside Manner**: Healing Draught heals more on an ally carrying a harmful status. |
| 9 | **Catalyst**: Contagion's proc chance rises with each debuff already on the target. | **Antidote**: the first tick of `mending` also removes poison and bleeding. |
| 14 | **Mixed Doses**: a target both burning and poisoned takes more from each tick. | **Field Dressing**: when an ally drops below a third of max HP, the Doctor's next Healing Draught costs no MP. |
| 20 | **Plague Bearer**: when an enemy with three or more debuffs dies, its debuffs pass to the nearest enemy. | **Steady Hands**: Healing Draught also grants `mending` to a second ally. |

Rank 4:

- Fire Vial (Pestilence): splashes `burning` onto one neighbour.
- Spreading Toxic Fog (Pestilence): the fog lingers one more round.
- Healing Draught (Physician): each `mending` tick also lowers fear.
- Blinding Vial (Physician): `blinded` lasts one more turn and its miss chance rises.
- Volatile Flask (both): its minimum hit count rises by one.

## Archer

- **Deadeye**: the one shot that ends it. Aimed Shot and Piercing Arrow.
- **Warden**: the bow that covers the party. Overwatch and Volley Shot.

| Level | Deadeye | Warden |
|---|---|---|
| 4 | **Steady Aim**: if the Archer took no damage last round, its next shot has a higher crit chance. | **Tripwire**: Overwatch's reaction shot applies `stagger` when it hits. |
| 9 | **Rhythm**: each crit raises the next shot's crit chance; a shot that does not crit resets it. | **Covering Fire**: Overwatch also fires at an enemy that attacks the ally with the lowest HP. |
| 14 | **Weak Point**: crits against a `weakened` target ignore part of its defense. | **Pinned**: enemies hit by Volley Shot move later in the turn order next round. |
| 20 | **Final Draw**: a kill by a crit refunds the shot's MP. | **Long Watch**: Overwatch stays set for a second trigger in the same round. |

Rank 4:

- Aimed Shot (Deadeye): a crit also applies `weakened`.
- Piercing Arrow (Deadeye): passes through to the enemy behind.
- Overwatch (Warden): the reaction shot hits with Aimed Shot's damage.
- Volley Shot (Warden): each arrow has a small chance to `stagger`.
- Crippling Shot (both): `weakened` also pushes the target later in the turn order.

## Ninja

- **Shadow**: never where the blow lands. Smoke Bomb and Shadow Strike's clone.
- **Hundred Cuts**: bleed stacked until Death Mark. Throwing Knives and Shuriken Storm.

| Level | Shadow | Hundred Cuts |
|---|---|---|
| 4 | **Unseen**: the first attack out of `stealthed` deals more damage. | **Deep Cuts**: `bleeding` the Ninja applies lasts one turn longer. |
| 9 | **Hollow Body**: a shadow clone that is destroyed blinds whoever destroyed it. | **Hemorrhage**: bleed ticks on a `netted` target deal more. |
| 14 | **Substitute**: once per combat, while a clone stands, a hit aimed at the Ninja lands on the clone instead. | **Open Veins**: Throwing Knives' extra-hit chance rises against a bleeding target. |
| 20 | **Ghost Step**: entering `stealthed` also removes one harmful status from the Ninja. | **Exsanguinate**: a target at five or more bleed stacks takes more damage from every ally's hits. |

Rank 4:

- Smoke Bomb (Shadow): `smoke-cover` also lowers enemy accuracy against the covered allies.
- Shadow Strike (Shadow): the clone's hits apply `bleeding`.
- Throwing Knives (Hundred Cuts): a knife that hits a bleeding target adds an extra stack.
- Shuriken Storm (Hundred Cuts): one extra hit lands on the enemy with the most bleed stacks.
- Barbed Net (both): a `netted` enemy bleeds each time it acts.

## Summoner

- **Legion**: many hands. Goblins and Command, the swarm as the weapon.
- **Totemist**: few, sturdy, bound to the party. Spirit, Golem and Totem keep the line.

| Level | Legion | Totemist |
|---|---|---|
| 4 | **Crowded Pact**: the Summoner's magic power rises for each active minion. | **Deep Roots**: the totem has more HP. |
| 9 | **Frenzy**: a minion that kills an enemy deals more with its next attack. | **Spirit Ward**: the spirit's heal also removes one harmful status, every other turn. |
| 14 | **Expendable**: when a minion dies, the Summoner regains MP. | **Bound Stone**: while the golem stands, the Summoner takes less damage. |
| 20 | **Swarm**: minions deal more to an enemy another minion hit this round. | **Unbroken Totem**: once per combat, a hit that would break the totem leaves it at 1 HP. |

Rank 4:

- Summon Goblin (Legion): two goblins answer instead of one.
- Command (Legion): costs less, and each commanded minion past the first acts with more power.
- Summon Spirit (Totemist): the spirit heals two allies.
- Totem Recall (Totemist): the totem also lowers the party's fear each round.
- Summon Golem (both): the golem's slam applies `stagger`.

## Jester

- **High Roller**: the dice, and the nerve to keep throwing them. Loaded Dice and Double or
  Nothing.
- **Ringmaster**: the enemy at its own throat, the party in step. Jeer, Rigged Game and Battle
  Ballad.

| Level | High Roller | Ringmaster |
|---|---|---|
| 4 | **Weighted**: the lowest face of every roll the Jester makes is raised one step. | **Heckler**: Jeer's `provoked` chance rises against an enemy that attacked the Jester last round. |
| 9 | **Hot Streak**: a roll on one of the top two faces raises the floor of the next roll. | **Encore**: Battle Ballad lasts one more round if the party took no damage in the last. |
| 14 | **House Edge**: each failed call of Double or Nothing improves the odds of the next. | **Turncoat**: `confused` enemies deal more damage to their own side. |
| 20 | **All In**: Finale throws one extra die for each top-face roll this combat. | **Grand Confusion**: when Rigged Game confuses its target, a second enemy is confused too. |

Rank 4:

- Loaded Dice (High Roller): a top-face roll strikes again for half.
- Double or Nothing (High Roller): a won call refunds its MP; a lost one moves the Jester first
  next round.
- Jeer (Ringmaster): a `provoked` enemy can use only its basic attack.
- Battle Ballad (Ringmaster): also clears `stagger` and slows from the party.
- Rigged Game (both): a `confused` enemy takes more from the Jester's next hit.

## Paladin

- **Martyr**: takes the wounds and closes them. Lay on Hands and Guardian Angel.
- **Crusader**: the light as a blade. Cross Slash and Vigil burn what stands against it.

| Level | Martyr | Crusader |
|---|---|---|
| 4 | **Shared Wound**: Lay on Hands also heals the Paladin for part of the amount. | **Condemnation**: `condemned` enemies take more holy damage. |
| 9 | **Kneeling Guard**: while kneeling in Vigil, the Paladin takes less damage. | **Zealous Cut**: Cross Slash's second cut deals more against a challenged enemy. |
| 14 | **Saved**: when Guardian Angel spares an ally, it also heals them. | **Penance**: an enemy that attacks someone else while challenged becomes `condemned`. |
| 20 | **Second Oath**: Martyr's Oath lasts one more turn if no ally fell during it. | **Holy Fire**: Retribution's returned damage is holy and applies `condemned`. |

Rank 4:

- Lay on Hands (Martyr): the healed ally also takes less damage until its next turn.
- Guardian Angel (Martyr): covers two allies.
- Cross Slash (Crusader): a third cut follows.
- Vigil (Crusader): its damage rises each turn the Paladin stays kneeling.
- Defiance (both): the challenge pulls up to two enemies.

## Warlock

- **Rot**: curses stacked until they burst. Hex and Withering Curse feed Ripened Curse.
- **Blood Mage**: the Warlock's own blood as the price and the reward. Blood Pact and Soul Rend.

| Level | Rot | Blood Mage |
|---|---|---|
| 4 | **Deep Hex**: `hexed` lasts one more turn. | **Blood Price**: when MP is short, the Warlock can pay a skill's cost in HP. |
| 9 | **Whisper**: Bind Tongue's `silenced` lasts one more turn on a target with three or more hex stacks. | **Sanguine**: lifesteal from Soul Rend past the Warlock's max HP becomes MP. |
| 14 | **Rotten Harvest**: a Ripened Curse burst also hits a second enemy for half. | **Covenant**: while an ally carries the pact, the Warlock heals a little each time that ally deals damage. |
| 20 | **Inexorable**: enemies cannot remove `hexed` from themselves. | **Life for Life**: below half HP, the Warlock's curses deal more. |

Rank 4:

- Hex (Rot): applies two stacks.
- Withering Curse (Rot): `enfeebled` always lands.
- Blood Pact (Blood Mage): binds two targets.
- Soul Rend (Blood Mage): the party's share of the drain rises.
- Bind Tongue (both): a `silenced` enemy takes more curse damage.

---

## New mechanics

Each of these is a generic effect kind, condition or hook in data, usable by any class, monster,
item or artifact:

- Conditions on the target: carries a given status, has N or more stacks of it, below an HP
  share, aiming at someone other than the caster, attacked a given character this round.
- Conditions on the caster: carries a given status, took no damage last round, below an HP share,
  a given summon is up.
- Once-per-combat triggers: redirect a hit, hold a summon at 1 HP.
- On-kill triggers: refund the skill's MP, act first next round, buff the killer's next attack.
- On-death triggers: pass the target's debuffs to the nearest enemy.
- Damage-over-time ticks that can crit with the applier's crit chance.
- Extending a status's duration, or refreshing it, when a given hit lands.
- Extra targets: forking, passing through, splash to a neighbour, a second summon.
- Lingering zones that act at the start of the next round.
- Turn-order pushes, later or first.
- Dice-roll floors raised by one step, and roll history read by later skills.
- Paying a skill's cost in HP when MP is short.
- Overheal converted into an absorb status.

New status effects: `frozen`, `mercy-ward`, `seared`, plus the stacking statuses that Kindled
Faith, Pain Fed and House Edge need.

## Review before data

- The 96 passive names and the 60 rank 4s go through a craft review (`narrative-craft-panel`)
  before any data is written, the same as the monster names in M1b.
- `random-play` and the class balance sims check that each direction, followed fully, lands
  within the same band as the other, and that no pair has an option picked far more often than
  the other once bots weigh them by outcome.
