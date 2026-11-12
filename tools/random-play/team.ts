import type { App } from "../../src/ui/app";
import type { Game } from "../../src/engine/game";
import { getActorByRef, channelStatus, checkSkillUsable, coinFlipWinChance, isCommandSkill } from "../../src/engine/combat";
import { getRoom } from "../../src/engine/dungeon";
import { getArtifact } from "../../src/data/artifacts";
import { getStatusEffect } from "../../src/data/statusEffects";
import { BALANCE } from "../../src/data/balanceConfig";
import { CAMP_KIT_ITEM_ID } from "../../src/data/items";
import { getSummonArchetype, getSummonCast, getSummonSkill } from "../../src/data/summons";
import { combatInventoryEntries, skillEntries } from "../../src/ui/state";
import { ITEM_PAGE_SIZE } from "../../src/ui/pagination";
import type { Character, CombatantRef, Id, ItemDefinition, Monster, Room, SkillDefinition, SkillEffect, StatusEffectDefinition } from "../../src/types";
import type { FooterInfo } from "./checks";
import { SATIETY_TARGET } from "./curve";

export type Role = "tank" | "healer" | "striker";

export interface Team {
  name: string;
  /** A member does what each of its roles asks: a healer heals early and keeps MP for it, a tank opens with support. */
  members: { classId: Id; roles: Role[] }[];
}

export const TEAMS: Team[] = [
  { name: "Bulwark", members: [{ classId: "knight", roles: ["tank"] }, { classId: "acolyte", roles: ["healer"] }, { classId: "mage", roles: ["striker"] }, { classId: "rogue", roles: ["striker"] }] },
  { name: "Oath", members: [{ classId: "paladin", roles: ["tank"] }, { classId: "plague-doctor", roles: ["healer"] }, { classId: "archer", roles: ["striker"] }, { classId: "warlock", roles: ["striker"] }] },
  { name: "Conjurers", members: [{ classId: "viking", roles: ["tank"] }, { classId: "acolyte", roles: ["healer"] }, { classId: "summoner", roles: ["striker"] }, { classId: "ninja", roles: ["striker"] }] },
  { name: "Blight", members: [{ classId: "knight", roles: ["tank"] }, { classId: "plague-doctor", roles: ["healer"] }, { classId: "jester", roles: ["striker"] }, { classId: "warlock", roles: ["striker"] }] },
  { name: "Tempo", members: [{ classId: "paladin", roles: ["tank", "healer"] }, { classId: "summoner", roles: ["striker", "healer"] }, { classId: "mage", roles: ["striker"] }, { classId: "archer", roles: ["striker"] }] },
];

/** Below this share of max MP a character conserves: heals and fear relief only, or an item, or the free basic attack. */
export const LOW_MP_SHARE = 0.35;
export const HURT_HP_SHARE = 0.5;
/** A healer tops the party up earlier than anyone else heals. */
export const HEALER_HP_SHARE = 0.7;
const DANGER_HP_SHARE = 0.35;
const REST_HP_SHARE = 0.6;
/** Combat penalties start here, so the bot acts before reaching `FEAR_TARGET`. */
export const FEAR_ACT_AT = BALANCE.combat.fearTierThresholds[0]!;
/** What a status on an enemy is worth, as a share of the caster's offense, when ranking skills. */
const STATUS_VALUE = 0.4;

export type TurnPlan =
  | { kind: "skill"; skill: SkillDefinition; target: CombatantRef | null; starved: boolean }
  | { kind: "item"; item: ItemDefinition; target: CombatantRef | null };

const hpShare = (c: Character) => c.hp / Math.max(1, c.maxHp);
const refOf = (c: Character): CombatantRef => ({ kind: "character", id: c.id });
const has = (effects: SkillEffect[] | undefined, kind: SkillEffect["kind"]) => (effects ?? []).some((e) => e.kind === kind);

