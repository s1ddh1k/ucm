import { $ } from "bun";
import { spawnSync } from "node:child_process";
import type {
  AdaptivePlan,
  LoopEvent,
  ReviewIssue,
  SpawnAgent,
  SpawnOpts,
  Task,
  ToolName,
  ToolResult,
  VerifyResult,
} from "./types.ts";
import { extractJson } from "./json.ts";
import { buildReviewPack } from "./review.ts";
import { CONSECUTIVE_ERROR_LIMIT, BACKOFF_DELAYS } from "./constants.ts";

export interface Phase2Opts {
  spawnAgent: SpawnAgent;
  spawnOpts: SpawnOpts;
  task: Task;
  plan?: AdaptivePlan | null;
  worktreePath: string;
  baseBranch?: string;
  branchName?: string;
  maxIterations: number;
  testCommand?: string;
  onEvent?: (event: LoopEvent) => void;
  onIterationStart?: (iteration: number) => Promise<void>;
}

interface ReviewFeedback {
  summary: string;
  issues: ReviewIssue[];
}

function summarizeText(text: string, limit = 240): string {
  const normalized = text
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, ""))
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit)}...`;
}

function currentBranch(cwd: string): string {
  const result = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd,
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 ? result.stdout.toString().trim() : "HEAD";
}

function formatIssues(issues: ReviewIssue[]): string {
  if (issues.length === 0) return "none";
  return issues
    .map((issue) => `- [${issue.severity}] ${issue.summary}${issue.where ? ` (${issue.where})` : ""}${issue.fix ? ` -> ${issue.fix}` : ""}`)
    .join("\n");
}

function preflightLines(results: ToolResult[], key: "checklist" | "evidence" | "expectedFiles"): string[] {
  return results.flatMap((result) => result[key]).filter(Boolean);
}

function buildImplementPrompt(
  task: Task,
  iteration: number,
  lastVerdict: VerifyResult | null,
  plan: AdaptivePlan | null,
  preflightNotes: ToolResult[],
  reviewFeedback: ReviewFeedback | null,
): string {
  const checklist = preflightLines(preflightNotes, "checklist");
  const evidence = preflightLines(preflightNotes, "evidence");
  const expectedFiles = preflightLines(preflightNotes, "expectedFiles");

  let prompt = `You are an implementation agent. Complete the following task with the highest quality.

Task Goal: ${task.goal}
Context: ${task.context}
Acceptance Criteria: ${task.acceptance}
Constraints: ${task.constraints?.trim() || "none"}`;

  if (plan) {
    prompt += `\nAdaptive Plan: ${plan.summary}`;
  }

  if (preflightNotes.length > 0) {
    prompt += "\n\nPreflight Guidance:";
    for (const note of preflightNotes) {
      prompt += `\n- ${note.tool}: ${note.summary}`;
    }
  }

  if (checklist.length > 0) {
    prompt += `\n\nExecution Checklist:\n${checklist.map((line, index) => `${index + 1}. ${line}`).join("\n")}`;
  }

  if (evidence.length > 0) {
    prompt += `\n\nRequired Evidence:\n${evidence.map((line) => `- ${line}`).join("\n")}`;
  }

  if (expectedFiles.length > 0) {
    prompt += `\n\nLikely Impacted Files:\n${expectedFiles.map((line) => `- ${line}`).join("\n")}`;
  }

  prompt += `

Rules:
- Implement everything needed to satisfy the acceptance criteria
- Write tests if appropriate
- Commit your work with clear commit messages
- You have full access to the codebase and all tools
- If the task is large, break it into subtasks and work through them methodically
- If independent subtasks exist, handle them in a logical order
- Keep the final diff reviewable for a human approver`;

  if (iteration > 1 && lastVerdict) {
    prompt += `\n\nThis is iteration ${iteration}. The previous attempt was reviewed and did NOT pass.`;
    if (lastVerdict.keepChanges) {
      prompt += `\nYour previous changes were kept. Build on them to address remaining issues.`;
    } else {
      prompt += `\nYour previous changes were rolled back. Try a different approach.`;
    }
  }

  if (reviewFeedback) {
    prompt += `\n\nReview Feedback To Fix:\n${reviewFeedback.summary}\n${formatIssues(reviewFeedback.issues)}`;
  }

  return prompt;
}

function buildVerifyPrompt(task: Task): string {
  return `You are a verification agent. Assess whether the task has been completed correctly.

