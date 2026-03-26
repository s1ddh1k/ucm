import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { GitWorktreeManager } from "../../packages/execution/git-worktree-manager.js";
import { ExecutionService } from "../dist-electron/main/execution-service.js";

function createAgent(overrides = {}) {
  return {
    id: "a-test",
    name: "Builder-Test",
    role: "implementation",
    status: "running",
    objective: "Patch the checkout auth regression.",
    ...overrides,
  };
}

function createProviderRegistry(overrides = {}) {
  const baseAdapter = {
    name: "claude",
    createCommand() {
      return {
        cmd: "fake-provider",
        args: ["run"],
        cwd: process.cwd(),
      };
    },
    async execute() {
      return {
        status: "done",
        stdout: "Default provider output\nStatus: completed",
        stderr: "",
        exitCode: 0,
        durationMs: 1,
      };
    },
  };

  return {
    claude: { ...baseAdapter, ...overrides.claude },
    codex: { ...baseAdapter, name: "codex", ...overrides.codex },
    gemini: { ...baseAdapter, name: "gemini", ...overrides.gemini },
  };
}

function waitForCompletion(configure) {
  return new Promise((resolve) => {
    configure((result) => resolve(result));
  });
}

test("execution service prefers terminal-backed provider output when session succeeds", async () => {
  const sessions = [];
  const terminalController = {
    startSession(input) {
      sessions.push({
        provider: input.provider,
        prompt: input.prompt,
        command: input.command,
      });
      setTimeout(() => {
        input.onData("Patched checkout auth flow\n");
        input.onData("Status: needs_review\n");
        input.onExit({ exitCode: 0, signal: 0 });
      }, 0);
      return "term-test-1";
    },
    killSession() {},
    writeToSession() {
      return false;
    },
    resizeSession() {
      return false;
    },
  };

  const providerRegistry = createProviderRegistry({
    claude: {
      async execute() {
        throw new Error("pipe fallback should not run");
      },
    },
  });

  const service = new ExecutionService({
    providerAdapters: providerRegistry,
    terminalSessionService: terminalController,
  });

  const sessionStarts = [];
  const terminalChunks = [];
  const result = await waitForCompletion((onComplete) => {
    service.spawnAgentRun({
      missionId: "m-test",
      runId: "r-test",
      agent: createAgent(),
      objective: "Patch the checkout auth regression.",
      steeringContext: "- S1: keep the fix small",
      onSessionStart(session) {
        sessionStarts.push(session);
      },
      onTerminalData(chunk) {
        terminalChunks.push(chunk);
      },
      onComplete,
    });
  });

  assert.equal(sessionStarts.length, 1);
  assert.equal(sessionStarts[0].sessionId, "term-test-1");
  assert.equal(sessions[0].provider, "claude");
  assert.equal(sessionStarts[0].transport, "provider_terminal");
  assert.equal(sessionStarts[0].workspaceMode, "process");
  assert.match(sessions[0].prompt, /Recent human steering:/);
  assert.equal(terminalChunks.length, 2);
  assert.equal(result.source, "provider");
  assert.equal(result.outcome, "needs_review");
  assert.equal(result.summary, "Patched checkout auth flow");
  assert.equal(result.session?.transport, "provider_terminal");
});

test("execution service falls back to pipe execution when terminal session does not yield output", async () => {
  let executeCalls = 0;
  const terminalController = {
    startSession(input) {
      setTimeout(() => {
        input.onExit({ exitCode: 1, signal: 0 });
      }, 0);
      return "term-test-2";
    },
    killSession() {},
    writeToSession() {
      return false;
    },
    resizeSession() {
      return false;
    },
  };

  const providerRegistry = createProviderRegistry({
    claude: {
      async execute() {
        executeCalls += 1;
        return {
          status: "done",
          stdout: "Verification packet is ready\nStatus: completed",
          stderr: "",
          exitCode: 0,
          durationMs: 4,
        };
      },
    },
  });

  const service = new ExecutionService({
    providerAdapters: providerRegistry,
    terminalSessionService: terminalController,
  });

  const result = await waitForCompletion((onComplete) => {
    service.spawnAgentRun({
      missionId: "m-test",
      runId: "r-test",
      agent: createAgent({ role: "verification", name: "Verifier-Test" }),
      objective: "Verify the checkout patch.",
      onComplete,
    });
  });

  assert.equal(executeCalls, 1);
  assert.equal(result.source, "provider");
  assert.equal(result.outcome, "completed");
  assert.equal(result.summary, "Verification packet is ready");
});