function relievesFear(effect: SkillEffect): boolean {
  if (effect.kind === "modifyStat") return effect.stat === "fear" && (effect.amount ?? 0) < 0;
  if (effect.kind !== "applyStatusEffect" || !effect.statusEffectId) return false;
  const status = getStatusEffect(effect.statusEffectId);
  return (status.fearResistPercent ?? 0) > 0 || status.perTurnEffects.some((e) => e.kind === "modifyStat" && e.stat === "fear" && (e.amount ?? 0) < 0);
}

const helpsAllies = (skill: SkillDefinition) => skill.target === "singleAlly" || skill.target === "allAllies" || skill.target === "allAlliesAndEnemies" || skill.target === "self";
const isHeal = (skill: SkillDefinition) => helpsAllies(skill) && has(skill.effects, "heal");
/** The minion a skill calls up, when that minion has a healing skill of its own. */
function healingMinionOf(skill: SkillDefinition): Id | null {
  for (const e of skill.effects ?? []) {
    if (e.kind !== "summon" || !e.summonCastId) continue;
    const archetype = getSummonArchetype(getSummonCast(e.summonCastId).archetypeId);
    if ((archetype.signatureSkillIds ?? []).some((id) => has(getSummonSkill(id).effects, "heal"))) return archetype.id;
  }
  return null;
}
const isFearRelief = (skill: SkillDefinition) => helpsAllies(skill) && (skill.effects ?? []).some(relievesFear);
const hitsEnemies = (skill: SkillDefinition) => skill.target === "singleEnemy" || skill.target === "allEnemies" || skill.target === "allAlliesAndEnemies";
const hitsAll = (skill: SkillDefinition) => skill.target === "allEnemies" || skill.target === "allAlliesAndEnemies";

/** Rough output of one cast, for ranking a character's own skills against each other. */
export function skillPower(skill: SkillDefinition, actor: Character, enemyCount: number): number {
  const offense = skill.isMagic ? actor.magicPower : actor.attack;
  let power = 0;
  for (const e of skill.effects ?? []) {
    if (e.kind === "damage") {
      const hits = e.hitCountRange ? (e.hitCountRange.min + e.hitCountRange.max) / 2 : 1;
      power += ((e.amount ?? 0) + (offense * (e.offenseMultiplierPercent ?? 100)) / 100) * hits;
    } else if (e.kind === "applyStatusEffect") {
      power += offense * STATUS_VALUE;
    }
  }
  const total = hitsAll(skill) ? power * enemyCount : power;
  return skill.coinFlip ? total * coinFlipWinChance(skill, actor) : total;
}

const raisesOffense = (e: StatusEffectDefinition["perTurnEffects"][number]) =>
  e.kind === "modifyCombatStat" && (e.combatStat === "attack" || e.combatStat === "magicPower") && (e.amount ?? 0) > 0;

/** An attack/magic buff for allies; a self buff (Poison Coat) is not timed, since its worth is often the rest of its kit. */
const buffsOffense = (skill: SkillDefinition) =>
  skill.target !== "self" &&
  (skill.effects ?? []).some((e) => e.kind === "applyStatusEffect" && !!e.statusEffectId && getStatusEffect(e.statusEffectId).perTurnEffects.some(raisesOffense));

/** The party member hitting hardest on its stronger stat: where a single-target attack/magic buff counts most. */
export function mainStriker(skill: SkillDefinition, actor: Character, party: Character[]): Character {
  const pool = party.filter((c) => !(skill.targetsOtherAlliesOnly && c.id === actor.id));
  const offense = (c: Character) => Math.max(c.attack, c.magicPower);
  return pool.reduce((top, c) => (offense(c) > offense(top) ? c : top), pool[0] ?? actor);
}

/**
 * Points of attack or magic a pure offense buff adds, summed over the allies it lands on, each ally counted on
 * its own stronger stat. Null for any skill that does anything else as well (fear relief, MP, an on-hit status),
 * since its worth is then more than the raw stat points.
 */
