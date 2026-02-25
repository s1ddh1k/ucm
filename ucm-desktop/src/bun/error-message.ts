import { homedir } from "node:os";
import { join } from "node:path";

const DESKTOP_DAEMON_LOG_PATH = join(homedir(), ".ucm-desktop", "daemon", "ucmd.log");

function getErrorDetail(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  return "Unknown error";
}

export function buildDesktopActionErrorMessage(
  action: string,
  error: unknown,
): string {
  return `${action} failed: ${getErrorDetail(error)}\n\nTry again. If this keeps happening, open ${DESKTOP_DAEMON_LOG_PATH} and restart UCM Desktop.`;
}
