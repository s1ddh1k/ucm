import { describe, it, assert } from "./harness.ts";
import { runController, type ControllerStatus } from "../src/controller.ts";
import { createDynamicSpawnAgent, type SpawnOverrides } from "../src/spawn.ts";
import type { AdaptivePlan, Config, LoopEvent, ReviewPack } from "../src/types.ts";
import { saveState } from "../src/state.ts";
import type { ControllerState } from "../src/state.ts";
import { createWorktree } from "../src/worktree.ts";
import { createTempGitRepo, cleanupDir, mockAgentPath } from "./helpers.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * 프롬프트 내용을 보고 mock-agent의 behavior를 결정하는 resolver.
 * 실제 프로세스를 스폰하되 mock-agent.ts로 대체.
 */
function e2eResolver(
  behaviors: {
    phase1?: { behavior: string; env?: Record<string, string> };
    implement?: { behavior: string; env?: Record<string, string> };
    verify?: { behavior: string; env?: Record<string, string> };
  },
) {
  return (prompt: string): SpawnOverrides => {
    const baseEnv: Record<string, string> = {
      PATH: process.env.PATH!,
      HOME: process.env.HOME!,
    };

    // phase1: 태스크 정의 프롬프트
    if (prompt.includes("task definition assistant")) {
      const b = behaviors.phase1 ?? { behavior: "succeed" };
      return {
        cmd: "bun",
        args: [mockAgentPath()],
        env: { ...baseEnv, MOCK_BEHAVIOR: b.behavior, ...b.env },
      };
    }

    // phase2 구현: implementation agent 프롬프트
    if (prompt.includes("implementation agent")) {
      const b = behaviors.implement ?? { behavior: "succeed" };
      return {
        cmd: "bun",
        args: [mockAgentPath()],
        env: { ...baseEnv, MOCK_BEHAVIOR: b.behavior, ...b.env },
      };
    }

    // phase2 검증: verification agent 프롬프트
    if (prompt.includes("verification agent")) {
      const b = behaviors.verify ?? { behavior: "succeed" };
      return {
        cmd: "bun",
        args: [mockAgentPath()],
        env: { ...baseEnv, MOCK_BEHAVIOR: b.behavior, ...b.env },
      };
    }

    // fallback
    return {
      cmd: "bun",
      args: [mockAgentPath()],
      env: { ...baseEnv, MOCK_BEHAVIOR: "succeed" },
    };
  };
}

function makeConfig(projectPath: string, overrides: Partial<Config> = {}): Config {
  return {
    provider: "claude",
    projectPath,
    maxIterations: 3,
    idleTimeoutMs: 10_000,
    hardTimeoutMs: 30_000,
    autoApprove: true,
    resume: false,
    ...overrides,
  };
}

