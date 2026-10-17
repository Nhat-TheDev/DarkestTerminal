import { describe, expect, test } from "bun:test";
import { FEAR_BEAT_TICKS, HIT_BEAT_TICKS, IMPACT_TICKS, RevealQueue, SESSION_MIN_TICKS, SUMMON_BEAT_TICKS } from "../src/ui/revealQueue";
import type { LogEntry, LogSession } from "../src/types";

function session(id: number): LogSession {
  return { id, actorId: "a", attackedIds: [], debuffedIds: [], buffedIds: [], healedIds: [], missedIds: [], lifestealIds: [], tickDamageIds: [], buffLostIds: [], lostTurnIds: [], summonIds: [], affectedIds: [], fearChangedIds: [], debuffLandedIds: [], dotLandedIds: [], immuneIds: [] };
}
function entries(prefix: string, count: number, s?: LogSession): LogEntry[] {
  return Array.from({ length: count }, (_, i) => ({ text: `${prefix}${i}`, kind: "info" as const, session: s }));
}
/** Runs ticks until the queue is idle; returns, per tick, what became visible and which session was lit. */
function drain(queue: RevealQueue, maxTicks = 500) {
  const steps: { texts: string[]; focus: number | null; holding: boolean }[] = [];
  let guard = 0;
  while (queue.active && guard++ < maxTicks) {
    const shown = queue.tick();
    steps.push({ texts: shown.map((e) => e.text), focus: queue.focus?.id ?? null, holding: queue.holding });
  }
  return steps;
}

