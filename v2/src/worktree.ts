import { $ } from "bun";
import { join } from "node:path";
import type { WorktreeInfo } from "./types.ts";

export async function createWorktree(
  projectPath: string,
  taskId: string,
): Promise<WorktreeInfo> {
  const branchName = `ucm/${taskId}`;
  const worktreePath = join(projectPath, ".ucm-worktrees", taskId);

  // 현재 브랜치 확인
  const baseBranch = (
    await $`git -C ${projectPath} rev-parse --abbrev-ref HEAD`.text()
  ).trim();

  // worktree 생성 + 새 브랜치
  await $`git -C ${projectPath} worktree add -b ${branchName} ${worktreePath}`.quiet();

  return { worktreePath, branchName, baseBranch, projectPath };
}

export async function mergeWorktree(info: WorktreeInfo): Promise<void> {
  const { projectPath, branchName, baseBranch, worktreePath } = info;

  // worktree에 커밋이 있는지 확인
  const log = await $`git -C ${worktreePath} log ${baseBranch}..HEAD --oneline`.text();
  if (!log.trim()) {
    throw new Error("No commits to merge");
  }

  // 메인 브랜치에서 머지
  await $`git -C ${projectPath} merge ${branchName} --no-edit`.quiet();
}

export async function removeWorktree(info: WorktreeInfo): Promise<void> {
  const { projectPath, worktreePath, branchName } = info;

  // worktree 제거
  await $`git -C ${projectPath} worktree remove ${worktreePath} --force`.quiet();

  // 브랜치 삭제
  await $`git -C ${projectPath} branch -D ${branchName}`.quiet();
}
