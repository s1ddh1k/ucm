import { $ } from "bun";
import type { SpawnAgent, SpawnOpts, Task, VerifyResult, LoopEvent } from "./types.ts";
import { extractJson } from "./json.ts";
import { CONSECUTIVE_ERROR_LIMIT, BACKOFF_DELAYS } from "./constants.ts";

export interface Phase2Opts {
  spawnAgent: SpawnAgent;
  spawnOpts: SpawnOpts;
  task: Task;
  worktreePath: string;
  maxIterations: number;
  testCommand?: string;
  onEvent?: (event: LoopEvent) => void;
  onIterationStart?: (iteration: number) => Promise<void>;
}

function buildImplementPrompt(task: Task, iteration: number, lastVerdict: VerifyResult | null): string {
  let prompt = `You are an implementation agent. Complete the following task with the highest quality.

Task Goal: ${task.goal}
Context: ${task.context}
Acceptance Criteria: ${task.acceptance}

Rules:
- Implement everything needed to satisfy the acceptance criteria
- Write tests if appropriate
- Commit your work with clear commit messages
- You have full access to the codebase and all tools
- If the task is large, break it into subtasks and work through them methodically
- If independent subtasks exist, handle them in a logical order`;

  if (iteration > 1 && lastVerdict) {
    prompt += `\n\nThis is iteration ${iteration}. The previous attempt was reviewed and did NOT pass.`;
    if (lastVerdict.keepChanges) {
      prompt += `\nYour previous changes were kept. Build on them to address remaining issues.`;
    } else {
      prompt += `\nYour previous changes were rolled back. Try a different approach.`;
    }
  }

  return prompt;
}

function buildVerifyPrompt(task: Task): string {
  return `You are a verification agent. Assess whether the task has been completed correctly.

Task Goal: ${task.goal}
Context: ${task.context}
Acceptance Criteria: ${task.acceptance}

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

export async function runPhase2(opts: Phase2Opts): Promise<{ success: boolean; iterations: number }> {
  const { spawnAgent, task, worktreePath, maxIterations, onEvent, onIterationStart } = opts;
  const spawnOpts: SpawnOpts = { ...opts.spawnOpts, cwd: worktreePath };

  let consecutiveErrors = 0;
  let lastErrorType = "";
  let consecutiveVerifyFailures = 0;
  let lastVerifyReason = "";
  let lastVerdict: VerifyResult | null = null;

  for (let i = 1; i <= maxIterations; i++) {
    // --- 구현 ---
    await onIterationStart?.(i);
    onEvent?.({ type: "implement_start", iteration: i });

    const implResult = await spawnAgent(buildImplementPrompt(task, i, lastVerdict), spawnOpts);

    if (isFatalError(implResult.status)) {
      onEvent?.({ type: "error", message: `Fatal spawn error: ${implResult.text}` });
      return { success: false, iterations: i };
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
        return { success: false, iterations: i };
      }

      // 백오프
      const delay = BACKOFF_DELAYS[Math.min(consecutiveErrors - 1, BACKOFF_DELAYS.length - 1)];
      await Bun.sleep(delay);
      continue;
    }

    consecutiveErrors = 0;
    lastErrorType = "";
    onEvent?.({ type: "implement_done", iteration: i });

    // --- 검증 ---
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
        return { success: false, iterations: i };
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
        return { success: false, iterations: i };
      }
      onEvent?.({ type: "error", message: "Failed to parse verify result" });
      continue;
    }

    // verify 성공적으로 파싱됨 → transient error 카운터 리셋
    consecutiveErrors = 0;
    lastErrorType = "";

    // --- 테스트 게이트 ---
    if (verdict.passed && opts.testCommand) {
      onEvent?.({ type: "test_start" });
      const testResult = await runTestCommand(opts.testCommand, worktreePath);
      onEvent?.({ type: "test_done", passed: testResult.passed, output: testResult.output });
      if (!testResult.passed) {
        verdict = { passed: false, keepChanges: true, reason: `Tests failed:\n${testResult.output}` };
      }
    }

    onEvent?.({ type: "verify_done", result: verdict });
    lastVerdict = verdict;

    if (verdict.passed) {
      onEvent?.({ type: "passed" });
      return { success: true, iterations: i };
    }

    // 검증 실패 처리
    if (verdict.reason === lastVerifyReason) {
      consecutiveVerifyFailures++;
    } else {
      consecutiveVerifyFailures = 1;
      lastVerifyReason = verdict.reason;
    }

    if (consecutiveVerifyFailures >= CONSECUTIVE_ERROR_LIMIT) {
      onEvent?.({ type: "error", message: `${CONSECUTIVE_ERROR_LIMIT} consecutive identical verify failures` });
      return { success: false, iterations: i };
    }

    if (!verdict.keepChanges) {
      // 롤백: 마지막 커밋 이후 변경 사항 제거
      await $`git -C ${worktreePath} checkout .`.quiet();
      await $`git -C ${worktreePath} clean -fd`.quiet();
    }
    // keepChanges=true: 코드 유지, 다음 반복
  }

  onEvent?.({ type: "max_iterations" });
  return { success: false, iterations: maxIterations };
}

const TEST_OUTPUT_LIMIT = 4096;

async function runTestCommand(
  command: string,
  cwd: string,
): Promise<{ passed: boolean; output: string }> {
  const parts = command.split(" ");
  const proc = Bun.spawnSync(parts, {
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
