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
- A passive is one of two kinds. It may change how one of the class's skills works (a new rider,
  target rule, cost or trigger on that skill, the ultimate and the class passive included, or on
  the class's summons), or it may stand on its own, tied to no skill (a condition met in combat).
  Either kind can sit on either side of a pair. The Mage's Conductor is the first kind (it changes
  Lightning Bolt); the Ninja's Red Harvest is the second.
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

- **Bulwark**: keeps allies standing. Interpose and Side by Side take and soften the blows meant
  for them.
- **Spearhead**: opens the enemy for allies. Heavy Charge and Engage set up hits that land harder.

| Level | Bulwark | Spearhead |
|---|---|---|
| 4 | **Shield Wall**: a hit the Knight takes in an ally's place, through Interpose or Watchful, deals less damage. | **Opening**: an enemy hit by Heavy Charge or Engage takes more from the next ally hit on it. |
| 9 | **Rearguard**: Watchful's intercept chance rises for an ally below half HP. | **Shoulder to Shoulder**: while Side by Side holds, that ally deals more damage. |
| 14 | **Closed Ranks**: while the Knight is above half HP, Rally also grants `fortify` to the party. | **War Cry**: Rally also raises the party's damage for the round, more for allies with low fear. |
| 20 | **Last Shield**: once per combat, a hit that would kill an ally the Knight is interposing for lands on the Knight instead. | **Held in Place**: an enemy taunted by the Knight takes more damage from every ally. |

Rank 4:

- Interpose (Bulwark): covers two allies at once.
- Side by Side (Bulwark): the ally also takes less damage while the shield is lent.
- Heavy Charge (Spearhead): leaves its target `exposed` (new): the next two ally hits on it deal
  more.
- Engage (Spearhead): the taunt lasts one more turn, and each counter leaves the attacker
  `exposed`.
- Rally (both): rallied allies ignore the next fear they would gain this round.

## Mage

- **Elementalist**: fire, lightning and ice played off each other. Each element sets up the next.
- **Black Arts**: spells that leave something behind. Arcane Shred and every bolt pile debuffs on
  the target.

| Level | Elementalist | Black Arts |
|---|---|---|
| 4 | **Kindling**: a fire hit on a burning target extends its `burning` by one turn. | **Deep Shred**: Arcane Shred's `shredded` lasts one more turn. |
| 9 | **Conductor**: Lightning Bolt arcs to a second enemy when its first target is `chilled`. | **Hollowing**: a spell that lands on a `shredded` target also applies `weakened`. |
| 14 | **Elemental Chain**: a hit of a different element than the one already on the target (fire on `chilled`, ice on stunned, lightning on `burning`) deals more. | **Dark Sigil**: the Mage's spell damage rises with each debuff on the target. |
| 20 | **Absolute Zero**: Frost Lance on a stunned, chilled target leaves it `frozen` (new): it loses its next turn and takes more from the next hit. | **Blight**: the Mage's area spells copy one debuff from the most-debuffed enemy onto every enemy they hit. |

Rank 4:

- Fireball (Elementalist): bursts on a burning target and sets one neighbour burning.
- Lightning Storm (Elementalist): an enemy already stunned takes more damage instead of rolling
  the stun again.
- Lightning Bolt (Black Arts): also applies `blinded`.
- Frost Lance (Black Arts): also applies `enfeebled`; a target both chilled and enfeebled moves
  later in the turn order.
- Fire Pillar (both): the floor stays alight for a round; enemies that act in it take fire damage.

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

- **Mercy**: support and healing. Heal, Mass Heal, Prayer and Sanctuary keep the party whole and
  steady.
- **Zeal**: the light turned outward. Purify and Sanctuary punish what hurts the party.

| Level | Mercy | Zeal |
|---|---|---|
| 4 | **Gentle Hands**: Heal heals more on an ally below half HP. | **Witness**: Smite deals more to an enemy that damaged an ally this round. |
| 9 | **Overflow**: healing past an ally's max HP becomes a short `mercy-ward` (new) that absorbs damage. | **Judgement**: Purify on an enemy also strips one helpful status from it. |
| 14 | **Calm Voice**: Prayer also lowers a second ally's fear by half as much. | **Kindled Faith**: each heal the Acolyte casts adds a stack; its next holy damage spends them for more. |
| 20 | **Blessed Ground**: allies inside Sanctuary take less damage. | **Wrath**: Purify's damage rises with each harmful status the Acolyte has removed this combat. |

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

