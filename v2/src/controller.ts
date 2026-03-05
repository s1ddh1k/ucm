import type { Config, Task, LoopEvent, SpawnAgent, SpawnOpts } from "./types.ts";
import { spawnAgent as defaultSpawnAgent } from "./spawn.ts";
import { createWorktree, mergeWorktree, removeWorktree } from "./worktree.ts";
import { runPhase1 } from "./phase1.ts";
import { runPhase2 } from "./phase2.ts";
import { saveState, loadState, clearState } from "./state.ts";
import type { ControllerState } from "./state.ts";
import { DEFAULT_IDLE_TIMEOUT_MS, DEFAULT_HARD_TIMEOUT_MS, DEFAULT_MAX_ITERATIONS } from "./constants.ts";

export type ControllerStatus =
  | "idle"
  | "phase1"
  | "phase2"
  | "merging"
  | "done"
  | "failed"
  | "cancelled";

export interface ControllerCallbacks {
  onStatusChange?: (status: ControllerStatus) => void;
  onPhase1Message?: (text: string) => void;
  onUserInput?: (prompt: string) => Promise<string>;
  onTaskProposed?: (task: Task) => Promise<boolean>;
  onPhase2Event?: (event: LoopEvent) => void;
  onApproveMerge?: () => Promise<boolean>;
  spawnAgent?: SpawnAgent;
}

export async function runController(
  config: Config,
  callbacks: ControllerCallbacks = {},
): Promise<{ status: ControllerStatus; task: Task | null }> {
  const {
    onStatusChange,
    onPhase1Message,
    onUserInput,
    onTaskProposed,
    onPhase2Event,
    onApproveMerge,
    spawnAgent = defaultSpawnAgent,
  } = callbacks;

  const setStatus = (s: ControllerStatus) => onStatusChange?.(s);

  const spawnOpts: SpawnOpts = {
    cwd: config.projectPath,
    provider: config.provider,
    model: config.model,
    idleTimeoutMs: config.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
    hardTimeoutMs: config.hardTimeoutMs ?? DEFAULT_HARD_TIMEOUT_MS,
  };

  // --- 이전 상태 복원 확인 ---
  const saved = await loadState(config.projectPath);

  let task: Task | null = null;

  if (saved && saved.task && saved.phase !== "phase1") {
    // 이전 태스크가 있고 phase2 이상이면 phase1 스킵
    task = saved.task;
    onPhase1Message?.(`Resuming task: ${task.goal}`);
  } else {
    // --- Phase 1: 태스크 확정 ---
    setStatus("phase1");

    await saveState(config.projectPath, {
      phase: "phase1",
      task: null,
      worktree: null,
      iteration: 0,
      config,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    try {
      task = await runPhase1({
        spawnAgent,
        spawnOpts,
        projectPath: config.projectPath,
        onMessage: onPhase1Message,
        onUserInput,
        onTaskProposed,
      });
    } catch (e) {
      setStatus("failed");
      await clearState(config.projectPath);
      throw e;
    }

    if (!task) {
      setStatus("failed");
      await clearState(config.projectPath);
      return { status: "failed", task: null };
    }
  }

  // --- Worktree 생성 (또는 기존 복원) ---
  let worktree = saved?.worktree ?? null;

  if (!worktree) {
    const taskId = `task-${Date.now()}`;
    try {
      worktree = await createWorktree(config.projectPath, taskId);
    } catch (e) {
      setStatus("failed");
      await clearState(config.projectPath);
      throw e;
    }
  }

  await saveState(config.projectPath, {
    phase: "phase2",
    task,
    worktree,
    iteration: saved?.iteration ?? 0,
    config,
    createdAt: saved?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  });

  try {
    // --- Phase 2: 구현+검증 루프 ---
    setStatus("phase2");

    const startIteration = saved?.phase === "phase2" ? (saved.iteration ?? 0) : 0;

    const result = await runPhase2({
      spawnAgent,
      spawnOpts: { ...spawnOpts, cwd: worktree.worktreePath },
      task,
      worktreePath: worktree.worktreePath,
      maxIterations: config.maxIterations ?? DEFAULT_MAX_ITERATIONS,
      testCommand: config.testCommand,
      onEvent: (event) => onPhase2Event?.(event),
      onIterationStart: (iteration) =>
        saveState(config.projectPath, {
          phase: "phase2",
          task,
          worktree,
          iteration,
          config,
          createdAt: saved?.createdAt ?? Date.now(),
          updatedAt: Date.now(),
        }),
    });

    if (!result.success) {
      setStatus("failed");
      await clearState(config.projectPath);
      return { status: "failed", task };
    }

    // --- 머지 승인 ---
    if (!config.autoApprove && onApproveMerge) {
      await saveState(config.projectPath, {
        phase: "merging",
        task,
        worktree,
        iteration: result.iterations,
        config,
        createdAt: saved?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      });

      const approved = await onApproveMerge();
      if (!approved) {
        setStatus("cancelled");
        await clearState(config.projectPath);
        return { status: "cancelled", task };
      }
    }

    // --- 머지 ---
    setStatus("merging");
    await mergeWorktree(worktree);
    setStatus("done");
    await clearState(config.projectPath);
    return { status: "done", task };
  } finally {
    // --- Cleanup ---
    try {
      await removeWorktree(worktree);
    } catch {
      // worktree가 이미 제거된 경우 무시
    }
  }
}
