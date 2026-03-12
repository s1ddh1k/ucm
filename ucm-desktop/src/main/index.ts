import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import type {
  NavigationItem,
  RuntimeUpdateEvent,
  UcmDesktopApi,
} from "../shared/contracts";
import { RuntimeService } from "./runtime";

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const windows = new Set<BrowserWindow>();
let runtime: RuntimeService;
let autopilotTimer: NodeJS.Timeout | null = null;

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
  },
});

const navigation: NavigationItem[] = [
  {
    id: "home",
    label: "Home",
    description: "Open a workspace and start or resume a mission.",
  },
  {
    id: "monitor",
    label: "Monitor",
    description: "Watch agents, bottlenecks, review alerts, and live runs.",
  },
  {
    id: "plan",
    label: "Plan",
    description: "Define goals, constraints, phases, and team structure.",
  },
  {
    id: "execute",
    label: "Execute",
    description: "Inspect diffs, traces, runtime state, and interventions.",
  },
  {
    id: "review",
    label: "Review",
    description: "Verify results, approve packets, and inspect deliverables.",
  },
  {
    id: "settings",
    label: "Settings",
    description: "Configure language, providers, defaults, and app behavior.",
  },
];

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
  ipcMain.handle("navigation:list-screens", () => navigation);
  ipcMain.handle("workspace:list", () => runtime.listWorkspaces());
  ipcMain.handle("mission:list", () => runtime.listMissions());
  ipcMain.handle("mission:get-active", () => runtime.getActiveMission());
  ipcMain.handle("mission:create", (_, input) => runtime.createMission(input));
  ipcMain.handle("run:get-active", () => runtime.getActiveRun());
  ipcMain.handle("run:list-for-active-mission", () => runtime.listRunsForActiveMission());
  ipcMain.handle("run:set-active", (_, input) => runtime.setActiveRun(input));
  ipcMain.handle("run:autopilot-step", () => runtime.autopilotStep());
  ipcMain.handle("run:autopilot-burst", (_, input) => runtime.autopilotBurst(input));
  ipcMain.handle("run:steering-submit", (_, input) => runtime.submitSteering(input));
  ipcMain.handle("run:terminal-write", (_, input) => runtime.writeTerminal(input));
  ipcMain.handle("run:terminal-resize", (_, input) =>
    runtime.resizeTerminal(input),
  );
  ipcMain.handle("run:terminal-kill", (_, input) => runtime.killTerminal(input));
  ipcMain.handle("deliverable:generate", (_, input) =>
    runtime.generateDeliverableRevision(input),
  );
  ipcMain.handle("deliverable:handoff", (_, input) =>
    runtime.handoffDeliverable(input),
  );
  ipcMain.handle("deliverable:approve", (_, input) =>
    runtime.approveDeliverableRevision(input),
  );
  ipcMain.handle("shell:get-snapshot", () => runtime.getShellSnapshot());
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  autopilotTimer = setInterval(() => {
    runtime.tickAutopilot();
  }, 1200);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (autopilotTimer) {
    clearInterval(autopilotTimer);
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
