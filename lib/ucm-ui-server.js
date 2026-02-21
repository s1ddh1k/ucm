const { spawn, execFileSync } = require("child_process");
const { readFile, writeFile, mkdir, readdir, stat } = require("fs/promises");
const fs = require("fs");
const net = require("net");
const path = require("path");
const os = require("os");
const http = require("http");
const WebSocket = require("ws");

const {
  UCM_DIR, ARTIFACTS_DIR, DAEMON_DIR,
  SOCK_PATH, PID_PATH, LOG_PATH,
  SOCKET_READY_TIMEOUT_MS, SOCKET_POLL_INTERVAL_MS, CLIENT_TIMEOUT_MS,
  DEFAULT_CONFIG,
  cleanStaleFiles, ensureDirectories, loadConfig,
} = require("./ucmd.js");
const { createSocketClient } = require("./socket-client.js");

const TEMPLATES_DIR = path.join(__dirname, "..", "templates");
const CHAT_DIR = path.join(UCM_DIR, "chat");
const CHAT_NOTES_PATH = path.join(CHAT_DIR, "notes.md");
const WEB_DIST_DIR = path.join(__dirname, "..", "web", "dist");
const WEB_INDEX_PATH = path.join(WEB_DIST_DIR, "index.html");
const MAX_PTY_SESSIONS = 3;

// ── Proxy Route Table ──

