import type { BrowserWindow } from "electrobun/bun";
import { Tray, Utils } from "electrobun/bun";
import type { DaemonManager } from "./daemon-manager";

export function setupTray(daemon: DaemonManager, mainWindow: BrowserWindow) {
  const tray = new Tray({
    title: "UCM",
  });

  tray.setMenu([
    { type: "normal", label: "Open Dashboard", action: "show" },
    { type: "divider" },
    { type: "normal", label: "Restart Daemon", action: "restart" },
    { type: "divider" },
    { type: "normal", label: "Quit", action: "quit" },
  ]);

  tray.on("tray-clicked", async (event: any) => {
    const action = event.data?.action;
    if (action === "show") {
      if (mainWindow.isMinimized()) mainWindow.unminimize();
      mainWindow.focus();
    }
    if (action === "restart") {
      try {
        await daemon.stop();
        const { port } = await daemon.start();
        mainWindow.webview.loadURL(`http://localhost:${port}`);
      } catch (error) {
        await Utils.showMessageBox({
          title: "Restart Failed",
          message: String(error),
          buttons: ["OK"],
        });
      }
    }
    if (action === "quit") {
      Utils.quit();
    }
  });
}
