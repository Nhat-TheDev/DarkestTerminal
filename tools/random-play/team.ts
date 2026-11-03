import type { App } from "../../src/ui/app";
import type { Game } from "../../src/engine/game";
import { getActorByRef, channelStatus, checkSkillUsable, isCommandSkill } from "../../src/engine/combat";
import { getRoom } from "../../src/engine/dungeon";
import { getArtifact } from "../../src/data/artifacts";
import { getStatusEffect } from "../../src/data/statusEffects";
import { BALANCE } from "../../src/data/balanceConfig";
import { CAMP_KIT_ITEM_ID } from "../../src/data/items";
import { combatInventoryEntries, skillEntries } from "../../src/ui/state";
import { ITEM_PAGE_SIZE } from "../../src/ui/pagination";
import type { Character, CombatantRef, Id, ItemDefinition, Monster, Room, SkillDefinition, SkillEffect } from "../../src/types";
import type { FooterInfo } from "./checks";
import { SATIETY_TARGET } from "./curve";

export type Role = "tank" | "healer" | "striker";

export interface Team {
  name: string;
  members: { classId: Id; role: Role }[];
}

export const TEAMS: Team[] = [
  { name: "Bulwark", members: [{ classId: "knight", role: "tank" }, { classId: "acolyte", role: "healer" }, { classId: "mage", role: "striker" }, { classId: "rogue", role: "striker" }] },
  { name: "Oath", members: [{ classId: "paladin", role: "tank" }, { classId: "plague-doctor", role: "healer" }, { classId: "archer", role: "striker" }, { classId: "warlock", role: "striker" }] },
  { name: "Conjurers", members: [{ classId: "viking", role: "tank" }, { classId: "acolyte", role: "healer" }, { classId: "summoner", role: "striker" }, { classId: "ninja", role: "striker" }] },
  { name: "Blight", members: [{ classId: "knight", role: "tank" }, { classId: "plague-doctor", role: "healer" }, { classId: "rogue", role: "striker" }, { classId: "warlock", role: "striker" }] },
  { name: "Tempo", members: [{ classId: "paladin", role: "tank" }, { classId: "jester", role: "striker" }, { classId: "mage", role: "striker" }, { classId: "archer", role: "striker" }] },
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
  return hitsAll(skill) ? power * enemyCount : power;
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

/** What `actor` does this round. Reads the game; the keypresses that carry it out are `TeamPolicy.chooseKey`'s. */
export function planTurn(game: Game, actor: Character, role: Role): TurnPlan {
  const party = game.state.party.filter((c) => c.isAlive);
  const enemyRefs = game.livingEnemyRefs();
  const enemies = enemyRefs.map((ref) => ({ ref, monster: getActorByRef(ref, game.ctx) as Monster }));
  const focus = enemies.reduce<(typeof enemies)[number] | null>((best, e) => (!best || e.monster.hp < best.monster.hp ? e : best), null)?.ref ?? null;
  const guardFight = getRoom(game.state.floor, game.state.currentRoomId).type === "boss";

  const known = skillEntries(actor);
  const usable = known.filter((s) => checkSkillUsable(actor, s) === null && !isCommandSkill(s));
  const healCosts = known.filter(isHeal).map((s) => s.mpCost);
  const healReserve = role === "healer" && healCosts.length > 0 ? Math.min(...healCosts) : 0;
  const lowMp = actor.mp < actor.maxMp * LOW_MP_SHARE;

  const heals = usable.filter(isHeal);
  const threshold = heals.length > 0 && role === "healer" ? HEALER_HP_SHARE : HURT_HP_SHARE;
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
    const heal = wounded.length >= 2 ? sweeping ?? single : single ?? sweeping;
    if (heal) return skillOn(heal, allyTarget(heal, wounded));
  }

  const affordable = usable.filter((s) => actor.mp - s.mpCost >= (isHeal(s) ? 0 : healReserve));
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

  if (!conserving && (role === "tank" || guardFight)) {
    const support = affordable.find(
      (s) => helpsAllies(s) && !isHeal(s) && !has(s.effects, "damage") && !actor.activeStatusEffects.some((a) => (s.effects ?? []).some((e) => e.statusEffectId === a.statusEffectId))
    );
    if (support) return skillOn(support, allyTarget(support, [...party].sort((a, b) => hpShare(a) - hpShare(b))));
  }

  const costliest = Math.max(0, ...usable.map((s) => s.mpCost));
  const attacks = affordable
    .filter((s) => hitsEnemies(s) || s.slot === 0)
    .filter((s) => !conserving || s.mpCost === 0)
    .filter((s) => guardFight || inDanger || s.mpCost === 0 || (!s.isUltimate && s.mpCost < costliest));
  const best = attacks.reduce<SkillDefinition | undefined>((top, s) => (!top || skillPower(s, actor, enemyRefs.length) > skillPower(top, actor, enemyRefs.length) ? s : top), undefined);
  const basic = known[0]!;
  const chosen = best ?? basic;
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

/** 1-based choice on the room screen. */
export function chooseRoom(game: Game): number {
  const choices = game.connectedRoomChoices();
  const order = partyNeedsRest(game) ? ROOM_ORDER_TIRED : ROOM_ORDER_RESTED;
  const rank = (room: Room) => (room.cleared ? order.length : order.indexOf(room.type));
  return choices.reduce((best, room, i) => (rank(room) < rank(choices[best]!) ? i : best), 0) + 1;
}

/** 1 eats, 2 talks. */
export function chooseRest(game: Game): "1" | "2" {
  if (game.state.satiety <= SATIETY_TARGET) return "1";
  return game.state.party.some((c) => c.isAlive && c.survival.fear >= FEAR_ACT_AT) ? "2" : "1";
}

/** Backs out of the screens only a stray key opens. */
const SIDE_SCREENS = new Set(["characterInfo", "fullLog", "saveMenu", "memory", "journal", "artifactMenu", "artifactDetail", "pickItemOutOfCombat"]);

export class TeamPolicy {
  itemsUsed = 0;
  starvedTurns = 0;
  private plan: { actorId: Id; turn: TurnPlan; counted: boolean } | null = null;
  private itemPage = 0;

  constructor(private readonly team: Team) {}

  private roleOf(actor: Character): Role {
    return this.team.members.find((m) => m.classId === actor.classId)?.role ?? "striker";
  }

  private turnFor(game: Game, actorRef: CombatantRef): TurnPlan {
    if (this.plan?.actorId === actorRef.id) return this.plan.turn;
    const actor = getActorByRef(actorRef, game.ctx) as Character;
    const turn = planTurn(game, actor, this.roleOf(actor));
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
