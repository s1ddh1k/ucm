// test/helpers/web-test-infra.js — test infrastructure for web/ frontend
// Extends TestEnvironment to also start Vite dev server proxying to the UI server

const { spawn } = require("node:child_process");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");
const { TestEnvironment } = require("./test-infra.js");
const { trackPid, killDaemon } = require("./cleanup.js");

class WebTestEnvironment extends TestEnvironment {
  constructor(prefix = "ucm-web-test") {
    super(prefix);
    this.viteProcess = null;
    this.vitePort = 0;
  }

  async findFreePort() {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.listen(0, () => {
        const port = server.address().port;
        server.close(() => resolve(port));
      });
    });
  }

  async startViteDevServer() {
    this.vitePort = await this.findFreePort();
    const webDir = path.join(__dirname, "..", "..", "web");

    this.viteProcess = spawn(
      path.join(webDir, "node_modules", ".bin", "vite"),
      ["--port", String(this.vitePort), "--strictPort"],
      {
        cwd: webDir,
        env: {
          ...process.env,
          // Override Vite proxy target to our test UI server
          VITE_API_TARGET: `http://localhost:${this.uiPort}`,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    trackPid(this.viteProcess.pid);

    this.viteProcess.on("error", (e) => {
      console.error("vite spawn error:", e.message);
    });

    await this.waitForViteServer();
  }

  waitForViteServer(timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
      const attempt = () => {
        if (Date.now() > deadline)
          return reject(new Error("Vite dev server not ready"));
        http
          .get(`http://localhost:${this.vitePort}`, (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => {
              if (res.statusCode === 200) resolve();
              else setTimeout(attempt, 300);
            });
          })
          .on("error", () => setTimeout(attempt, 300));
      };
      attempt();
    });
  }

  async startAll() {
    await this.startDaemon();
    await this.startUiServer();
    await this.startViteDevServer();
  }

  async cleanup() {
    if (this.viteProcess) {
      await killDaemon(this.viteProcess.pid, { waitMs: 2000 });
      this.viteProcess = null;
    }
    await super.cleanup();
  }

  get webUrl() {
    return `http://localhost:${this.vitePort}`;
  }
}

module.exports = { WebTestEnvironment };