describe("RevealQueue", () => {
  test("a summon's beat comes SUMMON_BEAT_TICKS after the impact and inside the session's minimum hold", () => {
    const q = new RevealQueue();
    q.enqueue(entries("a", 2, session(1)));
    const beat: boolean[] = [];
    while (q.active) {
      q.tick();
      beat.push(q.summonBeat);
    }
    const first = beat.indexOf(true);
    expect(first).toBe(IMPACT_TICKS + SUMMON_BEAT_TICKS);
    expect(first).toBeLessThan(SESSION_MIN_TICKS);
    expect(beat.slice(0, first).every((b) => !b)).toBe(true);
  });

  test("a session where fear rose shows it once its usual hold has run, then holds FEAR_BEAT_TICKS longer", () => {
    const q = new RevealQueue();
    q.enqueue(entries("a", 2, { ...session(1), fearChangedIds: ["p1"] }));
    const beat: boolean[] = [];
    while (q.active) {
      q.tick();
      if (q.focus) beat.push(q.fearBeat);
    }
    expect(beat.indexOf(true)).toBe(SESSION_MIN_TICKS);
    expect(beat.length).toBe(SESSION_MIN_TICKS + FEAR_BEAT_TICKS);
  });

  test("end-of-round fear shows at the impact and ends FEAR_BEAT_TICKS later", () => {
    const q = new RevealQueue();
    q.enqueue(entries("f", 1, { ...session(1), actorId: null, cause: "fear", fearChangedIds: ["p1"] }));
    const beat: boolean[] = [];
    while (q.active) {
      q.tick();
      if (q.focus) beat.push(q.fearBeat);
    }
    expect(beat.indexOf(true)).toBe(IMPACT_TICKS);
    expect(beat.length).toBe(IMPACT_TICKS + FEAR_BEAT_TICKS);
  });

  test("a session with no fear gain never reaches a fear beat and keeps its usual span", () => {
    const q = new RevealQueue();
    q.enqueue(entries("a", 2, session(1)));
    let ticks = 0;
    while (q.active) {
      q.tick();
      if (q.focus) ticks++;
      expect(q.fearBeat).toBe(false);
    }
    expect(ticks).toBe(SESSION_MIN_TICKS);
  });

  test("lines with no session never beat", () => {
    const q = new RevealQueue();
    q.enqueue(entries("p", 3));
    while (q.active) {
      q.tick();
      expect(q.summonBeat).toBe(false);
    }
  });

  test("the first line of a session appears on the first tick, in the same step as its highlight", () => {
    const q = new RevealQueue();
    q.enqueue(entries("a", 3, session(1)));
    const [first] = drain(q);
    expect(first).toMatchObject({ texts: ["a0"], focus: 1 });
  });

  test("after the first line a session waits for its impact (0.5 s), then shows the rest 1 tick (0.1 s) apart", () => {
    const q = new RevealQueue();
    q.enqueue(entries("a", 3, session(1)));
    const steps = drain(q);
    expect(steps.slice(0, IMPACT_TICKS + 2).map((s) => s.texts)).toEqual([["a0"], [], [], [], [], ["a1"], ["a2"]]);
  });

  test("the session holds back its changes until the impact tick, then lets them through", () => {
    const q = new RevealQueue();
    q.enqueue(entries("a", 1, session(1)));
    const steps = drain(q);
    expect(steps.slice(0, IMPACT_TICKS + 1).map((s) => s.holding)).toEqual([true, true, true, true, true, false]);
    expect(steps.at(-1)!.holding).toBe(false);
  });

  test("lines with no session never hold", () => {
    const q = new RevealQueue();
    q.enqueue(entries("n", 2));
    expect(drain(q).every((s) => !s.holding)).toBe(true);
  });

  test("a session holds for 15 ticks (1.5 s) before the next one starts", () => {
    const q = new RevealQueue();
    q.enqueue([...entries("a", 2, session(1)), ...entries("b", 1, session(2))]);
    const steps = drain(q);
    const indexOfB = steps.findIndex((s) => s.texts.includes("b0"));
    expect(indexOfB).toBe(SESSION_MIN_TICKS); // tick 16 (index 15): 1.5 s after a0
    expect(steps[indexOfB]!.focus).toBe(2);
    expect(steps[indexOfB - 1]!.focus).toBe(1); // highlight of session 1 still on until then
  });

  test("the highlight ends in the tick after the hold, not before", () => {
    const q = new RevealQueue();
    q.enqueue(entries("a", 1, session(1)));
    const steps = drain(q);
    expect(steps).toHaveLength(SESSION_MIN_TICKS + 1);
    expect(steps[SESSION_MIN_TICKS - 1]!.focus).toBe(1);
    expect(steps[SESSION_MIN_TICKS]!.focus).toBeNull();
    expect(q.active).toBe(false);
  });

  test("a session too long for 1.5 s lasts until its last line and loses nothing", () => {
    const q = new RevealQueue();
    q.enqueue([...entries("a", 20, session(1)), ...entries("b", 1, session(2))]);
    const steps = drain(q);
    expect(steps.flatMap((s) => s.texts).filter((t) => t.startsWith("a"))).toHaveLength(20);
    expect(steps.findIndex((s) => s.texts.includes("a19"))).toBe(IMPACT_TICKS + 18);
    expect(steps.findIndex((s) => s.texts.includes("b0"))).toBe(IMPACT_TICKS + 19);
  });

  test("entries without a session reveal at 0.1 s per line, with no highlight and no hold", () => {
    const q = new RevealQueue();
    q.enqueue(entries("n", 3));
    const steps = drain(q);
    expect(steps).toEqual([
      { texts: ["n0"], focus: null, holding: false },
      { texts: ["n1"], focus: null, holding: false },
      { texts: ["n2"], focus: null, holding: false },
    ]);
    expect(q.active).toBe(false);
  });

  test("a session followed by plain lines: the plain lines start after the hold, unhighlighted", () => {
    const q = new RevealQueue();
    q.enqueue([...entries("a", 1, session(1)), ...entries("n", 1)]);
    const steps = drain(q);
    const i = steps.findIndex((s) => s.texts.includes("n0"));
    expect(i).toBe(SESSION_MIN_TICKS);
    expect(steps[i]!.focus).toBeNull();
  });

  test("consecutive entries sharing a session id are one session even if the objects differ (save round trip)", () => {
    const q = new RevealQueue();
    q.enqueue([...entries("a", 1, session(1)), ...entries("b", 1, session(1))]);
    const steps = drain(q);
    expect(steps.slice(0, 2).map((s) => s.focus)).toEqual([1, 1]);
    expect(steps.findIndex((s) => s.texts.includes("b0"))).toBe(IMPACT_TICKS);
  });

  test("flush hands back every unrevealed line in order and leaves the queue idle with no highlight", () => {
    const q = new RevealQueue();
    q.enqueue([...entries("a", 3, session(1)), ...entries("b", 2, session(2))]);
    expect(q.tick().map((e) => e.text)).toEqual(["a0"]);
    expect(q.flush().map((e) => e.text)).toEqual(["a1", "a2", "b0", "b1"]);
    expect(q.active).toBe(false);
    expect(q.focus).toBeNull();
    expect(q.tick()).toEqual([]);
  });

  test("lines enqueued while a reveal is running join the end of the queue", () => {
    const q = new RevealQueue();
    q.enqueue(entries("a", 1, session(1)));
    q.tick();
    q.enqueue(entries("n", 1));
    const steps = drain(q);
    expect(steps.findIndex((s) => s.texts.includes("n0"))).toBeGreaterThan(0);
  });
});

