import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { BALANCE } from "../src/data/balanceConfig";
import { assertEventDataConsistent, EVENTS, getEvent } from "../src/data/events";
import { CAMP_REFLECTIONS } from "../src/data/loreExposure";
import { formatEffectLine } from "../src/ui/effectLine";
import { Game } from "../src/engine/game";
import { getRoom } from "../src/engine/dungeon";
import { answerLines } from "../src/ui/effectLine";
import { armEventExit } from "../src/engine/events/shared";
import { applyReflectionEffects, catalogRuleErrors, conditionHolds, effectAmount, resolveOutcome, shownOptions, stanceSpreadErrors } from "../src/engine/reflection";
import { resistedFearGain } from "../src/engine/survival";
import { clearSlot, gameFromSave, loadSave, saveRun } from "../src/engine/save";
import { SAVE_DIR } from "../src/engine/paths";
import type { EventDefinition, ReflectionEffect, ReflectionOption } from "../src/types";

const PARTY = ["knight", "mage", "rogue", "acolyte"];
const SLOT = "slot1";

afterEach(() => clearSlot(SLOT));

function eff(stat: ReflectionEffect["stat"], size: ReflectionEffect["size"], sign: 1 | -1, readFrom: string, target?: ReflectionEffect["target"]): ReflectionEffect {
  return { stat, size, sign, readFrom, ...(target ? { target } : {}) };
}

function opt(over: Partial<ReflectionOption> = {}): ReflectionOption {
  return { stance: "curious", text: "You wipe the dust off the lid.", outcomes: [{ effects: [eff("fear", "small", -1, "wipe the dust")] }], ...over };
}

const BASE: ReflectionOption[] = [
  { stance: "curious", text: "You pinch the dust and sniff it.", outcomes: [{ effects: [eff("faith", "small", 1, "pinch the dust"), eff("fear", "small", 1, "sniff it")] }] },
  { stance: "wary", text: "You step back from the stone.", outcomes: [{ effects: [eff("fear", "small", -1, "step back"), eff("faith", "small", -1, "the stone")] }] },
  { stance: "dismissive", text: "You walk on without looking.", outcomes: [{ effects: [eff("fear", "medium", -1, "without looking"), eff("mp", "small", -1, "walk on")] }] },
];

function forceEventRoom(game: Game, eventId: string) {
  const room = getRoom(game.state.floor, game.state.currentRoomId);
  room.type = "event";
  room.cleared = false;
  room.rolledEventId = eventId;
  return room;
}

function clearEventRoom(game: Game, eventId: string): void {
  forceEventRoom(game, eventId).cleared = true;
  game.state.eventOutcomes[eventId] = "resolved";
}

function withReflectionOf(options: ReflectionOption[]): EventDefinition {
  const merchant = EVENTS.find((e) => e.id === "merchant")!;
  return { ...merchant, reflection: { prompt: "A prompt.", options } };
}

function snapshot(game: Game) {
  const s = game.state;
  return { faith: s.faith, satiety: s.satiety, party: s.party.map((c) => [c.survival.fear, c.hp, c.mp]), stances: { ...s.eventReflectionStances } };
}

describe("reflection conditions", () => {
  test("religion condition: an option requiring a religion is shown only while a living member has it", () => {
    const options = [opt({ requires: [{ religionInParty: "plague-and-healing" }] }), opt({ text: "You wipe the lid." })];
    const without = new Game(1, PARTY);
    expect(shownOptions(without.state, options)).toHaveLength(1);

    const game = new Game(1, ["plague-doctor", "knight", "mage", "viking"]);
    expect(shownOptions(game.state, options)).toHaveLength(2);
    game.state.party[0]!.isAlive = false;
    expect(shownOptions(game.state, options)).toHaveLength(1);
  });

  test("history conditions: counters resolve through the events.* balance value, and the last gamble is read from state", () => {
    const state = new Game(1, PARTY).state;
    const counter = { counterAtLeast: { counter: "altarPaymentsCount" as const, threshold: "bloodDebtThreshold" } };
    state.narrativeCounters.altarPaymentsCount = BALANCE.events.bloodDebtThreshold - 1;
    expect(conditionHolds(state, counter)).toBe(false);
    state.narrativeCounters.altarPaymentsCount = BALANCE.events.bloodDebtThreshold;
    expect(conditionHolds(state, counter)).toBe(true);

    expect(conditionHolds(state, { lastGambleOutcome: "lost" })).toBe(false);
    state.lastGamblingDenOutcome = "lost";
    expect(conditionHolds(state, { lastGambleOutcome: "lost" })).toBe(true);
    expect(conditionHolds(state, { lastGambleOutcome: "won" })).toBe(false);
  });
});

