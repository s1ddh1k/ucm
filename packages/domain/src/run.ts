import type { RunRecord, RunStatus } from "../../contracts/src/records";

const RUN_TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  queued: ["running", "cancelled"],
  running: ["blocked", "needs_review", "completed", "failed", "cancelled"],
  blocked: ["running", "cancelled", "failed"],
  needs_review: ["running", "completed", "failed", "cancelled"],
  completed: [],
  failed: ["queued", "running", "cancelled"],
  cancelled: [],
};

export function canTransitionRun(
  current: RunStatus,
  next: RunStatus,
): boolean {
  return RUN_TRANSITIONS[current].includes(next);
}

export function transitionRun(
  run: RunRecord,
  next: RunStatus,
  updatedAt: string,
): RunRecord {
  if (!canTransitionRun(run.status, next)) {
    throw new Error(`invalid run transition: ${run.status} -> ${next}`);
  }

  return {
    ...run,
    status: next,
    updatedAt,
    startedAt:
      next === "running" && !run.startedAt ? updatedAt : run.startedAt,
    completedAt:
      next === "completed" || next === "failed" || next === "cancelled"
        ? updatedAt
        : run.completedAt,
  };
}