export function allyOffenseGain(skill: SkillDefinition, actor: Character, party: Character[]): number | null {
  const effects = skill.effects ?? [];
  const pure =
    effects.length > 0 &&
    effects.every((e) => {
      if (e.kind !== "applyStatusEffect" || !e.statusEffectId) return false;
      const status = getStatusEffect(e.statusEffectId);
      return !status.onHitStatusEffectId && status.perTurnEffects.length > 0 && status.perTurnEffects.every(raisesOffense);
    });
  if (!pure) return null;
  let gain = 0;
  for (const effect of effects) {
    const raises = getStatusEffect(effect.statusEffectId!).perTurnEffects;
    const targets = skill.target === "self" ? [actor] : party.filter((c) => !(effect.excludesCaster && c.id === actor.id));
    const gains = targets.map((ally) => {
      const stat = ally.attack >= ally.magicPower ? "attack" : "magicPower";
      const e = raises.find((r) => r.combatStat === stat);
      return e ? Math.max(effect.amount ?? e.amount ?? 0, (ally[stat] * (effect.minPercent ?? e.minPercent ?? 0)) / 100) : 0;
    });
    gain += skill.target === "singleAlly" ? Math.max(0, ...gains) : gains.reduce((x, y) => x + y, 0);
  }
  return gain;
}

function itemWith(game: Game, matches: (item: ItemDefinition) => boolean): ItemDefinition | undefined {
  return combatInventoryEntries(game.state.inventory).map((e) => e.item).find(matches);
}

/** The strongest potion the wound can use in full, or else the weakest one held. */
function healingPotion(game: Game, actor: Character): ItemDefinition | undefined {
  const amount = (item: ItemDefinition) => item.effects.find((e) => e.kind === "heal")?.amount ?? 0;
  const potions = combatInventoryEntries(game.state.inventory)
    .map((e) => e.item)
    .filter((item) => item.target === "self" && has(item.effects, "heal"))
    .sort((a, b) => amount(a) - amount(b));
  return potions.filter((item) => amount(item) <= actor.maxHp - actor.hp).pop() ?? potions[0];
}

function chooseCombatItem(game: Game, actor: Character, party: Character[], enemyCount: number, focus: CombatantRef | null, guardFight: boolean): TurnPlan | null {
  const plan = (item: ItemDefinition | undefined, target: CombatantRef | null): TurnPlan | null => (item ? { kind: "item", item, target } : null);
  const self = refOf(actor);
  const tonicHelps = party.filter((c) => hpShare(c) < HURT_HP_SHARE).length >= 2;
  return (
    (tonicHelps ? plan(itemWith(game, (i) => i.target === "allAllies" && has(i.effects, "heal")), null) : null) ??
    (hpShare(actor) < HURT_HP_SHARE ? plan(healingPotion(game, actor), self) : null) ??
    (actor.survival.fear >= FEAR_ACT_AT ? plan(itemWith(game, (i) => i.effects.some(relievesFear)), self) : null) ??
    (guardFight ? plan(itemWith(game, (i) => has(i.effects, "restoreMp")), self) : null) ??
    (enemyCount >= 2 ? plan(itemWith(game, (i) => i.target === "allEnemies" && has(i.effects, "damage")), null) : null) ??
    plan(itemWith(game, (i) => i.target === "singleEnemy" && has(i.effects, "damage")), focus)
  );
}

/** A caster buffs attack or magic at most once in this many rounds, on top of the skill's cooldown. */
export const BUFF_GAP_ROUNDS = 3;
/** The guard is open when debuffs have cut at least this share of its defense: buffs are worth most then. */
export const OPENING_DEFENSE_CUT = 0.1;
/** Inside an opening, a pure attack/magic buff only has to add this share of the caster's own attack. */
const OPENING_BUFF_BAR = 0.5;

