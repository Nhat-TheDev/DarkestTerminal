import type { CombatantRef, GameState, SkillTarget } from "../types";
import { CLASSES, getClass } from "../data/classes";
import { createFloor } from "../data/floor";
import { createCharacter } from "./party";
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
        if (room.type === "boss") {
          this.state.gameOver = "victory";
        }
      } else if (this.state.combat.outcome === "defeat") {
        this.state.gameOver = "defeat";
      }
    }
    this.postMoveCheck();
  }

  clearFinishedCombat(): void {
    if (this.state.combat?.phase === "over") this.state.combat = null;
  }

  className(classId: string): string {
    return getClass(classId).name;
  }
}
