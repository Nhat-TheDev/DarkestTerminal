import { BoxRenderable, TextRenderable, type CliRenderer, type KeyEvent } from "@opentui/core";
import type { Character, CombatantRef, Monster, SkillDefinition } from "../types";
import { Game } from "../engine/game";
import { getActorByRef } from "../engine/combat";
import { getSkill, getClass } from "../data/classes";
import { getRoom } from "../engine/dungeon";
import { getFearTier } from "../engine/resolver";

type UiState =
  | { kind: "room" }
  | { kind: "pickSkill"; actorRef: CombatantRef }
  | { kind: "pickTarget"; actorRef: CombatantRef; skill: SkillDefinition; candidates: CombatantRef[] }
  | { kind: "roundResolved" }
  | { kind: "combatOver" }
  | { kind: "gameover" };

const FEAR_TIER_LABEL: Record<number, string> = {
  1: "Bình Tĩnh",
  2: "Bất An",
  3: "Hoảng Loạn",
  4: "Suy Sụp",
};

export class App {
  private game: Game;
  private ui: UiState = { kind: "room" };
  private root: BoxRenderable;
  private header: TextRenderable;
  private party: TextRenderable;
  private main: TextRenderable;
  private log: TextRenderable;
  private footer: TextRenderable;
  private lastLogLength = 0;

  constructor(private renderer: CliRenderer, game?: Game) {
    this.game = game ?? new Game();

    this.root = new BoxRenderable(renderer, {
      id: "root",
      width: "100%",
      height: "100%",
      flexDirection: "column",
    });
    renderer.root.add(this.root);

    this.header = new TextRenderable(renderer, { id: "header", content: "" });
    const headerBox = new BoxRenderable(renderer, { id: "header-box", border: true, height: 3, title: "DARKEST-TERMINAL" });
    headerBox.add(this.header);
    this.root.add(headerBox);

    const body = new BoxRenderable(renderer, { id: "body", flexDirection: "row", flexGrow: 1 });
    this.root.add(body);

    const partyBox = new BoxRenderable(renderer, { id: "party-box", border: true, width: 38, title: "Party" });
    this.party = new TextRenderable(renderer, { id: "party", content: "" });
    partyBox.add(this.party);
    body.add(partyBox);

    const mainBox = new BoxRenderable(renderer, { id: "main-box", border: true, flexGrow: 1, title: "Hầm Ngục" });
    this.main = new TextRenderable(renderer, { id: "main", content: "" });
    mainBox.add(this.main);
    body.add(mainBox);

    const logBox = new BoxRenderable(renderer, { id: "log-box", border: true, height: 10, title: "Nhật Ký" });
    this.log = new TextRenderable(renderer, { id: "log", content: "" });
    logBox.add(this.log);
    this.root.add(logBox);

    this.footer = new TextRenderable(renderer, { id: "footer", content: "" });
    const footerBox = new BoxRenderable(renderer, { id: "footer-box", height: 3 });
    footerBox.add(this.footer);
    this.root.add(footerBox);

    renderer.keyInput.on("keypress", (key: KeyEvent) => this.handleKey(key));
    this.syncUiToGameState();
    this.render();
  }

  /** Exposed for tests — the UI is otherwise driven purely by keypresses. */
  get debugUiState(): UiState {
    return this.ui;
  }

  get debugGame(): Game {
    return this.game;
  }

  /** After any game mutation: figure out what the UI should be showing next. */
  private syncUiToGameState(): void {
    if (this.game.state.gameOver) {
      this.ui = { kind: "gameover" };
      return;
    }
    const combat = this.game.state.combat;
    if (!combat) {
      this.ui = { kind: "room" };
      return;
    }
    if (combat.phase === "over") {
      this.ui = { kind: "combatOver" };
      return;
    }
    if (combat.phase === "resolution") {
      this.ui = { kind: "roundResolved" };
      return;
    }
    // phase === "command": find the next living character without a queued action.
    const next = this.game
      .livingAllyRefs()
      .find((ref) => !combat.queuedActions.some((qa) => qa.actor.id === ref.id && qa.actor.kind === ref.kind));
    this.ui = next ? { kind: "pickSkill", actorRef: next } : { kind: "roundResolved" };
    if (!next && this.game.readyToResolve()) {
      this.game.resolve();
      this.syncUiToGameState();
    }
  }

  private handleKey(key: KeyEvent): void {
    if (key.name === "q" || key.name === "c" && key.ctrl) {
      process.exit(0);
    }
    const digit = /^[1-9]$/.test(key.name) ? Number(key.name) : null;

    switch (this.ui.kind) {
      case "room": {
        if (digit === null) break;
        const choices = this.game.connectedRoomChoices();
        const choice = choices[digit - 1];
        if (choice) this.game.move(choice.id);
        this.syncUiToGameState();
        break;
      }
      case "pickSkill": {
        if (digit === null) break;
        const actor = getActorByRef(this.ui.actorRef, this.game.ctx) as Character;
        const skill = actor.unlockedSkillIds.map(getSkill)[digit - 1];
        if (!skill) break;
        this.trySelectSkill(this.ui.actorRef, skill);
        break;
      }
      case "pickTarget": {
        if (digit === null) break;
        const target = this.ui.candidates[digit - 1];
        if (!target) break;
        const err = this.game.queue(this.ui.actorRef, this.ui.skill.id, [target]);
        if (err) {
          this.game.state.message = err.reason;
        }
        this.syncUiToGameState();
        break;
      }
      case "roundResolved":
      case "combatOver": {
        if (this.ui.kind === "combatOver") this.game.clearFinishedCombat();
        this.syncUiToGameState();
        break;
      }
      case "gameover":
        break;
    }
    this.render();
  }