Task Goal: ${task.goal}
Context: ${task.context}
Acceptance Criteria: ${task.acceptance}
Constraints: ${task.constraints?.trim() || "none"}

Rules:
- Check if the acceptance criteria are met
- Run tests if they exist
- Review code quality
- Output ONLY a JSON object:
  {"passed": true/false, "keepChanges": true/false, "reason": "..."}
- passed: true if all acceptance criteria are met
- keepChanges: true if the code changes should be kept even if not passing (partial progress)
- reason: brief explanation of the assessment`;
}

function buildToolPrompt(tool: ToolName, task: Task): string {
  const header = `Task Goal: ${task.goal}\nContext: ${task.context}\nAcceptance Criteria: ${task.acceptance}\nConstraints: ${task.constraints?.trim() || "none"}`;

  switch (tool) {
    case "specify":
      return `You are the specify adaptive tool. Tighten the execution contract before implementation. Do not modify files.

${header}

Output ONLY a JSON object with this shape:
{
  "summary": "brief execution contract",
  "stopConditions": ["observable stop condition"],
  "evidence": ["proof a human reviewer should expect"],
  "expectedFiles": ["likely touched paths or modules"]
}`;
    case "decompose":
      return `You are the decompose adaptive tool. Break the task into a safe execution order before implementation. Do not modify files.

${header}

Output ONLY a JSON object with this shape:
{
  "summary": "brief execution plan",
  "checklist": ["step 1", "step 2"],
  "expectedFiles": ["likely touched paths or modules"]
}`;
    case "ux-review":
      return `You are the ux-review adaptive tool. Review the current changes with a product and interaction lens. Do not modify files.

${header}

Output ONLY a JSON object with this shape:
{
  "passed": true,
  "summary": "concise assessment",
  "issues": [
    {
      "severity": "critical|major|minor",
      "summary": "issue description",
      "where": "screen, route, component, or interaction",
      "fix": "specific corrective action"
    }
  ]
}

Mark passed=false if a human should not merge yet.`;
    case "polish":
      return `You are the polish adaptive tool. Review the current changes for final quality issues. Do not modify files.

${header}

Output ONLY a JSON object with this shape:
{
  "passed": true,
  "summary": "concise assessment",
  "issues": [
    {
      "severity": "critical|major|minor",
      "summary": "issue description",
      "where": "file, module, or behavior",
      "fix": "specific corrective action"
    }
  ]
}

