import { describe, test, expect } from "bun:test";
import { Rng } from "../src/engine/rng";
import {
  getActorByRef,
  startCombat,
  queueAction,
  resolveRound,
  autoResolveTargets,
  livingMonsterRefs,
  livingCharacterRefs,
  livingSummonRefs,
  livingPlayerSideEnemyFacingRefs,
  isCombatOver,
} from "../src/engine/combat";
import type { CombatantRef, Summon } from "../src/types";
import { makeCtx, spawnInto, pickAnyAction } from "./helpers";
import { Game } from "../src/engine/game";
import { getRoom } from "../src/engine/dungeon";
import { spawnMonster } from "../src/data/monsters";

describe("combat round structure", () => {
  test("higher speed acts before lower speed in the resolution phase", () => {
    const { ctx } = makeCtx();

    const tanky = spawnInto(ctx, "skeleton-guard");
    const combat = startCombat("r1", [tanky.id], ctx, false);
    for (const ref of livingCharacterRefs(combat, ctx)) {
      const { skillId, targets } = pickAnyAction(ctx, combat, ref);
      const err = queueAction(combat, ref, skillId, targets, ctx);
      expect(err).toBeNull();
    }
    resolveRound(combat, ctx);
    const rogueLine = combat.log.findIndex((l) => l.text.includes("Rogue") && l.text.includes("uses"));
    const vanguardLine = combat.log.findIndex((l) => l.text.includes("Vanguard") && l.text.includes("uses"));
    expect(rogueLine).toBeGreaterThanOrEqual(0);
    expect(vanguardLine).toBeGreaterThanOrEqual(0);
    expect(rogueLine).toBeLessThan(vanguardLine);
  });

  test("isBuff skills get +20 speed for this round's turn order only", () => {
    const { ctx } = makeCtx();
    const tanky = spawnInto(ctx, "skeleton-guard");
    const combat = startCombat("r1", [tanky.id], ctx, false);
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    const self: CombatantRef = { kind: "character", id: vanguard.id };
    queueAction(combat, self, "vanguard-shield-guard", [self], ctx);
    for (const ref of livingCharacterRefs(combat, ctx)) {
      if (ref.id === vanguard.id) continue;
      const { skillId, targets } = pickAnyAction(ctx, combat, ref);
      queueAction(combat, ref, skillId, targets, ctx);
    }
    resolveRound(combat, ctx);
    const vanguardLine = combat.log.findIndex((l) => l.text.includes("Vanguard") && l.text.includes("uses"));
    const rogueLine = combat.log.findIndex((l) => l.text.includes("Rogue") && l.text.includes("uses"));
    expect(vanguardLine).toBeGreaterThanOrEqual(0);
    expect(rogueLine).toBeGreaterThanOrEqual(0);
    expect(vanguardLine).toBeLessThan(rogueLine);
    expect(vanguard.speed).toBe(8);
  });

  test("MP is deducted at resolution, not at queue time", () => {
    const { ctx } = makeCtx();
    const combat = startCombat("r1", [ctx.monsters[0]!.id], ctx, false);
    const mage = ctx.party.find((p) => p.classId === "mage")!;
    const mpBefore = mage.mp;
    const enemy = livingMonsterRefs(combat, ctx)[0]!;
    queueAction(combat, { kind: "character", id: mage.id }, "mage-fireball", [enemy], ctx);
    expect(mage.mp).toBe(mpBefore);
    resolveRound(combat, ctx);
    expect(mage.mp).toBe(mpBefore - 5);
  });

  test("cooldown decrements each round and re-allows the skill once it hits 0", () => {
    const { ctx } = makeCtx();
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    vanguard.mp = 999;
    const tanky = spawnInto(ctx, "skeleton-guard");
    const combat = startCombat("r1", [tanky.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: vanguard.id };

    queueAction(combat, self, "vanguard-shield-guard", [self], ctx);
    resolveRound(combat, ctx);
    expect(vanguard.cooldownsRemaining["vanguard-shield-guard"]).toBe(1);
    expect(queueAction(combat, self, "vanguard-shield-guard", [self], ctx)).not.toBeNull();

    resolveRound(combat, ctx);
    expect(vanguard.cooldownsRemaining["vanguard-shield-guard"]).toBe(0);
    expect(queueAction(combat, self, "vanguard-shield-guard", [self], ctx)).toBeNull();
  });

  test("dead singleEnemy target redirects to another living enemy instead of fizzling", () => {
    const { ctx } = makeCtx();
    const rats = [spawnInto(ctx, "dungeon-rat"), spawnInto(ctx, "dungeon-rat")];
    const combat = startCombat("r1", rats.map((m) => m.id), ctx, false);
    const rogue = ctx.party.find((p) => p.classId === "rogue")!;
    const [enemyA, enemyB] = livingMonsterRefs(combat, ctx);

    const targetA = getActorByRef(enemyA!, ctx);
    targetA.hp = 0;
    queueAction(combat, { kind: "character", id: rogue.id }, "rogue-stab", [enemyA!], ctx);
    for (const ref of livingCharacterRefs(combat, ctx)) {
      if (ref.id === rogue.id) continue;
      const { skillId, targets } = pickAnyAction(ctx, combat, ref);
      queueAction(combat, ref, skillId, targets, ctx);
    }
    resolveRound(combat, ctx);
    expect(combat.log.some((l) => l.text.includes("the target is gone"))).toBe(false);
    const enemyBActor = getActorByRef(enemyB!, ctx);
    expect(enemyBActor.hp).toBeLessThan(enemyBActor.maxHp);
  });

  test("combat resolves to victory once the last monster dies, even across multiple rounds", () => {
    const { ctx } = makeCtx();
    const oneRat = spawnInto(ctx, "dungeon-rat");
    const combat = startCombat("r1", [oneRat.id], ctx, false);

    for (let round = 0; round < 10 && !isCombatOver(combat, ctx); round++) {
      for (const ref of livingCharacterRefs(combat, ctx)) {
        const { skillId, targets } = pickAnyAction(ctx, combat, ref);
        queueAction(combat, ref, skillId, targets, ctx);
      }
      resolveRound(combat, ctx);
    }
    expect(isCombatOver(combat, ctx)).toBe(true);
    expect(combat.outcome).toBe("victory");
  });
});


describe("aggro-weighted targeting", () => {
  test("weightedPick favors higher-weight items over many draws", () => {
    const rng = new Rng(42);
    const items = [
      { name: "low", weight: 1 },
      { name: "high", weight: 99 },
    ];
    let highCount = 0;
    for (let i = 0; i < 1000; i++) {
      const picked = rng.weightedPick(items, (x) => x.weight);
      if (picked.name === "high") highCount++;
    }
    expect(highCount).toBeGreaterThan(900);
  });
});

describe("Archer Overwatch (interrupt)", () => {
  test("casting Overwatch this round interrupts the next monster's turn in the same round", () => {
    const { ctx } = makeCtx();
    const archer = ctx.party.find((p) => p.classId === "archer")!;
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.attack = 0;
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: archer.id };
    queueAction(combat, self, "archer-overwatch", [self], ctx);
    const hpBefore = rat.hp;

    resolveRound(combat, ctx);

    // Archer's own fear is 0 at combat start, so rollHits always succeeds — the shot lands.
    expect(rat.hp).toBeLessThan(hpBefore);
    expect(archer.activeStatusEffects.some((s) => s.statusEffectId === "overwatched")).toBe(false);
    expect(combat.log.some((l) => l.text.includes("Overwatch"))).toBe(true);
    // runMonsterTurn never ran for the rat this round, so it never logged its own basic attack.
    expect(combat.log.some((l) => l.text.startsWith(`${rat.name} attacks`))).toBe(false);
  });
});