describe("reflection outcomes", () => {
  const fiftyFifty = opt({
    outcomes: [
      { chance: 0.5, effects: [eff("fear", "small", -1, "wipe the dust")] },
      { chance: 0.5, effects: [eff("fear", "medium", 1, "wipe the dust")] },
    ],
  });

  test("roll is reproducible: the same seed picks the same branch, and both branches occur", () => {
    const seen = new Set<number>();
    for (let seed = 1; seed <= 40; seed++) {
      const a = new Game(seed, PARTY);
      const b = new Game(seed, PARTY);
      const first = resolveOutcome(a.state, a.ctx, fiftyFifty);
      expect(resolveOutcome(b.state, b.ctx, fiftyFifty)).toBe(first);
      seen.add(fiftyFifty.outcomes.indexOf(first));
    }
    expect(seen.size).toBe(2);
  });

  test("a certain outcome and a matching condition draw no rng", () => {
    const game = new Game(3, PARTY);
    const before = game.ctx.rng.getState();
    resolveOutcome(game.state, game.ctx, opt());
    const conditional = opt({
      outcomes: [
        { when: [{ lastGambleOutcome: "lost" }], effects: [eff("fear", "large", -1, "wipe the dust")] },
        { chance: 0.5, effects: [eff("fear", "small", -1, "wipe the dust")] },
        { chance: 0.5, effects: [eff("fear", "small", 1, "wipe the dust")] },
      ],
    });
    game.state.lastGamblingDenOutcome = "lost";
    expect(resolveOutcome(game.state, game.ctx, conditional)).toBe(conditional.outcomes[0]!);
    expect(game.ctx.rng.getState()).toBe(before);
    game.state.lastGamblingDenOutcome = "won";
    resolveOutcome(game.state, game.ctx, conditional);
    expect(game.ctx.rng.getState()).not.toBe(before);
  });
});

