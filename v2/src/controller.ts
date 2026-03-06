import type { AdaptivePlan, Config, LoopEvent, ReviewPack, SpawnAgent, SpawnOpts, Task } from "./types.ts";
import { spawnAgent as defaultSpawnAgent } from "./spawn.ts";
import { createWorktree, mergeWorktree, removeWorktree } from "./worktree.ts";
import { runPhase1 } from "./phase1.ts";
import { runPhase2 } from "./phase2.ts";
import { saveState, loadState, clearState } from "./state.ts";
import type { ControllerState } from "./state.ts";
import { buildAdaptivePlan } from "./adaptive.ts";
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
  onPlanReady?: (plan: AdaptivePlan) => void;
  onPhase2Event?: (event: LoopEvent) => void;
  onReviewReady?: (review: ReviewPack) => void;
  onApproveMerge?: () => Promise<boolean>;
  spawnAgent?: SpawnAgent;
}

export interface ControllerResult {
  status: ControllerStatus;
  task: Task | null;
  plan: AdaptivePlan | null;
  review: ReviewPack | null;
}

async function resolveSavedState(config: Config): Promise<ControllerState | null> {
  if (!config.resume) return null;
  const saved = await loadState(config.projectPath);
  if (!saved) {
    throw new Error("no saved state to resume");
  }
  return saved;
}

export async function runController(
  config: Config,
  callbacks: ControllerCallbacks = {},
): Promise<ControllerResult> {
  const {
    onStatusChange,
    onPhase1Message,
    onUserInput,
    onTaskProposed,
    onPlanReady,
    onPhase2Event,
    onReviewReady,
    onApproveMerge,
    spawnAgent = defaultSpawnAgent,
  } = callbacks;

  let currentStatus: ControllerStatus = "idle";
  const setStatus = (status: ControllerStatus) => {
    currentStatus = status;
    onStatusChange?.(status);
  };

  const spawnOpts: SpawnOpts = {
    cwd: config.projectPath,
    provider: config.provider,
    model: config.model,
    idleTimeoutMs: config.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
    hardTimeoutMs: config.hardTimeoutMs ?? DEFAULT_HARD_TIMEOUT_MS,
  };

  const saved = await resolveSavedState(config);

  let task: Task | null = saved?.task ?? null;
  let plan: AdaptivePlan | null = saved?.plan ?? null;
  let review: ReviewPack | null = saved?.review ?? null;
  let worktree = saved?.worktree ?? null;
  const createdAt = saved?.createdAt ?? Date.now();
  let shouldRemoveWorktree = false;
  let shouldClearState = false;

  const result = (): ControllerResult => ({ status: currentStatus, task, plan, review });

  const persistState = async (
    phase: ControllerState["phase"],
    iteration: number,
  ): Promise<void> => {
    await saveState(config.projectPath, {
      phase,
      task,
      plan,
      review,
      worktree,
      iteration,
      config,
      createdAt,
      updatedAt: Date.now(),
    });
  };

  try {
    if (saved && task && saved.phase !== "phase1") {
      onPhase1Message?.(`Resuming task: ${task.goal}`);
    } else {
      setStatus("phase1");

      await saveState(config.projectPath, {
        phase: "phase1",
        task: null,
        plan: null,
        review: null,
        worktree: null,
        iteration: 0,
        config,
        createdAt,
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
      } catch (error) {
        setStatus("failed");
        shouldClearState = true;
        throw error;
      }

      if (!task) {
        setStatus("failed");
        shouldClearState = true;
        return result();
      }
    }

    if (!plan && task) {
      plan = buildAdaptivePlan(task);
    }
    if (plan) {
      onPlanReady?.(plan);
    }

    if (!worktree) {
      const taskId = `task-${Date.now()}`;
      try {
        worktree = await createWorktree(config.projectPath, taskId);
      } catch (error) {
        setStatus("failed");
        shouldClearState = true;
        throw error;
      }
    }

    const mergeReady = async (iteration: number): Promise<ControllerResult> => {
      setStatus("merging");
      await persistState("merging", iteration);

      if (review) {
        onReviewReady?.(review);
      }

      if (!config.autoApprove && onApproveMerge) {
        const approved = await onApproveMerge();
        if (!approved) {
          setStatus("cancelled");
          shouldRemoveWorktree = true;
          shouldClearState = true;
          return result();
        }
      }

      try {
        await mergeWorktree(worktree!);
      } catch (error) {
        setStatus("failed");
        await persistState("merging", iteration);
        throw error;
      }
      setStatus("done");
      shouldRemoveWorktree = true;
      shouldClearState = true;
      return result();
    };

    if (saved?.phase === "merging" && worktree) {
      return await mergeReady(saved.iteration ?? 0);
    }

    await persistState("phase2", saved?.iteration ?? 0);

    setStatus("phase2");
    let phase2Iteration = saved?.iteration ?? 0;
    let phase2;
    try {
      phase2 = await runPhase2({
        spawnAgent,
        spawnOpts: { ...spawnOpts, cwd: worktree.worktreePath },
        task,
        plan,
        worktreePath: worktree.worktreePath,
        baseBranch: worktree.baseBranch,
        branchName: worktree.branchName,
        maxIterations: config.maxIterations ?? DEFAULT_MAX_ITERATIONS,
        testCommand: config.testCommand,
        onEvent: (event) => onPhase2Event?.(event),
        onIterationStart: (iteration) => {
          phase2Iteration = iteration;
          return persistState("phase2", iteration);
        },
      });
    } catch (error) {
      setStatus("failed");
      await persistState("phase2", phase2Iteration);
      throw error;
    }

    review = phase2.review;

    if (!phase2.success) {
      setStatus("failed");
      await persistState("phase2", phase2.iterations);
      return result();
    }

    return await mergeReady(phase2.iterations);
  } finally {
    if (shouldClearState) {
      await clearState(config.projectPath);
    }

    if (shouldRemoveWorktree && worktree) {
      try {
        await removeWorktree(worktree);
      } catch {
        // 이미 정리되었거나 수동 변경된 경우 무시
      }
    }
  }
}