const PROXY_ROUTES = [
  // GET routes
  { pattern: /^\/api\/list$/, method: "list",
    params: (url) => ({ status: url.searchParams.get("status") || undefined }) },
  { pattern: /^\/api\/stats$/, method: "stats" },
  { pattern: /^\/api\/status\/([a-f0-9]+)$/, method: "status",
    params: (_, m) => ({ taskId: m[1] }) },
  { pattern: /^\/api\/diff\/([a-f0-9]+)$/, method: "diff",
    params: (_, m) => ({ taskId: m[1] }) },
  { pattern: /^\/api\/logs\/([a-f0-9]+)$/, method: "logs",
    params: (url, m) => ({ taskId: m[1], lines: Number(url.searchParams.get("lines")) || undefined }) },
  { pattern: /^\/api\/proposals$/, method: "proposals",
    params: (url) => ({ status: url.searchParams.get("status") || undefined }) },
  { pattern: /^\/api\/proposal\/(p-[a-f0-9]+)$/, method: "proposal_evaluate",
    params: (_, m) => ({ proposalId: m[1] }) },
  { pattern: /^\/api\/observe\/status$/, method: "observe_status" },
  // POST routes
  { pattern: /^\/api\/submit$/, post: true, method: "submit", bodyParams: true },
  { pattern: /^\/api\/start\/([a-f0-9]+)$/, post: true, method: "start",
    params: (_, m) => ({ taskId: m[1] }) },
  { pattern: /^\/api\/approve\/([a-f0-9]+)$/, post: true, method: "approve",
    params: (_, m, body) => ({ taskId: m[1], ...body }) },
  { pattern: /^\/api\/reject\/([a-f0-9]+)$/, post: true, method: "reject",
    params: (_, m, body) => ({ taskId: m[1], ...body }) },
  { pattern: /^\/api\/cancel\/([a-f0-9]+)$/, post: true, method: "cancel",
    params: (_, m) => ({ taskId: m[1] }) },
  { pattern: /^\/api\/retry\/([a-f0-9]+)$/, post: true, method: "retry",
    params: (_, m) => ({ taskId: m[1] }) },
  { pattern: /^\/api\/delete\/([a-f0-9]+)$/, post: true, method: "delete",
    params: (_, m) => ({ taskId: m[1] }) },
  { pattern: /^\/api\/pause$/, post: true, method: "pause" },
  { pattern: /^\/api\/resume$/, post: true, method: "resume" },
  { pattern: /^\/api\/observe$/, post: true, method: "observe" },
  { pattern: /^\/api\/analyze$/, post: true, method: "analyze_project", bodyParams: true },
  { pattern: /^\/api\/research$/, post: true, method: "research_project", bodyParams: true },
  { pattern: /^\/api\/proposal\/approve\/(p-[a-f0-9]+)$/, post: true, method: "proposal_approve",
    params: (_, m) => ({ proposalId: m[1] }) },
  { pattern: /^\/api\/proposal\/reject\/(p-[a-f0-9]+)$/, post: true, method: "proposal_reject",
    params: (_, m) => ({ proposalId: m[1] }) },
  { pattern: /^\/api\/proposal\/delete\/(p-[a-f0-9]+)$/, post: true, method: "proposal_delete",
    params: (_, m) => ({ proposalId: m[1] }) },
  { pattern: /^\/api\/proposal\/priority\/(p-[a-f0-9]+)$/, post: true, method: "proposal_priority",
    params: (_, m, body) => ({ proposalId: m[1], ...body }) },
  { pattern: /^\/api\/refinement\/start$/, post: true, method: "start_refinement", bodyParams: true },
  { pattern: /^\/api\/refinement\/finalize$/, post: true, method: "finalize_refinement", bodyParams: true },
  { pattern: /^\/api\/refinement\/cancel$/, post: true, method: "cancel_refinement", bodyParams: true },
  { pattern: /^\/api\/cleanup$/, post: true, method: "cleanup", bodyParams: true },
  // Task priority
  { pattern: /^\/api\/priority\/([a-f0-9]+)$/, post: true, method: "update_priority",
    params: (_, m, body) => ({ taskId: m[1], ...body }) },
  // Stage gate routes
  { pattern: /^\/api\/stage-gate\/approve\/([a-f0-9]+)$/, post: true, method: "stage_gate_approve",
    params: (_, m, body) => ({ taskId: m[1], ...body }) },
  { pattern: /^\/api\/stage-gate\/reject\/([a-f0-9]+)$/, post: true, method: "stage_gate_reject",
    params: (_, m, body) => ({ taskId: m[1], ...body }) },
  // Config routes
  { pattern: /^\/api\/config$/, method: "get_config" },
  { pattern: /^\/api\/config$/, post: true, method: "set_config", bodyParams: true },
  // Autopilot routes
  { pattern: /^\/api\/autopilot\/status$/, method: "autopilot_status" },
  { pattern: /^\/api\/autopilot\/session\/([a-z0-9_]+)$/, method: "autopilot_session",
    params: (_, m) => ({ sessionId: m[1] }) },
  { pattern: /^\/api\/autopilot\/start$/, post: true, method: "autopilot_start", bodyParams: true },
  { pattern: /^\/api\/autopilot\/pause$/, post: true, method: "autopilot_pause", bodyParams: true },
  { pattern: /^\/api\/autopilot\/resume$/, post: true, method: "autopilot_resume", bodyParams: true },
  { pattern: /^\/api\/autopilot\/stop$/, post: true, method: "autopilot_stop", bodyParams: true },
  { pattern: /^\/api\/autopilot\/approve-item$/, post: true, method: "autopilot_approve_item", bodyParams: true },
  { pattern: /^\/api\/autopilot\/reject-item$/, post: true, method: "autopilot_reject_item", bodyParams: true },
  { pattern: /^\/api\/autopilot\/feedback-item$/, post: true, method: "autopilot_feedback_item", bodyParams: true },
  { pattern: /^\/api\/autopilot\/releases\/([a-z0-9_]+)$/, method: "autopilot_releases",
    params: (_, m) => ({ sessionId: m[1] }) },
  // Autopilot directive routes
  { pattern: /^\/api\/autopilot\/directives\/([a-z0-9_]+)$/, method: "autopilot_directive_list",
    params: (url, m) => ({ sessionId: m[1], status: url.searchParams.get("status") || undefined }) },
  { pattern: /^\/api\/autopilot\/directive\/add$/, post: true, method: "autopilot_directive_add", bodyParams: true },
  { pattern: /^\/api\/autopilot\/directive\/edit$/, post: true, method: "autopilot_directive_edit", bodyParams: true },
  { pattern: /^\/api\/autopilot\/directive\/delete$/, post: true, method: "autopilot_directive_delete", bodyParams: true },
];

