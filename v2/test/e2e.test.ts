import { describe, it, assert } from "./harness.ts";
import { createTempGitRepo, cleanupDir, mockAgentPath } from "./helpers.ts";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

const V2_DIR = join(import.meta.dir, "..");
const APP_LAUNCHER = join(V2_DIR, "build/dev-macos-arm64/UCM-dev.app/Contents/MacOS/launcher");

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
}): Promise<{ status: string; task: unknown } | null> {
  const { projectPath, resultPath, timeoutMs = 45_000 } = opts;

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

  const child = spawn(APP_LAUNCHER, [], {
    cwd: V2_DIR,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  return new Promise<{ status: string; task: unknown } | null>((resolve) => {
    const deadline = setTimeout(() => {
      child.kill("SIGTERM");
      resolve(null);
    }, timeoutMs);

    const poll = setInterval(() => {
      if (existsSync(resultPath)) {
        clearInterval(poll);
        clearTimeout(deadline);
        try {
          const content = require("fs").readFileSync(resultPath, "utf-8");
          resolve(JSON.parse(content));
        } catch {
          resolve(null);
        }
        setTimeout(() => child.kill("SIGTERM"), 1000);
      }
    }, 500);

    child.on("exit", () => {
      clearInterval(poll);
      clearTimeout(deadline);
      if (existsSync(resultPath)) {
        try {
          const content = require("fs").readFileSync(resultPath, "utf-8");
          resolve(JSON.parse(content));
        } catch {
          resolve(null);
        }
      } else {
        resolve(null);
      }
    });
  });
}

describe("E2E: Electrobun App", () => {
  it("full lifecycle: app launch → BrowserWindow → RPC → phase1 → phase2 → merge → exit", async () => {
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
    const repoDir = await createTempGitRepo();
    const resultPath = join(tmpdir(), `ucm-e2e-custom-${Date.now()}.json`);
    const customTask = JSON.stringify({
      goal: "Custom E2E goal",
      context: "Custom context",
      acceptance: "e2e.txt exists",
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
    } finally {
      await cleanupDir(repoDir);
      try { await unlink(resultPath); } catch {}
    }
  });
});
