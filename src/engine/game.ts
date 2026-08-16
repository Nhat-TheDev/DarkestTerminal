import type { CombatantRef, GameState, SkillTarget } from "../types";
import { CLASSES, getClass } from "../data/classes";
import { createFloor } from "../data/floor";
import { createCharacter, applyPartyExp } from "./party";
import { Rng } from "./rng";
import {
  type EngineContext,
  autoResolveTargets,
  queueAction,
  allLivingCharactersHaveQueuedActions,
  resolveRound,
  startCombat,
  type QueueActionError,
  livingMonsterRefs,
  livingCharacterRefs,
} from "./combat";
import { getRoom, moveToRoom, connectedRooms } from "./dungeon";
import { tickSurvivalOnAction } from "./survival";

export class Game {
  readonly ctx: EngineContext;
  readonly state: GameState;

  constructor(seed = Date.now()) {
    const rng = new Rng(seed);
    const { floor, monsters } = createFloor(rng);
    const party = CLASSES.map((cls, i) => createCharacter(`p${i + 1}`, cls.name, cls));
    this.ctx = { party, monsters, rng };
    this.state = {
      party,
      floor,
      currentRoomId: floor.entryRoomId,
      combat: null,
      message: `Bước vào ${getRoom(floor, floor.entryRoomId).name}.`,
      gameOver: null,
      partyExp: 0,
    };
    this.checkEntryRoomAmbush();
  }

  private checkEntryRoomAmbush(): void {
    const room = getRoom(this.state.floor, this.state.currentRoomId);
    const hasLiving = room.monsterIds.some((id) => (this.ctx.monsters.find((m) => m.id === id)?.hp ?? 0) > 0);
    if (hasLiving && !room.cleared) {
      this.state.combat = startCombat(room.id, room.monsterIds, this.ctx, room.type === "boss");
      this.state.message = `Bị phục kích tại ${room.name}!`;
    }
  }

  connectedRoomChoices() {
    return connectedRooms(this.state.floor, this.state.currentRoomId);
  }

  move(targetRoomId: string): void {
    if (this.state.combat && this.state.combat.phase !== "over") {
      this.state.message = "Phải xử lý xong trận chiến trước.";
      return;
    }
    moveToRoom(this.state, targetRoomId, this.ctx);
    this.postMoveCheck();
  }

  private postMoveCheck(): void {
    if (this.state.party.every((c) => !c.isAlive)) {
      this.state.gameOver = "defeat";
    }
  }

  autoTargets(target: SkillTarget, actor: CombatantRef): CombatantRef[] | null {
    if (!this.state.combat) return null;
    return autoResolveTargets(target, actor, this.state.combat, this.ctx);
  }

  livingEnemyRefs(): CombatantRef[] {
    if (!this.state.combat) return [];
    return livingMonsterRefs(this.state.combat, this.ctx);
  }

  livingAllyRefs(): CombatantRef[] {
    if (!this.state.combat) return [];
    return livingCharacterRefs(this.state.combat, this.ctx);
  }

  queue(actorRef: CombatantRef, skillId: string, targets: CombatantRef[]): QueueActionError | null {
    if (!this.state.combat) return { reason: "Không trong trận chiến." };
    return queueAction(this.state.combat, actorRef, skillId, targets, this.ctx);
  }

  readyToResolve(): boolean {
    if (!this.state.combat) return false;
    return allLivingCharactersHaveQueuedActions(this.state.combat, this.ctx);
  }

  resolve(): void {
    if (!this.state.combat) return;
    resolveRound(this.state.combat, this.ctx);
    for (const c of this.state.party) {
      if (c.isAlive) tickSurvivalOnAction(c, this.state.combat.log);
    }
    if (this.state.combat.phase === "over") {
      if (this.state.combat.outcome === "victory") {
        const room = getRoom(this.state.floor, this.state.combat.roomId);
        room.cleared = true;
        const expGained = room.monsterIds.reduce((sum, id) => sum + (this.ctx.monsters.find((m) => m.id === id)?.expReward ?? 0), 0);
        applyPartyExp(this.state, expGained);
      } else if (this.state.combat.outcome === "defeat") {
        this.state.gameOver = "defeat";
      }
    }
    this.postMoveCheck();
  }

  /**
   * Clearing the floor's guard room (elite or boss, §6.11) advances depth
   * instead of ending the game (docs/gameplay-decisions.md §6.9/6.10) — floor
   * depth is uncapped, so a run only ends via party wipe, never "victory".
   * Deferred to clearFinishedCombat() (not resolve()) so the player still
   * sees the "combatOver" victory screen/log before the floor changes under
   * them — doing it inside resolve() would silently replace state.combat
   * with the next floor's entry-room ambush before the UI ever renders it.
   */
  private advanceToNextFloor(): void {
    const nextDepth = this.state.floor.depth + 1;
    const { floor, monsters } = createFloor(this.ctx.rng, nextDepth);
    this.ctx.monsters = monsters;
    this.state.floor = floor;
    this.state.currentRoomId = floor.entryRoomId;
    this.state.message = `Cả đội xuống tầng ${nextDepth}!`;
    this.checkEntryRoomAmbush();
  }

  clearFinishedCombat(): void {
    if (this.state.combat?.phase !== "over") return;
    const wasBossRoomVictory = this.state.combat.outcome === "victory" && getRoom(this.state.floor, this.state.combat.roomId).type === "boss";
    this.state.combat = null;
    if (wasBossRoomVictory) this.advanceToNextFloor();
  }

  className(classId: string): string {
    return getClass(classId).name;
  }
}