/** What one fight remembers between turns: the round each member last cast an attack/magic buff. */
export interface FightMemory {
  lastBuffRound: Map<Id, number>;
}

export const newFightMemory = (): FightMemory => ({ lastBuffRound: new Map() });

/** Share of a monster's defense its statuses are holding down right now. */
export function defenseCut(monster: Monster): number {
  const cut = monster.activeStatusEffects.reduce((sum, s) => sum + Math.max(0, -(s.appliedAmounts?.defense ?? 0)), 0);
  const base = monster.defense + cut;
  return base > 0 ? cut / base : 0;
}

/** What `actor` does this round. Reads the game; the keypresses that carry it out are `TeamPolicy.chooseKey`'s. */
export function planTurn(game: Game, actor: Character, roles: Role[], memory: FightMemory = newFightMemory()): TurnPlan {
  const party = game.state.party.filter((c) => c.isAlive);
  const enemyRefs = game.livingEnemyRefs();
  const enemies = enemyRefs.map((ref) => ({ ref, monster: getActorByRef(ref, game.ctx) as Monster }));
  const focus = enemies.reduce<(typeof enemies)[number] | null>((best, e) => (!best || e.monster.hp < best.monster.hp ? e : best), null)?.ref ?? null;
  const guardFight = getRoom(game.state.floor, game.state.currentRoomId).type === "boss";

  const known = skillEntries(actor);
  const usable = known.filter((s) => checkSkillUsable(actor, s) === null && !isCommandSkill(s));
  const healer = roles.includes("healer");
  // A healer counts calling up a healing minion as a heal, while that minion is not already on the field.
  const minionHeals = (skills: SkillDefinition[]) =>
    healer
      ? skills.filter((s) => {
          const minion = healingMinionOf(s);
          return minion !== null && !game.ctx.summons.some((m) => m.ownerId === actor.id && m.archetypeId === minion && m.hp > 0);
        })
      : [];
  const healsFor = (skills: SkillDefinition[]) => [...skills.filter(isHeal), ...minionHeals(skills)];
  const healCosts = healsFor(known).map((s) => s.mpCost);
  const healReserve = healer && healCosts.length > 0 ? Math.min(...healCosts) : 0;
  const lowMp = actor.mp < actor.maxMp * LOW_MP_SHARE;

  const heals = healsFor(usable);
  const threshold = heals.length > 0 && healer ? HEALER_HP_SHARE : HURT_HP_SHARE;
  const wounded = [...party].sort((a, b) => hpShare(a) - hpShare(b)).filter((c) => hpShare(c) < threshold);
  const skillOn = (skill: SkillDefinition, target: CombatantRef | null): TurnPlan => ({ kind: "skill", skill, target, starved: false });
  const allyTarget = (skill: SkillDefinition, ordered: Character[]): CombatantRef | null => {
    if (skill.target !== "singleAlly") return null;
    return refOf(ordered.find((c) => !(skill.targetsOtherAlliesOnly && c.id === actor.id)) ?? actor);
  };

  if (lowMp) {
    const item = chooseCombatItem(game, actor, party, enemyRefs.length, focus, guardFight);
    if (item && (hpShare(actor) < HURT_HP_SHARE || heals.length === 0 || wounded.length === 0)) return item;
  }

  if (wounded.length > 0) {
    const sweeping = heals.find((s) => s.target === "allAllies" || s.target === "allAlliesAndEnemies");
    const single = heals.find((s) => s.target === "singleAlly" || (s.target === "self" && wounded.includes(actor)));
    const heal = (wounded.length >= 2 ? sweeping ?? single : single ?? sweeping) ?? heals.find((s) => healingMinionOf(s) !== null);
    if (heal) return skillOn(heal, allyTarget(heal, wounded));
  }

  const affordable = usable.filter((s) => actor.mp - s.mpCost >= (heals.includes(s) ? 0 : healReserve));
  const frightened = [...party].sort((a, b) => b.survival.fear - a.survival.fear).filter((c) => c.survival.fear >= FEAR_ACT_AT);
  if (frightened.length > 0) {
    const relief = affordable.find(isFearRelief);
    if (relief) return skillOn(relief, allyTarget(relief, frightened));
  }

  if (!lowMp || guardFight) {
    const item = hpShare(actor) < HURT_HP_SHARE ? healingPotion(game, actor) : undefined;
    if (item && heals.length === 0) return { kind: "item", item, target: refOf(actor) };
  }

  const conserving = lowMp && !guardFight;
  const inDanger = party.some((c) => hpShare(c) < DANGER_HP_SHARE) || party.length < game.state.party.length;

  const costliest = Math.max(0, ...usable.map((s) => s.mpCost));
  const attacks = affordable
    .filter((s) => hitsEnemies(s) || s.slot === 0)
    .filter((s) => !conserving || s.mpCost === 0)
    .filter((s) => guardFight || inDanger || s.mpCost === 0 || (!s.isUltimate && s.mpCost < costliest));
  const best = attacks.reduce<SkillDefinition | undefined>((top, s) => (!top || skillPower(s, actor, enemyRefs.length) > skillPower(top, actor, enemyRefs.length) ? s : top), undefined);
  const basic = known[0]!;
  const chosen = best ?? basic;

  if (!conserving && (roles.includes("tank") || guardFight)) {
    // An attack/magic buff is worth a turn only when it adds more than the caster's own attack would; it is
    // judged on its gain, since a buff that skips the caster never shows on the caster as already active.
    const ownAttack = skillPower(chosen, actor, enemyRefs.length);
    const weakestFirst = [...party].sort((a, b) => hpShare(a) - hpShare(b));
    // A single-target attack/magic buff goes on the main striker; any other single-target support on the weakest.
    const singleTarget = (s: SkillDefinition) => (buffsOffense(s) ? mainStriker(s, actor, party) : weakestFirst.find((c) => !(s.targetsOtherAlliesOnly && c.id === actor.id)) ?? actor);
    const receivers = (s: SkillDefinition, e: SkillEffect) =>
      s.target === "self" ? [actor] : s.target === "singleAlly" ? [singleTarget(s)] : party.filter((c) => !(e.excludesCaster && c.id === actor.id));
    const alreadyOn = (s: SkillDefinition) =>
      (s.effects ?? []).every(
        (e) => e.kind !== "applyStatusEffect" || receivers(s, e).every((c) => c.activeStatusEffects.some((a) => a.statusEffectId === e.statusEffectId))
      );
    const round = game.state.combat?.roundNumber ?? 0;
    const lastBuff = memory.lastBuffRound.get(actor.id);
    const gapPassed = lastBuff === undefined || round - lastBuff >= BUFF_GAP_ROUNDS;
    // Without an opening a buff still goes out now and then, counting from the start of the fight.
    const longWait = round - (lastBuff ?? 0) >= 2 * BUFF_GAP_ROUNDS;
    const guard = enemies.reduce<Monster | null>((top, e) => (!top || e.monster.maxHp > top.maxHp ? e.monster : top), null);
    const opening = guard !== null && defenseCut(guard) >= OPENING_DEFENSE_CUT;
    const buffed = (s: SkillDefinition, target: Character | null): TurnPlan => {
      memory.lastBuffRound.set(actor.id, round);
      return skillOn(s, target ? refOf(target) : null);
    };

    // MP for an ally is worth most to a hitter running dry: the hardest of them gets it, opening or not.
    const restoresAllyMp = (s: SkillDefinition) => s.target === "singleAlly" && has(s.effects, "restoreMp");
    const dry = party.filter((c) => c.mp < c.maxMp * LOW_MP_SHARE);
    const refill = gapPassed ? affordable.find(restoresAllyMp) : undefined;
    if (refill) {
      const pool = dry.filter((c) => !(refill.targetsOtherAlliesOnly && c.id === actor.id));
      if (pool.length > 0) return buffed(refill, mainStriker(refill, actor, pool));
    }

    const support = affordable.find((s) => {
      if (!helpsAllies(s) || isHeal(s) || has(s.effects, "damage")) return false;
      if (buffsOffense(s)) {
        if (!gapPassed || !(opening || longWait)) return false;
        const gain = allyOffenseGain(s, actor, party);
        if (gain !== null) return gain > ownAttack * (opening ? OPENING_BUFF_BAR : 1);
      }
      return !alreadyOn(s);
    });
    if (support) {
      const target = support.target === "singleAlly" ? singleTarget(support) : null;
      return buffsOffense(support) ? buffed(support, target) : skillOn(support, target ? refOf(target) : null);
    }
  }

  return { kind: "skill", skill: chosen, target: chosen.target === "singleEnemy" ? focus : null, starved: lowMp && chosen.mpCost === 0 };
}

