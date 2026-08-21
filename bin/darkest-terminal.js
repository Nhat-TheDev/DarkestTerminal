#!/usr/bin/env node

import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const PLATFORM_PACKAGES = {
  "darwin-arm64": "darkest-terminal-darwin-arm64",
  "darwin-x64": "darkest-terminal-darwin-x64",
  "win32-x64": "darkest-terminal-win32-x64",
};

const key = `${process.platform}-${process.arch}`;
const pkgName = PLATFORM_PACKAGES[key];

if (!pkgName) {
  console.error(
    `darkest-terminal: unsupported platform "${key}". Supported: ${Object.keys(PLATFORM_PACKAGES).join(", ")}`,
  );
  process.exit(1);
}

let binPath;
try {
  const pkgJsonPath = require.resolve(`${pkgName}/package.json`);
  const binName = process.platform === "win32" ? "darkest-terminal.exe" : "darkest-terminal";
  binPath = path.join(path.dirname(pkgJsonPath), binName);
} catch {
  console.error(
    `darkest-terminal: could not find platform package "${pkgName}". Try reinstalling (npm install darkest-terminal).`,
  );
  process.exit(1);
}

if (!existsSync(binPath)) {
  console.error(`darkest-terminal: binary not found at ${binPath}.`);
  process.exit(1);
}

const result = spawnSync(binPath, process.argv.slice(2), { stdio: "inherit" });
process.exit(result.status ?? 1);
