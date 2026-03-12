import { describe, it, assert } from "./harness.ts";
import { createTempGitRepo, cleanupDir, mockAgentPath } from "./helpers.ts";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

const V2_DIR = join(import.meta.dir, "..");
const REQUIRE_APP_E2E = process.env.UCM_REQUIRE_APP_E2E === "1";

function resolveAppLauncher(): string | null {
  const override = process.env.UCM_APP_LAUNCHER;
  if (override) return override;

  const candidates = [
    join(V2_DIR, "build/dev-macos-arm64/UCM-dev.app/Contents/MacOS/launcher"),
    join(V2_DIR, "build/stable-macos-arm64/UCM.app/Contents/MacOS/launcher"),
    join(V2_DIR, "build/stable-macos-arm64/UCM-stable.app/Contents/MacOS/launcher"),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

const APP_LAUNCHER = resolveAppLauncher();

function shouldSkipAppE2E(): boolean {
  return !APP_LAUNCHER && !REQUIRE_APP_E2E;
}

function requireAppLauncher(): string {
  if (APP_LAUNCHER) return APP_LAUNCHER;
  throw new Error(
    "app launcher not found. Run `bun run build:dev` or set UCM_APP_LAUNCHER before running test:app",
  );
}

/**
 * Electrobun 앱을 E2E 테스트 모드로 실행.
 * 실제 BrowserWindow가 뜨고, webview UI가 로드되고,
 * bun↔webview RPC가 동작하고, controller가 전체 흐름을 실행.
 * mock-agent.ts로 CLI를 대체.
 */
async function runAppE2E(opts: {
  projectPath: string;
  resultPath: string;
  taskJson?: string;
  timeoutMs?: number;
}): Promise<{ status: string; task: unknown; plan?: unknown; review?: unknown } | null> {
  const { projectPath, resultPath, timeoutMs = 60_000 } = opts;
  let stdoutTail = "";
  let stderrTail = "";

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    UCM_E2E_TEST: "1",
    UCM_E2E_PROJECT_PATH: projectPath,
    UCM_E2E_MOCK_AGENT: mockAgentPath(),
    UCM_E2E_RESULT_PATH: resultPath,
    NODE_TLS_REJECT_UNAUTHORIZED: "0",
  };
  if (opts.taskJson) {
    env.UCM_E2E_TASK_JSON = opts.taskJson;
  }

  const child = spawn(requireAppLauncher(), [], {
    cwd: V2_DIR,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    stdoutTail = `${stdoutTail}${chunk.toString()}`.slice(-8000);
  });
  child.stderr.on("data", (chunk) => {
    stderrTail = `${stderrTail}${chunk.toString()}`.slice(-8000);
  });

  return new Promise<{ status: string; task: unknown; plan?: unknown; review?: unknown } | null>((resolve) => {
    let settled = false;
    let childExited = false;

    const finish = (value: { status: string; task: unknown; plan?: unknown; review?: unknown } | null) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(deadline);
      resolve(value);
    };

    const deadline = setTimeout(() => {
      if (!childExited) child.kill("SIGTERM");
      if (!existsSync(resultPath) && (stdoutTail || stderrTail)) {
        console.log("    - app stdout tail:", stdoutTail.trim());
        console.log("    - app stderr tail:", stderrTail.trim());
      }
      finish(readResultFile(resultPath));
    }, timeoutMs);

    const poll = setInterval(() => {
      if (existsSync(resultPath)) {
        finish(readResultFile(resultPath));
        if (!childExited) {
          setTimeout(() => child.kill("SIGTERM"), 1000);
        }
      }
    }, 500);

    child.on("exit", () => {
      childExited = true;
      if (existsSync(resultPath)) {
        finish(readResultFile(resultPath));
      }
    });
  });
}

function readResultFile(path: string): { status: string; task: unknown; plan?: unknown; review?: unknown } | null {
  if (!existsSync(path)) return null;
  try {
    const content = require("fs").readFileSync(path, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

describe("E2E: Electrobun App", () => {
  it("full lifecycle: app launch → BrowserWindow → RPC → phase1 → phase2 → merge → exit", async () => {
    if (shouldSkipAppE2E()) {
      console.log("    - skipping built app E2E (launcher not found)");
      return;
    }
    const repoDir = await createTempGitRepo();
    const resultPath = join(tmpdir(), `ucm-e2e-${Date.now()}.json`);

    try {
      const result = await runAppE2E({ projectPath: repoDir, resultPath });

      // 앱이 결과를 생성했는지
      assert(result !== null, "app should produce a result");
      assert.equal(result!.status, "done");

      // 태스크가 올바르게 생성되었는지
      const task = result!.task as { goal: string; context: string; acceptance: string };
      assert(task !== null, "should have a task");
      assert.equal(task.goal, "E2E test feature");
      assert(result!.plan !== null, "adaptive plan should be returned");
      assert(result!.review !== null, "review pack should be returned");

      // 머지 후 파일이 메인 브랜치에 존재하는지
      assert(existsSync(join(repoDir, "e2e.txt")), "e2e.txt should be merged to main");
      const content = await Bun.file(join(repoDir, "e2e.txt")).text();
      assert(content.startsWith("e2e test content\n"), "file content should match");
    } finally {
      await cleanupDir(repoDir);
      try { await unlink(resultPath); } catch {}
    }
  });

  it("E2E: custom task JSON propagates through app", async () => {
    if (shouldSkipAppE2E()) {
      console.log("    - skipping built app E2E (launcher not found)");
      return;
    }
    const repoDir = await createTempGitRepo();
    const resultPath = join(tmpdir(), `ucm-e2e-custom-${Date.now()}.json`);
    const customTask = JSON.stringify({
      goal: "Custom E2E goal",
      context: "Custom context",
      acceptance: "e2e.txt exists",
      constraints: "stay inside the repo",
    });

    try {
      const result = await runAppE2E({
        projectPath: repoDir,
        resultPath,
        taskJson: customTask,
      });

      assert(result !== null, "app should produce a result");
      assert.equal(result!.status, "done");
      const task = result!.task as { goal: string };
      assert.equal(task.goal, "Custom E2E goal");
      assert(result!.plan !== null);
      assert(result!.review !== null);
    } finally {
      await cleanupDir(repoDir);
      try { await unlink(resultPath); } catch {}
    }
  });
});