const WS_FORWARD_ACTIONS = new Set([
  "gather_answer", "project_answer", "refinement_answer", "refinement_autopilot",
  "autopilot_start", "autopilot_pause", "autopilot_resume", "autopilot_stop",
  "autopilot_approve_item", "autopilot_reject_item", "autopilot_feedback_item",
  "autopilot_directive_add", "autopilot_directive_edit", "autopilot_directive_delete",
]);

// ── State ──

let daemonOnline = false;
let subscribeConn = null;
let config = null;
const browserWsClients = new Set();

// ── Socket Communication ──

const socketRequest = createSocketClient(SOCK_PATH, CLIENT_TIMEOUT_MS);

// ── System Prompt Builder ──

async function buildSystemPrompt(cwd) {
  const template = await readFile(path.join(TEMPLATES_DIR, "ucm-chat-system.md"), "utf-8");
  return template
    .replace(/\{\{CWD\}\}/g, cwd || os.homedir())
    .replace("{{NOTES_PATH}}", CHAT_NOTES_PATH);
}

// ── PTY Session Management ──

const ptySessions = new Map(); // ws → { pty, id, watcher }
let ptyIdCounter = 0;
const SESSION_ID_PATH = path.join(CHAT_DIR, "session-id");
const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

function getPtySessionCount() {
  return ptySessions.size;
}

async function loadSavedSessionId() {
  try {
    return (await readFile(SESSION_ID_PATH, "utf-8")).trim();
  } catch {
    return null;
  }
}

async function saveSessionId(id) {
  await mkdir(CHAT_DIR, { recursive: true });
  await writeFile(SESSION_ID_PATH, id, "utf-8");
}

// Discover the Claude projects directory for a given cwd by verifying
// that our known session file exists there. Returns null if unverified.
function discoverClaudeProjectDir(cwd, knownSessionId) {
  const encoded = cwd.replace(/\//g, "-");
  const candidate = path.join(CLAUDE_PROJECTS_DIR, encoded);
  try {
    fs.statSync(path.join(candidate, knownSessionId + ".jsonl"));
    return candidate;
  } catch {
    return null;
  }
}

// Watch Claude projects directory for new .jsonl files (/new detection).
// Returns watcher or null if directory could not be verified.
function startSessionWatcher(projectDir, currentSessionId, onNewSession) {
  const known = new Set();
  try {
    for (const f of fs.readdirSync(projectDir)) {
      if (f.endsWith(".jsonl")) known.add(f);
    }
  } catch {}

  const watcher = fs.watch(projectDir, (eventType, filename) => {
    if (!filename || !filename.endsWith(".jsonl")) return;
    if (eventType === "rename" && !known.has(filename)) {
      known.add(filename);
      const newId = filename.replace(".jsonl", "");
      onNewSession(newId);
    }
  });

  return watcher;
}

function spawnPtySession(ws, { cols, rows, cwd, newSession }) {
  if (getPtySessionCount() >= MAX_PTY_SESSIONS) {
    ws.send(JSON.stringify({ event: "pty:error", data: { message: "max PTY sessions reached" } }));
    return;
  }

  const pty = require("node-pty");
  const sessionId = ++ptyIdCounter;
  const resolvedCwd = cwd || os.homedir();

  buildSystemPrompt(resolvedCwd).then(async (systemPrompt) => {
    const args = ["--append-system-prompt", systemPrompt, "--dangerously-skip-permissions"];

    const savedId = newSession ? null : await loadSavedSessionId();
    let claudeSessionId;
    if (savedId) {
      args.push("--resume", savedId);
      claudeSessionId = savedId;
    } else {
      claudeSessionId = require("crypto").randomUUID();
      args.push("--session-id", claudeSessionId);
      await saveSessionId(claudeSessionId);
    }

    const ptyEnv = { ...process.env };
    delete ptyEnv.CLAUDECODE;
    const ptyProcess = pty.spawn("claude", args, {
      name: "xterm-256color",
      cols: cols || 80,
      rows: rows || 24,
      cwd: resolvedCwd,
      env: ptyEnv,
    });

    ptySessions.set(ws, { pty: ptyProcess, id: sessionId, watcher: null });

    // verify Claude projects directory and start watcher for /new detection
    setTimeout(() => {
      const projectDir = discoverClaudeProjectDir(resolvedCwd, claudeSessionId);
      if (projectDir) {
        const watcher = startSessionWatcher(projectDir, claudeSessionId, (newId) => {
          saveSessionId(newId).catch(() => {});
        });
        const session = ptySessions.get(ws);
        if (session) session.watcher = watcher;
      }
    }, 3000);

    ptyProcess.onData((data) => {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(Buffer.from(data, "utf-8"), { binary: true });
        }
      } catch {}
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      const session = ptySessions.get(ws);
      if (session?.watcher) session.watcher.close();
      ptySessions.delete(ws);

      // resume 실패(존재하지 않는 세션 ID) → 새 세션으로 자동 재시도
      if (exitCode !== 0 && savedId) {
        const fsp = require("fs/promises");
        fsp.rm(SESSION_ID_PATH, { force: true }).catch(() => {});
        spawnPtySession(ws, { cols, rows, cwd, newSession: true });
        return;
      }

      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ event: "pty:exit", data: { exitCode, signal } }));
        }
      } catch {}
    });

    ws.send(JSON.stringify({ event: "pty:spawned", data: { id: sessionId, cwd: resolvedCwd } }));
  }).catch((e) => {
    ws.send(JSON.stringify({ event: "pty:error", data: { message: e.message } }));
  });
}