function partyNeedsRest(game: Game): boolean {
  const party = game.state.party.filter((c) => c.isAlive);
  const totalMp = party.reduce((sum, c) => sum + c.mp, 0);
  const totalMaxMp = party.reduce((sum, c) => sum + c.maxMp, 0);
  return (
    game.state.satiety <= SATIETY_TARGET ||
    party.some((c) => c.survival.fear >= FEAR_ACT_AT || hpShare(c) < REST_HP_SHARE) ||
    totalMp < totalMaxMp * LOW_MP_SHARE
  );
}

const ROOM_ORDER_RESTED: Room["type"][] = ["combat", "event", "rest", "boss"];
const ROOM_ORDER_TIRED: Room["type"][] = ["rest", "event", "combat", "boss"];

/** 1-based choice on the room screen. An unknown room is ranked by what the player sees, after every known type. */
export function chooseRoom(game: Game): number {
  const choices = game.connectedRoomChoices();
  const order = partyNeedsRest(game) ? ROOM_ORDER_TIRED : ROOM_ORDER_RESTED;
  const rank = (room: Room) => (room.cleared ? order.length + 1 : room.hidden ? order.length : order.indexOf(room.type));
  return choices.reduce((best, room, i) => (rank(room) < rank(choices[best]!) ? i : best), 0) + 1;
}

