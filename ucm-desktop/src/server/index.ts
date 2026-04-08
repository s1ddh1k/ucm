import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { RuntimeService } from "../main/runtime";
import {
  browseWorkspaceDirectories,
  createWorkspaceDirectory,
} from "../main/workspace-browser-service";
import type { NavigationItem, RuntimeUpdateEvent } from "../shared/contracts";

const PORT = Number(process.env.UCM_PORT) || 4800;

const NAVIGATION_SCREENS: NavigationItem[] = [
  { id: "home", label: "Home", description: "Launch workspaces, missions, and templates" },
  { id: "monitor", label: "Monitor", description: "Track agents, queues, and blockers" },
  { id: "plan", label: "Plan", description: "Shape mission scope and constraints" },
  { id: "execute", label: "Execute", description: "Inspect runs, patches, and live output" },
  { id: "review", label: "Review", description: "Approve evidence and release artifacts" },
  { id: "settings", label: "Settings", description: "Manage environment and workspace registry" },
];

// --- WebSocket clients ---
const wsClients = new Set<WebSocket>();

function broadcastRuntimeUpdate(event: RuntimeUpdateEvent) {
  const msg = JSON.stringify(event);
  for (const ws of wsClients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    }
  }
}

// --- Runtime ---
let autopilotTimer: NodeJS.Timeout | null = null;
const ACTIVE_AUTOPILOT_DELAY_MS = 1200;
const IDLE_AUTOPILOT_DELAY_MS = 5000;

const runtime = new RuntimeService({
  onStateChange: (reason) => {
    broadcastRuntimeUpdate({ reason });
    if (reason === "terminal_updated") return;
    scheduleAutopilot(reason === "run_completed" ? 150 : 500);
  },
});

function scheduleAutopilot(delayMs = ACTIVE_AUTOPILOT_DELAY_MS) {
  if (autopilotTimer) clearTimeout(autopilotTimer);
  autopilotTimer = setTimeout(() => {
    autopilotTimer = null;
    const result = runtime.tickAutopilot();
    scheduleAutopilot(
      result.eventKind === "none" ? IDLE_AUTOPILOT_DELAY_MS : ACTIVE_AUTOPILOT_DELAY_MS,
    );
  }, delayMs);
  autopilotTimer.unref?.();
}

// --- RPC route map ---
type RpcHandler = (input: unknown) => unknown | Promise<unknown>;

const routes: Record<string, RpcHandler> = {
  "app:get-version": () => "0.2.0",
  "navigation:list-screens": () => NAVIGATION_SCREENS,
  "workspace:list": () => runtime.listWorkspaces(),
  "workspace:set-active": (input) => runtime.setActiveWorkspace(input as { workspaceId: string }),
  "workspace:add": (input) => runtime.addWorkspace(input as { rootPath: string }),
  "workspace:browse": (input) => browseWorkspaceDirectories(input as { rootPath?: string }),
  "workspace:create-directory": (input) =>
    createWorkspaceDirectory(input as { parentPath: string; directoryName: string }),
  "mission:list": () => runtime.listMissions(),
  "mission:get-active": () => runtime.getActiveMission(),
  "mission:set-active": (input) => runtime.setActiveMission(input as { missionId: string }),
  "mission:create": (input) =>
    runtime.createMission(input as { workspaceId: string; title: string; goal: string; command?: string }),
  "run:get-active": () => runtime.getActiveRun(),
  "run:list-for-active-mission": () => runtime.listRunsForActiveMission(),
  "run:list-wakeup-requests": (input) =>
    runtime.listWakeupRequestsForRun(input as { runId: string }),
  "run:list-execution-attempts": (input) =>
    runtime.listExecutionAttemptsForRun(input as { runId: string }),
  "run:list-session-leases": (input) =>
    runtime.listSessionLeasesForRun(input as { runId: string }),
  "run:set-active": (input) => runtime.setActiveRun(input as { runId: string }),
  "run:retry": (input) => runtime.retryRun(input as { runId: string }),
  "run:autopilot-step": () => runtime.autopilotStep(),
  "run:autopilot-burst": (input) => runtime.autopilotBurst(input as { maxSteps?: number }),
  "run:steering-submit": (input) => runtime.submitSteering(input as { runId: string; text: string }),
  "run:terminal-write": (input) => runtime.writeTerminal(input as { sessionId: string; data: string }),
  "run:terminal-resize": (input) =>
    runtime.resizeTerminal(input as { sessionId: string; cols: number; rows: number }),
  "run:terminal-kill": (input) => runtime.killTerminal(input as { sessionId: string }),
  "release:generate": (input) =>
    runtime.generateDeliverableRevision(input as { runId: string; deliverableId: string; summary: string }),
  "release:handoff": (input) =>
    runtime.handoffDeliverable(
      input as { runId: string; deliverableRevisionId: string; channel: "inbox" | "export" | "share"; target?: string },
    ),
  "release:approve": (input) =>
    runtime.approveDeliverableRevision(input as { runId: string; deliverableRevisionId: string }),
  "shell:get-snapshot": () => runtime.getShellSnapshot(),
};

// --- HTTP server ---
const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // RPC endpoint: POST /rpc { method, params }
  if (req.method === "POST" && req.url === "/rpc") {
    let body = "";
    for await (const chunk of req) body += chunk;

    try {
      const { method, params } = JSON.parse(body);
      const handler = routes[method];
      if (!handler) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `unknown method: ${method}` }));
        return;
      }
      const result = await handler(params);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ result }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

// --- WebSocket server ---
const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws) => {
  wsClients.add(ws);
  ws.on("close", () => wsClients.delete(ws));
});

// --- Start ---
server.listen(PORT, "127.0.0.1", () => {
  console.log(`ucm-server listening on http://127.0.0.1:${PORT}`);
  console.log(`  RPC:       POST http://127.0.0.1:${PORT}/rpc`);
  console.log(`  WebSocket: ws://127.0.0.1:${PORT}/ws`);
  scheduleAutopilot();
});