test("execution service can run a gemini-backed pass without opening a terminal session", async () => {
  let terminalStarts = 0;
  const terminalController = {
    startSession() {
      terminalStarts += 1;
      return "term-gemini";
    },
    killSession() {},
    writeToSession() {
      return false;
    },
    resizeSession() {
      return false;
    },
  };

  const providerRegistry = createProviderRegistry({
    gemini: {
      async execute() {
        return {
          status: "done",
          stdout: "Collected broader alternatives\nStatus: completed",
          stderr: "",
          exitCode: 0,
          durationMs: 6,
        };
      },
    },
  });

  const service = new ExecutionService({
    providerAdapters: providerRegistry,
    terminalSessionService: terminalController,
  });

  const result = await waitForCompletion((onComplete) => {
    service.spawnAgentRun({
      missionId: "m-test",
      runId: "r-gemini",
      agent: createAgent({ role: "research", name: "Researcher-Test" }),
      objective: "Broaden the solution space before implementation.",
      providerPreference: "gemini",
      onComplete,
    });
  });

  assert.equal(terminalStarts, 0);
  assert.equal(result.source, "provider");
  assert.equal(result.outcome, "completed");
  assert.equal(result.summary, "Collected broader alternatives");
});

test("execution service delegates terminal controls to the terminal controller", () => {
  const calls = [];
  const terminalController = {
    startSession() {
      return "term-control";
    },
    killSession(sessionId) {
      calls.push(["kill", sessionId]);
    },
    writeToSession(sessionId, data) {
      calls.push(["write", sessionId, data]);
      return true;
    },
    resizeSession(sessionId, cols, rows) {
      calls.push(["resize", sessionId, cols, rows]);
      return true;
    },
  };

  const service = new ExecutionService({
    providerAdapters: createProviderRegistry(),
    terminalSessionService: terminalController,
  });

  assert.equal(service.writeTerminalSession("term-control", "hello"), true);
  assert.equal(service.resizeTerminalSession("term-control", 120, 40), true);
  service.killTerminalSession("term-control");

  assert.deepEqual(calls, [
    ["write", "term-control", "hello"],
    ["resize", "term-control", 120, 40],
    ["kill", "term-control"],
  ]);
});

test("execution service blocks provider spawn when the budget bucket is saturated", () => {
  const pendingSessions = [];
  const terminalController = {
    startSession(input) {
      pendingSessions.push(input);
      return `term-${pendingSessions.length}`;
    },
    killSession() {},
    writeToSession() {
      return false;
    },
    resizeSession() {
      return false;
    },
  };

  const service = new ExecutionService({
    providerAdapters: createProviderRegistry(),
    terminalSessionService: terminalController,
  });

  const firstStarted = service.spawnAgentRun({
    missionId: "m-budget",
    runId: "r-1",
    agent: createAgent(),
    objective: "First implementation pass.",
    budgetClass: "standard",
    executionBudgetLimit: 1,
    onComplete() {},
  });
  const secondStarted = service.spawnAgentRun({
    missionId: "m-budget",
    runId: "r-2",
    agent: createAgent({ id: "a-test-2", name: "Builder-Test-2" }),
    objective: "Second implementation pass.",
    budgetClass: "standard",
    executionBudgetLimit: 1,
    onComplete() {},
  });

  assert.equal(firstStarted, true);
  assert.equal(secondStarted, false);
  assert.equal(pendingSessions.length, 1);
});

test("execution service can run a local workspace command and capture git diff", {
  skip: "Disabled by default: git worktree integration is currently unstable in WSL/local runs.",
}, async () => {
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), "ucm-desktop-local-"));
  const worktreeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ucm-desktop-worktrees-"));
  spawnSync("git", ["init"], { cwd: workspacePath, encoding: "utf8" });
  fs.writeFileSync(path.join(workspacePath, "note.txt"), "before\n", "utf8");
  spawnSync("git", ["add", "."], { cwd: workspacePath, encoding: "utf8" });
  spawnSync("git", ["commit", "-m", "init"], {
    cwd: workspacePath,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });

  const service = new ExecutionService({
    providerAdapters: createProviderRegistry(),
    worktreeManager: new GitWorktreeManager({ rootPath: worktreeRoot }),
    terminalSessionService: {
      startSession() {
        throw new Error("local commands should not create provider terminal sessions");
      },
      killSession() {},
      writeToSession() {
        return false;
      },
      resizeSession() {
        return false;
      },
    },
  });

  const result = await waitForCompletion((onComplete) => {
    service.spawnAgentRun({
      missionId: "m-local",
      runId: "r-local",
      agent: createAgent(),
      objective: "Run local project command.",
      budgetClass: "standard",
      workspacePath,
      workspaceCommand: "printf 'after\\n' > note.txt && printf 'workspace run complete\\n'",
      onSessionStart(session) {
        assert.equal(session.transport, "local_shell");
        assert.equal(session.workspaceMode, "git_worktree");
      },
      onComplete,
    });
  });

  assert.equal(result.source, "local");
  assert.equal(result.outcome, "completed");
  assert.match(result.summary, /workspace run complete/);
  assert.match(result.generatedPatch || "", /diff --git a\/note.txt b\/note.txt/);
  assert.equal(result.session?.transport, "local_shell");
  assert.equal(result.session?.workspaceMode, "git_worktree");
  assert.ok(result.session?.worktreePath);
  assert.equal(
    fs.readFileSync(path.join(workspacePath, "note.txt"), "utf8"),
    "before\n",
  );
  assert.equal(
    fs.readFileSync(path.join(result.session.worktreePath, "note.txt"), "utf8"),
    "after\n",
  );

  fs.rmSync(worktreeRoot, { recursive: true, force: true });
});