  private trySelectSkill(actorRef: CombatantRef, skill: SkillDefinition): void {
    if (skill.target === "singleEnemy" || skill.target === "singleAlly") {
      const candidates = skill.target === "singleEnemy" ? this.game.livingEnemyRefs() : this.game.livingAllyRefs();
      this.ui = { kind: "pickTarget", actorRef, skill, candidates };
      return;
    }
    const targets = this.game.autoTargets(skill.target, actorRef) ?? [actorRef];
    const err = this.game.queue(actorRef, skill.id, targets);
    if (err) this.game.state.message = err.reason;
    this.syncUiToGameState();
  }

  private render(): void {
    const s = this.game.state;
    const room = getRoom(s.floor, s.currentRoomId);
    this.header.content = `${room.name} — Tầng ${s.floor.depth} | ${s.combat ? `Round ${s.combat.roundNumber}` : "Khám phá"}`;

    this.party.content = s.party
      .map((c) => this.renderCharacterLine(c))
      .join("\n\n");

    this.main.content = this.renderMain();

    const fullLog = [...(s.combat?.log ?? [])];
    const newLines = fullLog.slice(this.lastLogLength);
    if (this.ui.kind !== "roundResolved" && this.ui.kind !== "combatOver") {
      this.lastLogLength = fullLog.length;
    }
    const displayLog = (this.ui.kind === "roundResolved" || this.ui.kind === "combatOver" ? newLines : fullLog).slice(-12);
    this.log.content = (displayLog.length > 0 ? displayLog : [s.message]).join("\n");

    this.footer.content = this.renderFooter();
  }

  private renderCharacterLine(c: Character): string {
    if (!c.isAlive) return `${c.name} (${getClass(c.classId).name}) — ĐÃ CHẾT`;
    const tier = getFearTier(c.survival.fear);
    const statuses = c.activeStatusEffects.map((s) => s.statusEffectId).join(", ") || "-";
    return [
      `${c.name} (${getClass(c.classId).name}) Lv${c.level}`,
      `HP ${c.hp}/${c.maxHp}  MP ${c.mp}/${c.maxMp}`,
      `ATK ${c.attack} DEF ${c.defense} AGGRO ${c.aggro} SPD ${c.speed}`,
      `Đói ${Math.round(c.survival.hunger)} Khát ${Math.round(c.survival.thirst)} Sợ ${Math.round(c.survival.fear)} (${FEAR_TIER_LABEL[tier]})`,
      `Hiệu ứng: ${statuses}`,
    ].join("\n");
  }

  private renderMain(): string {
    const s = this.game.state;
    if (this.ui.kind === "gameover") {
      return s.gameOver === "victory"
        ? "CHIẾN THẮNG!\n\nBạn đã hạ gục chúa ngục và sống sót qua tầng hầm ngục."
        : "TOÀN ĐỘI ĐÃ GỤC NGÃ.\n\nHầm ngục nuốt chửng một đoàn thám hiểm khác...";
    }
    if (this.ui.kind === "room") {
      const room = getRoom(s.floor, s.currentRoomId);
      const choices = this.game.connectedRoomChoices();
      const lines = [`Loại phòng: ${room.type}${room.cleared ? " (đã dọn sạch)" : ""}`, "", "Lối đi:"];
      choices.forEach((r, i) => lines.push(`  [${i + 1}] ${r.name} (${r.type})`));
      return lines.join("\n");
    }
    if (this.ui.kind === "combatOver") {
      const combat = s.combat!;
      return combat.outcome === "victory" ? "Đã dọn sạch phòng! Nhấn phím bất kỳ để tiếp tục." : "Trận chiến thất bại.";
    }
    if (this.ui.kind === "roundResolved") {
      return "Round kết thúc. Nhấn phím bất kỳ để xem diễn biến / tiếp tục.";
    }
    if (this.ui.kind === "pickSkill") {
      const actor = getActorByRef(this.ui.actorRef, this.game.ctx) as Character;
      const lines = [`Lượt của ${actor.name} — chọn kỹ năng:`];
      actor.unlockedSkillIds.map(getSkill).forEach((sk, i) => {
        const usesLeft = sk.usesPerCombat !== undefined ? actor.usesRemainingThisCombat[sk.id] ?? sk.usesPerCombat : null;
        lines.push(`  [${i + 1}] ${sk.name} (MP ${sk.mpCost}${usesLeft !== null ? `, còn ${usesLeft} lượt/trận` : ""}) — ${sk.description}`);
      });
      return lines.join("\n");
    }
    if (this.ui.kind === "pickTarget") {
      const lines = [`Chọn mục tiêu cho ${this.ui.skill.name}:`];
      this.ui.candidates.forEach((ref, i) => {
        const target = getActorByRef(ref, this.game.ctx);
        const hpInfo = "hp" in target ? ` (${target.hp}/${target.maxHp} HP)` : "";
        lines.push(`  [${i + 1}] ${target.name}${hpInfo}`);
      });
      return lines.join("\n");
    }
    return "";
  }

  private renderFooter(): string {
    switch (this.ui.kind) {
      case "room":
        return "Nhấn số để di chuyển. q để thoát.";
      case "pickSkill":
        return "Nhấn số để chọn kỹ năng.";
      case "pickTarget":
        return "Nhấn số để chọn mục tiêu.";
      case "roundResolved":
      case "combatOver":
        return "Nhấn phím bất kỳ để tiếp tục.";
      case "gameover":
        return "Trò chơi kết thúc. q để thoát.";
    }
  }
}
