import { describe, test, expect } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { App } from "../src/ui/app";
import { Game } from "../src/engine/game";
import { startCombat } from "../src/engine/combat";
import { spawnMonster } from "../src/data/monsters";
import { getRoom } from "../src/engine/dungeon";
import { applyStatusEffectToActor } from "../src/engine/resolver";

async function channelingFight() {
  const harness = await createTestRenderer({ width: 130, height: 47 });
  const game = new Game(3, ["paladin", "vanguard", "mage", "rogue"]);
  const room = getRoom(game.state.floor, game.state.currentRoomId);
  const rat = spawnMonster("dungeon-rat", 1);
  rat.maxHp = rat.hp = 1e5;
  game.ctx.monsters.push(rat);
  room.monsterIds = [rat.id];
  room.cleared = false;
  game.state.combat = startCombat(room.id, [rat.id], game.ctx, false);
  const paladin = game.state.party[0]!;
  applyStatusEffectToActor(paladin, "vigil-channel", 2, { log: [] });
  const app = new App(harness.renderer, game, { autoReveal: false });
  await harness.renderOnce();
  return { ...harness, app, game, paladin };
}

describe("channel choice on the command screen", () => {
  test("a channeling Paladin is asked to hold or break, and holding moves on to the next character", async () => {
    const { app, captureCharFrame, mockInput, renderOnce, game, renderer } = await channelingFight();
    expect(app.debugUiState.kind).toBe("pickAction");
    expect(captureCharFrame()).toContain("[1] Hold Vigil");
    expect(captureCharFrame()).toContain("[2] Break Vigil");
    mockInput.pressKey("1");
    await renderOnce();
    expect(game.state.combat!.heldChannelIds).toContain(game.state.party[0]!.id);
    expect(app.debugUiState.kind).toBe("pickAction");
    expect((app.debugUiState as { actorRef: { id: string } }).actorRef.id).toBe(game.state.party[1]!.id);
    renderer.destroy();
  });

  test("breaking the channel ends it and lets the Paladin choose an action", async () => {
    const { app, captureCharFrame, mockInput, renderOnce, paladin, renderer } = await channelingFight();
    mockInput.pressKey("2");
    await renderOnce();
    expect(paladin.activeStatusEffects.some((s) => s.statusEffectId === "vigil-channel")).toBe(false);
    expect(app.debugUiState.kind).toBe("pickAction");
    expect(captureCharFrame()).not.toContain("Hold Vigil");
    renderer.destroy();
  });
});
