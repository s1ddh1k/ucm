import { BrowserWindow, BrowserView, Tray } from "electrobun/bun";
import type { AppRPC } from "./rpc.ts";
import { runController, type ControllerStatus } from "../controller.ts";
import { createDynamicSpawnAgent } from "../spawn.ts";
import type { AdaptivePlan, LoopEvent, ReviewPack, SpawnAgent, Task } from "../types.ts";
import {
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_HARD_TIMEOUT_MS,
} from "../constants.ts";

const isE2E = !!process.env.UCM_E2E_TEST;
const e2eProjectPath = process.env.UCM_E2E_PROJECT_PATH;
const e2eMockAgentPath = process.env.UCM_E2E_MOCK_AGENT;
const e2eResultPath = process.env.UCM_E2E_RESULT_PATH;

function buildE2ESpawnAgent(): SpawnAgent | undefined {
  if (!isE2E || !e2eMockAgentPath) return undefined;

  const taskJson = process.env.UCM_E2E_TASK_JSON ?? JSON.stringify({
    goal: "E2E test feature",
    context: "Automated test",
    acceptance: "e2e.txt exists",
    constraints: "stay inside the repository",
  });

  return createDynamicSpawnAgent((prompt) => {
    const baseEnv: Record<string, string> = {
      PATH: process.env.PATH!,
      HOME: process.env.HOME!,
    };

    if (prompt.includes("task definition assistant")) {
      return {
        cmd: "bun",
        args: [e2eMockAgentPath],
        env: { ...baseEnv, MOCK_BEHAVIOR: "json_response", MOCK_JSON: taskJson },
      };
    }

    if (prompt.includes("implementation agent")) {
      return {
        cmd: "bun",
        args: [e2eMockAgentPath],
        env: {
          ...baseEnv,
          MOCK_BEHAVIOR: "implement",
          MOCK_FILENAME: "e2e.txt",
          MOCK_CONTENT: "e2e test content\n",
        },
      };
    }

    if (prompt.includes("verification agent")) {
      return {
        cmd: "bun",
        args: [e2eMockAgentPath],
        env: {
          ...baseEnv,
          MOCK_BEHAVIOR: "json_response",
          MOCK_JSON: '{"passed":true,"keepChanges":true,"reason":"e2e pass"}',
        },
      };
    }

    return {
      cmd: "bun",
      args: [e2eMockAgentPath],
      env: { ...baseEnv, MOCK_BEHAVIOR: "succeed" },
    };
  });
}

let resolveTaskApproval: ((approved: boolean) => void) | null = null;
let resolveMergeApproval: ((approved: boolean) => void) | null = null;
let resolveUserInput: ((text: string) => void) | null = null;

function emitPlan(plan: AdaptivePlan): void {
  win.webview.rpc.send.planReady({ plan });
}

function emitReview(review: ReviewPack): void {
  win.webview.rpc.send.reviewReady({ review });
}

const rpc = BrowserView.defineRPC<AppRPC>({
  maxRequestTime: 600_000,
  handlers: {
    requests: {
      startController: async (params) => {
        const e2eAgent = buildE2ESpawnAgent();

        const result = await runController(
          {
            provider: params.provider,
            model: params.model,
            projectPath: params.projectPath,
            maxIterations: params.maxIterations,
            idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
            hardTimeoutMs: DEFAULT_HARD_TIMEOUT_MS,
            autoApprove: params.autoApprove,
            resume: params.resume,
          },
          {
            ...(e2eAgent ? { spawnAgent: e2eAgent } : {}),
            onStatusChange: (status: ControllerStatus) => {
              win.webview.rpc.send.statusChange({ status });
            },
            onPhase1Message: (text: string) => {
              win.webview.rpc.send.phase1Message({ text });
            },
            onUserInput: (prompt: string) => {
              win.webview.rpc.send.requestUserInput({ prompt });
              return new Promise<string>((resolve) => {
                resolveUserInput = resolve;
              });
            },
            onTaskProposed: (task: Task) => {
              win.webview.rpc.send.requestTaskApproval({ task });
              return new Promise<boolean>((resolve) => {
                resolveTaskApproval = resolve;
              });
            },
            onPlanReady: emitPlan,
            onPhase2Event: (event: LoopEvent) => {
              win.webview.rpc.send.phase2Event({ event });
            },
            onReviewReady: emitReview,
            onApproveMerge: () => {
              win.webview.rpc.send.requestMergeApproval({});
              return new Promise<boolean>((resolve) => {
                resolveMergeApproval = resolve;
              });
            },
          },
        );

        win.webview.rpc.send.controllerDone(result);

        if (isE2E && e2eResultPath) {
          await Bun.write(e2eResultPath, JSON.stringify(result));
          setTimeout(() => process.exit(0), 500);
        }

        return result;
      },

      approveTask: ({ approved }) => {
        resolveTaskApproval?.(approved);
        resolveTaskApproval = null;
      },

      approveMerge: ({ approved }) => {
        resolveMergeApproval?.(approved);
        resolveMergeApproval = null;
      },

      submitUserInput: ({ text }) => {
        resolveUserInput?.(text);
        resolveUserInput = null;
      },
    },
    messages: {},
  },
});

const win = new BrowserWindow({
  title: "UCM",
  url: "views://ui/index.html",
  frame: { width: 1200, height: 820, x: 200, y: 200 },
  rpc,
});

new Tray({
  title: "UCM",
});

if (isE2E && e2eProjectPath) {
  console.log("[E2E] Test mode active");
  console.log("[E2E] projectPath:", e2eProjectPath);
  console.log("[E2E] mockAgent:", e2eMockAgentPath);
  console.log("[E2E] resultPath:", e2eResultPath);

  const e2eAgent = buildE2ESpawnAgent();

  win.webview.on("dom-ready", async () => {
    console.log("[E2E] DOM ready, starting controller from bun process...");

    try {
      const result = await runController(
        {
          provider: "claude",
          projectPath: e2eProjectPath,
          maxIterations: 3,
          idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
          hardTimeoutMs: DEFAULT_HARD_TIMEOUT_MS,
          autoApprove: true,
          resume: false,
        },
        {
          ...(e2eAgent ? { spawnAgent: e2eAgent } : {}),
          onStatusChange: (status) => {
            console.log("[E2E] status:", status);
            win.webview.rpc.send.statusChange({ status });
          },
          onPhase1Message: (text) => {
            win.webview.rpc.send.phase1Message({ text });
          },
          onTaskProposed: async (task) => {
            console.log("[E2E] task proposed:", task.goal);
            win.webview.rpc.send.taskProposed({ task });
            return true;
          },
          onPlanReady: emitPlan,
          onPhase2Event: (event) => {
            console.log("[E2E] event:", event.type);
            win.webview.rpc.send.phase2Event({ event });
          },
          onReviewReady: emitReview,
        },
      );

      console.log("[E2E] Controller done:", result.status);
      win.webview.rpc.send.controllerDone(result);

      if (e2eResultPath) {
        await Bun.write(e2eResultPath, JSON.stringify(result));
        console.log("[E2E] Result written to:", e2eResultPath);
        setTimeout(() => process.exit(0), 500);
      }
    } catch (err) {
      console.error("[E2E] Error:", err);
      if (e2eResultPath) {
        await Bun.write(e2eResultPath, JSON.stringify({ status: "error", error: String(err) }));
        setTimeout(() => process.exit(1), 500);
      }
    }
  });
}