Mark passed=false if a human should not merge yet.`;
  }
}

function normalizeIssue(issue: unknown, source: ToolName): ReviewIssue | null {
  if (!issue || typeof issue !== "object") return null;
  const candidate = issue as Record<string, unknown>;
  const severity = candidate.severity;
  const summary = candidate.summary;
  if (
    (severity !== "critical" && severity !== "major" && severity !== "minor") ||
    typeof summary !== "string"
  ) {
    return null;
  }
  return {
    severity,
    summary: summary.trim(),
    where: typeof candidate.where === "string" ? candidate.where.trim() : undefined,
    fix: typeof candidate.fix === "string" ? candidate.fix.trim() : undefined,
    source,
  };
}

function parseToolResult(tool: ToolName, stage: ToolResult["stage"], iteration: number, rationale: string, raw: string): ToolResult {
  const fallback = (): ToolResult => ({
    tool,
    stage,
    iteration,
    status: "ok",
    rationale,
    summary: summarizeText(raw),
    raw,
    blocking: false,
    checklist: [],
    evidence: [],
    expectedFiles: [],
    issues: [],
  });

  const parsed = extractJson<Record<string, unknown>>(raw);
  if (!parsed || typeof parsed !== "object") {
    return fallback();
  }

  if (tool === "specify") {
    return {
      ...fallback(),
      summary: typeof parsed.summary === "string" ? parsed.summary.trim() : fallback().summary,
      evidence: Array.isArray(parsed.evidence) ? parsed.evidence.map(String).map((line) => line.trim()).filter(Boolean) : [],
      expectedFiles: Array.isArray(parsed.expectedFiles) ? parsed.expectedFiles.map(String).map((line) => line.trim()).filter(Boolean) : [],
      checklist: Array.isArray(parsed.stopConditions) ? parsed.stopConditions.map(String).map((line) => line.trim()).filter(Boolean) : [],
    };
  }

  if (tool === "decompose") {
    return {
      ...fallback(),
      summary: typeof parsed.summary === "string" ? parsed.summary.trim() : fallback().summary,
      checklist: Array.isArray(parsed.checklist) ? parsed.checklist.map(String).map((line) => line.trim()).filter(Boolean) : [],
      expectedFiles: Array.isArray(parsed.expectedFiles) ? parsed.expectedFiles.map(String).map((line) => line.trim()).filter(Boolean) : [],
    };
  }

  const issues = Array.isArray(parsed.issues)
    ? parsed.issues.map((issue) => normalizeIssue(issue, tool)).filter((issue): issue is ReviewIssue => issue !== null)
    : [];
  const passed = parsed.passed !== false;
  const blocking = !passed || issues.some((issue) => issue.severity === "critical" || issue.severity === "major");

  return {
    ...fallback(),
    summary: typeof parsed.summary === "string" ? parsed.summary.trim() : fallback().summary,
    blocking,
    issues,
  };
}

async function runAdaptiveTool(
  tool: NonNullable<AdaptivePlan>["tools"][number],
  iteration: number,
  opts: Pick<Phase2Opts, "spawnAgent" | "spawnOpts" | "task" | "onEvent">,
): Promise<ToolResult> {
  opts.onEvent?.({ type: "tool_start", tool: tool.tool, stage: tool.stage, iteration });
  const result = await opts.spawnAgent(buildToolPrompt(tool.tool, opts.task), opts.spawnOpts);

  const toolResult = result.status === "ok"
    ? parseToolResult(tool.tool, tool.stage, iteration, tool.rationale, result.text)
    : {
      tool: tool.tool,
      stage: tool.stage,
      iteration,
      status: "failed",
      rationale: tool.rationale,
      summary: `${tool.tool} failed: ${result.status}`,
      raw: result.text,
      blocking: tool.stage === "review",
      checklist: [],
      evidence: [],
      expectedFiles: [],
      issues: tool.stage === "review"
        ? [{ severity: "major", summary: `${tool.tool} could not complete`, fix: "Re-run the review", source: tool.tool }]
        : [],
    } satisfies ToolResult;

  opts.onEvent?.({ type: "tool_done", result: toolResult });
  return toolResult;
}

function buildReviewFeedback(results: ToolResult[]): ReviewFeedback | null {
  const issues = results.flatMap((result) => result.issues);
  if (!results.some((result) => result.blocking)) return null;
  const summary = results
    .filter((result) => result.blocking)
    .map((result) => `${result.tool}: ${result.summary}`)
    .join("\n");
  return { summary, issues };
}

export async function runPhase2(opts: Phase2Opts): Promise<{
  success: boolean;
  iterations: number;
  review: ReturnType<typeof buildReviewPack> | null;
}> {
  const { spawnAgent, task, worktreePath, maxIterations, onEvent, onIterationStart } = opts;
  const spawnOpts: SpawnOpts = { ...opts.spawnOpts, cwd: worktreePath };
  const plan = opts.plan ?? null;
  const toolResults: ToolResult[] = [];
  let latestTestOutput = "Not run";
  let latestReviewFeedback: ReviewFeedback | null = null;

  if (plan) {
    for (const tool of plan.tools.filter((entry) => entry.stage === "preflight")) {
      toolResults.push(await runAdaptiveTool(tool, 0, { spawnAgent, spawnOpts, task, onEvent }));
    }
  }

  const preflightNotes = toolResults.filter((result) => result.stage === "preflight");
  let consecutiveErrors = 0;
  let lastErrorType = "";
  let consecutiveVerifyFailures = 0;
  let lastVerifyReason = "";
  let lastVerdict: VerifyResult | null = null;

  for (let i = 1; i <= maxIterations; i++) {
    await onIterationStart?.(i);
    onEvent?.({ type: "implement_start", iteration: i });

    const implResult = await spawnAgent(
      buildImplementPrompt(task, i, lastVerdict, plan, preflightNotes, latestReviewFeedback),
      spawnOpts,
    );

    if (isFatalError(implResult.status)) {
      onEvent?.({ type: "error", message: `Fatal spawn error: ${implResult.text}` });
      return { success: false, iterations: i, review: null };
    }

    if (isTransientError(implResult.status)) {
      const errorType = implResult.status;
      if (errorType === lastErrorType) {
        consecutiveErrors++;
      } else {
        consecutiveErrors = 1;
        lastErrorType = errorType;
      }

      if (consecutiveErrors >= CONSECUTIVE_ERROR_LIMIT) {
        onEvent?.({ type: "error", message: `${CONSECUTIVE_ERROR_LIMIT} consecutive ${errorType} errors` });
        return { success: false, iterations: i, review: null };
      }

      const delay = BACKOFF_DELAYS[Math.min(consecutiveErrors - 1, BACKOFF_DELAYS.length - 1)];
      await Bun.sleep(delay);
      continue;
    }

    consecutiveErrors = 0;
    lastErrorType = "";
    onEvent?.({ type: "implement_done", iteration: i });

    onEvent?.({ type: "verify_start", iteration: i });

    const verifyResult = await spawnAgent(buildVerifyPrompt(task), spawnOpts);

    if (verifyResult.status !== "ok") {
      const errorType = verifyResult.status;
      if (errorType === lastErrorType) {
        consecutiveErrors++;
      } else {
        consecutiveErrors = 1;
        lastErrorType = errorType;
      }

      if (consecutiveErrors >= CONSECUTIVE_ERROR_LIMIT) {
        onEvent?.({ type: "error", message: `${CONSECUTIVE_ERROR_LIMIT} consecutive verify ${errorType} errors` });
        return { success: false, iterations: i, review: null };
      }

      onEvent?.({ type: "error", message: `Verify agent error: ${verifyResult.status}` });
      const delay = BACKOFF_DELAYS[Math.min(consecutiveErrors - 1, BACKOFF_DELAYS.length - 1)];
      await Bun.sleep(delay);
      continue;
    }

    let verdict = extractJson<VerifyResult>(verifyResult.text);
    if (!verdict) {
      consecutiveErrors++;
      if (consecutiveErrors >= CONSECUTIVE_ERROR_LIMIT) {
        onEvent?.({ type: "error", message: `${CONSECUTIVE_ERROR_LIMIT} consecutive verify parse failures` });
        return { success: false, iterations: i, review: null };
      }
      onEvent?.({ type: "error", message: "Failed to parse verify result" });
      continue;
    }

    consecutiveErrors = 0;
    lastErrorType = "";

    if (verdict.passed && opts.testCommand) {
      onEvent?.({ type: "test_start" });
      const testResult = await runTestCommand(opts.testCommand, worktreePath);
      latestTestOutput = testResult.output || (testResult.passed ? "Command completed without output" : "Command failed without output");
      onEvent?.({ type: "test_done", passed: testResult.passed, output: testResult.output });
      if (!testResult.passed) {
        verdict = { passed: false, keepChanges: true, reason: `Tests failed:\n${testResult.output}` };
      }
    }

    onEvent?.({ type: "verify_done", result: verdict });
    lastVerdict = verdict;

    if (verdict.passed) {
      const reviewRoundResults: ToolResult[] = [];
      if (plan) {
        for (const tool of plan.tools.filter((entry) => entry.stage === "review")) {
          const toolResult = await runAdaptiveTool(tool, i, { spawnAgent, spawnOpts, task, onEvent });
          toolResults.push(toolResult);
          reviewRoundResults.push(toolResult);
        }
      }

      const reviewFeedback = buildReviewFeedback(reviewRoundResults);
      if (reviewFeedback) {
        latestReviewFeedback = reviewFeedback;
        const reviewReason = [reviewFeedback.summary, formatIssues(reviewFeedback.issues)].filter(Boolean).join("\n");
        onEvent?.({
          type: "review_blocked",
          iteration: i,
          summary: reviewFeedback.summary,
          issues: reviewFeedback.issues,
        });

        if (reviewReason === lastVerifyReason) {
          consecutiveVerifyFailures++;
        } else {
          consecutiveVerifyFailures = 1;
          lastVerifyReason = reviewReason;
        }

        if (consecutiveVerifyFailures >= CONSECUTIVE_ERROR_LIMIT) {
          onEvent?.({ type: "error", message: `${CONSECUTIVE_ERROR_LIMIT} consecutive identical review failures` });
          return { success: false, iterations: i, review: null };
        }

        lastVerdict = { passed: false, keepChanges: true, reason: reviewReason };
        continue;
      }

      latestReviewFeedback = null;
      const review = buildReviewPack({
        worktreePath,
        baseBranch: opts.baseBranch ?? `${currentBranch(worktreePath)}~1`,
        branchName: opts.branchName ?? currentBranch(worktreePath),
        finalReason: verdict.reason,
        testOutput: latestTestOutput,
        iterations: i,
        toolResults,
      });

      onEvent?.({ type: "passed" });
      return { success: true, iterations: i, review };
    }

    latestReviewFeedback = null;

    if (verdict.reason === lastVerifyReason) {
      consecutiveVerifyFailures++;
    } else {
      consecutiveVerifyFailures = 1;
      lastVerifyReason = verdict.reason;
    }

    if (consecutiveVerifyFailures >= CONSECUTIVE_ERROR_LIMIT) {
      onEvent?.({ type: "error", message: `${CONSECUTIVE_ERROR_LIMIT} consecutive identical verify failures` });
      return { success: false, iterations: i, review: null };
    }

    if (!verdict.keepChanges) {
      await $`git -C ${worktreePath} checkout .`.quiet();
      await $`git -C ${worktreePath} clean -fd`.quiet();
    }
  }

  onEvent?.({ type: "max_iterations" });
  return { success: false, iterations: maxIterations, review: null };
}

const TEST_OUTPUT_LIMIT = 4096;

async function runTestCommand(
  command: string,
  cwd: string,
): Promise<{ passed: boolean; output: string }> {
  const shell = process.env.SHELL || "/bin/bash";
  const proc = Bun.spawnSync([shell, "-lc", command], {
    cwd,
    env: { ...process.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = proc.stdout.toString().slice(-TEST_OUTPUT_LIMIT);
  const stderr = proc.stderr.toString().slice(-TEST_OUTPUT_LIMIT);
  const output = (stdout + (stderr ? `\n${stderr}` : "")).trim();
  return { passed: proc.exitCode === 0, output };
}

function isFatalError(status: string): boolean {
  return status === "error";
}

function isTransientError(status: string): boolean {
  return status === "timeout" || status === "rate_limited" || status === "loop_killed";
}