describe("applying reflection effects", () => {
  test("targets resolve: mostAfraid, mostHurt and a religion hit the right members, ties to the earliest slot", () => {
    const game = new Game(1, ["knight", "mage", "plague-doctor", "viking"]);
    const { party } = game.state;
    party.forEach((c) => (c.survival.fear = 20));
    party[1]!.survival.fear = 60;
    party[3]!.survival.fear = 60;
    applyReflectionEffects(game.state, [eff("fear", "small", -1, "x", "mostAfraid")]);
    expect(party.map((c) => c.survival.fear)).toEqual([20, 55, 20, 60]);

    party.forEach((c) => (c.hp = c.maxHp));
    party[2]!.hp = Math.floor(party[2]!.maxHp / 2);
    party[0]!.hp = Math.floor(party[0]!.maxHp / 2);
    const before = party.map((c) => c.hp);
    applyReflectionEffects(game.state, [eff("hp", "small", 1, "x", "mostHurt")]);
    expect(party[0]!.hp).toBeGreaterThan(before[0]!);
    expect(party.slice(1).map((c) => c.hp)).toEqual([party[1]!.maxHp, before[2]!, party[3]!.maxHp]);

    party.forEach((c) => (c.mp = c.maxMp));
    applyReflectionEffects(game.state, [eff("mp", "large", -1, "x", { religion: "plague-and-healing" })]);
    expect(party[2]!.mp).toBe(party[2]!.maxMp - effectAmount(eff("mp", "large", -1, "x"), party[2]));
    expect([party[0]!.mp, party[1]!.mp, party[3]!.mp]).toEqual([party[0]!.maxMp, party[1]!.maxMp, party[3]!.maxMp]);
  });

  test("reflection effects never kill: HP stops at 1, MP at 0, the dead are skipped", () => {
    const game = new Game(1, PARTY);
    const [first, second] = game.state.party;
    first!.hp = 2;
    first!.mp = 1;
    second!.isAlive = false;
    second!.hp = 0;
    applyReflectionEffects(game.state, [eff("hp", "large", -1, "x"), eff("mp", "large", -1, "x")]);
    expect(first!.hp).toBe(1);
    expect(first!.mp).toBe(0);
    expect(first!.isAlive).toBe(true);
    expect(second!.hp).toBe(0);
  });

  test("a Fear gain goes through the Faith factor and the member's own resistance; a relief is applied as declared", () => {
    const game = new Game(1, PARTY);
    const c = game.state.party[0]!;
    c.activeStatusEffects = [];
    c.survival.fear = 10;
    game.state.faith = 100;
    applyReflectionEffects(game.state, [eff("fear", "medium", 1, "x")]);
    expect(c.survival.fear).toBe(10 + resistedFearGain(c, 10, 100));
    c.survival.fear = 30;
    applyReflectionEffects(game.state, [eff("fear", "small", -1, "x")]);
    expect(c.survival.fear).toBe(25);
  });

  test("Faith and Satiety clamp, and a Satiety loss drains it", () => {
    const game = new Game(1, PARTY);
    game.state.faith = 99;
    game.state.satiety = 98;
    applyReflectionEffects(game.state, [eff("faith", "large", 1, "x"), eff("satiety", "large", 1, "x")]);
    expect(game.state.faith).toBe(100);
    expect(game.state.satiety).toBe(100);
    applyReflectionEffects(game.state, [eff("satiety", "small", -1, "x")]);
    expect(game.state.satiety).toBe(95);
  });
});