- **Malady**: debuffs that take the enemy apart. `weakened`, `blinded`, `enfeebled` and
  `shredded`, applied hard and stacked.
- **Pestilence**: many fevers at once. Burning, poison, acid and bleeding on the same body.

| Level | Malady | Pestilence |
|---|---|---|
| 4 | **Thin Blood**: `weakened` the Doctor applies lowers damage further. | **Slow Burn**: burning and poison the Doctor applies last one turn longer. |
| 9 | **Selective**: Contagion draws only stat-reducing debuffs, and they last one more turn. | **Fresh Fever**: Contagion draws a damage-over-time effect the target does not already carry. |
| 14 | **Compounding**: each stat debuff already on a target makes the next one the Doctor applies stronger. | **Mixed Doses**: a target carrying two or more different damage-over-time effects takes more from each tick. |
| 20 | **Lingering Malady**: when a debuffed enemy dies, its stat debuffs pass to the nearest enemy. | **Fevered**: every third tick of the Doctor's damage over time on a target adds one it does not carry yet (`acid-burn`, `burning`, `poisoned` or `bleeding`). |

Rank 4:

- Blinding Vial (Malady): `blinded` lasts one more turn and its miss chance rises.
- Volatile Flask (Malady): its minimum hit count rises by one, and each hit extends one debuff on
  the target by a turn.
- Fire Vial (Pestilence): splashes `burning` onto one neighbour and adds `acid-burn` to the
  target.
- Spreading Toxic Fog (Pestilence): the fog lingers one more round and poisons again.
- Healing Draught (both): also removes one harmful status from the ally.

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

- **Shadow**: the enemy never sure what it is hitting. Smoke, clones and stealth throw its
  attacks off.
- **Reaper**: the kill. Throwing Knives for one target, Shuriken Storm for the group, Death Mark to
  finish.

| Level | Shadow | Reaper |
|---|---|---|
| 4 | **Misdirection**: an enemy that attacks a shadow clone is `confused` for a turn. | **Unseen Blade**: the first attack out of `stealthed` deals more damage. |
| 9 | **Hollow Body**: a shadow clone that is destroyed blinds whoever destroyed it. | **Open Veins**: Throwing Knives' extra-hit chance rises against a bleeding target. |
| 14 | **Substitute**: once per combat, while a clone stands, a hit aimed at the Ninja lands on the clone instead. | **Culling**: Shuriken Storm deals more to enemies below half HP. |
| 20 | **Haze**: an enemy that attacks an ally under `smoke-cover` may lose track and strike another enemy instead. | **Red Harvest**: when the Ninja kills, the damage past the target's HP passes to the nearest enemy. |

Rank 4:

- Smoke Bomb (Shadow): `smoke-cover` also lowers enemy accuracy against the covered allies.
- Shadow Strike (Shadow): two clones stand up instead of one.
- Throwing Knives (Reaper): each knife can strike a different enemy.
- Shuriken Storm (Reaper): one extra hit lands on the enemy with the lowest HP.
- Barbed Net (both): a `netted` enemy bleeds each time it acts.

## Summoner

- **Shepherd**: a versatile flock for the party. The spirit heals, the golem holds, the totem
  strengthens and steadies.
- **Feral**: the bound things let off the leash. Goblins, Command and the imp hit harder and keep
  hitting.

| Level | Shepherd | Feral |
|---|---|---|
| 4 | **Deep Roots**: the totem has more HP. | **Blooded Pack**: minions deal more damage to an enemy below half HP. |
| 9 | **Spirit Ward**: the spirit's heal also removes one harmful status, every other turn. | **Frenzy**: a minion that kills an enemy deals more with its next attack. |
| 14 | **Stone Watch**: while the golem stands, the ally with the lowest HP takes less damage. | **Bloodlust**: each enemy a minion kills raises every minion's attack for the rest of the combat. |
| 20 | **Unbroken Totem**: once per combat, a hit that would break the totem leaves it at 1 HP. | **Swarm**: minions deal more to an enemy another minion hit this round. |

Rank 4:

- Summon Spirit (Shepherd): the spirit heals two allies.
- Totem Recall (Shepherd): the totem also lowers the party's fear each round.
- Summon Goblin (Feral): two goblins answer instead of one.
- Command (Feral): costs less, and each commanded minion past the first acts with more power.
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
- **Inquisitor**: damage and control. Cross Slash and Defiance hold an enemy in place and punish
  it.