/** 1 eats, 2 talks. */
export function chooseRest(game: Game): "1" | "2" {
  if (game.state.satiety <= SATIETY_TARGET) return "1";
  return game.state.party.some((c) => c.isAlive && c.survival.fear >= FEAR_ACT_AT) ? "2" : "1";
}

/** Backs out of the screens only a stray key opens. */
const SIDE_SCREENS = new Set(["characterInfo", "fullLog", "saveMenu", "memory", "journal", "artifactMenu", "artifactDetail", "pickItemOutOfCombat", "floorMap", "monsterInfo", "bestiary"]);

export class TeamPolicy {
  itemsUsed = 0;
  starvedTurns = 0;
  private plan: { actorId: Id; turn: TurnPlan; counted: boolean } | null = null;
  private memory = newFightMemory();
  private memoryCombat: unknown = null;
  private itemPage = 0;

  constructor(private readonly team: Team) {}

  private rolesOf(actor: Character): Role[] {
    return this.team.members.find((m) => m.classId === actor.classId)?.roles ?? ["striker"];
  }

  private turnFor(game: Game, actorRef: CombatantRef): TurnPlan {
    if (this.plan?.actorId === actorRef.id) return this.plan.turn;
    const actor = getActorByRef(actorRef, game.ctx) as Character;
    if (game.state.combat !== this.memoryCombat) {
      this.memoryCombat = game.state.combat;
      this.memory = newFightMemory();
    }
    const turn = planTurn(game, actor, this.rolesOf(actor), this.memory);
    this.plan = { actorId: actorRef.id, turn, counted: false };
    this.itemPage = 0;
    return turn;
  }

