// test/helpers/test-infra.js — shared test infrastructure
// Extracted from test/integration.js and test/browser.js

const { spawn } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const net = require("node:net");
const http = require("node:http");

const { trackPid, cleanupAll } = require("./cleanup.js");
const { ensureWebDistBuilt } = require("./web-build.js");

class TestEnvironment {
  constructor(prefix = "ucm-dashboard-test") {
    this.prefix = prefix;
    this.ucmDir = path.join(os.tmpdir(), `${prefix}-${Date.now()}`);
    this.daemonDir = path.join(this.ucmDir, "daemon");
    this.sockPath = path.join(this.daemonDir, "ucm.sock");
    this.tasksDir = path.join(this.ucmDir, "tasks");

    this.daemonProcess = null;
    this.uiProcess = null;
    this.uiPort = 0;
  }

  setupDirs(configOverrides = {}) {
    const mkdirp = (dir) => fs.mkdirSync(dir, { recursive: true });

    mkdirp(this.daemonDir);
    for (const sub of ["pending", "running", "review", "done", "failed"]) {
      mkdirp(path.join(this.tasksDir, sub));
    }
    mkdirp(path.join(this.ucmDir, "worktrees"));
    mkdirp(path.join(this.ucmDir, "workspaces"));
    mkdirp(path.join(this.ucmDir, "artifacts"));
    mkdirp(path.join(this.ucmDir, "logs"));
    mkdirp(path.join(this.ucmDir, "lessons"));
    mkdirp(path.join(this.ucmDir, "proposals"));
    for (const sub of ["proposed", "approved", "rejected", "implemented"]) {
      mkdirp(path.join(this.ucmDir, "proposals", sub));
    }
    mkdirp(path.join(this.ucmDir, "snapshots"));

    const config = {
      concurrency: 1,
      provider: "claude",
      model: "opus",
      scanIntervalMs: 60000,
      pipeline: ["analyze", "implement"],
      defaultPipeline: "quick",
      stageTimeoutMs: 30000,
      httpPort: 0,
      uiPort: 0,
      resources: {
        cpuThreshold: 0.8,
        memoryMinFreeMb: 512,
        diskMinFreeGb: 1,
        checkIntervalMs: 60000,
      },
      cleanup: { retentionDays: 7, autoCleanOnDiskPressure: true },
      quota: {
        source: "ccusage",
        mode: "work",
        modes: {
          work: { windowBudgetPercent: 50 },
          off: { windowBudgetPercent: 90 },
        },
        softLimitPercent: 80,
        hardLimitPercent: 95,
      },
      infra: {
        slots: 1,
        composeFile: "docker-compose.test.yml",
        upTimeoutMs: 60000,
        downAfterTest: true,
        browserSlots: 1,
      },
      observer: {
        enabled: false,
        intervalMs: 14400000,
        taskCountTrigger: 10,
        maxProposalsPerCycle: 5,
        dataWindowDays: 7,
        proposalRetentionDays: 30,
      },
      selfImprove: {
        enabled: false,
        maxRisk: "low",
        requirePassingTests: true,
        backupBranch: true,
      },
      regulator: { enabled: false },
      ...configOverrides,
    };
    fs.writeFileSync(
      path.join(this.ucmDir, "config.json"),
      JSON.stringify(config, null, 2),
    );
  }

  socketRequest(method, params = {}) {
    const sockPath = this.sockPath;
    return new Promise((resolve, reject) => {
      const conn = net.createConnection(sockPath);
      let buffer = "";
      const timer = setTimeout(() => {
        conn.destroy();
        reject(new Error("socket timeout"));
      }, 10000);

      conn.on("connect", () => {
        conn.write(`${JSON.stringify({ id: "test", method, params })}\n`);
      });

      conn.on("data", (chunk) => {
        buffer += chunk;
        const idx = buffer.indexOf("\n");
        if (idx !== -1) {
          clearTimeout(timer);
          const line = buffer.slice(0, idx);
          try {
            const response = JSON.parse(line);
            if (response.ok) resolve(response.data);
            else reject(new Error(response.error || "unknown error"));
          } catch (e) {
            reject(new Error(`parse error: ${e.message}`));
          }
          conn.end();
        }
      });

      conn.on("error", (e) => {
        clearTimeout(timer);
        conn.destroy();
        reject(e);
      });
    });
  }

  httpRequest(method, urlPath, body = null) {
    const port = this.uiPort;
    return new Promise((resolve, reject) => {
      const url = new URL(urlPath, `http://localhost:${port}`);
      const options = {
        hostname: "localhost",
        port,
        path: url.pathname + url.search,
        method,
        headers: { "Content-Type": "application/json" },
      };

      const req = http.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: JSON.parse(data),
            });
          } catch {
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: data,
            });
          }
        });
      });

      req.on("error", reject);
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error("http timeout"));
      });

      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  }

  waitForSocket(timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
      const attempt = () => {
        if (Date.now() > deadline) return reject(new Error("socket not ready"));
        this.socketRequest("stats")
          .then(resolve)
          .catch(() => setTimeout(attempt, 200));
      };
      attempt();
    });
  }

  waitForUiServer(timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
      const attempt = () => {
        if (Date.now() > deadline)
          return reject(new Error("UI server not ready"));
        this.httpRequest("GET", "/api/daemon/status")
          .then((res) => resolve(res))
          .catch(() => setTimeout(attempt, 200));
      };
      attempt();
    });
  }

  findFreePort() {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.listen(0, () => {
        const port = server.address().port;
        server.close(() => resolve(port));
      });
    });
  }

  async startDaemon() {
    this.setupDirs();

    const ucmdPath = path.join(__dirname, "..", "..", "lib", "ucmd.js");
    this.daemonProcess = spawn(
      process.execPath,
      [ucmdPath, "start", "--foreground"],
      {
        env: { ...process.env, UCM_DIR: this.ucmDir },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    trackPid(this.daemonProcess.pid);

    this.daemonProcess.on("error", (e) => {
      console.error("daemon spawn error:", e.message);
    });

    await this.waitForSocket();
  }

  async startUiServer() {
    ensureWebDistBuilt();
    this.uiPort = await this.findFreePort();
    const uiPath = path.join(__dirname, "..", "..", "lib", "ucm-ui-server.js");

    this.uiProcess = spawn(
      process.execPath,
      [
        "-e",
        `
      process.env.UCM_DIR = ${JSON.stringify(this.ucmDir)};
      process.env.UCM_UI_PORT = ${JSON.stringify(String(this.uiPort))};
      const { startUiServer } = require(${JSON.stringify(uiPath)});
      startUiServer({ port: ${this.uiPort} }).catch((e) => {
        console.error(e.message);
        process.exit(1);
      });
    `,
      ],
      {
        env: {
          ...process.env,
          UCM_DIR: this.ucmDir,
          UCM_UI_PORT: String(this.uiPort),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    trackPid(this.uiProcess.pid);

    await this.waitForUiServer();
  }

  async startAll() {
    await this.startDaemon();
    await this.startUiServer();
  }

  async cleanup() {
    await cleanupAll();
    try {
      fs.rmSync(this.ucmDir, { recursive: true, force: true });
    } catch {}
  }

  get url() {
    return `http://localhost:${this.uiPort}`;
  }
}

module.exports = { TestEnvironment };
