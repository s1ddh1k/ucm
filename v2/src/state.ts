import { join } from "node:path";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import type { Task, WorktreeInfo, Config } from "./types.ts";
import type { ControllerStatus } from "./controller.ts";

export interface ControllerState {
  phase: "phase1" | "phase2" | "merging";
  task: Task | null;
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
  await Bun.write(statePath(projectPath), JSON.stringify(state, null, 2));
}

export async function loadState(projectPath: string): Promise<ControllerState | null> {
  const path = statePath(projectPath);
  if (!existsSync(path)) return null;
  try {
    const content = await Bun.file(path).text();
    return JSON.parse(content) as ControllerState;
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
