const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const { GitWorktreeManager } = require("./git-worktree-manager.js");

class RuntimeExecutionEngine {
  constructor(options = {}) {
    this.activeRuns = new Set();
    this.activeBudgetCounts = new Map();
    this.activeProviderCounts = new Map();
    this.providerAdapters = options.providerAdapters ?? {};
    this.terminalSessionController = options.terminalSessionController;
    this.worktreeManager =
      options.worktreeManager ?? new GitWorktreeManager(options.worktreeOptions);
    this.providerLimits = {
      claude: options.providerLimits?.claude ?? 1,
      codex: options.providerLimits?.codex ?? 1,
      local: options.providerLimits?.local ?? 2,
    };
  }

  spawnAgentRun(input) {
    const executionKey = `${input.runId}:${input.agent.id}`;
    if (this.activeRuns.has(executionKey)) {
      return false;
    }

    const provider = input.workspaceCommand?.trim()
      ? "local"
      : this.resolveProvider(input.providerPreference);
    const activeProviderCount = this.activeProviderCounts.get(provider) ?? 0;
    if (activeProviderCount >= this.providerLimits[provider]) {
      return false;
    }

    const budgetKey = `${input.missionId}:${input.budgetClass ?? "standard"}`;
    const currentBudgetCount = this.activeBudgetCounts.get(budgetKey) ?? 0;
    if (
      typeof input.executionBudgetLimit === "number" &&
      input.executionBudgetLimit >= 0 &&
      currentBudgetCount >= input.executionBudgetLimit
    ) {
      return false;
    }

    this.activeRuns.add(executionKey);
    this.activeBudgetCounts.set(budgetKey, currentBudgetCount + 1);
    this.activeProviderCounts.set(provider, activeProviderCount + 1);

    void this.execute(input, provider)
      .then((result) => {
        input.onComplete(result);
      })
      .catch(() => {
        this.spawnMockFallback(input);
      })
      .finally(() => {
        this.activeRuns.delete(executionKey);
        const nextBudgetCount = (this.activeBudgetCounts.get(budgetKey) ?? 1) - 1;
        if (nextBudgetCount <= 0) {
          this.activeBudgetCounts.delete(budgetKey);
        } else {
          this.activeBudgetCounts.set(budgetKey, nextBudgetCount);
        }
        const nextProviderCount =
          (this.activeProviderCounts.get(provider) ?? 1) - 1;
        if (nextProviderCount <= 0) {
          this.activeProviderCounts.delete(provider);
        } else {
          this.activeProviderCounts.set(provider, nextProviderCount);
        }
      });

    return true;
  }

  async execute(input, provider) {
    const workspaceContext = this.worktreeManager.prepareRunWorkspace({
      runId: input.runId,
      missionId: input.missionId,
      workspacePath: input.workspacePath,
    });

    if (input.workspaceCommand?.trim()) {
      return this.executeLocalWorkspaceCommand({
        input,
        provider,
        workspaceContext,
      });
    }

    const adapter = this.providerAdapters[provider];
    if (!adapter) {
      throw new Error(`missing provider adapter: ${provider}`);
    }

    const prompt = this.buildPrompt(input);
    const cwd = workspaceContext.cwd;
    const terminalResult = await this.executeWithTerminalSession({
      adapter,
      provider,
      prompt,
      cwd,
      input,
      workspaceContext,
    });
    if (terminalResult) {
      return terminalResult;
    }

    input.onSessionStart?.({
      sessionId: `exec-${input.runId}`,
      provider,
      transport: "provider_pipe",
      cwd,
      workspaceMode: workspaceContext.workspaceMode,
      workspaceRootPath: workspaceContext.workspaceRootPath,
      worktreePath: workspaceContext.worktreePath,
      interactive: false,
    });

    const result = await adapter.execute({
      prompt,
      cwd,
      model: this.defaultModelFor(provider),
      timeoutMs: 45000,
    });

    if (result.status !== "done" || !result.stdout.trim()) {
      throw new Error(this.describeFailure(provider, result));
    }

    return {
      missionId: input.missionId,
      runId: input.runId,
      agentId: input.agent.id,
      summary: this.summarizeProviderOutput(input.agent, input.objective, result),
      source: "provider",
      outcome: this.parseOutcome(result.stdout, input.agent),
      stderr: result.stderr || undefined,
      session: {
        sessionId: `exec-${input.runId}`,
        provider,
        transport: "provider_pipe",
        cwd,
        workspaceMode: workspaceContext.workspaceMode,
        workspaceRootPath: workspaceContext.workspaceRootPath,
        worktreePath: workspaceContext.worktreePath,
        interactive: false,
      },
    };
  }