function killPtySession(ws) {
  const session = ptySessions.get(ws);
  if (!session) return;
  if (session.watcher) session.watcher.close();
  try { session.pty.kill(); } catch {}
  ptySessions.delete(ws);
}

// ── Daemon Subscription ──

function connectDaemonSubscription() {
  const conn = net.createConnection(SOCK_PATH);
  let buf = "";
  let reconnecting = false;

  function scheduleReconnect() {
    if (reconnecting) return;
    reconnecting = true;
    subscribeConn = null;
    conn.destroy();
    if (daemonOnline) {
      daemonOnline = false;
      broadcastToBrowser("daemon:status", { status: "offline" });
    }
    setTimeout(connectDaemonSubscription, 3000);
  }

  conn.on("connect", () => {
    conn.write(JSON.stringify({ id: "sub", method: "subscribe", params: {} }) + "\n");
    subscribeConn = conn;
    daemonOnline = true;
    broadcastToBrowser("daemon:status", { status: "running" });
  });

  conn.on("data", (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.event) {
          broadcastToBrowser(msg.event, msg.data);
        }
      } catch {}
    }
  });

  conn.on("close", scheduleReconnect);
  conn.on("error", scheduleReconnect);
}

// ── Browser WS Broadcast ──

function broadcastToBrowser(event, data) {
  if (browserWsClients.size === 0) return;
  const msg = JSON.stringify({ event, data });
  for (const ws of browserWsClients) {
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    } catch { browserWsClients.delete(ws); }
  }
}

// ── HTTP Helpers ──

function jsonResponse(res, data, statusCode = 200) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) { req.destroy(); reject(new Error("payload too large")); return; }
      body += chunk;
    });
    req.on("end", () => {
      if (!body.trim()) { resolve({}); return; }
      try { resolve(JSON.parse(body)); } catch { reject(new Error("invalid JSON body")); }
    });
  });
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js" || ext === ".mjs") return "application/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".ico") return "image/x-icon";
  if (ext === ".txt") return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

// ── Daemon Management ──

