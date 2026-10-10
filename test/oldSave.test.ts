import { describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { App } from "../src/ui/app";
import { Game } from "../src/engine/game";
import { startCombat } from "../src/engine/combat";
import { getRoom } from "../src/engine/dungeon";
import { deleteSlot, gameFromSave, loadSave, saveRun, SLOT_IDS, type SaveFile } from "../src/engine/save";
import { spawnMonster } from "../src/data/monsters";
import { getClass } from "../src/data/classes";
import type { CombatantRef, LogSession, Summon } from "../src/types";
import { pickAnyAction } from "./helpers";

const PARTY = ["vanguard", "mage", "ninja", "summoner"];
/** Ids a build before the rename used: a skill, a status and a summon archetype that are no longer in data/*.json. */
const OLD_SKILL = "vanguard-slash";
const OLD_STATUS = "mage-shred";
const OLD_SUMMON = "ninja-clone";

function summon(id: string, ownerId: string, archetypeId: string, extra: Partial<Summon> = {}): Summon {
  return { id, ownerId, archetypeId, name: archetypeId, hp: 20, maxHp: 20, attack: 4, defense: 2, magicPower: 0, aggro: 5, speed: 1, activeStatusEffects: [], actionsTaken: 0, maxActions: 3, ...extra };
}

/**
 * A real save taken mid-fight, after one resolved round, then given the ids an older build wrote:
 * a summon of a removed archetype (with a buff tied to it), a queued action and skill counters under
 * an old skill id, an old status in every snapshot, and log sessions missing their newer id lists.
 */
function oldMidFightSave(): { save: SaveFile; goblinRef: CombatantRef } {
  const game = new Game(7, PARTY);
  game.currentSaveSlot = "slot1";
  const room = getRoom(game.state.floor, game.state.currentRoomId);
  const goblins = [spawnMonster("goblin", 1), spawnMonster("goblin", 1)];
  for (const g of goblins) {
    g.hp = g.maxHp = 500;
    g.attack = 0;
    game.ctx.monsters.push(g);
  }
  room.monsterIds = goblins.map((g) => g.id);
  room.cleared = false;
  game.state.combat = startCombat(room.id, room.monsterIds, game.ctx, false);
  for (const ref of game.livingCharactersNeedingAction()) {
    const { skillId, targets } = pickAnyAction(game.ctx, game.state.combat, ref);
    expect(game.queue(ref, skillId, targets)).toBeNull();
  }
  game.resolve();
  saveRun(game);

  const save = loadSave("slot1");
  const combat = save.state.combat!;
  expect(combat.phase).toBe("command");
  const [vanguard, mage, ninja, summoner] = save.state.party.map((c) => c!);
  const goblinRef: CombatantRef = { kind: "monster", id: goblins[0]!.id };

  const clone = summon(`${ninja!.id}-${OLD_SUMMON}-1`, ninja!.id, OLD_SUMMON);
  const thrower = summon(`${summoner!.id}-goblin-thrower-1`, summoner!.id, "goblin-thrower", {
    defense: 2,
    activeStatusEffects: [{ statusEffectId: OLD_STATUS, turnsRemaining: 2, appliedAmounts: { defense: -3 } }],
  });
  save.summons = [clone, thrower];
  for (const s of save.summons) {
    combat.combatants.push({ ref: { kind: "summon", id: s.id }, speed: s.speed });
    combat.turnQueue.push({ kind: "summon", id: s.id });
  }
  vanguard!.activeStatusEffects.push({ statusEffectId: "guard", turnsRemaining: 5, linkedSummonId: clone.id });

  combat.queuedActions = [
    { actor: { kind: "character", id: vanguard!.id }, source: { kind: "skill", skillId: OLD_SKILL }, targets: [goblinRef] },
    { actor: { kind: "character", id: mage!.id }, source: { kind: "skill", skillId: getClass("mage").skills[0]!.id }, targets: [goblinRef] },
  ];
  mage!.cooldownsRemaining = { "mage-fireball": 2, fireball: 1 };
  vanguard!.usesRemainingThisCombat = { "vanguard-sword-judgment": 0 };

  for (const snapshot of [combat.roundStartSnapshot!, ...combat.log.flatMap((e) => (e.snapshot ? [e.snapshot] : []))]) {
    for (const unit of snapshot) unit.activeStatusEffects = [...(unit.activeStatusEffects ?? []), { statusEffectId: OLD_STATUS, turnsRemaining: 2 }];
  }
  const sessions = combat.log.flatMap((e) => (e.session ? [e.session as Partial<LogSession>] : []));
  expect(sessions.length).toBeGreaterThan(0);
  for (const session of sessions) {
    delete session.summonIds;
    delete session.lostTurnIds;
    delete session.buffLostIds;
    delete session.tickDamageIds;
    delete session.lifestealIds;
  }
  return { save, goblinRef };
}

describe("a mid-fight save written before ids were renamed", () => {
  test("loads with every old id gone, and the summon of a removed archetype gone with its refs and linked buff", () => {
    try {
      const { save } = oldMidFightSave();
      const thrower = save.summons![1]!;
      const game = gameFromSave(save, "slot1");
      const combat = game.state.combat!;
      const [vanguard, mage] = game.state.party;

      expect(game.ctx.summons.map((s) => s.id)).toEqual([thrower.id]);
      expect(game.ctx.summons[0]!.activeStatusEffects).toEqual([]);
      expect(game.ctx.summons[0]!.defense).toBe(5);
      const summonRefs = [...combat.combatants.map((c) => c.ref), ...combat.turnQueue].filter((r) => r.kind === "summon").map((r) => r.id);
      expect(new Set(summonRefs)).toEqual(new Set([thrower.id]));
      expect(vanguard!.activeStatusEffects.some((s) => s.linkedSummonId !== undefined)).toBe(false);

      expect(combat.queuedActions.map((a) => a.actor.id)).toEqual([mage!.id]);
      expect(mage!.cooldownsRemaining).toEqual({ fireball: 1 });
      expect(vanguard!.usesRemainingThisCombat).toEqual({});

      const snapshots = [combat.roundStartSnapshot!, ...combat.log.flatMap((e) => (e.snapshot ? [e.snapshot] : []))];
      expect(snapshots.flat().flatMap((u) => u.activeStatusEffects ?? []).some((s) => s.statusEffectId === "mage-shred")).toBe(false);
      for (const entry of combat.log) {
        if (!entry.session) continue;
        for (const list of [entry.session.summonIds, entry.session.lostTurnIds, entry.session.buffLostIds, entry.session.tickDamageIds, entry.session.lifestealIds]) {
          expect(list).toEqual(expect.any(Array));
        }
      }
    } finally {
      SLOT_IDS.forEach(deleteSlot);
    }
  });

  test("renders, asks the character whose action was dropped for a new one, and resolves the next round", async () => {
    try {
      const { save, goblinRef } = oldMidFightSave();
      const game = gameFromSave(save, "slot1");
      const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({ width: 130, height: 62 });
      const app = new App(renderer, game, { autoReveal: false });
      await renderOnce();
      for (let guard = 0; app.debugRevealActive && guard < 500; guard++) {
        app.tickReveal();
        await renderOnce();
      }
      expect(captureCharFrame()).toContain(game.state.party[0]!.name);
      const ui = app.debugUiState;
      expect(ui.kind === "pickAction" && ui.actorRef.id).toBe(game.state.party[0]!.id);

      for (const ref of game.livingCharactersNeedingAction()) {
        if (game.state.combat!.queuedActions.some((a) => a.actor.id === ref.id)) continue;
        const { skillId, targets } = pickAnyAction(game.ctx, game.state.combat!, ref);
        expect(game.queue(ref, skillId, targets.length > 0 ? targets : [goblinRef])).toBeNull();
      }
      expect(() => game.resolve()).not.toThrow();
      expect(game.state.combat!.roundNumber).toBe(3);
      renderer.destroy();
    } finally {
      SLOT_IDS.forEach(deleteSlot);
    }
  });
});