describe("Ninja Shadow Clone (summon combatant)", () => {
  test("Shadow Clone spawns as a real, targetable combatant with aggro, and expires after 2 of its own actions", () => {
    const { ctx } = makeCtx();
    const ninja = ctx.party.find((p) => p.classId === "ninja")!;
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.attack = 0;
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: ninja.id };
    queueAction(combat, self, "ninja-shadow-clone", [self], ctx);
    resolveRound(combat, ctx);

    const summonRefs = livingSummonRefs(combat, ctx);
    expect(summonRefs).toHaveLength(1);
    const clone = getActorByRef(summonRefs[0]!, ctx) as Summon;
    expect(clone.ownerId).toBe(ninja.id);
    expect(clone.aggro).toBeGreaterThan(ninja.aggro);
    expect(clone.actionsTaken).toBe(0);

    // Round 2: the clone takes its 1st action (it was spawned mid-round-1, so it starts acting from round 2).
    resolveRound(combat, ctx);
    expect(clone.actionsTaken).toBe(1);
    expect(livingSummonRefs(combat, ctx)).toHaveLength(1);

    // Round 3: the clone takes its 2nd action and expires.
    resolveRound(combat, ctx);
    expect(clone.actionsTaken).toBe(2);
    expect(livingSummonRefs(combat, ctx)).toHaveLength(0);
  });

  test("Shadow Clone's maxHp is flat (doesn't scale with the Ninja's own maxHp), and its aggro is a flat 20", () => {
    const { ctx } = makeCtx();
    const ninja = ctx.party.find((p) => p.classId === "ninja")!;
    ninja.maxHp = 999; // if maxHp scaling ever crept back in, the clone's maxHp would move with this
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.attack = 0;
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: ninja.id };
    queueAction(combat, self, "ninja-shadow-clone", [self], ctx);
    resolveRound(combat, ctx);

    const clone = getActorByRef(livingSummonRefs(combat, ctx)[0]!, ctx) as Summon;
    expect(clone.maxHp).toBe(20);
    expect(clone.aggro).toBe(20);
  });

  test("Shadow Clone detonates for AoE damage against every enemy when it expires", () => {
    const { ctx } = makeCtx();
    const ninja = ctx.party.find((p) => p.classId === "ninja")!;
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.attack = 0;
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: ninja.id };
    queueAction(combat, self, "ninja-shadow-clone", [self], ctx);
    resolveRound(combat, ctx);
    resolveRound(combat, ctx); // clone's 1st action
    const hpBeforeExpiry = rat.hp;

    resolveRound(combat, ctx); // clone's 2nd action — expires and detonates
    expect(livingSummonRefs(combat, ctx)).toHaveLength(0);
    expect(rat.hp).toBeLessThan(hpBeforeExpiry);
    expect(combat.log.some((l) => l.text.includes("detonates"))).toBe(true);
  });

  test("Shadow Clone detonates when it dies mid-combat, not just when it runs out of actions", () => {
    const { ctx } = makeCtx();
    const ninja = ctx.party.find((p) => p.classId === "ninja")!;
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.attack = 0;
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: ninja.id };
    queueAction(combat, self, "ninja-shadow-clone", [self], ctx);
    resolveRound(combat, ctx);

    const clone = getActorByRef(livingSummonRefs(combat, ctx)[0]!, ctx) as Summon;
    clone.hp = 0; // simulates being killed by enemy damage before it ever gets to act on its own
    const hpBeforeDeath = rat.hp;

    resolveRound(combat, ctx);
    expect(clone.actionsTaken).toBe(0);
    expect(livingSummonRefs(combat, ctx)).toHaveLength(0);
    expect(rat.hp).toBeLessThan(hpBeforeDeath);
    expect(combat.log.some((l) => l.text.includes("detonates"))).toBe(true);
  });

  test("recasting Shadow Clone (dismissing the old one) does not trigger the detonation burst", () => {
    const { ctx } = makeCtx();
    const ninja = ctx.party.find((p) => p.classId === "ninja")!;
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.attack = 0;
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: ninja.id };
    queueAction(combat, self, "ninja-shadow-clone", [self], ctx);
    resolveRound(combat, ctx);
    ninja.mp = ninja.maxMp;
    ninja.cooldownsRemaining["ninja-shadow-clone"] = 0;

    queueAction(combat, self, "ninja-shadow-clone", [self], ctx);
    resolveRound(combat, ctx);

    expect(combat.log.some((l) => l.text.includes("detonates"))).toBe(false);
    expect(combat.log.some((l) => l.text.includes("dismissed"))).toBe(true);
  });

  test("a Shadow Clone still alive when the room's combat ends is dismissed instead of lingering in ctx.summons", () => {
    const game = new Game(1);
    const ninja = game.state.party.find((p) => p.classId === "ninja")!;
    ninja.mp = ninja.maxMp;
    ninja.cooldownsRemaining["ninja-shadow-clone"] = 0;
    const rat = spawnMonster("dungeon-rat", 1);
    rat.hp = 1;
    rat.attack = 0;
    game.ctx.monsters.push(rat);
    const room = getRoom(game.state.floor, game.state.currentRoomId);
    room.monsterIds = [rat.id];
    room.cleared = false;
    game.state.combat = startCombat(room.id, [rat.id], game.ctx, false);

    const ninjaRef: CombatantRef = { kind: "character", id: ninja.id };
    expect(game.queue(ninjaRef, "ninja-shadow-clone", [ninjaRef])).toBeNull();
    for (const ref of game.livingCharactersNeedingAction()) {
      if (ref.id === ninja.id) continue;
      const { skillId, targets } = pickAnyAction(game.ctx, game.state.combat!, ref);
      game.queue(ref, skillId, targets);
    }
    game.resolve();

    // The rat dies this same round (1 hp), before the freshly-spawned clone ever gets a turn of its
    // own — so it's still hp > 0 and actionsTaken 0 when combat.phase flips to "over".
    expect(game.state.combat?.phase).toBe("over");
    expect(game.state.combat?.outcome).toBe("victory");
    const clone = game.ctx.summons.find((s) => s.ownerId === ninja.id)!;
    expect(clone).toBeDefined();
    expect(clone.hp).toBeGreaterThan(0);

    game.clearFinishedCombat();
    expect(clone.hp).toBe(0);
  });

  test("a Shadow Clone still alive when the party is wiped is dismissed too, same as on victory", () => {
    const game = new Game(2);
    const ninja = game.state.party.find((p) => p.classId === "ninja")!;
    ninja.mp = ninja.maxMp;
    ninja.cooldownsRemaining["ninja-shadow-clone"] = 0;
    const rat = spawnMonster("dungeon-rat", 1);
    rat.hp = 99999;
    rat.attack = 0; // never actually deals the killing blow — the wipe below is simulated directly
    game.ctx.monsters.push(rat);
    const room = getRoom(game.state.floor, game.state.currentRoomId);
    room.monsterIds = [rat.id];
    room.cleared = false;
    game.state.combat = startCombat(room.id, [rat.id], game.ctx, false);

    const ninjaRef: CombatantRef = { kind: "character", id: ninja.id };
    expect(game.queue(ninjaRef, "ninja-shadow-clone", [ninjaRef])).toBeNull();
    for (const ref of game.livingCharactersNeedingAction()) {
      if (ref.id === ninja.id) continue;
      const { skillId, targets } = pickAnyAction(game.ctx, game.state.combat!, ref);
      game.queue(ref, skillId, targets);
    }
    game.resolve();
    expect(game.state.combat?.phase).not.toBe("over"); // the rat survives, combat is still ongoing

    const clone = game.ctx.summons.find((s) => s.ownerId === ninja.id)!;
    expect(clone).toBeDefined();
    expect(clone.hp).toBeGreaterThan(0);

    // Same helper `postMoveCheck`/`resolve()`'s defeat branch call internally on a real party wipe
    // (test/ability-effects.test.ts's `wipeParty` uses the same pattern).
    for (const c of game.state.party) {
      c.hp = 0;
      c.isAlive = false;
    }
    (game as unknown as { triggerDefeat: () => void }).triggerDefeat();

    expect(game.state.gameOver).toBe("defeat");
    expect(game.state.combat).toBeNull();
    expect(clone.hp).toBe(0);
  });
});