  async executeLocalWorkspaceCommand(input) {
    const command = input.input.workspaceCommand?.trim();
    if (!command) {
      throw new Error("workspace command is required");
    }

    const session = {
      sessionId: `exec-${input.input.runId}`,
      provider: "local",
      transport: "local_shell",
      cwd: input.workspaceContext.cwd,
      workspaceMode: input.workspaceContext.workspaceMode,
      workspaceRootPath: input.workspaceContext.workspaceRootPath,
      worktreePath: input.workspaceContext.worktreePath,
      interactive: false,
    };
    input.input.onSessionStart?.(session);

    const output = await this.executeShellCommand({
      command,
      cwd: input.workspaceContext.cwd,
      onData: (chunk) => {
        input.input.onTerminalData?.(chunk);
      },
    });
    const generatedPatch = this.captureGitDiff(input.workspaceContext.cwd);

    return {
      missionId: input.input.missionId,
      runId: input.input.runId,
      agentId: input.input.agent.id,
      summary: this.summarizeLocalCommand(command, output.stdout, output.stderr),
      source: "local",
      outcome: output.exitCode === 0 ? "completed" : "blocked",
      stderr: output.stderr || undefined,
      stdout: output.stdout || undefined,
      generatedPatch: generatedPatch || undefined,
      session,
    };
  }