async function startDaemonProcess() {
  await cleanStaleFiles();
  await mkdir(DAEMON_DIR, { recursive: true });

  const ucmdPath = path.join(__dirname, "ucmd.js");
  const logFd = fs.openSync(LOG_PATH, "a");
  const child = spawn(process.execPath, [ucmdPath, "start", "--foreground"], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  fs.closeSync(logFd);
  await writeFile(PID_PATH, String(child.pid));

  const deadline = Date.now() + SOCKET_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await socketRequest({ method: "stats", params: {} });
      return { ok: true, pid: child.pid };
    } catch {
      await new Promise((r) => setTimeout(r, SOCKET_POLL_INTERVAL_MS));
    }
  }

  throw new Error("daemon failed to start");
}

// ── Main Server ──

async function startUiServer(opts = {}) {
  process.on("uncaughtException", (err) => {
    console.error(`[FATAL] uncaughtException: ${err.stack || err.message}`);
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    console.error(`[ERROR] unhandledRejection: ${reason instanceof Error ? reason.stack : reason}`);
  });

  await ensureDirectories();
  config = await loadConfig();

  const port = opts.port || Number(process.env.UCM_UI_PORT) || config.uiPort || DEFAULT_CONFIG.uiPort;
  const devMode = opts.dev || false;
  let uiIndexHtml = null;

  try {
    const s = await stat(WEB_INDEX_PATH);
    if (!s.isFile()) throw new Error("index.html is not a file");
  } catch (e) {
    throw new Error(`React dashboard build not found at ${WEB_INDEX_PATH}. Run: cd ${path.join(__dirname, "..", "web")} && npm run build (${e.message})`);
  }
  if (!devMode) {
    uiIndexHtml = await readFile(WEB_INDEX_PATH, "utf-8");
  }

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const pathname = url.pathname;

    // CORS
    if (pathname.startsWith("/api/")) {
      const origin = req.headers.origin || "";
      if (origin && /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      }
      if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
    }

    try {
      // Daemon management
      if (pathname === "/api/daemon/status") {
        try {
          const stats = await socketRequest({ method: "stats", params: {} });
          jsonResponse(res, { online: true, ...stats });
        } catch {
          jsonResponse(res, { online: false });
        }
        return;
      }

      if (req.method === "POST" && pathname === "/api/daemon/start") {
        try {
          const result = await startDaemonProcess();
          jsonResponse(res, result);
        } catch (e) {
          jsonResponse(res, { error: e.message }, 500);
        }
        return;
      }

      if (req.method === "POST" && pathname === "/api/daemon/stop") {
        try {
          await socketRequest({ method: "shutdown", params: {} });
          jsonResponse(res, { ok: true });
        } catch (e) {
          jsonResponse(res, { error: e.message }, 500);
        }
        return;
      }

      // Browse API (local) — restricted to home directory
      if (pathname === "/api/browse") {
        const requestedPath = url.searchParams.get("path") || os.homedir();
        const showHidden = url.searchParams.get("showHidden") === "1";
        const resolved = path.resolve(requestedPath);
        const home = os.homedir();
        if (!resolved.startsWith(home + path.sep) && resolved !== home) {
          jsonResponse(res, { error: "access denied: path must be within home directory" }, 403);
          return;
        }
        try {
          const entries = await readdir(resolved, { withFileTypes: true });
          const directories = [];
          for (const entry of entries) {
            if (!showHidden && entry.name.startsWith(".")) continue;
            try {
              const fullPath = path.join(resolved, entry.name);
              const s = await stat(fullPath);
              if (s.isDirectory()) {
                directories.push({ name: entry.name, path: fullPath });
              }
            } catch {}
          }
          directories.sort((a, b) => a.name.localeCompare(b.name));
          jsonResponse(res, { current: resolved, parent: path.dirname(resolved), directories });
        } catch (e) {
          jsonResponse(res, { error: e.message }, 400);
        }
        return;
      }

      // Mkdir API (local) — restricted to home directory
      if (req.method === "POST" && pathname === "/api/mkdir") {
        let body;
        try { body = await readBody(req); } catch (e) {
          jsonResponse(res, { error: e.message }, 400); return;
        }
        const dirPath = body && body.path;
        if (!dirPath || typeof dirPath !== "string") {
          jsonResponse(res, { error: "path is required" }, 400);
          return;
        }
        const resolved = path.resolve(dirPath);
        const home = os.homedir();
        if (!resolved.startsWith(home + path.sep) && resolved !== home) {
          jsonResponse(res, { error: "access denied: path must be within home directory" }, 403);
          return;
        }
        try {
          await mkdir(resolved, { recursive: true });
          execFileSync("git", ["init"], { cwd: resolved, stdio: "ignore" });
          jsonResponse(res, { created: resolved, gitInit: true });
        } catch (e) {
          jsonResponse(res, { error: e.message }, 400);
        }
        return;
      }

      // Artifacts API (local)
      const artifactMatch = pathname.match(/^\/api\/artifacts\/([a-f0-9]+)$/);
      if (artifactMatch) {
        const taskId = artifactMatch[1];
        const artifactDir = path.join(ARTIFACTS_DIR, taskId);
        let files = [];
        try { files = await readdir(artifactDir); } catch {}
        let summary = null;
        try { summary = await readFile(path.join(artifactDir, "summary.md"), "utf-8"); } catch {}
        let memory = null;
        try { memory = JSON.parse(await readFile(path.join(artifactDir, "memory.json"), "utf-8")); } catch {}
        // Read JSON artifact file contents
        const contents = {};
        for (const f of files) {
          if (f.endsWith(".json") && f !== "memory.json") {
            try {
              contents[f] = JSON.parse(await readFile(path.join(artifactDir, f), "utf-8"));
            } catch {}
          }
        }
        jsonResponse(res, { taskId, summary, memory, files, contents });
        return;
      }

      // Proxy routes → daemon socket
      let body = null;
      if (req.method === "POST") {
        try {
          body = await readBody(req);
        } catch (e) {
          jsonResponse(res, { error: e.message }, 400);
          return;
        }
      }

      for (const route of PROXY_ROUTES) {
        const match = pathname.match(route.pattern);
        if (!match) continue;
        if (route.post && req.method !== "POST") continue;
        if (!route.post && req.method !== "GET") continue;

        if (!daemonOnline) {
          jsonResponse(res, { error: "daemon offline" }, 503);
          return;
        }

        let params = {};
        if (route.bodyParams && body) {
          params = body;
        } else if (route.params) {
          params = route.params(url, match, body || {});
        }

        try {
          const data = await socketRequest({ method: route.method, params });
          jsonResponse(res, data);
        } catch (e) {
          jsonResponse(res, { error: e.message }, 500);
        }
        return;
      }

      if (pathname.startsWith("/api/")) {
        jsonResponse(res, { error: "not found" }, 404);
        return;
      }

      // React static files (web/dist) + SPA fallback
      if (req.method === "GET" || req.method === "HEAD") {
        const relativePath = pathname.replace(/^\/+/, "");
        if (relativePath && relativePath !== "index.html") {
          const candidatePath = path.resolve(WEB_DIST_DIR, relativePath);
          const allowedPrefix = WEB_DIST_DIR + path.sep;
          if (candidatePath === WEB_DIST_DIR || candidatePath.startsWith(allowedPrefix)) {
            try {
              const fileStats = await stat(candidatePath);
              if (fileStats.isFile()) {
                const headers = { "Content-Type": contentTypeFor(candidatePath) };
                if (relativePath.startsWith("assets/")) {
                  headers["Cache-Control"] = "public, max-age=31536000, immutable";
                }
                res.writeHead(200, headers);
                if (req.method === "HEAD") {
                  res.end();
                } else {
                  res.end(await readFile(candidatePath));
                }
                return;
              }
            } catch {}
          }
        }

        const indexHtml = devMode ? await readFile(WEB_INDEX_PATH, "utf-8") : uiIndexHtml;
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
        res.end(indexHtml);
        return;
      }

      res.writeHead(405, { "Content-Type": "text/plain" });
      res.end("Method Not Allowed");
    } catch (e) {
      jsonResponse(res, { error: e.message }, 500);
    }
  });

  // WebSocket server
  const wss = new WebSocket.Server({ server: httpServer });
  wss.on("connection", (ws) => {
    browserWsClients.add(ws);

    ws.on("message", (raw, isBinary) => {
      // binary frame → PTY stdin
      if (isBinary) {
        const session = ptySessions.get(ws);
        if (session) {
          session.pty.write(raw.toString("utf-8"));
        }
        return;
      }

      // text frame → JSON control message
      try {
        const msg = JSON.parse(raw.toString());
        const { action, params } = msg;

        // PTY actions
        if (action === "pty:spawn") {
          spawnPtySession(ws, params || {});
          return;
        }
        if (action === "pty:data") {
          const session = ptySessions.get(ws);
          if (session && params?.data) {
            session.pty.write(params.data);
          }
          return;
        }
        if (action === "pty:resize") {
          const session = ptySessions.get(ws);
          if (session && params?.cols && params?.rows) {
            session.pty.resize(params.cols, params.rows);
          }
          return;
        }
        if (action === "pty:kill") {
          killPtySession(ws);
          return;
        }

        // forward to daemon socket
        if (WS_FORWARD_ACTIONS.has(action) && daemonOnline) {
          socketRequest({ method: action, params: params || {} }).catch(() => {});
          return;
        }

        // WS action handlers that match HTTP POST routes
        if (action && params) {
          const handlers = {
            submit: () => socketRequest({ method: "submit", params }),
            start: () => socketRequest({ method: "start", params }),
            approve: () => socketRequest({ method: "approve", params }),
            reject: () => socketRequest({ method: "reject", params }),
            cancel: () => socketRequest({ method: "cancel", params }),
            pause: () => socketRequest({ method: "pause", params: {} }),
            resume: () => socketRequest({ method: "resume", params: {} }),
            start_refinement: () => socketRequest({ method: "start_refinement", params }),
            finalize_refinement: () => socketRequest({ method: "finalize_refinement", params }),
            cancel_refinement: () => socketRequest({ method: "cancel_refinement", params }),
          };
          const handler = handlers[action];
          if (handler && daemonOnline) {
            handler()
              .then((result) => ws.send(JSON.stringify({ event: "action:result", data: { action, result } })))
              .catch((e) => ws.send(JSON.stringify({ event: "action:error", data: { action, error: e.message } })));
          }
        }
      } catch {}
    });

    ws.on("close", () => {
      killPtySession(ws);
      browserWsClients.delete(ws);
    });
    ws.on("error", () => {
      killPtySession(ws);
      browserWsClients.delete(ws);
    });

    // send initial daemon status
    try {
      ws.send(JSON.stringify({ event: "daemon:status", data: { status: daemonOnline ? "running" : "offline" } }));
    } catch {}
  });

  await new Promise((resolve, reject) => {
    httpServer.on("error", (e) => {
      if (e.code === "EADDRINUSE") {
        reject(new Error(`port ${port} is already in use. Is ucmd or another UI server already running? Use --port to specify a different port.`));
      } else {
        reject(e);
      }
    });
    httpServer.listen(port, () => resolve());
  });

  console.log(`UCM UI server listening on http://localhost:${port}${devMode ? " (dev mode)" : ""}`);

  // start daemon subscription
  connectDaemonSubscription();

  // keep process alive
  function shutdown() {
    // kill all PTY sessions
    for (const [ws, session] of ptySessions) {
      try { session.pty.kill(); } catch {}
    }
    ptySessions.clear();

    if (subscribeConn) try { subscribeConn.end(); } catch {}
    for (const ws of browserWsClients) try { ws.close(); } catch {}
    httpServer.close();
    process.exit(0);
  }

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

module.exports = { startUiServer, PROXY_ROUTES };
