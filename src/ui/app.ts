import { BoxRenderable, ScrollBoxRenderable, TextRenderable, StyledText, type CliRenderer, type KeyEvent, type TextChunk } from "@opentui/core";
import type { Character, CombatantRef, Monster, SkillDefinition } from "../types";
import { Game } from "../engine/game";
import { getActorByRef, checkSkillUsable } from "../engine/combat";
import { getSkill, getClass } from "../data/classes";
import { getRoom } from "../engine/dungeon";
import { getFearTier } from "../engine/resolver";
import {
  PALETTE,
  CLASS_STYLE,
  MONSTER_STYLE,
  BOSS_COLOR,
  ELITE_COLOR,
  chip,
  plainChunk,
  colorChunk,
  boldColorChunk,
  hpColorFor,
  fearColorFor,
  joinLines,
} from "./theme";
import {
  spriteForClass,
  spriteForMonster,
  renderSpriteInSlot,
  compositeSpriteRow,
  MAX_BOSS_HEIGHT,
  TOMBSTONE_SPRITE,
  CAMPFIRE_SPRITE,
  type Sprite,
} from "./sprites";

const SLOT_WIDTH = 13; // matches the class sprites' width, the widest sprites
const SLOT_GAP = 2;
const DIVIDER_WIDTH = 3;
const EMPTY_ENEMY_WIDTH = 24;
/** sprite (bottom-aligned to MAX_BOSS_HEIGHT) + 1 spacer + label line + hp line. */
const UNIT_BLOCK_HEIGHT = MAX_BOSS_HEIGHT + 3;
/** How many of the most recent log lines are kept on screen — scroll up within the panel to see them. */
const LOG_HISTORY_SIZE = 20;

function centerText(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  const pad = width - text.length;
  const left = Math.floor(pad / 2);
  return " ".repeat(left) + text + " ".repeat(pad - left);
}

/** Elite and boss are 2 distinct tiers — mixing them up made every guard-room elite display as "BOSS". */
function monsterStyle(m: Monster): { abbr: string; color: string } {
  if (m.tier === "boss") return { abbr: "BOSS", color: BOSS_COLOR };
  if (m.tier === "elite") return { abbr: "ELITE", color: ELITE_COLOR };
  return MONSTER_STYLE[m.archetypeId] ?? { abbr: "??", color: PALETTE.dim };
}

function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1).trimEnd() + "…";
}

/** Concatenates same-height blocks side by side, line by line, with a blank gap between them. */
function mergeBlocksHorizontally(blocks: TextChunk[][][], gapWidth: number): TextChunk[][] {
  const lineCount = blocks[0]?.length ?? 0;
  const merged: TextChunk[][] = [];
  for (let i = 0; i < lineCount; i++) {
    const line: TextChunk[] = [];
    blocks.forEach((block, idx) => {
      if (idx > 0) line.push(plainChunk(" ".repeat(gapWidth)));
      line.push(...(block[i] ?? []));
    });
    merged.push(line);
  }
  return merged;
}