/** One damage line per amount, each a direct hit on `targetId`. */
function hitEntries(s: LogSession, targetId: string, amounts: number[]): LogEntry[] {
  return amounts.map((amount, i) => ({ text: `hit${i}`, kind: "attack" as const, session: s, hit: { targetId, amount } }));
}

describe("RevealQueue hit beats", () => {
  /** Per tick of the lit session: the step, in the order the ticks ran. */
  function stepsOf(q: RevealQueue) {
    const steps: number[] = [];
    while (q.active) {
      q.tick();
      if (q.focus) steps.push(q.hitStep);
    }
    return steps;
  }

  test("a unit hit three times steps to the next hit every HIT_BEAT_TICKS from the impact and holds the last", () => {
    const q = new RevealQueue();
    q.enqueue(hitEntries(session(1), "m1", [53, 52, 54]));
    q.tick();
    expect(q.focusHits.get("m1")).toEqual([{ amount: 53 }, { amount: 52 }, { amount: 54 }]);
    const steps = stepsOf(q);
    steps.unshift(0); // the tick taken above
    expect(steps.indexOf(1)).toBe(IMPACT_TICKS + HIT_BEAT_TICKS);
    expect(steps.indexOf(2)).toBe(IMPACT_TICKS + 2 * HIT_BEAT_TICKS);
    expect(steps.slice(0, IMPACT_TICKS + HIT_BEAT_TICKS).every((step) => step === 0)).toBe(true);
    expect(steps.at(-1)).toBe(2);
  });

  test("the session runs one HIT_BEAT_TICKS longer for each hit past the first", () => {
    const length = (amounts: number[]) => {
      const q = new RevealQueue();
      q.enqueue(hitEntries(session(1), "m1", amounts));
      return stepsOf(q).length;
    };
    expect(length([53])).toBe(SESSION_MIN_TICKS);
    expect(length([53, 52])).toBe(SESSION_MIN_TICKS + HIT_BEAT_TICKS);
    expect(length([53, 52, 54])).toBe(SESSION_MIN_TICKS + 2 * HIT_BEAT_TICKS);
  });

  test("the most-hit unit sets the pace; units hit once keep one number", () => {
    const q = new RevealQueue();
    const s = session(1);
    q.enqueue([...hitEntries(s, "m1", [10, 11]), ...hitEntries(s, "m2", [30])]);
    q.tick();
    expect(q.focusHits.get("m1")).toEqual([{ amount: 10 }, { amount: 11 }]);
    expect(q.focusHits.get("m2")).toEqual([{ amount: 30 }]);
    expect(stepsOf(q).at(-1)).toBe(1);
  });

  test("a summon's number waits for the last hit", () => {
    const q = new RevealQueue();
    q.enqueue(hitEntries(session(1), "m1", [53, 52, 54]));
    const beat: boolean[] = [];
    while (q.active) {
      q.tick();
      if (q.focus) beat.push(q.summonBeat);
    }
    expect(beat.indexOf(true)).toBe(IMPACT_TICKS + SUMMON_BEAT_TICKS + 2 * HIT_BEAT_TICKS);
  });

  test("with no hits nothing changes: step 0, no hits, the usual summon beat", () => {
    const q = new RevealQueue();
    q.enqueue(entries("a", 2, session(1)));
    const beat: boolean[] = [];
    while (q.active) {
      q.tick();
      expect(q.hitStep).toBe(0);
      expect(q.focusHits.size).toBe(0);
      if (q.focus) beat.push(q.summonBeat);
    }
    expect(beat.indexOf(true)).toBe(IMPACT_TICKS + SUMMON_BEAT_TICKS);
  });
});

describe("RevealQueue crit marks", () => {
  test("each hit keeps its own crit flag, in the order the hits landed", () => {
    const q = new RevealQueue();
    const s = session(1);
    q.enqueue([
      { text: "a", kind: "attack", session: s, hit: { targetId: "m1", amount: 53 } },
      { text: "b", kind: "attack", session: s, hit: { targetId: "m1", amount: 80, crit: true } },
      { text: "c", kind: "attack", session: s, hit: { targetId: "m1", amount: 52 } },
    ]);
    q.tick();
    expect(q.focusHits.get("m1")).toEqual([{ amount: 53 }, { amount: 80, crit: true }, { amount: 52 }]);
  });

  test("a critical heal is remembered by the unit it landed on, only while its session is lit", () => {
    const q = new RevealQueue();
    q.enqueue([{ text: "heal", kind: "heal", session: session(1), healCritOf: "p1" }]);
    expect(q.focusHealCrits.size).toBe(0);
    q.tick();
    expect([...q.focusHealCrits]).toEqual(["p1"]);
    while (q.active) q.tick();
    expect(q.focusHealCrits.size).toBe(0);
  });
});