describe("the catalog rules", () => {
  test("catalog rules hold for every event, and the base fixture is clean", () => {
    expect(catalogRuleErrors(BASE)).toEqual([]);
    for (const event of EVENTS) {
      if (event.reflection) expect(catalogRuleErrors(event.reflection.options), event.id).toEqual([]);
    }
  });

  test("the loader throws on a list that breaks each rule in turn", () => {
    const cases: [RegExp, ReflectionOption[]][] = [
      [/rule 1/, [...BASE.slice(0, 2), { ...BASE[2]!, text: "You walk on." }]],
      [/rule 2/, [...BASE.slice(0, 2), opt({ stance: "dismissive", outcomes: [{ effects: [] }] })]],
      [/rule 2/, [...BASE.slice(0, 2), opt({ stance: "dismissive", outcomes: [{ effects: [eff("faith", "large", 1, "wipe the dust")] }] })]],
      [/rule 3/, [...BASE, opt({ text: "You wipe the dust slowly.", outcomes: [{ effects: [eff("fear", "large", -1, "wipe the dust")] }] })]],
      [/rule 4/, [...BASE.slice(0, 2), opt({ stance: "devout", requires: [{ religionInParty: "light-and-glory" }], outcomes: [{ effects: [eff("fear", "small", 1, "wipe the dust")] }] })]],
      [/rule 7/, [...BASE, opt({ text: "You share the bread you carry.", outcomes: [{ effects: [eff("satiety", "small", 1, "share the bread"), eff("fear", "small", 1, "the bread")] }] })]],
      [/rule 8/, [...BASE, { ...BASE[0]!, text: "You pinch the dust and smell it." }]],
    ];
    for (const [rule, options] of cases) {
      expect(catalogRuleErrors(options).join("\n")).toMatch(rule);
      expect(() => assertEventDataConsistent([withReflectionOf(options)])).toThrow(rule);
    }
  });

  test("an answer that leaving without a word beats fails rule 3", () => {
    const worse = opt({ text: "You break the lid.", outcomes: [{ effects: [eff("fear", "small", 1, "break the lid"), eff("faith", "small", -1, "break the lid")] }] });
    expect(catalogRuleErrors([...BASE, worse]).join("\n")).toMatch(/leaving without a word/);
  });

  test("a gamble is not beaten by a safe answer when its best case wins", () => {
    const gamble = opt({
      text: "You throw the dice once more.",
      outcomes: [
        { chance: 0.5, effects: [eff("fear", "small", -1, "throw the dice")] },
        { chance: 0.5, effects: [eff("fear", "medium", 1, "throw the dice")] },
      ],
    });
    const safe = opt({ text: "You pocket the dice quietly.", outcomes: [{ effects: [eff("fear", "small", -1, "pocket the dice")] }] });
    expect(catalogRuleErrors([...BASE, gamble, safe]).join("\n")).not.toContain('"You throw the dice');
  });

  test("loader rejects a condition naming an unknown religion, counter or threshold", () => {
    const withCondition = (requires: ReflectionOption["requires"]) => [...BASE, opt({ stance: "devout", text: "You raise a hand.", requires, outcomes: [{ effects: [eff("fear", "small", 1, "raise a hand")] }] })];
    expect(() => assertEventDataConsistent([withReflectionOf(withCondition([{ religionInParty: "nope" }]))])).toThrow(/religion/);
    expect(() => assertEventDataConsistent([withReflectionOf(withCondition([{ counterAtLeast: { counter: "nope" as never, threshold: "bloodDebtThreshold" } }]))])).toThrow(/counter/);
    expect(() => assertEventDataConsistent([withReflectionOf(withCondition([{ counterAtLeast: { counter: "altarPaymentsCount", threshold: "nope" } }]))])).toThrow(/threshold/);
  });

  test("no stance is tied to an effect: the shipped catalog passes and a lopsided one is flagged", () => {
    const eventAnswers = EVENTS.flatMap((e) => e.reflection?.options ?? []);
    const campAnswers = Object.values(CAMP_REFLECTIONS).flatMap((tier) => tier.options);
    expect(stanceSpreadErrors(eventAnswers)).toEqual([]);
    expect(stanceSpreadErrors(eventAnswers, campAnswers)).toEqual([]);

    const campFaith = (up: boolean, i: number) => opt({ text: `You wipe the dust ${i} times.`, outcomes: [{ effects: [eff("faith", "small", up ? 1 : -1, "wipe the dust")] }] });
    const lopsidedCamp = Array.from({ length: 10 }, (_, i) => campFaith(i < 7, i));
    expect(stanceSpreadErrors(eventAnswers, lopsidedCamp).join("\n")).toMatch(/7 of 10 camp answers raises Faith \(rule 6\)/);

    const curious = (up: boolean, i: number) => opt({ text: `You wipe the dust ${i} times.`, outcomes: [{ effects: [eff("faith", "small", up ? 1 : -1, "wipe the dust")] }] });
    const lopsided = Array.from({ length: 12 }, (_, i) => curious(i < 8, i));
    expect(stanceSpreadErrors(lopsided).join("\n")).toMatch(/8 of 12 curious answers raises Faith \(rule 6\)/);
    expect(stanceSpreadErrors(lopsided.filter((o) => o.outcomes[0]!.effects[0]!.sign === 1)).join("\n")).toMatch(/lowers Faith \(rule 5\)/);
  });
});

