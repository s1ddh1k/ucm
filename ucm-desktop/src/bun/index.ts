import { BrowserWindow, Utils } from "electrobun/bun";
import Electrobun from "electrobun/bun";
import { DaemonManager } from "./daemon-manager";
import { setupTray } from "./tray";
import { setupUpdater } from "./updater";

const daemon = new DaemonManager();

// Handle crash: notify user and offer restart
daemon.setOnCrash(async (code) => {
  const choice = await Utils.showMessageBox({
    title: "UCM Daemon Crashed",
    message: `The UCM daemon exited unexpectedly (code ${code}). Restart it?`,
    buttons: ["Restart", "Quit"],
  });
  if (choice === 0) {
    try {
      const { port } = await daemon.start();
      mainWindow.webview.loadURL(`http://localhost:${port}`);
    } catch (error) {
      await Utils.showMessageBox({
        title: "Restart Failed",
        message: String(error),
        buttons: ["Quit"],
      });
      Utils.quit();
    }
  } else {
    Utils.quit();
  }
});

// Start daemon with error handling
let port: number;
try {
  const result = await daemon.start();
  port = result.port;
} catch (error) {
  await Utils.showMessageBox({
    title: "UCM Startup Error",
    message: `Failed to start daemon: ${error instanceof Error ? error.message : String(error)}`,
    buttons: ["Quit"],
  });
  Utils.quit();
  throw error;
}

const mainWindow = new BrowserWindow({
  title: "UCM Dashboard",
  url: `http://localhost:${port}`,
  frame: { width: 1400, height: 900 },
  titleBarStyle: "default",
});

setupTray(daemon, mainWindow);
setupUpdater();

// Clean up daemon on quit
Electrobun.events.on("before-quit", async () => {
  await daemon.stop();
});
