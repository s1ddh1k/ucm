import { Updater, Utils } from "electrobun/bun";

const CHECK_INTERVAL_MS = 60 * 60 * 1000;

async function checkAndApplyUpdate() {
  try {
    const result = await Updater.checkForUpdate();
    if (result.error) {
      console.error("update check failed:", result.error);
      return;
    }
    if (!result.updateAvailable) return;

    await Updater.downloadUpdate();

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
    console.error("update error:", error);
  }
}

export function setupUpdater() {
  // Delay initial check to avoid slowing down startup
  setTimeout(checkAndApplyUpdate, 10000);
  setInterval(checkAndApplyUpdate, CHECK_INTERVAL_MS);
}
