import { join } from "node:path";
import { existsSync } from "node:fs";
import { rename, unlink } from "node:fs/promises";
import type { Task, WorktreeInfo, Config, AdaptivePlan, ReviewPack } from "./types.ts";
import type { ControllerStatus } from "./controller.ts";

export interface ControllerState {
  phase: "phase1" | "phase2" | "merging";
  task: Task | null;
  plan: AdaptivePlan | null;
  review: ReviewPack | null;
  worktree: WorktreeInfo | null;
  iteration: number;
  config: Config;
  createdAt: number;
  updatedAt: number;
}

const STATE_FILE = ".ucm-state.json";

function statePath(projectPath: string): string {
  return join(projectPath, STATE_FILE);
}

export async function saveState(projectPath: string, state: ControllerState): Promise<void> {
  state.updatedAt = Date.now();
  const targetPath = statePath(projectPath);
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  await Bun.write(tempPath, `${JSON.stringify(state, null, 2)}\n`);
  await rename(tempPath, targetPath);
}

export async function loadState(projectPath: string): Promise<ControllerState | null> {
  const path = statePath(projectPath);
  if (!existsSync(path)) return null;
  try {
    const content = await Bun.file(path).text();
    const raw = JSON.parse(content) as Partial<ControllerState>;
    if (!raw.config) return null;
    return {
      phase: raw.phase ?? "phase1",
      task: raw.task ?? null,
      plan: raw.plan ?? null,
      review: raw.review ?? null,
      worktree: raw.worktree ?? null,
      iteration: raw.iteration ?? 0,
      config: raw.config as Config,
      createdAt: raw.createdAt ?? Date.now(),
      updatedAt: raw.updatedAt ?? Date.now(),
    };
  } catch {
    return null;
  }
}

export async function clearState(projectPath: string): Promise<void> {
  const path = statePath(projectPath);
  try {
    await unlink(path);
  } catch {
    // 파일이 없으면 무시
  }
}

export function hasState(projectPath: string): boolean {
  return existsSync(statePath(projectPath));
}