  /** Called on the keypress that queues the turn, so a turn replanned or abandoned on the way is not counted. */
  private countTurn(): void {
    if (!this.plan || this.plan.counted) return;
    this.plan.counted = true;
    if (this.plan.turn.kind === "item") this.itemsUsed++;
    else if (this.plan.turn.starved) this.starvedTurns++;
  }

  /** The key this team would press now, or null when the screen has no decision to make. */
  chooseKey(app: App, footer: FooterInfo): string | null {
    const ui = app.debugUiState;
    const game = app.debugGame;
    const s = game.state;
    if (SIDE_SCREENS.has(ui.kind)) return "ESCAPE";
    switch (ui.kind) {
      case "room":
        return String(chooseRoom(game));
      case "rest":
        return chooseRest(game);
      case "campPrompt":
        return s.satiety <= SATIETY_TARGET && (s.inventory[CAMP_KIT_ITEM_ID] ?? 0) > 0 ? "1" : "RETURN";
      case "pickAction": {
        if (channelStatus(getActorByRef(ui.actorRef, game.ctx))) return "1";
        this.plan = null;
        return this.turnFor(game, ui.actorRef).kind === "skill" ? "1" : "2";
      }
      case "pickSkill": {
        const turn = this.turnFor(game, ui.actorRef);
        if (turn.kind !== "skill") return "ESCAPE";
        const index = skillEntries(getActorByRef(ui.actorRef, game.ctx) as Character).findIndex((sk) => sk.id === turn.skill.id);
        return String(Math.max(0, index) + 1);
      }
      case "skillDetail":
        if (!this.turnFor(game, ui.actorRef).target) this.countTurn();
        return "RETURN";
      case "pickItemInCombat": {
        const turn = this.turnFor(game, ui.actorRef);
        if (turn.kind !== "item") return "ESCAPE";
        const index = combatInventoryEntries(s.inventory).findIndex((e) => e.item.id === turn.item.id);
        if (index < 0) return "ESCAPE";
        const page = Math.floor(index / ITEM_PAGE_SIZE);
        if (page !== this.itemPage) {
          const forward = page > this.itemPage;
          this.itemPage += forward ? 1 : -1;
          return forward ? "ARROW_RIGHT" : "ARROW_LEFT";
        }
        return String((index % ITEM_PAGE_SIZE) + 1);
      }
      case "itemDetail":
        if (ui.origin.kind !== "combat") return "ESCAPE";
        if (!this.turnFor(game, ui.origin.actorRef).target) this.countTurn();
        return "1";
      case "pickTarget": {
        const target = this.turnFor(game, ui.actorRef).target;
        const index = target ? ui.candidates.findIndex((c) => c.kind === target.kind && c.id === target.id) : 0;
        this.countTurn();
        return String(Math.max(0, index) + 1);
      }
      case "roomReward":
        return ui.viewing ? "1" : "RETURN";
      case "artifactDecision": {
        const pending = s.pendingArtifactDecision;
        return pending && !pending.forceEquip && getArtifact(pending.artifactId).isCursed ? "2" : "1";
      }
      case "artifactDecisionPickCharacter": {
        const counts = s.party.map((c) => (c.isAlive ? c.equippedArtifactIds.length : Number.POSITIVE_INFINITY));
        return String(counts.indexOf(Math.min(...counts)) + 1);
      }
      case "eventArtifactShop":
        return ui.viewingOfferIndex !== null ? "2" : "ESCAPE";
      case "eventCursedOffer":
      case "eventHpGamble":
      case "eventFortuneExchange":
        return "2";
      case "eventCoinGamble":
        return s.activeEvent?.gambleState ? "1" : "2";
      case "eventArtifactSacrifice":
        return String(Math.max(...footer.digits));
      case "eventCombatReward":
        return partyNeedsRest(game) ? "2" : "1";
      default:
        return null;
    }
  }
}
