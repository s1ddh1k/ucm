import { describe, it, assert } from "./harness.ts";
import { saveState, loadState, clearState, hasState } from "../src/state.ts";
import type { ControllerState } from "../src/state.ts";
import { createTempGitRepo, cleanupDir } from "./helpers.ts";

describe("state.ts", () => {
  let repoDir: string;

  it("saves and loads state", async () => {
    repoDir = await createTempGitRepo();

    const state: ControllerState = {
      phase: "phase2",
      task: { goal: "Test", context: "Ctx", acceptance: "Acc" },
      worktree: {
        worktreePath: "/tmp/wt",
        branchName: "ucm/test",
        baseBranch: "main",
        projectPath: repoDir,
      },
      iteration: 2,
      config: {
        provider: "claude",
        projectPath: repoDir,
        maxIterations: 10,
        idleTimeoutMs: 300000,
        hardTimeoutMs: 1800000,
        autoApprove: false,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await saveState(repoDir, state);
    assert(hasState(repoDir));

    const loaded = await loadState(repoDir);
    assert(loaded !== null);
    assert.equal(loaded!.phase, "phase2");
    assert.equal(loaded!.task!.goal, "Test");
    assert.equal(loaded!.iteration, 2);

    await cleanupDir(repoDir);
  });

  it("returns null when no state file", async () => {
    repoDir = await createTempGitRepo();
    const loaded = await loadState(repoDir);
    assert.equal(loaded, null);
    assert.equal(hasState(repoDir), false);
    await cleanupDir(repoDir);
  });

  it("clears state", async () => {
    repoDir = await createTempGitRepo();

    await saveState(repoDir, {
      phase: "phase1",
      task: null,
      worktree: null,
      iteration: 0,
      config: {
        provider: "claude",
        projectPath: repoDir,
        maxIterations: 10,
        idleTimeoutMs: 300000,
        hardTimeoutMs: 1800000,
        autoApprove: true,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    assert(hasState(repoDir));
    await clearState(repoDir);
    assert.equal(hasState(repoDir), false);

    await cleanupDir(repoDir);
  });

  it("clear on nonexistent path does not throw", async () => {
    await clearState("/tmp/ucm-no-exist-" + Date.now());
    // no error
  });
});