describe("the exit scene", () => {
  test("every event room ends on the exit scene", () => {
    const game = new Game(70, PARTY);
    forceEventRoom(game, "open-chest");
    expect(game.openChest()).toBeNull();
    expect(game.state.pendingEventExit).toEqual({ eventId: "open-chest", withReflection: false });

    let sawSkipped = false;
    for (let seed = 1; seed < 200 && !sawSkipped; seed++) {
      const g = new Game(seed, PARTY);
      g.state.eventReflectionStances["merchant"] = "curious";
      clearEventRoom(g, "merchant");
      armEventExit(g.state, g.ctx);
      expect(g.state.pendingEventExit?.eventId).toBe("merchant");
      sawSkipped = g.state.pendingEventExit!.withReflection === false;
    }
    expect(sawSkipped).toBe(true);
  });

  test("a journal scene that replaces the reflection is followed by the exit without one", () => {
    const game = new Game(1, PARTY, undefined, undefined, false, SLOT);
    game.state.combat = null;
    forceEventRoom(game, "old-count");
    game.state.journalHandledRoomId = null;
    expect(game.openChest()).toBeNull();
    if (game.state.pendingJournalFind) game.resolveJournalFind(true);
    expect(game.state.pendingJournal).not.toBeNull();
    expect(game.state.pendingEventExit).toEqual({ eventId: "old-count", withReflection: false });
  });

  test("journal replacing a reflection applies no effects", () => {
    const game = new Game(1, PARTY, undefined, undefined, false, SLOT);
    game.state.combat = null;
    forceEventRoom(game, "old-count");
    game.state.journalHandledRoomId = null;
    game.openChest();
    if (game.state.pendingJournalFind) game.resolveJournalFind(true);
    const before = snapshot(game);
    game.pickReflectionAnswer(0);
    expect(snapshot(game)).toEqual(before);
    expect(game.state.pendingEventExit?.withReflection).toBe(false);
  });

  test("leaving without a word changes nothing and the next visit still reflects", () => {
    const game = new Game(80, PARTY);
    clearEventRoom(game, "merchant");
    armEventExit(game.state, game.ctx);
    expect(game.state.pendingEventExit).toEqual({ eventId: "merchant", withReflection: true });
    const before = snapshot(game);
    game.leaveEventRoom();
    expect(game.state.pendingEventExit).toBeNull();
    expect(snapshot(game)).toEqual(before);
    expect(game.state.eventReflectionStances).toEqual({});

    clearEventRoom(game, "merchant");
    armEventExit(game.state, game.ctx);
    expect(game.state.pendingEventExit?.withReflection).toBe(true);
  });

  test("pickReflectionAnswer records the stance, applies the answer's effects and clears the exit", () => {
    const game = new Game(81, PARTY);
    clearEventRoom(game, "guardian-fight");
    armEventExit(game.state, game.ctx);
    game.state.faith = 50;
    const outcome = game.pickReflectionAnswer(2);
    expect(outcome).toBe(getEvent("guardian-fight").reflection!.options[2]!.outcomes[0]!);
    expect(game.state.eventReflectionStances["guardian-fight"]).toBe("dismissive");
    expect(game.state.faith).toBe(50 - BALANCE.reflection.effectSizes.faith.medium);
    expect(game.state.pendingEventExit).toBeNull();
  });

  test("an index past the shown answers does nothing", () => {
    const game = new Game(82, PARTY);
    clearEventRoom(game, "guardian-fight");
    armEventExit(game.state, game.ctx);
    const before = snapshot(game);
    game.pickReflectionAnswer(3);
    expect(game.state.pendingEventExit).toEqual({ eventId: "guardian-fight", withReflection: true });
    expect(snapshot(game)).toEqual(before);
  });
});

describe("the camp tiers", () => {
  test("catalog rules hold for every tier, and every answer's condition has a label", () => {
    for (const [tier, content] of Object.entries(CAMP_REFLECTIONS)) {
      expect(catalogRuleErrors(content.options), `tier ${tier}`).toEqual([]);
    }
    for (const answer of [...EVENTS.flatMap((e) => e.reflection?.options ?? []), ...Object.values(CAMP_REFLECTIONS).flatMap((tier) => tier.options)]) {
      expect(() => answerLines(new Game(1, PARTY).state, [answer]), answer.text).not.toThrow();
    }
  });
});

