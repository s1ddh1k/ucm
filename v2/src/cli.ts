#!/usr/bin/env bun

import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { runController } from "./controller.ts";
import { loadState } from "./state.ts";
import type { AdaptivePlan, Config, LoopEvent, ReviewPack, Task } from "./types.ts";
import {
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_HARD_TIMEOUT_MS,
} from "./constants.ts";

interface ParsedArgs {
  projectPath: string;
  provider: "claude" | "codex";
  model?: string;
  maxIterations: number;
  autoApprove: boolean;
  resume: boolean;
  testCommand?: string;
  recursive: boolean;
  help: boolean;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const result: ParsedArgs = {
    projectPath: ".",
    provider: "claude",
    model: undefined,
    maxIterations: DEFAULT_MAX_ITERATIONS,
    autoApprove: false,
    resume: false,
    testCommand: undefined,
    recursive: false,
    help: false,
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    if (arg === "-h" || arg === "--help") {
      result.help = true;
      i++;
    } else if (arg === "--provider") {
      const val = argv[++i];
      if (val !== "claude" && val !== "codex") {
        throw new Error(`invalid provider: ${val}`);
      }
      result.provider = val;
      i++;
    } else if (arg === "--model") {
      result.model = argv[++i];
      i++;
    } else if (arg === "--max-iterations") {
      result.maxIterations = Number(argv[++i]);
      if (!Number.isFinite(result.maxIterations) || result.maxIterations < 1) {
        throw new Error(`invalid max-iterations: ${argv[i]}`);
      }
      i++;
    } else if (arg === "--auto-approve") {
      result.autoApprove = true;
      i++;
    } else if (arg === "--resume") {
      result.resume = true;
      i++;
    } else if (arg === "--test-command") {
      result.testCommand = argv[++i];
      if (!result.testCommand) throw new Error("--test-command requires a value");
      i++;
    } else if (arg === "--recursive") {
      result.recursive = true;
      i++;
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown flag: ${arg}`);
    } else {
      result.projectPath = arg;
      i++;
    }
  }

  result.projectPath = resolve(result.projectPath);
  return result;
}

const HELP = `ucm [project-path] [options]

Options:
  --provider <claude|codex>   AI provider (default: claude)
  --model <model>             Model override
  --max-iterations <n>        Max implementation cycles (default: ${DEFAULT_MAX_ITERATIONS})
  --auto-approve              Skip approval prompts
  --resume                    Resume saved state (error if none)
  --test-command <cmd>        Run test command after verify pass
  --recursive                 Re-run with improved code after merge
  -h, --help                  Show this help`;

function formatEvent(event: LoopEvent): string {
  switch (event.type) {
    case "implement_start":
      return `[iteration ${event.iteration}] implementing...`;
    case "implement_done":
      return `[iteration ${event.iteration}] implementation done`;
    case "verify_start":
      return `[iteration ${event.iteration}] verifying...`;
    case "verify_done":
      return event.result.passed
        ? `[verify] passed`
        : `[verify] failed - ${event.result.reason}`;
    case "tool_start":
      return `[tool:${event.stage}] ${event.tool}...`;
    case "tool_done":
      return `[tool:${event.result.stage}] ${event.result.tool} - ${event.result.summary}`;
    case "review_blocked":
      return `[review] blocked on iteration ${event.iteration}\n${event.issues.map((issue) => `- [${issue.severity}] ${issue.summary}`).join("\n")}`;
    case "test_start":
      return `[test] running...`;
    case "test_done":
      return event.passed
        ? `[test] passed`
        : `[test] failed\n${event.output}`;
    case "passed":
      return `[done] all checks passed`;
    case "max_iterations":
      return `[done] max iterations reached`;
    case "error":
      return `[error] ${event.message}`;
  }
}

function formatTask(task: Task): string {
  return [
    `\nGoal: ${task.goal}`,
    `Context: ${task.context}`,
    `Acceptance: ${task.acceptance}`,
    `Constraints: ${task.constraints?.trim() || "none"}\n`,
  ].join("\n");
}

function formatPlan(plan: AdaptivePlan): string {
  const lines = [`\nAdaptive Plan: ${plan.summary}`];
  for (const tool of plan.tools) {
    lines.push(`- ${tool.tool} [${tool.stage}] ${tool.rationale}`);
  }
  return lines.join("\n");
}

function formatReview(review: ReviewPack): string {
  return [
    "\nReview Pack",
    `Base: ${review.baseBranch}`,
    `Branch: ${review.branchName}`,
    `Iterations: ${review.iterations}`,
    `Reason: ${review.finalReason}`,
    `Changed Files: ${review.changedFiles.length > 0 ? review.changedFiles.join(", ") : "none"}`,
    `File Stats: ${review.files.length > 0 ? review.files.map((file) => `${file.path} (+${file.additions}/-${file.deletions})`).join(" | ") : "none"}`,
    `Commits: ${review.commits.length > 0 ? review.commits.join(" | ") : "none"}`,
    `Review Issues: ${review.reviewIssues.length > 0 ? review.reviewIssues.map((issue) => `[${issue.severity}] ${issue.summary}`).join(" | ") : "none"}`,
    `Diff Stat:\n${review.diffStat || "none"}`,
    `Test Output:\n${review.testOutput || "Not run"}`,
  ].join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(HELP);
    return;
  }

  if (args.resume) {
    const saved = await loadState(args.projectPath);
    if (!saved) {
      console.error("error: no saved state to resume");
      process.exit(1);
    }
  }

  const config: Config = {
    provider: args.provider,
    model: args.model,
    projectPath: args.projectPath,
    maxIterations: args.maxIterations,
    idleTimeoutMs: DEFAULT_IDLE_TIMEOUT_MS,
    hardTimeoutMs: DEFAULT_HARD_TIMEOUT_MS,
    autoApprove: args.autoApprove,
    resume: args.resume,
    testCommand: args.testCommand,
  };

  const rl = createInterface({ input: stdin, output: stdout });

  const confirm = async (prompt: string): Promise<boolean> => {
    const answer = await rl.question(prompt);
    return answer.trim().toLowerCase() !== "n";
  };

  try {
    const { status, task, plan, review } = await runController(config, {
      onStatusChange: (controllerStatus) => console.log(`[status] ${controllerStatus}`),
      onPhase1Message: (text) => console.log(text),
      onUserInput: (prompt) => rl.question(`${prompt}\n> `),
      onTaskProposed: async (proposedTask) => {
        console.log(formatTask(proposedTask));
        return args.autoApprove || (await confirm("Approve? [Y/n] "));
      },
      onPlanReady: (adaptivePlan) => console.log(formatPlan(adaptivePlan)),
      onPhase2Event: (event) => console.log(formatEvent(event)),
      onReviewReady: (reviewPack) => console.log(formatReview(reviewPack)),
      onApproveMerge: args.autoApprove
        ? undefined
        : () => confirm("Merge? [Y/n] "),
    });

    console.log(`\n[result] ${status}${task ? ` - ${task.goal}` : ""}`);
    if (plan && plan.tools.length === 0) {
      console.log("[plan] default loop used");
    }
    if (review && !args.autoApprove) {
      console.log("[review] merge approval requested after review pack generation");
    }

    if (status === "done" && args.recursive) {
      const depth = parseInt(process.env.UCM_RECURSIVE_DEPTH ?? "0", 10);
      if (depth >= 10) {
        console.log("[recursive] max depth reached");
        process.exit(0);
      }
      console.log(`[recursive] re-running (depth ${depth + 1})...`);
      rl.close();
      const child = Bun.spawn([process.argv[0], ...process.argv.slice(1)], {
        stdio: ["inherit", "inherit", "inherit"],
        env: { ...process.env, UCM_RECURSIVE_DEPTH: String(depth + 1) },
      });
      process.exit(await child.exited);
    }

    process.exit(status === "done" ? 0 : 1);
  } finally {
    rl.close();
  }
}

if (import.meta.main) main();
