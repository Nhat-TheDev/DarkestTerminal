# Darkest Terminal

```
   █████   ████  █████  ██  ██ ██████  █████ ██████
   ██  ██ ██  ██ ██  ██ ██ ██  ██     ██       ██
   ██  ██ ██████ █████  ████   █████   ████    ██
   ██  ██ ██  ██ ██ ██  ██ ██  ██         ██   ██
   █████  ██  ██ ██  ██ ██  ██ ██████ █████    ██

██████ ██████ █████  ██    ██ ██ ██    ██  ████  ██
  ██   ██     ██  ██ ███  ███ ██ ███   ██ ██  ██ ██
  ██   █████  █████  ██ ██ ██ ██ ██ ██ ██ ██████ ██
  ██   ██     ██ ██  ██    ██ ██ ██   ███ ██  ██ ██
  ██   ██████ ██  ██ ██    ██ ██ ██    ██ ██  ██ ██████
```

*A dungeon doesn't care that your only monitor is a terminal window.*

[![Tests](https://github.com/Nhat-TheDev/DarkestTerminal/actions/workflows/darkest-terminal-test.yml/badge.svg)](https://github.com/Nhat-TheDev/DarkestTerminal/actions/workflows/darkest-terminal-test.yml)
[![Verify Build](https://github.com/Nhat-TheDev/DarkestTerminal/actions/workflows/verify-build.yml/badge.svg)](https://github.com/Nhat-TheDev/DarkestTerminal/actions/workflows/verify-build.yml)
[![npm version](https://img.shields.io/npm/v/darkest-terminal.svg?color=cb3837&logo=npm)](https://www.npmjs.com/package/darkest-terminal)
[![License: PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/license-PolyForm--Noncommercial--1.0.0-blue.svg)](./LICENSE)
![Runtime: Bun](https://img.shields.io/badge/runtime-Bun-fbf0df?logo=bun&logoColor=000)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)

## 📖 Introduction

**Darkest Terminal** is a roguelike dungeon crawler that runs entirely in your
terminal — no graphics card, no window manager, just you, a keyboard, and a
dungeon that goes as deep as you dare.

Pick 4 characters from a roster of 6 classes and lead them down an endless,
procedurally generated dungeon. Every floor is freshly built, every branch
eventually leads back to a guarded boss room, and every fight is turn-based —
command your whole party, then watch the round play out in speed order. There
is no "you win" screen: you play until your party falls, permanently. Manage
hunger and fear alongside HP and MP, gear up on items and permanent
Artifacts, spend the coin you loot on gambles and favors from strange
wanderers, and see how far down you can get.

![Title screen](./docs/images/title-screen.svg)
![Battlefield mid-combat: header, party, monsters, and log](./docs/images/battlefield-combat.svg)

## 🚀 Installation

The easiest way — no installation required, works on macOS and Windows
(downloads a self-contained binary the first time you run it):

```bash
npx darkest-terminal
```

Running from source (needs [Bun](https://bun.sh)):

```bash
bun install
bun run start
```

## 🎮 How to Play

**Starting up.** You'll first see the title (splash) screen — press any key
to reach the menu, then choose **New Game** or **Continue** (Continue only
shows up once you have a save). New Game takes you straight to the character
select screen.

**Building your party.** Pick exactly 4 characters from the 6-class roster —
number keys to select/deselect a class, any key to confirm once you have 4.
Each class plays differently, so a mix of roles (a tank, some damage, some
support) will serve you better than four of the same idea.

![Character select — choosing 4 characters for the expedition party from the 6-class roster](./docs/images/character-select.svg)

**Controls.** Everything in the game is driven by a **number** key — moving
between rooms, choosing skills/items, picking targets, rest-room choices,
event choices. After a round of combat resolves, the log plays back what
happened one line at a time (press any key to skip straight to the end),
then press any key again to move on. Use **↑/↓** to scroll back through the
combat log, and **q** to quit.

![Room cleared — coins/satiety in the header, satiety drain and coins earned in the log](./docs/images/room-cleared.svg)

**The loop.** Move from room to room, fight whatever's guarding the way,
collect coins/items/Artifacts, and keep your party's Fear and Satiety in
check between fights. Clear the guarded room at the end of a floor and the
next floor generates immediately — there's no final boss to "beat the game,"
just how deep you can push before your party doesn't make it back.

## ✨ Features

- **An endless, hand-crafted-feeling dungeon** — every floor is generated
  fresh at runtime: one entrance, branching paths that always reconverge, and
  one guarded room standing between you and the next floor down. No two runs
  look the same, and there's no scripted ending — you play until you can't.
- **6 classes, a party of 4** — Vanguard, Mage, Rogue, Acolyte, Viking, and
  Plague Doctor, each with a full kit of skills (including a powerful,
  always-hits ultimate) and their own way of growing stronger as they level.
- **Turn-based tactical combat** — command your whole party first, then watch
  the round resolve in speed order; monsters target based on who's drawing
  the most aggro, and a target that dies mid-round properly redirects the
  attacks aimed at it.
- **A real bestiary** — 11 regular monster types roaming the dungeon, plus 5
  dedicated Elite/Boss archetypes guarding the end of every floor, each with
  its own skill kit (and the Boss with a devastating charge-then-unleash
  finisher).
- **Fear & Satiety** — two survival stats running alongside HP/MP. Fear
  creeps up as fights get hairy and starts working against you in combat;
  Satiety drains as you explore and, if it runs too low, weakens your whole
  party until you rest or make camp.
- **True permadeath** — HP hits 0, that character (or that run, if the whole
  party falls) is gone for good. No mid-run resurrections.
- **Leveling 1-100** — characters grow through EXP earned from kills, with
  each class scaling differently so they stay distinct at high level; the
  dungeon itself scales independently, so the deeper you go, the tougher
  everything gets regardless of your level.
- **Items & permanent Artifacts** — consumables you can use in or out of
  combat, plus Artifacts: powerful, permanent relics you have to decide to
  equip or discard the instant you find them — no free do-overs later.

  ![Artifact decision — equip/discard choice shown right after picking up an Artifact](./docs/images/artifact-decision.svg)

- **Cursed Coins** — a shared currency dropped by every kill, spendable at
  the Merchant, risked at the Wandering Gambling Den, or traded away at the
  Wandering Hermit's Exchange Fortune.
- **Event rooms with real narrative** — random encounters split across
  rarity tiers, some tied into recurring NPCs and multi-visit story chains
  rather than one-off flavor text.
- **Save & continue** — pick up a run later from a list of your saves.
- **Pixel art rendered directly in the terminal** — every character and
  monster is hand-drawn pixel art, composited straight into your terminal
  window as colored character cells.

## 📚 For developers

The rest of this README used to live here — it now lives in
**[`docs/developer-guide.md`](./docs/developer-guide.md)**, which serves as
the entry point for understanding how the game is built: architecture, data
files, code layout, and how to run the test suite.