| Level | Martyr | Inquisitor |
|---|---|---|
| 4 | **Shared Wound**: Lay on Hands also heals the Paladin for part of the amount. | **Condemnation**: `condemned` enemies take more holy damage. |
| 9 | **Kneeling Guard**: while kneeling in Vigil, the Paladin takes less damage. | **Shackled**: Cross Slash on a challenged enemy applies `stagger`. |
| 14 | **Saved**: when Guardian Angel spares an ally, it also heals them. | **Penance**: an enemy that attacks someone else while challenged becomes `condemned` and may be `stunned`. |
| 20 | **Second Oath**: Martyr's Oath lasts one more turn if no ally fell during it. | **Verdict**: Defiance also `silences` the challenged enemy for a turn, so it can only strike with its basic attack. |

Rank 4:

- Lay on Hands (Martyr): the healed ally also takes less damage until its next turn.
- Guardian Angel (Martyr): covers two allies.
- Cross Slash (Inquisitor): a third cut follows.
- Defiance (Inquisitor): the challenge pulls up to two enemies.
- Vigil (both): its damage rises each turn the Paladin stays kneeling.

## Warlock

- **Rot**: curses stacked until they burst. Hex and Withering Curse feed Ripened Curse.
- **Blood Mage**: the Warlock's own blood spent for high damage and for the party. Blood Pact and
  Soul Rend.

| Level | Rot | Blood Mage |
|---|---|---|
| 4 | **Deep Hex**: `hexed` lasts one more turn. | **Blood Price**: when MP is short, the Warlock can pay a skill's cost in HP. |
| 9 | **Whisper**: Bind Tongue's `silenced` lasts one more turn on a target with three or more hex stacks. | **Transfusion**: Blood Pact also heals its target for part of the HP the Warlock spent this combat. |
| 14 | **Rotten Harvest**: a Ripened Curse burst also hits a second enemy for half. | **Life for Life**: below half HP, the Warlock's damage rises. |
| 20 | **Inexorable**: enemies cannot remove `hexed` from themselves. | **Covenant**: an ally carrying the pact deals more damage, and the Warlock heals a little each time that ally lands a hit. |

Rank 4:

- Hex (Rot): applies two stacks.
- Withering Curse (Rot): `enfeebled` always lands.
- Blood Pact (Blood Mage): binds two targets.
- Soul Rend (Blood Mage): costs HP instead of MP and deals more.
- Bind Tongue (both): a `silenced` enemy takes more curse damage.

---

## New mechanics

Each of these is a generic effect kind, condition or hook in data, usable by any class, monster,
item or artifact:

- Conditions on the target: carries a given status, has N or more stacks of it, carries N or more
  debuffs or damage-over-time effects, carries a status of a different element than the hit,
  below an HP share, aiming at someone other than the caster, attacked a given character this
  round.
- Conditions on the caster: carries a given status, took no damage last round, below an HP share,
  a given summon is up.
- Once-per-combat triggers: redirect a hit, hold a summon at 1 HP.
- On-kill triggers: refund the skill's MP, act first next round, buff the killer's next attack.
- On-death triggers: pass the target's stat debuffs, or the damage past its HP, to the nearest
  enemy.
- Copying a debuff from one enemy onto others.
- Limiting or steering a random status roll (Contagion) to a pool: stat debuffs only, or a
  damage-over-time effect the target lacks.
- A tick counter per target that adds a new effect every N ticks.
- Damage-over-time ticks that can crit with the applier's crit chance.
- Extending a status's duration, or refreshing it, when a given hit lands.
- Extra targets: forking, passing through, splash to a neighbour, a second summon.
- Lingering zones that act at the start of the next round.
- Turn-order pushes, later or first.
- Dice-roll floors raised by one step, and roll history read by later skills.
- Paying a skill's cost in HP, always or when MP is short.
- Overheal converted into an absorb status.

New status effects: `frozen`, `mercy-ward`, `seared`, `exposed`, plus the stacking statuses that
Kindled Faith, Pain Fed, House Edge and Bloodlust need.

## Review before data

- The 96 passive names and the 60 rank 4s go through a craft review (`narrative-craft-panel`)
  before any data is written, the same as the monster names in M1b.
- `random-play` and the class balance sims check that each direction, followed fully, lands
  within the same band as the other, and that no pair has an option picked far more often than
  the other once bots weigh them by outcome.