describe("RevealQueue overkill", () => {
  test("a hit keeps its overkill, and the hits after the kill count towards the session's hold", () => {
    const q = new RevealQueue();
    const s = session(1);
    q.enqueue([
      { text: "a", kind: "attack", session: s, hit: { targetId: "m1", amount: 52, overkill: 28, crit: true } },
      { text: "Overkill on Dungeon Rat: 49 from Knight.", kind: "attack", session: s, hit: { targetId: "m1", amount: 49, overkill: 49 } },
      { text: "Overkill on Dungeon Rat: 51 from Knight.", kind: "attack", session: s, hit: { targetId: "m1", amount: 51, overkill: 51 } },
    ]);
    q.tick();
    expect(q.focusHits.get("m1")).toEqual([{ amount: 52, overkill: 28, crit: true }, { amount: 49, overkill: 49 }, { amount: 51, overkill: 51 }]);
    let lit = 1;
    while (q.active) {
      q.tick();
      if (q.focus) lit++;
    }
    expect(lit).toBe(SESSION_MIN_TICKS + 2 * HIT_BEAT_TICKS);
  });
});

describe("RevealQueue paces a session's lines by hit beat", () => {
  const hit = (text: string, targetId: string, s: LogSession, extra: Partial<LogEntry> = {}): LogEntry => ({ text, kind: "attack", session: s, hit: { targetId, amount: 50 }, ...extra });
  const plain = (text: string, s: LogSession): LogEntry => ({ text, kind: "info", session: s });

  /** The tick each line is revealed on, by text. */
  function revealTicks(queue: RevealQueue): Record<string, number> {
    const at: Record<string, number> = {};
    for (let tick = 0; queue.active && tick < 200; tick++) for (const entry of queue.tick()) at[entry.text] = tick;
    return at;
  }

  test("one unit hit three times: each hit line, with the line after it, is up at its own beat", () => {
    const s = session(1);
    const q = new RevealQueue();
    q.enqueue([plain("announce", s), hit("hit 1", "m1", s), plain("defeated", s), hit("overkill 2", "m1", s), hit("overkill 3", "m1", s)]);
    expect(revealTicks(q)).toEqual({
      announce: 0,
      "hit 1": IMPACT_TICKS,
      defeated: IMPACT_TICKS + 1,
      "overkill 2": IMPACT_TICKS + HIT_BEAT_TICKS,
      "overkill 3": IMPACT_TICKS + 2 * HIT_BEAT_TICKS,
    });
  });

  test("several units hit more than once are interleaved by beat, the log's own order kept within a beat", () => {
    const s = session(1);
    const q = new RevealQueue();
    q.enqueue([plain("announce", s), hit("A1", "a", s), hit("A2", "a", s), hit("B1", "b", s), hit("B2", "b", s)]);
    const order: string[] = [];
    while (q.active) for (const entry of q.tick()) order.push(entry.text);
    expect(order).toEqual(["announce", "A1", "B1", "A2", "B2"]);
  });

  test("the whole run still fits inside the session's hold", () => {
    const s = session(1);
    const q = new RevealQueue();
    q.enqueue([plain("announce", s), hit("h1", "m1", s), hit("h2", "m1", s), hit("h3", "m1", s)]);
    const shown: string[] = [];
    while (q.active) for (const entry of q.tick()) shown.push(entry.text);
    expect(shown).toEqual(["announce", "h1", "h2", "h3"]);
  });

  test("a session with no unit hit twice keeps the plain pace", () => {
    const s = session(1);
    const q = new RevealQueue();
    q.enqueue([plain("announce", s), hit("A1", "a", s), hit("B1", "b", s)]);
    expect(revealTicks(q)).toEqual({ announce: 0, A1: IMPACT_TICKS, B1: IMPACT_TICKS + 1 });
  });

  test("skipping hands back what was not revealed yet, in the order it would have shown", () => {
    const s = session(1);
    const q = new RevealQueue();
    q.enqueue([plain("announce", s), hit("A1", "a", s), hit("A2", "a", s), hit("B1", "b", s), hit("B2", "b", s)]);
    q.tick();
    expect(q.flush().map((e) => e.text)).toEqual(["A1", "B1", "A2", "B2"]);
  });
});
