import { describe, test, expect } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { KeyEvent } from "@opentui/core";
import { App } from "../src/ui/app";
import { Game } from "../src/engine/game";
import { startCombat, spawnAdditionalSummon } from "../src/engine/combat";
import { spawnMonster } from "../src/data/monsters";
import { getSkill, getEffectiveSkill } from "../src/data/classes";
import { getRoom } from "../src/engine/dungeon";
import { skillEntries } from "../src/ui/state";
import { applyStatusEffectToActor } from "../src/engine/resolver";

async function commandFight(withGoblin = true) {
  const harness = await createTestRenderer({ width: 130, height: 47 });
  const game = new Game(3, ["summoner", "vanguard", "mage", "rogue"]);
  const room = getRoom(game.state.floor, game.state.currentRoomId);
  const rat = spawnMonster("dungeon-rat", 1);
  rat.maxHp = rat.hp = 1e5;
  game.ctx.monsters.push(rat);
  room.monsterIds = [rat.id];
  room.cleared = false;
  game.state.combat = startCombat(room.id, [rat.id], game.ctx, false);
  const summoner = game.state.party[0]!;
  summoner.level = 25;
  for (const id of ["summon-goblin", "totem-recall", "command"]) if (!summoner.unlockedSkillIds.includes(id)) summoner.unlockedSkillIds.push(id);
  summoner.mp = summoner.maxMp;
  const spawn = (skillId: string) => {
    const effect = getEffectiveSkill(getSkill(skillId), summoner.level).effects!.find((e) => e.kind === "summon")!;
    return spawnAdditionalSummon(effect, summoner, game.state.combat!, game.ctx, [])!;
  };
  spawn("totem-recall");
  const goblin = withGoblin ? spawn("summon-goblin") : undefined;
  const app = new App(harness.renderer, game, { autoReveal: false });
  await harness.renderOnce();
  const press = async (key: string) => {
    // A lone Esc from the mock input waits on the parser's escape-sequence timeout; emitting the event directly keeps the test off the clock.
    if (key === "ESCAPE")
      harness.renderer.keyInput.emit("keypress", new KeyEvent({ name: "escape", ctrl: false, meta: false, shift: false, option: false, sequence: "\x1b", number: false, raw: "\x1b", eventType: "press", source: "raw" }));
    else harness.mockInput.pressKey(key);
    await harness.renderOnce();
  };
  const commandDigit = String(skillEntries(summoner).findIndex((s) => s.id === "command") + 1);
  return { ...harness, app, game, summoner, goblin, rat, press, commandDigit };
}

describe("Command on the combat screen", () => {
  test("picks a minion, then its skill, then a target, and queues the order", async () => {
    const { app, captureCharFrame, press, game, goblin, rat, commandDigit, renderer } = await commandFight();
    await press("1");
    await press(commandDigit);
    await press("RETURN");
    expect(app.debugUiState.kind).toBe("pickCommandMinion");
    expect(captureCharFrame()).toContain("[1] Goblin Thrower");
    expect(captureCharFrame()).not.toContain("[2] Recall Totem");
    expect(captureCharFrame()).toContain("[1] Minion");
    await press("1");
    expect(app.debugUiState.kind).toBe("pickCommandSkill");
    expect(captureCharFrame()).toContain("[1] Rock Throw");
    await press("1");
    expect(app.debugUiState.kind).toBe("pickTarget");
    expect(captureCharFrame()).toContain("Goblin Thrower's Rock Throw");
    await press("1");
    const queued = game.state.combat!.queuedActions[0]!;
    expect(queued.source).toEqual({ kind: "skill", skillId: "command", command: { summonId: goblin!.id, skillId: "rock-throw" } });
    expect(queued.targets).toEqual([{ kind: "monster", id: rat.id }]);
    renderer.destroy();
  });

  test("Esc walks back one step at a time", async () => {
    const { app, press, commandDigit, renderer } = await commandFight();
    await press("1");
    await press(commandDigit);
    await press("RETURN");
    await press("1");
    await press("1");
    for (const kind of ["pickCommandSkill", "pickCommandMinion", "skillDetail"] as const) {
      await press("ESCAPE");
      expect(app.debugUiState.kind).toBe(kind);
    }
    renderer.destroy();
  });

  test("a stunned minion is left off the list, so with no other minion Command is refused", async () => {
    const { app, captureCharFrame, press, goblin, commandDigit, renderer } = await commandFight();
    applyStatusEffectToActor(goblin!, "stunned", 1, { log: [] });
    await press("1");
    await press(commandDigit);
    await press("RETURN");
    expect(app.debugUiState.kind).toBe("skillDetail");
    expect(captureCharFrame()).toContain("No minion able to take a command.");
    renderer.destroy();
  });

  test("with only the totem out, Command is refused", async () => {
    const { app, captureCharFrame, press, commandDigit, renderer } = await commandFight(false);
    await press("1");
    await press(commandDigit);
    await press("RETURN");
    expect(app.debugUiState.kind).toBe("skillDetail");
    expect(captureCharFrame()).toContain("No minion able to take a command.");
    renderer.destroy();
  });
});
