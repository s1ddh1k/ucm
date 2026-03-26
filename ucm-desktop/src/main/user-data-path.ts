import path from "node:path";
import os from "node:os";
import fs from "node:fs";

/**
 * Returns the user-data directory for persisting runtime state.
 * Works both inside Electron (app.getPath) and standalone Node.
 */
export function resolveUserDataPath(): string {
  // Allow explicit override via env
  const explicit = process.env.UCM_DESKTOP_USER_DATA_DIR;
  if (explicit) {
    fs.mkdirSync(explicit, { recursive: true });
    return explicit;
  }

  // Try Electron app.getPath when available
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require("electron");
    if (app && typeof app.getPath === "function") {
      return app.getPath("userData");
    }
  } catch {
    // Not in Electron — fall through
  }

  // Standalone Node fallback
  const dir = path.join(os.homedir(), ".ucm");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
