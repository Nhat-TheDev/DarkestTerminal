import { homedir } from "node:os";
import { join } from "node:path";

const APP_DIR_NAME = "darkest-terminal";

function resolveSaveDir(): string {
  if (process.env.DARKEST_TERMINAL_SAVE_DIR) return process.env.DARKEST_TERMINAL_SAVE_DIR;
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", APP_DIR_NAME);
  }
  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), APP_DIR_NAME);
  }
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), APP_DIR_NAME);
}

/**
 * The one directory holding every per-run save plus the global `profile.json`. Lives in its own
 * leaf module — importing nothing from the engine — because both `save.ts` and `profile.ts` need it
 * and `save.ts` imports `Game` (which imports `profile.ts`): resolving it inside either of those
 * would close an import cycle and crash at load time depending on which module loads first.
 */
export const SAVE_DIR = resolveSaveDir();
