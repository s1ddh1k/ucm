import { Updater, Utils } from "electrobun/bun";

const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const ERROR_DIALOG_COOLDOWN_MS = 15 * 60 * 1000;
let lastUpdateErrorMessage = "";
let lastUpdateErrorShownAt = 0;

function normalizeUpdateError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  return "unknown error";
}

async function showUpdateError(context: string, error: unknown) {
  const detail = normalizeUpdateError(error);
  const message = `${context}: ${detail}`;
  const now = Date.now();
  if (
    message === lastUpdateErrorMessage &&
    now - lastUpdateErrorShownAt < ERROR_DIALOG_COOLDOWN_MS
  ) {
    console.error("[updater]", message);
    return;
  }

  lastUpdateErrorMessage = message;
  lastUpdateErrorShownAt = now;
  console.error("[updater]", message);

  await Utils.showMessageBox({
    title: "Update Check Failed",
    message:
      `${message}\n\n` +
      "UCM will retry automatically in about 1 hour. " +
      "You can keep using the app and check your network/firewall settings if this continues.",
    buttons: ["OK"],
  });
}

async function checkAndApplyUpdate() {
  try {
    const result = await Updater.checkForUpdate();
    if (result.error) {
      await showUpdateError("Could not check for updates", result.error);
      return;
    }
    if (!result.updateAvailable) return;

    try {
      await Updater.downloadUpdate();
    } catch (error) {
      await showUpdateError("Update download failed", error);
      return;
    }

    const info = Updater.updateInfo();
    if (info?.updateReady) {
      const choice = await Utils.showMessageBox({
        title: "Update Available",
        message: `UCM ${result.version} is ready to install. Restart now?`,
        buttons: ["Restart Now", "Later"],
      });
      if (choice === 0) {
        await Updater.applyUpdate();
      }
    }
  } catch (error) {
    await showUpdateError("Update process failed", error);
  }
}

export function setupUpdater() {
  // Delay initial check to avoid slowing down startup
  setTimeout(checkAndApplyUpdate, 10000);
  setInterval(checkAndApplyUpdate, CHECK_INTERVAL_MS);
}