type UiState =
  | { kind: "room" }
  | { kind: "rest" }
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
  private battlefield: TextRenderable;
  private party: TextRenderable;
  private main: TextRenderable;
  private monsters: TextRenderable;
  private log: TextRenderable;
  private logScroll: ScrollBoxRenderable;
  private footer: TextRenderable;
  /** How many entries of the current combat's log have already been folded into `logHistory` — combat.log resets to a fresh array each new fight, `logHistory` never does. */
  private lastLogLength = 0;
  private observedCombatLog: string[] | null = null;
  /** Persists across combats/floors for the lifetime of the App — never cleared, only trimmed to LOG_HISTORY_SIZE. */
  private logHistory: string[] = [];

  constructor(private renderer: CliRenderer, game?: Game) {
    this.game = game ?? new Game();

    const panel = {
      border: true as const,
      backgroundColor: PALETTE.panelBg,
      borderColor: PALETTE.border,
      titleColor: PALETTE.title,
    };

    this.root = new BoxRenderable(renderer, {
      id: "root",
      width: "100%",
      height: "100%",
      flexDirection: "column",
      backgroundColor: PALETTE.bg,
    });
    renderer.root.add(this.root);

    this.header = new TextRenderable(renderer, { id: "header", content: "", fg: PALETTE.text });
    const headerBox = new BoxRenderable(renderer, {
      id: "header-box",
      ...panel,
      borderColor: PALETTE.borderAccent,
      height: 3,
      title: "DARKEST-TERMINAL",
    });
    headerBox.add(this.header);
    this.root.add(headerBox);

    const battlefieldBox = new BoxRenderable(renderer, {
      id: "battlefield-box",
      ...panel,
      height: UNIT_BLOCK_HEIGHT + 2,
      title: "Chiến Trường",
    });
    this.battlefield = new TextRenderable(renderer, { id: "battlefield", content: "", fg: PALETTE.text, bg: PALETTE.panelBg });
    battlefieldBox.add(this.battlefield);
    this.root.add(battlefieldBox);

    const body = new BoxRenderable(renderer, { id: "body", flexDirection: "row", flexGrow: 1, backgroundColor: PALETTE.bg });
    this.root.add(body);

    const partyBox = new BoxRenderable(renderer, { id: "party-box", ...panel, width: 34, title: "Đoàn Thám Hiểm" });
    this.party = new TextRenderable(renderer, { id: "party", content: "", fg: PALETTE.text });
    partyBox.add(this.party);
    body.add(partyBox);

    const mainBox = new BoxRenderable(renderer, { id: "main-box", ...panel, flexGrow: 1, title: "Hầm Ngục" });
    this.main = new TextRenderable(renderer, { id: "main", content: "", fg: PALETTE.text });
    mainBox.add(this.main);
    body.add(mainBox);

    const monstersBox = new BoxRenderable(renderer, { id: "monsters-box", ...panel, width: 32, title: "Quái Vật" });
    this.monsters = new TextRenderable(renderer, { id: "monsters", content: "", fg: PALETTE.text });
    monstersBox.add(this.monsters);
    body.add(monstersBox);

    const logBox = new BoxRenderable(renderer, { id: "log-box", ...panel, height: 8, title: "Nhật Ký (↑/↓ để cuộn)" });
    this.logScroll = new ScrollBoxRenderable(renderer, {
      id: "log-scroll",
      width: "100%",
      height: "100%",
      scrollX: false,
      scrollY: true,
      stickyScroll: true,
      stickyStart: "bottom",
    });
    this.log = new TextRenderable(renderer, { id: "log", content: "", fg: PALETTE.dim });
    this.logScroll.add(this.log);
    logBox.add(this.logScroll);
    this.root.add(logBox);

    this.footer = new TextRenderable(renderer, { id: "footer", content: "", fg: PALETTE.dim });
    const footerBox = new BoxRenderable(renderer, { id: "footer-box", height: 3, backgroundColor: PALETTE.bg });
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
      const room = getRoom(this.game.state.floor, this.game.state.currentRoomId);
      this.ui = room.type === "rest" && !room.cleared ? { kind: "rest" } : { kind: "room" };
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
    if (key.name === "q" || (key.name === "c" && key.ctrl)) {
      this.quit();
      return;
    }
    if (this.logScroll.handleKeyPress(key)) {
      this.render();
      return;
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
      case "rest": {
        const choice = digit === 1 ? "eat" : digit === 2 ? "chat" : digit === 3 ? "skip" : null;
        if (choice === null) break;
        this.game.restAction(choice);
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
        if (err) this.reportUnusable(err.reason);
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

  /**
   * `process.exit()` alone skips OpenTUI's terminal teardown (leaves mouse
   * tracking / alternate screen / cursor state stuck) — `renderer.destroy()`
   * restores the terminal first, then we exit.
   */
  private quit(): void {
    this.renderer.destroy();
    process.exit(0);
  }

  /**
   * Surfaces a "can't do that" reason where the player will actually see it.
   * state.message only renders as a fallback when the session's whole log
   * history is empty (see render()'s log section) — dead once combat has
   * happened even once — so push straight into the active combat's log instead.
   */
  private reportUnusable(reason: string): void {
    this.game.state.combat?.log.push(reason);
  }

  private trySelectSkill(actorRef: CombatantRef, skill: SkillDefinition): void {
    const actor = getActorByRef(actorRef, this.game.ctx);
    const unusable = checkSkillUsable(actor, skill);
    if (unusable) {
      // Stay on pickSkill — never advance to target-picking for a skill that can't be used.
      this.reportUnusable(`Không thể dùng ${skill.name}: ${unusable.reason}`);
      return;
    }
    if (skill.target === "singleEnemy" || skill.target === "singleAlly") {
      const candidates = skill.target === "singleEnemy" ? this.game.livingEnemyRefs() : this.game.livingAllyRefs();
      this.ui = { kind: "pickTarget", actorRef, skill, candidates };
      return;
    }
    if (skill.target === "singleAllyOrEnemy") {
      const candidates = [...this.game.livingAllyRefs(), ...this.game.livingEnemyRefs()];
      this.ui = { kind: "pickTarget", actorRef, skill, candidates };
      return;
    }
    const targets = this.game.autoTargets(skill.target, actorRef) ?? [actorRef];
    const err = this.game.queue(actorRef, skill.id, targets);
    if (err) this.reportUnusable(err.reason);
    this.syncUiToGameState();
  }

  private render(): void {
    const s = this.game.state;
    const room = getRoom(s.floor, s.currentRoomId);
    this.header.content = joinLines([
      [
        boldColorChunk(room.name, PALETTE.title),
        plainChunk(`  Tầng ${s.floor.depth}  |  `),
        colorChunk(s.combat ? `Round ${s.combat.roundNumber}` : "Khám phá", PALETTE.dim),
      ],
    ]);

    this.battlefield.content = joinLines(this.renderBattlefield());

    const partyLines: TextChunk[][] = [];
    s.party.forEach((c, i) => {
      if (i > 0) partyLines.push([]);
      partyLines.push(...this.renderCharacterLines(c));
    });
    this.party.content = joinLines(partyLines);
    this.monsters.content = joinLines(this.renderMonsterLines());
    this.main.content = this.renderMain();

    // Combat.log is a fresh array per fight; fold every new line into logHistory,
    // which persists for the whole session so past battles stay visible (scroll to see them).
    const combatLog = s.combat?.log ?? null;
    if (combatLog !== this.observedCombatLog) {
      this.observedCombatLog = combatLog;
      this.lastLogLength = 0;
    }
    if (combatLog) {
      this.logHistory.push(...combatLog.slice(this.lastLogLength));
      this.lastLogLength = combatLog.length;
    }
    const displayLog = this.logHistory.slice(-LOG_HISTORY_SIZE);
    this.log.content = (displayLog.length > 0 ? displayLog : [s.message]).join("\n");

    this.footer.content = this.renderFooter();
  }

  private renderCharacterLines(c: Character): TextChunk[][] {
    const style = CLASS_STYLE[c.classId] ?? { abbr: "??", color: PALETTE.dim };
    if (!c.isAlive) {
      return [[chip(style.abbr, PALETTE.dead), plainChunk(` ${c.name} — Đã ngã xuống`)]];
    }

    const line1: TextChunk[] = [chip(style.abbr, style.color), plainChunk(` ${c.name} `), colorChunk(`Lv.${c.level}`, PALETTE.title)];
    const line2: TextChunk[] = [
      plainChunk("  "),
      colorChunk(`HP ${c.hp}/${c.maxHp}`, hpColorFor(c.hp, c.maxHp)),
      plainChunk(" "),
      colorChunk(`MP ${c.mp}/${c.maxMp}`, PALETTE.mp),
    ];

    const tier = getFearTier(c.survival.fear);
    const notes: TextChunk[] = [];
    if (tier >= 2) {
      notes.push(colorChunk(FEAR_TIER_LABEL[tier]!, fearColorFor(tier)));
    }
    if (c.survival.hunger <= 20) notes.push(colorChunk("Đói lả", PALETTE.hpLow));
    if (c.survival.thirst <= 20) notes.push(colorChunk("Khát khô", PALETTE.hpLow));
    for (const eff of c.activeStatusEffects) {
      notes.push(colorChunk(eff.statusEffectId, PALETTE.dim));
    }

    if (notes.length === 0) return [line1, line2];
    const line3: TextChunk[] = [plainChunk("  ")];
    notes.forEach((n, i) => {
      if (i > 0) line3.push(plainChunk(" · "));
      line3.push(n);
    });
    return [line1, line2, line3];
  }

  /** The 3 rows below a unit's sprite (spacer/label/status) — always exactly SLOT_WIDTH, never overflows. */
  private buildUnitMeta(label: string, labelColor: string, statusText: string, statusColor: string): TextChunk[][] {
    return [
      [plainChunk(" ".repeat(SLOT_WIDTH))],
      [colorChunk(centerText(label, SLOT_WIDTH), labelColor)],
      [colorChunk(centerText(statusText, SLOT_WIDTH), statusColor)],
    ];
  }

  /**
   * Builds 1 side (party or enemy row) of the battlefield from its units.
   * Sprites are composited (not just concatenated) so a sprite wider than
   * SLOT_WIDTH bleeds into its neighbors' slots instead of corrupting the
   * layout — see compositeSpriteRow. The label/status rows stay simple
   * side-by-side text, since they're always exactly SLOT_WIDTH.
   */
  private buildSideBlock(units: { sprite: Sprite; label: string; labelColor: string; statusText: string; statusColor: string }[]): TextChunk[][] {
    const spritePart = compositeSpriteRow(
      units.map((u) => u.sprite),
      SLOT_WIDTH,
      MAX_BOSS_HEIGHT,
      SLOT_GAP
    );
    const metaPart = mergeBlocksHorizontally(
      units.map((u) => this.buildUnitMeta(u.label, u.labelColor, u.statusText, u.statusColor)),
      SLOT_GAP
    );
    return [...spritePart, ...metaPart];
  }

  private buildEmptyEnemyBlock(message: string): TextChunk[][] {
    const blank = () => [plainChunk(" ".repeat(EMPTY_ENEMY_WIDTH))];
    const lines: TextChunk[][] = [];
    for (let i = 0; i < MAX_BOSS_HEIGHT; i++) lines.push(blank());
    lines.push(blank());
    lines.push(message ? [colorChunk(centerText(message, EMPTY_ENEMY_WIDTH), PALETTE.dim)] : blank());
    lines.push(blank());
    return lines;
  }

  private buildCampfireBlock(): TextChunk[][] {
    const lines = renderSpriteInSlot(CAMPFIRE_SPRITE, MAX_BOSS_HEIGHT, EMPTY_ENEMY_WIDTH);
    lines.push([plainChunk(" ".repeat(EMPTY_ENEMY_WIDTH))]);
    lines.push([colorChunk(centerText("Lửa trại ấm áp", EMPTY_ENEMY_WIDTH), PALETTE.dim)]);
    lines.push([plainChunk(" ".repeat(EMPTY_ENEMY_WIDTH))]);
    return lines;
  }

  /** Pixel-art frame (docs: 1 pixel = 1 cell, units <=10px tall, boss <=13px): party on the left, current room's monsters/boss on the right. */
  private renderBattlefield(): TextChunk[][] {
    const s = this.game.state;

    const partyUnits = s.party.map((c) => {
      const style = CLASS_STYLE[c.classId] ?? { abbr: "??", color: PALETTE.dim };
      if (!c.isAlive) return { sprite: TOMBSTONE_SPRITE, label: style.abbr, labelColor: PALETTE.dead, statusText: "Gục", statusColor: PALETTE.dead };
      const sprite = spriteForClass(c.classId);
      return { sprite, label: style.abbr, labelColor: style.color, statusText: `${c.hp}/${c.maxHp}`, statusColor: hpColorFor(c.hp, c.maxHp) };
    });
    const partyBlock = this.buildSideBlock(partyUnits);

    const room = getRoom(s.floor, s.currentRoomId);
    const isRestRoom = !s.combat && room.type === "rest";

    let enemyBlock: TextChunk[][];
    if (s.combat) {
      const monsterCombatants = s.combat.combatants.filter((c) => c.ref.kind === "monster");
      if (monsterCombatants.length === 0) {
        enemyBlock = this.buildEmptyEnemyBlock("Đã dọn sạch");
      } else {
        const enemyUnits = monsterCombatants.map((combatant) => {
          const m = getActorByRef(combatant.ref, this.game.ctx) as Monster;
          const style = monsterStyle(m);
          if (m.hp <= 0) return { sprite: TOMBSTONE_SPRITE, label: style.abbr, labelColor: PALETTE.dead, statusText: "Hạ gục", statusColor: PALETTE.dead };
          const sprite = spriteForMonster(m.archetypeId, m.tier);
          return { sprite, label: style.abbr, labelColor: style.color, statusText: `${m.hp}/${m.maxHp}`, statusColor: hpColorFor(m.hp, m.maxHp) };
        });
        enemyBlock = this.buildSideBlock(enemyUnits);
      }
    } else if (isRestRoom) {
      enemyBlock = this.buildCampfireBlock();
    } else {
      const message = room.type !== "combat" && room.type !== "boss" ? "" : room.cleared ? "An toàn" : "Chưa chạm trán";
      enemyBlock = this.buildEmptyEnemyBlock(message);
    }

    const divider: TextChunk[][] = [];
    for (let i = 0; i < UNIT_BLOCK_HEIGHT; i++) {
      divider.push(
        i === Math.floor(UNIT_BLOCK_HEIGHT / 2) && !isRestRoom
          ? [colorChunk(centerText("vs", DIVIDER_WIDTH), PALETTE.dim)]
          : [plainChunk(" ".repeat(DIVIDER_WIDTH))]
      );
    }

    return mergeBlocksHorizontally([partyBlock, divider, enemyBlock], SLOT_GAP);
  }

  private renderMonsterLines(): TextChunk[][] {
    const s = this.game.state;
    if (!s.combat) {
      const room = getRoom(s.floor, s.currentRoomId);
      if (room.type !== "combat" && room.type !== "boss") {
        return [[colorChunk("Không có quái vật.", PALETTE.dim)]];
      }
      return [[colorChunk(room.cleared ? "Phòng đã an toàn." : "Chưa chạm trán.", PALETTE.dim)]];
    }
    const lines: TextChunk[][] = [];
    for (const combatant of s.combat.combatants) {
      if (combatant.ref.kind !== "monster") continue;
      const m = getActorByRef(combatant.ref, this.game.ctx) as Monster;
      const style = monsterStyle(m);
      if (m.hp <= 0) {
        lines.push([chip(style.abbr, PALETTE.dead), plainChunk(` ${m.name} — hạ gục`)]);
        continue;
      }
      lines.push([
        chip(style.abbr, style.color),
        plainChunk(` ${m.name}`),
        plainChunk("\n   "),
        colorChunk(`HP ${m.hp}/${m.maxHp}`, hpColorFor(m.hp, m.maxHp)),
      ]);
    }
    return lines.length > 0 ? lines : [[colorChunk("Không còn quái vật.", PALETTE.dim)]];
  }

  private renderMain(): string | StyledText {
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
    if (this.ui.kind === "rest") {
      const room = getRoom(s.floor, s.currentRoomId);
      return [
        `Cả đội dừng chân tại ${room.name}, quây quần bên lửa trại.`,
        "",
        "  [1] Ăn uống — hồi 50% HP/MP tối đa.",
        "  [2] Trò chuyện — hồi 10% HP/MP tối đa, giảm 20 sợ hãi cho cả đội.",
        "  [3] Bỏ qua — tiếp tục lên đường ngay.",
      ].join("\n");
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
      const lines: TextChunk[][] = [[plainChunk(`Lượt của ${actor.name} — chọn kỹ năng:`)]];
      actor.unlockedSkillIds.map(getSkill).forEach((sk, i) => {
        const unusable = checkSkillUsable(actor, sk);
        const usesLeft = sk.usesPerCombat !== undefined ? actor.usesRemainingThisCombat[sk.id] ?? sk.usesPerCombat : null;
        const usesSuffix = usesLeft !== null ? `, còn ${usesLeft} lượt/trận` : "";
        // Raw damage before the target's defense is subtracted (see resolver.ts's damage
        // formula) — only shown for skills with a plain damage effect, skipped for the 2
        // dual-relation skills since their effect depends on which side the target is on.
        const dmgEffect = sk.effects?.find((e) => e.kind === "damage");
        const dmgSuffix = dmgEffect ? `, ~${Math.max(1, Math.round((dmgEffect.amount ?? 0) + actor.attack))} dmg` : "";
        const head = `  [${i + 1}] ${sk.name} (MP ${sk.mpCost}${usesSuffix}${dmgSuffix})`;
        if (unusable) {
          // The reason (cooldown/MP status) replaces the description here rather than
          // trailing after it — the main panel can be quite narrow, and the reason is
          // the more important thing to see when a skill can't be used right now.
          lines.push([colorChunk(`${head} — ${unusable.reason}`, PALETTE.disabled)]);
        } else {
          lines.push([plainChunk(`${head} — ${truncateText(sk.description, 34)}`)]);
        }
      });
      return joinLines(lines);
    }
    if (this.ui.kind === "pickTarget") {
      const lines = [`Chọn mục tiêu cho ${this.ui.skill.name}:`];
      const isDualRelation = this.ui.skill.target === "singleAllyOrEnemy";
      this.ui.candidates.forEach((ref, i) => {
        const target = getActorByRef(ref, this.game.ctx);
        const hpInfo = "hp" in target ? ` (${target.hp}/${target.maxHp} HP)` : "";
        const sidePrefix = isDualRelation ? (ref.kind === "character" ? "[Đồng đội] " : "[Địch] ") : "";
        lines.push(`  [${i + 1}] ${sidePrefix}${target.name}${hpInfo}`);
      });
      return lines.join("\n");
    }
    return "";
  }

  private renderFooter(): string {
    switch (this.ui.kind) {
      case "room":
        return "Nhấn số để di chuyển. q để thoát.";
      case "rest":
        return "Nhấn số để chọn hoạt động.";
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
