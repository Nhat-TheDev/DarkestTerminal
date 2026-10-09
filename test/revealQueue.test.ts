import { describe, expect, test } from "bun:test";
import { IMPACT_TICKS, RevealQueue, SESSION_MIN_TICKS } from "../src/ui/revealQueue";
import type { LogEntry, LogSession } from "../src/types";

function session(id: number): LogSession {
  return { id, actorId: "a", attackedIds: [], debuffedIds: [], buffedIds: [], healedIds: [], missedIds: [], lifestealIds: [], tickDamageIds: [], affectedIds: [] };
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