describe("Ninja Smoke Bomb (stealth / untargetable)", () => {
  test("a stealthed character is excluded from monster-facing target pools but still selectable by allies", () => {
    const { ctx } = makeCtx();
    const ninja = ctx.party.find((p) => p.classId === "ninja")!;
    const rat = spawnInto(ctx, "dungeon-rat");
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: ninja.id };
    queueAction(combat, self, "ninja-smoke-bomb", [self], ctx);
    resolveRound(combat, ctx);

    expect(ninja.activeStatusEffects.some((s) => s.statusEffectId === "stealthed")).toBe(true);
    const enemyFacingRefs = livingPlayerSideEnemyFacingRefs(combat, ctx);
    expect(enemyFacingRefs.some((r) => r.kind === "character" && r.id === ninja.id)).toBe(false);
    const allyRefs = livingCharacterRefs(combat, ctx);
    expect(allyRefs.some((r) => r.id === ninja.id)).toBe(true);
  });
});

describe("Summoner minion cap and Mastery (summon combatant)", () => {
  test("casting a different-type summon while at the default 1-minion cap replaces the active one", () => {
    const { ctx } = makeCtx();
    const summoner = ctx.party.find((p) => p.classId === "summoner")!;
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.attack = 0;
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: summoner.id };

    queueAction(combat, self, "summoner-summon-goblin", [self], ctx);
    resolveRound(combat, ctx);
    expect(ctx.summons.filter((s) => s.hp > 0)).toHaveLength(1);
    expect(ctx.summons.find((s) => s.hp > 0)!.archetypeId).toBe("goblin-thrower");

    queueAction(combat, self, "summoner-summon-spirit", [self], ctx);
    resolveRound(combat, ctx);
    const active = ctx.summons.filter((s) => s.hp > 0);
    expect(active).toHaveLength(1);
    expect(active[0]!.archetypeId).toBe("healer-spirit");
  });

  test("recasting the same summon skill replaces only that minion, not a duplicate, and the surviving combatant ref resolves to the live one", () => {
    const { ctx } = makeCtx();
    const summoner = ctx.party.find((p) => p.classId === "summoner")!;
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.attack = 0;
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: summoner.id };

    const err1 = queueAction(combat, self, "summoner-summon-goblin", [self], ctx);
    expect(err1).toBeNull();
    resolveRound(combat, ctx);

    // Summon Goblin has a cooldown, so clear it to actually exercise a 2nd cast this test — a
    // queueAction call that silently no-ops on cooldown would make this test pass for the wrong reason.
    summoner.cooldownsRemaining["summoner-summon-goblin"] = 0;
    summoner.mp = summoner.maxMp;
    const err2 = queueAction(combat, self, "summoner-summon-goblin", [self], ctx);
    expect(err2).toBeNull();
    resolveRound(combat, ctx);

    expect(ctx.summons.filter((s) => s.hp > 0 && s.archetypeId === "goblin-thrower")).toHaveLength(1);

    // The stale, dismissed entry must not shadow the live one when resolved by combatant ref
    // (both once shared a deterministic id — see the `summonCounter` fix in combat.ts).
    const summonRef = combat.combatants.find((c) => c.ref.kind === "summon")!.ref;
    const resolved = getActorByRef(summonRef, ctx) as Summon;
    expect(resolved.hp).toBeGreaterThan(0);
  });

  test("a minion that expires by running out of actions is zeroed out, not left as a ghost that still counts toward the owner's active-minion cap", () => {
    const { ctx } = makeCtx();
    const summoner = ctx.party.find((p) => p.classId === "summoner")!;
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.attack = 0;
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: summoner.id };

    queueAction(combat, self, "summoner-summon-goblin", [self], ctx);
    resolveRound(combat, ctx); // goblin spawns mid-round, doesn't act yet
    resolveRound(combat, ctx); // action 1
    resolveRound(combat, ctx); // action 2
    resolveRound(combat, ctx); // action 3 — goblin-thrower's maxActions, expires this round

    const goblin = ctx.summons.find((s) => s.archetypeId === "goblin-thrower")!;
    expect(goblin.actionsTaken).toBe(3);
    expect(goblin.hp).toBe(0);
    expect(combat.combatants.some((c) => c.ref.kind === "summon")).toBe(false);

    // A different-type summon right after must not see the expired goblin as still "owned" —
    // it should be added cleanly, not treated as if the owner were already at any cap.
    summoner.cooldownsRemaining["summoner-summon-spirit"] = 0;
    summoner.mp = summoner.maxMp;
    queueAction(combat, self, "summoner-summon-spirit", [self], ctx);
    resolveRound(combat, ctx);
    const activeMinions = combat.combatants.filter((c) => c.ref.kind === "summon");
    expect(activeMinions).toHaveLength(1);
    expect((getActorByRef(activeMinions[0]!.ref, ctx) as Summon).archetypeId).toBe("healer-spirit");
  });

  test("reaching Mastery rank 2 by level (without casting it) raises the cap to 2 different-type minions", () => {
    const { ctx } = makeCtx();
    const summoner = ctx.party.find((p) => p.classId === "summoner")!;
    summoner.level = 50;
    summoner.unlockedSkillIds.push("summoner-summon-golem");
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.attack = 0;
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: summoner.id };

    queueAction(combat, self, "summoner-summon-goblin", [self], ctx);
    resolveRound(combat, ctx);
    queueAction(combat, self, "summoner-summon-spirit", [self], ctx);
    resolveRound(combat, ctx);

    let active = ctx.summons.filter((s) => s.hp > 0);
    expect(active.map((s) => s.archetypeId).sort()).toEqual(["goblin-thrower", "healer-spirit"]);

    // A 3rd different type, still under the same rank-2 cap of 2, evicts the oldest (goblin).
    queueAction(combat, self, "summoner-summon-golem", [self], ctx);
    resolveRound(combat, ctx);
    active = ctx.summons.filter((s) => s.hp > 0);
    expect(active.map((s) => s.archetypeId).sort()).toEqual(["healer-spirit", "stone-golem"]);
  });

  test("Mastery empowers every currently active minion, and any minion summoned afterward, with bonus max HP/attack", () => {
    const { ctx } = makeCtx();
    const summoner = ctx.party.find((p) => p.classId === "summoner")!;
    summoner.level = 20;
    summoner.unlockedSkillIds.push("summoner-mastery");
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.attack = 0;
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: summoner.id };

    queueAction(combat, self, "summoner-summon-goblin", [self], ctx);
    resolveRound(combat, ctx);
    const goblin = ctx.summons.find((s) => s.archetypeId === "goblin-thrower")!;
    const unbuffedMaxHp = goblin.maxHp;
    const unbuffedAttack = goblin.attack;

    queueAction(combat, self, "summoner-mastery", [self], ctx);
    resolveRound(combat, ctx);
    expect(summoner.activeStatusEffects.some((s) => s.statusEffectId === "minion-empowerment")).toBe(true);
    expect(goblin.maxHp).toBe(Math.round(unbuffedMaxHp * 1.15));
    expect(goblin.attack).toBe(Math.round(unbuffedAttack * 1.15));
  });

  test("Healer Spirit heals on its own turn regardless of which of its 2 heal skills is picked", () => {
    const { ctx } = makeCtx();
    const summoner = ctx.party.find((p) => p.classId === "summoner")!;
    const vanguard = ctx.party.find((p) => p.classId === "vanguard")!;
    const rat = spawnInto(ctx, "dungeon-rat");
    rat.attack = 0;
    const combat = startCombat("r1", [rat.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: summoner.id };

    queueAction(combat, self, "summoner-summon-spirit", [self], ctx);
    resolveRound(combat, ctx); // spirit spawns mid-round, doesn't act yet
    vanguard.hp = 1;

    resolveRound(combat, ctx); // spirit's own 1st turn
    expect(combat.log.some((l) => l.kind === "heal")).toBe(true);
  });

  test("Summon Hellfire Imp spawns exactly 1 imp and damages every enemy exactly once", () => {
    const { ctx } = makeCtx();
    const summoner = ctx.party.find((p) => p.classId === "summoner")!;
    summoner.level = 35;
    summoner.mp = summoner.maxMp;
    summoner.unlockedSkillIds.push("summoner-summon-imp");
    const rat1 = spawnInto(ctx, "dungeon-rat");
    const rat2 = spawnInto(ctx, "dungeon-rat");
    rat1.attack = 0;
    rat2.attack = 0;
    const combat = startCombat("r1", [rat1.id, rat2.id], ctx, false);
    const self: CombatantRef = { kind: "character", id: summoner.id };
    const targets = autoResolveTargets("allEnemies", self, combat, ctx) ?? [];

    const hpBefore = [rat1.hp, rat2.hp];
    queueAction(combat, self, "summoner-summon-imp", targets, ctx);
    resolveRound(combat, ctx);

    expect(ctx.summons.filter((s) => s.archetypeId === "hellfire-imp")).toHaveLength(1);
    expect(rat1.hp).toBeLessThan(hpBefore[0]!);
    expect(rat2.hp).toBeLessThan(hpBefore[1]!);
  });
});