describe("controller.test.ts (E2E)", () => {
  let repoDir: string;

  it("full lifecycle: real spawn → phase1 → worktree → implement → verify → merge", async () => {
    repoDir = await createTempGitRepo();

    const taskJson = JSON.stringify({
      goal: "Add greeting feature",
      context: "End users",
      acceptance: "greeting.txt exists with content",
    });

    const agent = createDynamicSpawnAgent(
      e2eResolver({
        phase1: {
          behavior: "json_response",
          env: { MOCK_JSON: taskJson },
        },
        implement: {
          behavior: "implement",
          env: { MOCK_FILENAME: "greeting.txt", MOCK_CONTENT: "hello world\n" },
        },
        verify: {
          behavior: "json_response",
          env: { MOCK_JSON: '{"passed":true,"keepChanges":true,"reason":"all criteria met"}' },
        },
      }),
    );

    const statuses: ControllerStatus[] = [];
    const events: LoopEvent[] = [];
    const plans: AdaptivePlan[] = [];
    const reviews: ReviewPack[] = [];

    const result = await runController(makeConfig(repoDir), {
      spawnAgent: agent,
      onStatusChange: (s) => statuses.push(s),
      onTaskProposed: async () => true,
      onPlanReady: (plan) => plans.push(plan),
      onPhase2Event: (e) => events.push(e),
      onReviewReady: (review) => reviews.push(review),
    });

    // 전체 흐름 성공
    assert.equal(result.status, "done");
    assert(result.task !== null);
    assert.equal(result.task!.goal, "Add greeting feature");
    assert(result.plan !== null, "adaptive plan should be returned");
    assert(result.review !== null, "review pack should be returned");
    assert.equal(plans.length, 1);
    assert.equal(reviews.length, 1);
    assert(result.review!.changedFiles.includes("greeting.txt"));

    // 상태 전이 확인
    assert.equal(statuses[0], "phase1");
    assert(statuses.includes("phase2"));
    assert(statuses.includes("merging"));
    assert(statuses.includes("done"));

    // phase2 이벤트 확인
    assert(events.some((e) => e.type === "implement_start"));
    assert(events.some((e) => e.type === "implement_done"));
    assert(events.some((e) => e.type === "verify_start"));
    assert(events.some((e) => e.type === "verify_done"));
    assert(events.some((e) => e.type === "passed"));

    // 머지 후 메인 브랜치에 파일 존재
    assert(existsSync(join(repoDir, "greeting.txt")), "file should be merged to main");
    const content = await Bun.file(join(repoDir, "greeting.txt")).text();
    assert(content.startsWith("hello world\n"), "file content should start with expected text");

    await cleanupDir(repoDir);
  });

  it("E2E: phase1 fail → controller fails without worktree creation", async () => {
    repoDir = await createTempGitRepo();

    const agent = createDynamicSpawnAgent(
      e2eResolver({
        phase1: { behavior: "fail" },
      }),
    );

    const statuses: ControllerStatus[] = [];
    const result = await runController(makeConfig(repoDir), {
      spawnAgent: agent,
      onStatusChange: (s) => statuses.push(s),
    });

    assert.equal(result.status, "failed");
    assert.equal(result.task, null);
    assert.equal(statuses[0], "phase1");
    assert.equal(statuses[1], "failed");

    await cleanupDir(repoDir);
  });

  it("E2E: verify fails then passes on retry → merge succeeds", async () => {
    repoDir = await createTempGitRepo();

    const taskJson = JSON.stringify({
      goal: "Add retry feature",
      context: "Testing",
      acceptance: "retry.txt exists",
    });

    let verifyCallCount = 0;

    const agent = createDynamicSpawnAgent((prompt) => {
      const baseEnv = { PATH: process.env.PATH!, HOME: process.env.HOME! };

      if (prompt.includes("task definition assistant")) {
        return {
          cmd: "bun",
          args: [mockAgentPath()],
          env: { ...baseEnv, MOCK_BEHAVIOR: "json_response", MOCK_JSON: taskJson },
        };
      }

      if (prompt.includes("implementation agent")) {
        return {
          cmd: "bun",
          args: [mockAgentPath()],
          env: {
            ...baseEnv,
            MOCK_BEHAVIOR: "implement",
            MOCK_FILENAME: "retry.txt",
            MOCK_CONTENT: "attempt\n",
          },
        };
      }

      if (prompt.includes("verification agent")) {
        verifyCallCount++;
        const passed = verifyCallCount >= 2;
        return {
          cmd: "bun",
          args: [mockAgentPath()],
          env: {
            ...baseEnv,
            MOCK_BEHAVIOR: "json_response",
            MOCK_JSON: JSON.stringify({
              passed,
              keepChanges: true,
              reason: passed ? "looks good now" : "needs more work",
            }),
          },
        };
      }

      return { cmd: "bun", args: [mockAgentPath()], env: { ...baseEnv, MOCK_BEHAVIOR: "succeed" } };
    });

    const events: LoopEvent[] = [];
    const result = await runController(makeConfig(repoDir), {
      spawnAgent: agent,
      onTaskProposed: async () => true,
      onPhase2Event: (e) => events.push(e),
    });

    assert.equal(result.status, "done");
    assert.equal(verifyCallCount, 2);

    // verify_done 이벤트에서 첫 번째는 실패, 두 번째는 성공
    const verifyDones = events.filter((e) => e.type === "verify_done");
    assert.equal(verifyDones.length, 2);
    assert.equal((verifyDones[0] as any).result.passed, false);
    assert.equal((verifyDones[1] as any).result.passed, true);

    await cleanupDir(repoDir);
  });

  it("E2E: merge rejected by user → cancelled status", async () => {
    repoDir = await createTempGitRepo();

    const taskJson = JSON.stringify({
      goal: "Cancelled feature",
      context: "User rejects",
      acceptance: "Done",
    });

    const agent = createDynamicSpawnAgent(
      e2eResolver({
        phase1: {
          behavior: "json_response",
          env: { MOCK_JSON: taskJson },
        },
        implement: {
          behavior: "implement",
          env: { MOCK_FILENAME: "cancelled.txt", MOCK_CONTENT: "nope\n" },
        },
        verify: {
          behavior: "json_response",
          env: { MOCK_JSON: '{"passed":true,"keepChanges":true,"reason":"ok"}' },
        },
      }),
    );

    const result = await runController(
      makeConfig(repoDir, { autoApprove: false }),
      {
        spawnAgent: agent,
        onTaskProposed: async () => true,
        onApproveMerge: async () => false, // 머지 거부
      },
    );

    assert.equal(result.status, "cancelled");
    assert(result.task !== null);

    // 머지 안 됨: 메인에 파일 없어야 함
    assert(!existsSync(join(repoDir, "cancelled.txt")), "file should NOT be on main");

    await cleanupDir(repoDir);
  });

  it("E2E: implement agent timeout → transient error handling", async () => {
    repoDir = await createTempGitRepo();

    const taskJson = JSON.stringify({
      goal: "Timeout feature",
      context: "Testing",
      acceptance: "Done",
    });

    const agent = createDynamicSpawnAgent(
      e2eResolver({
        phase1: {
          behavior: "json_response",
          env: { MOCK_JSON: taskJson },
        },
        implement: { behavior: "timeout" },
        verify: {
          behavior: "json_response",
          env: { MOCK_JSON: '{"passed":true,"keepChanges":true,"reason":"ok"}' },
        },
      }),
    );

    const events: LoopEvent[] = [];
    const result = await runController(
      makeConfig(repoDir, { idleTimeoutMs: 300, hardTimeoutMs: 500 }),
      {
        spawnAgent: agent,
        onTaskProposed: async () => true,
        onPhase2Event: (e) => events.push(e),
      },
    );

    // timeout은 transient error → 3회 연속 후 실패
    assert.equal(result.status, "failed");
    assert(events.some((e) => e.type === "error"));

    await cleanupDir(repoDir);
  });

  it("E2E: worktree cleaned up after success", async () => {
    repoDir = await createTempGitRepo();

    const taskJson = JSON.stringify({
      goal: "Cleanup test",
      context: "Testing",
      acceptance: "file.txt exists",
    });

    const agent = createDynamicSpawnAgent(
      e2eResolver({
        phase1: {
          behavior: "json_response",
          env: { MOCK_JSON: taskJson },
        },
        implement: {
          behavior: "implement",
          env: { MOCK_FILENAME: "file.txt", MOCK_CONTENT: "data\n" },
        },
        verify: {
          behavior: "json_response",
          env: { MOCK_JSON: '{"passed":true,"keepChanges":true,"reason":"ok"}' },
        },
      }),
    );

    await runController(makeConfig(repoDir), {
      spawnAgent: agent,
      onTaskProposed: async () => true,
    });

    // worktree 디렉토리 정리 확인
    const { stdout } = Bun.spawnSync(["git", "-C", repoDir, "worktree", "list"]);
    const worktrees = stdout.toString().trim().split("\n");
    assert.equal(worktrees.length, 1, "only main worktree should remain");

    // 브랜치 정리 확인
    const { stdout: brOut } = Bun.spawnSync(["git", "-C", repoDir, "branch"]);
    const branches = brOut.toString().trim();
    assert(!branches.includes("ucm/"), "ucm branches should be cleaned up");

    await cleanupDir(repoDir);
  });

  it("E2E: resume from saved state skips phase1", async () => {
    repoDir = await createTempGitRepo();

    // 미리 worktree를 생성하고 상태 파일을 저장
    const worktree = await createWorktree(repoDir, "resume-test");

    const task = {
      goal: "Resumed feature",
      context: "Testing resume",
      acceptance: "file.txt exists",
      constraints: "Preserve existing README",
    };
    const config = makeConfig(repoDir, { resume: true });

    await saveState(repoDir, {
      phase: "phase2",
      task,
      plan: null,
      review: null,
      worktree,
      iteration: 0,
      config,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // phase1용 behavior 없이 implement/verify만 설정
    const agent = createDynamicSpawnAgent((prompt) => {
      const baseEnv = { PATH: process.env.PATH!, HOME: process.env.HOME! };

      if (prompt.includes("implementation agent")) {
        return {
          cmd: "bun",
          args: [mockAgentPath()],
          env: {
            ...baseEnv,
            MOCK_BEHAVIOR: "implement",
            MOCK_FILENAME: "file.txt",
            MOCK_CONTENT: "resumed content\n",
          },
        };
      }

      if (prompt.includes("verification agent")) {
        return {
          cmd: "bun",
          args: [mockAgentPath()],
          env: {
            ...baseEnv,
            MOCK_BEHAVIOR: "json_response",
            MOCK_JSON: '{"passed":true,"keepChanges":true,"reason":"ok"}',
          },
        };
      }

      // phase1 에이전트 호출이면 실패해야 함 (resume 시 호출되지 않아야 함)
      return {
        cmd: "bun",
        args: [mockAgentPath()],
        env: { ...baseEnv, MOCK_BEHAVIOR: "fail" },
      };
    });

    const statuses: ControllerStatus[] = [];
    const messages: string[] = [];

    const result = await runController(config, {
      spawnAgent: agent,
      onStatusChange: (s) => statuses.push(s),
      onPhase1Message: (text) => messages.push(text),
      onTaskProposed: async () => true,
    });

    // phase1을 건너뛰고 바로 phase2로 진행
    assert.equal(result.status, "done");
    assert.equal(result.task!.goal, "Resumed feature");
    assert(result.plan !== null);
    assert(result.review !== null);
    // resume 메시지 확인
    assert(messages.some((m) => m.includes("Resuming")), "should emit resume message");
    // phase1 상태가 없고 바로 phase2로 시작
    assert.equal(statuses[0], "phase2");

    await cleanupDir(repoDir);
  });

  it("E2E: state file cleared after successful completion", async () => {
    repoDir = await createTempGitRepo();

    const taskJson = JSON.stringify({
      goal: "State cleanup test",
      context: "Testing",
      acceptance: "clean.txt exists",
    });

    const agent = createDynamicSpawnAgent(
      e2eResolver({
        phase1: {
          behavior: "json_response",
          env: { MOCK_JSON: taskJson },
        },
        implement: {
          behavior: "implement",
          env: { MOCK_FILENAME: "clean.txt", MOCK_CONTENT: "clean\n" },
        },
        verify: {
          behavior: "json_response",
          env: { MOCK_JSON: '{"passed":true,"keepChanges":true,"reason":"ok"}' },
        },
      }),
    );

    await runController(makeConfig(repoDir), {
      spawnAgent: agent,
      onTaskProposed: async () => true,
    });

    // 완료 후 상태 파일이 제거되었는지 확인
    assert(!existsSync(join(repoDir, ".ucm-state.json")), "state file should be cleared after completion");

    await cleanupDir(repoDir);
  });

  it("saved state is ignored unless resume=true", async () => {
    repoDir = await createTempGitRepo();

    const worktree = await createWorktree(repoDir, "ignore-saved-state");
    await saveState(repoDir, {
      phase: "phase2",
      task: {
        goal: "Old task",
        context: "Should be ignored",
        acceptance: "Never",
        constraints: "none",
      },
      plan: null,
      review: null,
      worktree,
      iteration: 0,
      config: makeConfig(repoDir, { resume: true }),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const taskJson = JSON.stringify({
      goal: "Fresh task",
      context: "New run",
      acceptance: "fresh.txt exists",
      constraints: "none",
    });

    const agent = createDynamicSpawnAgent(
      e2eResolver({
        phase1: {
          behavior: "json_response",
          env: { MOCK_JSON: taskJson },
        },
        implement: {
          behavior: "implement",
          env: { MOCK_FILENAME: "fresh.txt", MOCK_CONTENT: "fresh\n" },
        },
        verify: {
          behavior: "json_response",
          env: { MOCK_JSON: '{"passed":true,"keepChanges":true,"reason":"ok"}' },
        },
      }),
    );

    const result = await runController(makeConfig(repoDir), {
      spawnAgent: agent,
      onTaskProposed: async () => true,
    });

    assert.equal(result.status, "done");
    assert.equal(result.task!.goal, "Fresh task");

    await cleanupDir(repoDir);
  });

  it("E2E: failed runs keep worktree and state for resume", async () => {
    repoDir = await createTempGitRepo();

    const taskJson = JSON.stringify({
      goal: "Fail cleanup test",
      context: "Testing",
      acceptance: "Never",
    });

    const agent = createDynamicSpawnAgent(
      e2eResolver({
        phase1: {
          behavior: "json_response",
          env: { MOCK_JSON: taskJson },
        },
        implement: { behavior: "fail" },
      }),
    );

    const result = await runController(makeConfig(repoDir), {
      spawnAgent: agent,
      onTaskProposed: async () => true,
    });

    assert.equal(result.status, "failed");
    const { stdout } = Bun.spawnSync(["git", "-C", repoDir, "worktree", "list"]);
    const worktrees = stdout.toString().trim().split("\n");
    assert.equal(worktrees.length, 2, "failed runs should keep the task worktree for resume");
    assert(existsSync(join(repoDir, ".ucm-state.json")), "state should remain after failure");

    await cleanupDir(repoDir);
  });
});
