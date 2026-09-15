# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Darkest Terminal — a roguelike dungeon crawler that renders entirely in the terminal (pixel art as colored terminal cells), built on [Bun](https://bun.sh) + [OpenTUI](https://github.com/anomalyco/opentui). Turn-based party combat, procedurally generated floors, true permadeath. Ships as a standalone compiled binary (`npx darkest-terminal`) as well as runnable from source.

**Read [`docs/developer-guide.md`](docs/developer-guide.md) before making non-trivial changes** — it is the maintained architecture reference (data files, code layout, floor generation, combat, UI panels, the key-hint grammar) and this file intentionally does not duplicate it. For *why* a mechanic works the way it does (exact formulas/thresholds/design rationale), see [`docs/design-doc.md`](docs/design-doc.md), [`docs/gameplay-decisions/00-index.md`](docs/gameplay-decisions/00-index.md) (per-topic docs), and [`docs/technical-decisions.md`](docs/technical-decisions.md).

## Commands

```bash
bun install
bun run start          # run the game from source

bun test                       # full test suite (engine unit tests + headless UI smoke tests)
bun test test/combat-ranks.test.ts   # run a single test file
bun test -t "some test name"         # run tests matching a name pattern
bun run typecheck              # tsc --noEmit (strict mode)

bun run sprite-editor       # dev tool: edit pixel-art sprites in the browser
bun run rebalance-editor    # dev tool: inspect/compare character & monster stats, damage, level-by-depth projections
bun run dump-save           # dev tool: web UI to generate a save at any level/floor/room/event (dev-mode only)

bun run build            # compile a standalone release binary (--define __DEV__=false)
```

Tests redirect `DARKEST_TERMINAL_SAVE_DIR` to a fresh temp directory (`test/setup.ts`, preloaded via `bunfig.toml`) so they never touch a real save directory.

## Architecture

**Data-driven, not hardcoded.** Nearly all game content and balance numbers (classes, monsters, skills, items, artifacts, events, status effects, level-growth curves, balance constants, sprites, UI strings) live as JSON in `data/*.json`, not TypeScript. `src/data/*.ts` modules are thin loaders that validate shape and expose typed accessors (`getClass`, `getArtifact`, `getEvent`, `spriteForClass`, `t`, ...) — the rest of the codebase never touches the JSON directly. **When changing content or balance, edit the JSON; when changing how that content is interpreted, edit the loader.**

**`src/engine/` vs `src/ui/`.** Engine code is pure logic, testable without any terminal rendering — `game.ts` (the `Game` class, the single mutator of `GameState`), `combat.ts`, `party.ts`, `dungeon.ts`, `survival.ts`, `resolver.ts` (the shared `SkillEffect` resolver used by skills/items/status-effects/artifacts alike), `save.ts`, `migration.ts`, `artifacts.ts`, `events/` (one file per event room). `src/ui/` only ever reads/writes state through `Game`'s methods — it never mutates `GameState` directly.

**Floors are generated at runtime, not authored.** `generateFloorLayout` (`src/data/floorPatterns.ts`) builds a stage-based graph (every room in stage N connects to every room in stage N+1, no other edges) with exactly 1 entrance and 1 boss/guard room at the end, no dead ends, every branch reconverging. `src/data/floor.ts` fills that structure with actual room names/monsters. Floor depth (`Floor.depth`, uncapped) is entirely separate from character level (1-100, shared across the party). The generator's invariants are covered by a property-based test — see `technical-decisions.md` §1 before changing the branching rules.

**Combat is 2-phase.** All 4 party members queue actions first (`queueAction`), then the round resolves in speed order with monster AI deciding on the spot (`resolveRound`, `combat.ts`). Targeting is aggro-weighted; a target that dies mid-round redirects attacks already aimed at it. Elite/Boss archetypes share a strike+cleave kit plus their own debuff, and Bosses get a charge-then-unleash Finishing Blow.

**Dev mode gates dev-only capability at compile time**, not at runtime config (`src/engine/devMode.ts`'s `DEV_MODE`, driven by a `__DEV__` define baked in only by `bun run build`). Saves written with `devDump: true` (via `writeDevDumpSave`) refuse to load outside dev mode (`isDevDumpAllowed`, `save.ts`) even if the file is copied into a release install — this is what makes `tools/dev-save-dump/` and other dev tools safe to ship source-only.

**Key hints are generated, not hand-typed per screen.** Every screen's footer (`[1-n] Move   [i] Items`) follows a fixed grammar enforced by `test/keyHints.test.ts` and derived centrally in `src/ui/keyHints.ts` (`digitHint`, `globalHints`, `composeFooter`) — see the "Key hints" section of `docs/developer-guide.md` before adding a new screen or footer string.

**`tools/`** holds standalone Bun-server dev tools (sprite editor, rebalance editor, dev save generator) — each is `server.ts` (Bun.serve, reads/writes the same `data/*.json` or engine code the game itself uses) + `index.html`, run independently of `src/main.ts`.

## Conventions from working on this project

These came out of actual friction/feedback while building this repo — keep them in mind, they aren't generic advice.

- **When a UI text/format change is ambiguous, confirm the exact target render before implementing it.** Either ask (AskUserQuestion with concrete candidate strings using real data) or state the literal output you're about to produce and invite correction — don't ship a best-guess interpretation. A short token like "100%" can mean a trigger chance or a scaling percentage; guessing wrong burns a full iteration every time.
- **Dev tool web UIs (`tools/*/server.ts` + `index.html`) load their catalogs by serving `data/*.json` directly** (same pattern as `sprite-editor`'s `/api/sprites`), not by hand-building a bespoke "meta"/summary object in TypeScript — keeps the tool honest to whatever the JSON actually contains, and the client reads whichever fields it needs.
- **Keep data and docs in sync.** Any change to `data/*.json` content or to engine behavior that a doc describes (`docs/developer-guide.md`, `docs/gameplay-decisions/*`, `docs/design-doc.md`, `docs/technical-decisions.md`) gets that doc updated in the same change, not as a follow-up.
- **Keep tone consistent for any description or text you write, and check it for slop/cringe before calling the work done.** Match the dark, spare, unsentimental voice already established in `data/*.json` (item/artifact/ability/event text) — no generic AI phrasing, no forced whimsy, no cliché tension beats.
- **Always run tests after any change to logic/engine code that affects gameplay systems or the player-facing experience.** `bun test` (and `bun run typecheck`) before considering the change finished — not just for the file you touched, the full suite.
- **All text in the game and in docs is English**, regardless of what language the conversation with the user happens in.
- **Don't over-note.** Before finishing, strip historical narration, "we considered X", and resolved warnings out of code comments and docs — a comment should describe the current state, not the discussion that produced it. If a caveat genuinely needs to keep being tracked, put it in its own dedicated note file instead of leaving it scattered inline.