describe("the effect line", () => {
  const optionOf = (eventId: string, index: number) => getEvent(eventId).reflection!.options[index]!;

  test("effect line render: sizes as declared, a roll with its odds, a target in brackets", () => {
    const state = new Game(1, PARTY).state;
    expect(formatEffectLine(state, optionOf("merchant", 0).outcomes)).toBe("50%: Fear −5   ·   50%: Fear +10");
    expect(formatEffectLine(state, optionOf("guardian-fight", 1).outcomes)).toBe("Fear −5   ·   Faith −3");
    expect(formatEffectLine(state, optionOf("blood-altar", 1).outcomes)).toBe("HP +5% (most hurt)   ·   Faith −3");
    expect(formatEffectLine(state, optionOf("blood-altar", 0).outcomes)).toBe("50%: Fear −5, MP −5%   ·   50%: Fear +10, MP −5%");
    expect(formatEffectLine(state, optionOf("the-delay", 3).outcomes)).toBe("Fear −10 (most afraid)   ·   MP −5%");
    expect(formatEffectLine(state, Object.values(CAMP_REFLECTIONS)[2]!.options[3]!.outcomes)).toBe("HP +20% (most hurt)   ·   MP −10% (Plague and Healing)");
  });

  test("a conditional outcome replaces the plain one once its history holds", () => {
    const state = new Game(1, PARTY).state;
    const fury = optionOf("blood-altar", 3).outcomes;
    expect(formatEffectLine(state, fury)).toBe("Faith +6   ·   HP −5% (most hurt)");
    state.narrativeCounters.altarPaymentsCount = BALANCE.events.bloodDebtThreshold;
    expect(formatEffectLine(state, fury)).toBe("Faith +10   ·   HP −5% (most hurt)");
  });

  test("effect line shows fear before resistance: Fear +10 stays +10 at full Faith while the member takes less", () => {
    const game = new Game(1, PARTY);
    const merchantCurious = optionOf("merchant", 0);
    const gain = merchantCurious.outcomes[1]!;
    expect(formatEffectLine(game.state, [gain])).toBe("Fear +10");
    game.state.faith = 100;
    const c = game.state.party[0]!;
    c.activeStatusEffects = [];
    c.survival.fear = 0;
    expect(formatEffectLine(game.state, [gain])).toBe("Fear +10");
    applyReflectionEffects(game.state, gain.effects);
    expect(c.survival.fear).toBe(resistedFearGain(c, 10, 100));
    expect(c.survival.fear).toBe(5);
  });
});

describe("saves", () => {
  test("migration resolves a 1.2.1 pending reflection against the new list", () => {
    const game = new Game(7, PARTY);
    game.currentSaveSlot = SLOT;
    clearEventRoom(game, "guardian-fight");
    game.state.faith = 50;
    saveRun(game);
    const save = loadSave(SLOT);
    save.meta.saveVersion = "1.2.1";
    const old = save.state as unknown as Record<string, unknown>;
    delete old.pendingEventExit;
    old.pendingReflection = { eventId: "guardian-fight" };
    writeFileSync(join(SAVE_DIR, `${SLOT}.json`), JSON.stringify(save));

    const loaded = gameFromSave(loadSave(SLOT), SLOT);
    expect(loaded.state.pendingEventExit).toEqual({ eventId: "guardian-fight", withReflection: true });
    expect("pendingReflection" in loaded.state).toBe(false);
    const fearBefore = loaded.state.party.map((c) => c.survival.fear);
    loaded.pickReflectionAnswer(0);
    expect(loaded.state.eventReflectionStances["guardian-fight"]).toBe("curious");
    expect(loaded.state.faith).toBe(50 + BALANCE.reflection.effectSizes.faith.small);
    loaded.state.party.forEach((c, i) => expect(c.survival.fear).toBeGreaterThan(fearBefore[i]!));
  });
});
