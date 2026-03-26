import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import type {
  NavigationItem,
  RuntimeUpdateEvent,
  UcmDesktopApi,
} from "../shared/contracts";
import { RuntimeService } from "./runtime";
import {
  browseWorkspaceDirectories,
  createWorkspaceDirectory,
} from "./workspace-browser-service";

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const windows = new Set<BrowserWindow>();
let runtime: RuntimeService;
let autopilotTimer: NodeJS.Timeout | null = null;

const ACTIVE_AUTOPILOT_DELAY_MS = 1200;
const IDLE_AUTOPILOT_DELAY_MS = 5000;
const NAVIGATION_SCREENS: NavigationItem[] = [
  {
    id: "home",
    label: "Home",
    description: "Launch workspaces, missions, and templates",
  },
  {
    id: "monitor",
    label: "Monitor",
    description: "Track agents, queues, and blockers",
  },
  {
    id: "plan",
    label: "Plan",
    description: "Shape mission scope and constraints",
  },
  {
    id: "execute",
    label: "Execute",
    description: "Inspect runs, patches, and live output",
  },
  {
    id: "review",
    label: "Review",
    description: "Approve evidence and release artifacts",
  },
  {
    id: "settings",
    label: "Settings",
    description: "Manage environment and workspace registry",
  },
];

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-compositing");
app.commandLine.appendSwitch("use-gl", "swiftshader");
app.commandLine.appendSwitch("disable-software-rasterizer");
app.commandLine.appendSwitch("in-process-gpu");

const customUserDataPath = process.env.UCM_DESKTOP_USER_DATA_DIR;
if (customUserDataPath) {
  fs.mkdirSync(customUserDataPath, { recursive: true });
  app.setPath("userData", customUserDataPath);
}

runtime = new RuntimeService({
  onStateChange: (reason) => {
    broadcastRuntimeUpdate({ reason });
    if (!runtime) {
      return;
    }
    if (reason === "terminal_updated") {
      return;
    }
    scheduleAutopilot(reason === "run_completed" ? 150 : 500);
  },
});

function scheduleAutopilot(delayMs = ACTIVE_AUTOPILOT_DELAY_MS) {
  if (autopilotTimer) {
    clearTimeout(autopilotTimer);
  }

  autopilotTimer = setTimeout(() => {
    autopilotTimer = null;
    const result = runtime.tickAutopilot();
    scheduleAutopilot(
      result.eventKind === "none"
        ? IDLE_AUTOPILOT_DELAY_MS
        : ACTIVE_AUTOPILOT_DELAY_MS,
    );
  }, delayMs);
  autopilotTimer.unref?.();
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1520,
    height: 980,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: "#f6f1e8",
    title: "UCM Agent IDE",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL as string);
    window.webContents.openDevTools({ mode: "detach" });
  } else {
    void window.loadFile(path.join(process.cwd(), "dist", "index.html"));
  }

  windows.add(window);
  window.on("closed", () => {
    windows.delete(window);
  });
}

function broadcastRuntimeUpdate(event: RuntimeUpdateEvent) {
  for (const window of windows) {
    if (!window.isDestroyed()) {
      window.webContents.send("runtime:updated", event);
    }
  }
}

function registerIpc() {
  ipcMain.handle("app:get-version", () => app.getVersion());
  ipcMain.handle("navigation:list-screens", () => NAVIGATION_SCREENS);
  ipcMain.handle("workspace:list", () => runtime.listWorkspaces());
  ipcMain.handle("workspace:set-active", (_, input) => runtime.setActiveWorkspace(input));
  ipcMain.handle("workspace:add", (_, input) => runtime.addWorkspace(input));
  ipcMain.handle("workspace:browse", (_, input) => browseWorkspaceDirectories(input));
  ipcMain.handle("workspace:create-directory", (_, input) =>
    createWorkspaceDirectory(input),
  );
  ipcMain.handle("mission:list", () => runtime.listMissions());
  ipcMain.handle("mission:get-active", () => runtime.getActiveMission());
  ipcMain.handle("mission:set-active", (_, input) => runtime.setActiveMission(input));
  ipcMain.handle("mission:create", (_, input) => runtime.createMission(input));
  ipcMain.handle("run:get-active", () => runtime.getActiveRun());
  ipcMain.handle("run:list-for-active-mission", () => runtime.listRunsForActiveMission());
  ipcMain.handle("run:set-active", (_, input) => runtime.setActiveRun(input));
  ipcMain.handle("run:retry", (_, input) => runtime.retryRun(input));
  ipcMain.handle("run:autopilot-step", () => runtime.autopilotStep());
  ipcMain.handle("run:autopilot-burst", (_, input) => runtime.autopilotBurst(input));
  ipcMain.handle("run:steering-submit", (_, input) => runtime.submitSteering(input));
  ipcMain.handle("run:terminal-write", (_, input) => runtime.writeTerminal(input));
  ipcMain.handle("run:terminal-resize", (_, input) =>
    runtime.resizeTerminal(input),
  );
  ipcMain.handle("run:terminal-kill", (_, input) => runtime.killTerminal(input));
  ipcMain.handle("release:generate", (_, input) =>
    runtime.generateDeliverableRevision(input),
  );
  ipcMain.handle("release:handoff", (_, input) =>
    runtime.handoffDeliverable(input),
  );
  ipcMain.handle("release:approve", (_, input) =>
    runtime.approveDeliverableRevision(input),
  );
  ipcMain.handle("shell:get-snapshot", () => runtime.getShellSnapshot());
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  scheduleAutopilot();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (autopilotTimer) {
    clearTimeout(autopilotTimer);
    autopilotTimer = null;
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});

declare global {
  interface Window {
    ucm: UcmDesktopApi;
  }
}
