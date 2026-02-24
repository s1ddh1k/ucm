import { homedir } from "node:os";
import { join, resolve } from "node:path";

const DESKTOP_UCM_DIR = join(homedir(), ".ucm-desktop");
const DESKTOP_UI_PORT = 17173;

type DaemonStatus = "stopped" | "starting" | "running";
type OnCrashCallback = (code: number | null) => void;

export class DaemonManager {
  private child: ReturnType<typeof Bun.spawn> | null = null;
  private port = DESKTOP_UI_PORT;
  private status: DaemonStatus = "stopped";
  private onCrash: OnCrashCallback | null = null;

  setOnCrash(callback: OnCrashCallback) {
    this.onCrash = callback;
  }

  async start(): Promise<{ port: number }> {
    if (this.status === "running") {
      return { port: this.port };
    }
    if (this.status === "starting") {
      throw new Error("daemon is already starting");
    }

    this.status = "starting";

    // In Electrobun, bundled bun code runs from the app's Resources/app/bun/ directory.
    // The copy rules place UCM files at ucm/lib/ relative to the app root.
    const embeddedPath = resolve(import.meta.dir, "../ucm/lib/ucm-embedded.js");

    return new Promise<{ port: number }>((promiseResolve, promiseReject) => {
      let settled = false;
      const startupTimeout = setTimeout(() => {
        if (!settled && this.status === "starting") {
          settle();
          child.kill("SIGTERM");
          this.child = null;
          this.status = "stopped";
          promiseReject(new Error("daemon startup timed out (15s)"));
        }
      }, 15000);

      function settle() {
        if (settled) return false;
        settled = true;
        clearTimeout(startupTimeout);
        return true;
      }

      const child = Bun.spawn(["node", embeddedPath], {
        env: {
          ...process.env,
          UCM_DIR: DESKTOP_UCM_DIR,
          UCM_UI_PORT: String(this.port),
        },
        serialization: "json",
        ipc: (message) => {
          if (message.type === "ready" && settle()) {
            this.status = "running";
            promiseResolve({ port: message.port || this.port });
          }
          if (message.type === "error" && settle()) {
            this.child = null;
            this.status = "stopped";
            promiseReject(
              new Error(message.message || "daemon startup failed"),
            );
          }
        },
      });
      this.child = child;

      child.exited.then((code) => {
        const wasRunning = this.status === "running";
        this.child = null;
        this.status = "stopped";

        if (settle()) {
          promiseReject(
            new Error(`daemon exited during startup with code ${code}`),
          );
        } else if (wasRunning && this.onCrash) {
          this.onCrash(code);
        }
      });
    });
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;

    child.kill("SIGTERM");
    const exited = await Promise.race([
      child.exited.then(() => true),
      Bun.sleep(10000).then(() => false),
    ]);

    if (!exited) {
      child.kill("SIGKILL");
      await child.exited;
    }

    this.child = null;
    this.status = "stopped";
  }

  getStatus(): DaemonStatus {
    return this.status;
  }

  getPort(): number {
    return this.port;
  }
}
