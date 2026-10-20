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

/** In a leaf module: save.ts and profile.ts both need it, and defining it in either would close an import cycle. */
export const SAVE_DIR = resolveSaveDir();
