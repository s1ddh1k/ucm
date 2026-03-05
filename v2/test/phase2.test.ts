import { describe, it, assert } from "./harness.ts";
import { runPhase2 } from "../src/phase2.ts";
import type { SpawnAgent, SpawnResult, Task, LoopEvent } from "../src/types.ts";
import { createTempGitRepo, cleanupDir } from "./helpers.ts";
import { $ } from "bun";
import { join } from "node:path";

const testTask: Task = {
  goal: "Add hello feature",
  context: "Test context",
  acceptance: "hello.txt exists with content",
};

function okResult(text: string): SpawnResult {
  return { status: "ok", text, exitCode: 0, durationMs: 100 };
}

function verifyJson(passed: boolean, keepChanges: boolean, reason: string): string {
  return JSON.stringify({ passed, keepChanges, reason });
}

describe("phase2.ts", () => {
  let repoDir: string;

  it("passes on first iteration when verify succeeds", async () => {
    repoDir = await createTempGitRepo();
    let callCount = 0;
    const agent: SpawnAgent = async (prompt) => {
      callCount++;
      if (callCount === 1) {
        // 구현 에이전트: 파일 생성 + 커밋
        await Bun.write(join(repoDir, "hello.txt"), "hello\n");
        await $`git -C ${repoDir} add .`.quiet();
        await $`git -C ${repoDir} commit -m "add hello"`.quiet();
        return okResult("Implemented feature");
      }
      // 검증 에이전트
      return okResult(verifyJson(true, true, "all criteria met"));
    };

    const events: LoopEvent[] = [];
    const result = await runPhase2({
      spawnAgent: agent,
      spawnOpts: { cwd: repoDir, provider: "claude" },
      task: testTask,
      worktreePath: repoDir,
      maxIterations: 5,
      onEvent: (e) => events.push(e),
    });

    assert.equal(result.success, true);
    assert.equal(result.iterations, 1);
    assert(events.some((e) => e.type === "passed"));
    await cleanupDir(repoDir);
  });

  it("retries on verify failure with keepChanges=true", async () => {
    repoDir = await createTempGitRepo();
    let implCount = 0;
    let verifyCount = 0;
    const agent: SpawnAgent = async (prompt) => {
      if (prompt.includes("implementation agent")) {
        implCount++;
        return okResult("implemented");
      }
      verifyCount++;
      if (verifyCount < 2) {
        return okResult(verifyJson(false, true, "partial progress"));
      }
      return okResult(verifyJson(true, true, "all good"));
    };

    const result = await runPhase2({
      spawnAgent: agent,
      spawnOpts: { cwd: repoDir, provider: "claude" },
      task: testTask,
      worktreePath: repoDir,
      maxIterations: 5,
    });

    assert.equal(result.success, true);
    assert.equal(result.iterations, 2);
    assert.equal(implCount, 2);
    await cleanupDir(repoDir);
  });

  it("resets on verify failure with keepChanges=false", async () => {
    repoDir = await createTempGitRepo();
    let verifyCount = 0;
    const agent: SpawnAgent = async (prompt) => {
      if (prompt.includes("implementation agent")) {
        // 추적되지 않는 파일 생성
        await Bun.write(join(repoDir, "temp.txt"), "temp\n");
        return okResult("implemented");
      }
      verifyCount++;
      if (verifyCount < 2) {
        return okResult(verifyJson(false, false, "wrong approach"));
      }
      return okResult(verifyJson(true, true, "ok"));
    };

    const result = await runPhase2({
      spawnAgent: agent,
      spawnOpts: { cwd: repoDir, provider: "claude" },
      task: testTask,
      worktreePath: repoDir,
      maxIterations: 5,
    });

    assert.equal(result.success, true);
    await cleanupDir(repoDir);
  });

  it("stops on fatal spawn error", async () => {
    repoDir = await createTempGitRepo();
    const agent: SpawnAgent = async () => ({
      status: "error",
      text: "ENOENT: command not found",
      exitCode: null,
      durationMs: 10,
    });

    const events: LoopEvent[] = [];
    const result = await runPhase2({
      spawnAgent: agent,
      spawnOpts: { cwd: repoDir, provider: "claude" },
      task: testTask,
      worktreePath: repoDir,
      maxIterations: 5,
      onEvent: (e) => events.push(e),
    });

    assert.equal(result.success, false);
    assert.equal(result.iterations, 1);
    assert(events.some((e) => e.type === "error"));
    await cleanupDir(repoDir);
  });

  it("stops after 3 consecutive transient errors", async () => {
    repoDir = await createTempGitRepo();
    let callCount = 0;
    const agent: SpawnAgent = async () => {
      callCount++;
      return { status: "timeout", text: "", exitCode: null, durationMs: 100 };
    };

    const result = await runPhase2({
      spawnAgent: agent,
      spawnOpts: { cwd: repoDir, provider: "claude" },
      task: testTask,
      worktreePath: repoDir,
      maxIterations: 10,
    });

    assert.equal(result.success, false);
    assert.equal(callCount, 3);
    await cleanupDir(repoDir);
  });

  it("stops after 3 consecutive identical verify failures", async () => {
    repoDir = await createTempGitRepo();
    let verifyCount = 0;
    const agent: SpawnAgent = async (prompt) => {
      if (prompt.includes("implementation agent")) {
        return okResult("implemented");
      }
      verifyCount++;
      return okResult(verifyJson(false, true, "same reason every time"));
    };

    const events: LoopEvent[] = [];
    const result = await runPhase2({
      spawnAgent: agent,
      spawnOpts: { cwd: repoDir, provider: "claude" },
      task: testTask,
      worktreePath: repoDir,
      maxIterations: 10,
      onEvent: (e) => events.push(e),
    });

    assert.equal(result.success, false);
    assert.equal(verifyCount, 3);
    await cleanupDir(repoDir);
  });

  it("reaches max iterations", async () => {
    repoDir = await createTempGitRepo();
    let verifyCount = 0;
    const agent: SpawnAgent = async (prompt) => {
      if (prompt.includes("implementation agent")) {
        return okResult("implemented");
      }
      verifyCount++;
      return okResult(verifyJson(false, true, `failure ${verifyCount}`));
    };

    const events: LoopEvent[] = [];
    const result = await runPhase2({
      spawnAgent: agent,
      spawnOpts: { cwd: repoDir, provider: "claude" },
      task: testTask,
      worktreePath: repoDir,
      maxIterations: 3,
      onEvent: (e) => events.push(e),
    });

    assert.equal(result.success, false);
    assert(events.some((e) => e.type === "max_iterations"));
    await cleanupDir(repoDir);
  });

  it("passes iteration context to implement prompt on retry", async () => {
    repoDir = await createTempGitRepo();
    const prompts: string[] = [];
    let verifyCount = 0;

    const agent: SpawnAgent = async (prompt) => {
      if (prompt.includes("implementation agent")) {
        prompts.push(prompt);
        return okResult("implemented");
      }
      verifyCount++;
      if (verifyCount < 2) {
        return okResult(verifyJson(false, true, "missing tests"));
      }
      return okResult(verifyJson(true, true, "all good"));
    };

    await runPhase2({
      spawnAgent: agent,
      spawnOpts: { cwd: repoDir, provider: "claude" },
      task: testTask,
      worktreePath: repoDir,
      maxIterations: 5,
    });

    // 첫 번째 프롬프트에는 iteration 컨텍스트 없음
    assert(!prompts[0].includes("iteration"), "first prompt should not mention iteration");
    // 두 번째 프롬프트에는 이전 시도 정보 포함
    assert.includes(prompts[1], "iteration 2");
    assert.includes(prompts[1], "kept");
    await cleanupDir(repoDir);
  });

  it("tells agent to try different approach when changes were rolled back", async () => {
    repoDir = await createTempGitRepo();
    const prompts: string[] = [];
    let verifyCount = 0;

    const agent: SpawnAgent = async (prompt) => {
      if (prompt.includes("implementation agent")) {
        prompts.push(prompt);
        return okResult("implemented");
      }
      verifyCount++;
      if (verifyCount < 2) {
        return okResult(verifyJson(false, false, "wrong approach"));
      }
      return okResult(verifyJson(true, true, "ok"));
    };

    await runPhase2({
      spawnAgent: agent,
      spawnOpts: { cwd: repoDir, provider: "claude" },
      task: testTask,
      worktreePath: repoDir,
      maxIterations: 5,
    });

    // 롤백 후 프롬프트에 "다른 접근" 언급
    assert.includes(prompts[1], "rolled back");
    assert.includes(prompts[1], "different approach");
    await cleanupDir(repoDir);
  });

  it("test gate passes when test command succeeds", async () => {
    repoDir = await createTempGitRepo();
    const agent: SpawnAgent = async (prompt) => {
      if (prompt.includes("implementation agent")) return okResult("done");
      return okResult(verifyJson(true, true, "all good"));
    };

    const events: LoopEvent[] = [];
    const result = await runPhase2({
      spawnAgent: agent,
      spawnOpts: { cwd: repoDir, provider: "claude" },
      task: testTask,
      worktreePath: repoDir,
      maxIterations: 5,
      testCommand: "true",
      onEvent: (e) => events.push(e),
    });

    assert.equal(result.success, true);
    assert(events.some((e) => e.type === "test_start"));
    assert(events.some((e) => e.type === "test_done" && e.passed));
    assert(events.some((e) => e.type === "passed"));
    await cleanupDir(repoDir);
  });

  it("test gate overrides verdict when test command fails", async () => {
    repoDir = await createTempGitRepo();
    let verifyCount = 0;
    const agent: SpawnAgent = async (prompt) => {
      if (prompt.includes("implementation agent")) return okResult("done");
      verifyCount++;
      return okResult(verifyJson(true, true, "looks good"));
    };

    const events: LoopEvent[] = [];
    const result = await runPhase2({
      spawnAgent: agent,
      spawnOpts: { cwd: repoDir, provider: "claude" },
      task: testTask,
      worktreePath: repoDir,
      maxIterations: 2,
      testCommand: "false",
      onEvent: (e) => events.push(e),
    });

    assert.equal(result.success, false);
    assert(events.some((e) => e.type === "test_done" && !e.passed));
    // verify_done should report failure despite LLM saying passed
    const verifyDones = events.filter((e) => e.type === "verify_done");
    assert(verifyDones.length > 0);
    for (const e of verifyDones) {
      if (e.type === "verify_done") assert.equal(e.result.passed, false);
    }
    await cleanupDir(repoDir);
  });

  it("skips test gate when testCommand is not set", async () => {
    repoDir = await createTempGitRepo();
    const agent: SpawnAgent = async (prompt) => {
      if (prompt.includes("implementation agent")) return okResult("done");
      return okResult(verifyJson(true, true, "ok"));
    };

    const events: LoopEvent[] = [];
    const result = await runPhase2({
      spawnAgent: agent,
      spawnOpts: { cwd: repoDir, provider: "claude" },
      task: testTask,
      worktreePath: repoDir,
      maxIterations: 5,
      onEvent: (e) => events.push(e),
    });

    assert.equal(result.success, true);
    assert(!events.some((e) => e.type === "test_start"));
    assert(!events.some((e) => e.type === "test_done"));
    await cleanupDir(repoDir);
  });

  it("emits correct event sequence on success", async () => {
    repoDir = await createTempGitRepo();
    const agent: SpawnAgent = async (prompt) => {
      if (prompt.includes("implementation agent")) return okResult("done");
      return okResult(verifyJson(true, true, "perfect"));
    };

    const events: LoopEvent[] = [];
    await runPhase2({
      spawnAgent: agent,
      spawnOpts: { cwd: repoDir, provider: "claude" },
      task: testTask,
      worktreePath: repoDir,
      maxIterations: 5,
      onEvent: (e) => events.push(e),
    });

    assert.equal(events[0].type, "implement_start");
    assert.equal(events[1].type, "implement_done");
    assert.equal(events[2].type, "verify_start");
    assert.equal(events[3].type, "verify_done");
    assert.equal(events[4].type, "passed");
    await cleanupDir(repoDir);
  });
});
