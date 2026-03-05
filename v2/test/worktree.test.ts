import { describe, it, assert, beforeEach, afterEach } from "./harness.ts";
import { createWorktree, mergeWorktree, removeWorktree } from "../src/worktree.ts";
import { createTempGitRepo, cleanupDir } from "./helpers.ts";
import { $ } from "bun";
import { join } from "node:path";
import { existsSync } from "node:fs";

let repoDir: string;

describe("worktree.ts", () => {
  beforeEach(async () => {
    repoDir = await createTempGitRepo();
  });

  afterEach(async () => {
    await cleanupDir(repoDir);
  });

  it("creates worktree with correct branch", async () => {
    const info = await createWorktree(repoDir, "task-1");
    assert.equal(info.branchName, "ucm/task-1");
    assert(existsSync(info.worktreePath), "worktree path should exist");

    // worktree 브랜치 확인
    const branch = (await $`git -C ${info.worktreePath} rev-parse --abbrev-ref HEAD`.text()).trim();
    assert.equal(branch, "ucm/task-1");

    await removeWorktree(info);
  });

  it("merges worktree commits back to main", async () => {
    const info = await createWorktree(repoDir, "task-2");

    // worktree에서 파일 생성 + 커밋
    await Bun.write(join(info.worktreePath, "feature.txt"), "new feature\n");
    await $`git -C ${info.worktreePath} add .`.quiet();
    await $`git -C ${info.worktreePath} commit -m "add feature"`.quiet();

    await mergeWorktree(info);

    // 메인 브랜치에서 파일 존재 확인
    assert(existsSync(join(repoDir, "feature.txt")), "file should be merged");

    await removeWorktree(info);
  });

  it("removes worktree and branch", async () => {
    const info = await createWorktree(repoDir, "task-3");
    await removeWorktree(info);

    assert(!existsSync(info.worktreePath), "worktree path should not exist");

    // 브랜치도 삭제됨
    const branches = (await $`git -C ${repoDir} branch`.text()).trim();
    assert(!branches.includes("ucm/task-3"), "branch should be deleted");
  });

  it("throws when merging with no commits", async () => {
    const info = await createWorktree(repoDir, "task-4");

    let threw = false;
    try {
      await mergeWorktree(info);
    } catch (e) {
      threw = true;
      assert(e instanceof Error);
      assert.includes(e.message, "No commits to merge");
    }
    assert(threw, "should have thrown");

    await removeWorktree(info);
  });

  it("preserves baseBranch info", async () => {
    const info = await createWorktree(repoDir, "task-5");
    assert.equal(info.baseBranch, "main");
    assert.equal(info.projectPath, repoDir);

    await removeWorktree(info);
  });

  it("multiple worktrees coexist", async () => {
    const info1 = await createWorktree(repoDir, "task-a");
    const info2 = await createWorktree(repoDir, "task-b");

    assert(existsSync(info1.worktreePath));
    assert(existsSync(info2.worktreePath));
    assert(info1.worktreePath !== info2.worktreePath);

    await removeWorktree(info1);
    await removeWorktree(info2);
  });
});