  executeWithTerminalSession(input) {
    if (!this.terminalSessionController) {
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      let output = "";
      let settled = false;
      let sessionId = "";

      const finish = (result) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      try {
        sessionId = this.terminalSessionController.startSession({
          command: input.adapter.createCommand({
            prompt: input.prompt,
            cwd: input.cwd,
            model: this.defaultModelFor(input.provider),
            timeoutMs: 45000,
          }),
          prompt: input.prompt,
          provider: input.provider,
          onData: (chunk) => {
            output += chunk;
            input.input.onTerminalData?.(chunk);
          },
          onExit: ({ exitCode }) => {
            if (exitCode !== 0 || !output.trim()) {
              finish(null);
              return;
            }
            finish({
              missionId: input.input.missionId,
              runId: input.input.runId,
              agentId: input.input.agent.id,
              summary: this.summarizeTerminalOutput(
                input.input.agent,
                input.input.objective,
                output,
              ),
              source: "provider",
              outcome: this.parseOutcome(output, input.input.agent),
              session: {
                sessionId,
                provider: input.provider,
                transport: "provider_terminal",
                cwd: input.cwd,
                workspaceMode: input.workspaceContext.workspaceMode,
                workspaceRootPath: input.workspaceContext.workspaceRootPath,
                worktreePath: input.workspaceContext.worktreePath,
                interactive: true,
              },
            });
          },
        });
        input.input.onSessionStart?.({
          sessionId,
          provider: input.provider,
          transport: "provider_terminal",
          cwd: input.cwd,
          workspaceMode: input.workspaceContext.workspaceMode,
          workspaceRootPath: input.workspaceContext.workspaceRootPath,
          worktreePath: input.workspaceContext.worktreePath,
          interactive: true,
        });
      } catch {
        if (sessionId) {
          this.terminalSessionController.killSession(sessionId);
        }
        finish(null);
      }
    });
  }

  spawnMockFallback(input) {
    setTimeout(() => {
      input.onComplete({
        missionId: input.missionId,
        runId: input.runId,
        agentId: input.agent.id,
        summary: `${input.agent.name} finished a mock pass for "${input.objective}".`,
        source: "mock",
        outcome:
          input.agent.role === "verification" ? "needs_review" : "completed",
        session: {
          sessionId: `mock-${input.runId}`,
          provider: input.workspaceCommand?.trim() ? "local" : this.resolveProvider(input.providerPreference),
          transport: input.workspaceCommand?.trim() ? "local_shell" : "provider_pipe",
          cwd: this.worktreeManager.prepareRunWorkspace({
            runId: input.runId,
            missionId: input.missionId,
            workspacePath: input.workspacePath,
          }).cwd,
          workspaceMode: this.worktreeManager.prepareRunWorkspace({
            runId: input.runId,
            missionId: input.missionId,
            workspacePath: input.workspacePath,
          }).workspaceMode,
          workspaceRootPath: this.worktreeManager.prepareRunWorkspace({
            runId: input.runId,
            missionId: input.missionId,
            workspacePath: input.workspacePath,
          }).workspaceRootPath,
          worktreePath: this.worktreeManager.prepareRunWorkspace({
            runId: input.runId,
            missionId: input.missionId,
            workspacePath: input.workspacePath,
          }).worktreePath,
          interactive: false,
        },
      });
    }, 150);
  }

  executeShellCommand(input) {
    return new Promise((resolve, reject) => {
      const child = spawn(input.command, {
        cwd: input.cwd,
        env: { ...process.env },
        shell: true,
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        const text = chunk.toString();
        stdout += text;
        input.onData?.(text);
      });
      child.stderr.on("data", (chunk) => {
        const text = chunk.toString();
        stderr += text;
        input.onData?.(text);
      });
      child.on("error", (error) => {
        reject(error);
      });
      child.on("close", (exitCode) => {
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode,
        });
      });
    });
  }

  captureGitDiff(cwd) {
    try {
      const result = spawnSync("git", ["diff", "--no-ext-diff", "--", "."], {
        cwd,
        encoding: "utf8",
      });
      if (result.status !== 0) {
        return "";
      }
      return result.stdout.trim();
    } catch {
      return "";
    }
  }

  resolveProvider(preferred) {
    if (preferred === "local") {
      return "local";
    }
    if (preferred && this.providerAdapters[preferred]) {
      return preferred;
    }
    const raw = (
      process.env.UCM_PROVIDER ||
      process.env.LLM_PROVIDER ||
      "claude"
    ).toLowerCase();
    return raw === "codex" ? "codex" : "claude";
  }

  defaultModelFor(provider) {
    if (provider === "local") {
      return undefined;
    }
    if (provider === "claude") {
      return "sonnet";
    }
    return "medium";
  }

  summarizeLocalCommand(command, stdout, stderr) {
    const firstLine =
      stdout.split(/\r?\n/).find((line) => line.trim()) ||
      stderr.split(/\r?\n/).find((line) => line.trim());
    return firstLine || `Local command completed: ${command}`;
  }

  buildPrompt(input) {
    const steeringSection = input.steeringContext
      ? `Recent human steering:\n${input.steeringContext}`
      : "Recent human steering:\n- none";
    const roleInstruction =
      input.agent.role === "implementation"
        ? "Produce a concise implementation update. Describe the likely patch shape, touched areas, and immediate risk."
        : "Produce a concise verification update. Describe the test posture, failure signal, and next review concern.";
    return [
      `You are ${input.agent.name}, acting in role ${input.agent.role}.`,
      `Objective: ${input.objective}`,
      steeringSection,
      roleInstruction,
      "Respond in plain text with 3 short sections:",
      "1. What changed",
      "2. What remains risky",
      "3. What the next agent should do",
      "End with exactly one status line in this format:",
      "Status: completed | blocked | needs_review",
      "Keep the response under 140 words.",
    ].join("\n");
  }

  summarizeProviderOutput(agent, objective, result) {
    const firstLine = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => Boolean(line) && !/^status:/i.test(line));
    return (
      firstLine ||
      `${agent.name} completed a provider-backed pass for "${objective}".`
    );
  }

  summarizeTerminalOutput(agent, objective, output) {
    const line = output
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean)
      .find(
        (value) =>
          !value.startsWith(">") &&
          !value.startsWith("$") &&
          !/^status:/i.test(value),
      );
    return (
      line ||
      `${agent.name} completed a terminal-backed pass for "${objective}".`
    );
  }

  parseOutcome(output, agent) {
    const statusLine = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => /^status:/i.test(line));
    const normalized = statusLine?.split(":")[1]?.trim().toLowerCase();
    if (normalized === "blocked") {
      return "blocked";
    }
    if (normalized === "needs_review") {
      return "needs_review";
    }
    if (normalized === "completed") {
      return "completed";
    }
    return agent.role === "verification" ? "needs_review" : "completed";
  }

  describeFailure(provider, result) {
    return [provider + " execution failed", result.status, result.stderr, result.stdout]
      .filter(Boolean)
      .join(": ");
  }

  writeTerminalSession(sessionId, data) {
    return this.terminalSessionController?.writeToSession(sessionId, data) ?? false;
  }

  resizeTerminalSession(sessionId, cols, rows) {
    return this.terminalSessionController?.resizeSession(sessionId, cols, rows) ?? false;
  }

  killTerminalSession(sessionId) {
    this.terminalSessionController?.killSession(sessionId);
  }
}

module.exports = {
  RuntimeExecutionEngine,
};
