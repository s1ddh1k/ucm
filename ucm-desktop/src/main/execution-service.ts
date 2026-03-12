import fs from "node:fs";
import path from "node:path";
import type { AgentSnapshot } from "../shared/contracts";
import { ClaudeAdapter } from "./providers/claude-adapter";
import { CodexAdapter } from "./providers/codex-adapter";
import type {
  BaseProviderAdapter,
  ProviderExecutionResult,
  ProviderName,
} from "./provider-adapter";
import { TerminalSessionService } from "./terminal-session-service";
import type {
  ExecutionController,
  ProviderAdapterRegistry,
  SpawnAgentRunInput,
  TerminalSessionController,
} from "./execution-types";

export class ExecutionService implements ExecutionController {
  private activeRuns = new Set<string>();
  private activeBudgetCounts = new Map<string, number>();
  private activeProviderCounts = new Map<ProviderName, number>();
  private providerAdapters: ProviderAdapterRegistry;
  private terminalSessionService: TerminalSessionController;
  private providerLimits: Record<ProviderName, number>;

  constructor(options?: {
    providerAdapters?: ProviderAdapterRegistry;
    terminalSessionService?: TerminalSessionController;
    providerLimits?: Partial<Record<ProviderName, number>>;
  }) {
    this.providerAdapters =
      options?.providerAdapters ??
      ({
        claude: new ClaudeAdapter(),
        codex: new CodexAdapter(),
      } satisfies ProviderAdapterRegistry);
    this.terminalSessionService =
      options?.terminalSessionService ?? new TerminalSessionService();
    this.providerLimits = {
      claude: options?.providerLimits?.claude ?? 1,
      codex: options?.providerLimits?.codex ?? 1,
    };
  }

  spawnAgentRun(input: SpawnAgentRunInput) {
    const executionKey = `${input.runId}:${input.agent.id}`;
    if (this.activeRuns.has(executionKey)) {
      return false;
    }

    const provider = this.resolveProvider(input.providerPreference);
    const activeProviderCount = this.activeProviderCounts.get(provider) ?? 0;
    if (activeProviderCount >= this.providerLimits[provider]) {
      return false;
    }

    const budgetKey = `${input.missionId}:${input.budgetClass}`;
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

    void this.executeWithProvider(input)
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
        const nextProviderCount = (this.activeProviderCounts.get(provider) ?? 1) - 1;
        if (nextProviderCount <= 0) {
          this.activeProviderCounts.delete(provider);
        } else {
          this.activeProviderCounts.set(provider, nextProviderCount);
        }
      });

    return true;
  }

  private async executeWithProvider(
    input: SpawnAgentRunInput,
  ): Promise<{
    missionId: string;
    runId: string;
    agentId: string;
    summary: string;
    source: "provider";
    outcome: "completed" | "blocked" | "needs_review";
    stderr?: string;
  }> {
    const provider = this.resolveProvider(input.providerPreference);
    const adapter = this.providerAdapters[provider];
    const prompt = this.buildPrompt(input);
    const cwd = this.resolveCwd(input.workspacePath);
    const terminalResult = await this.executeWithTerminalSession({
      adapter,
      provider,
      prompt,
      cwd,
      input,
    });
    if (terminalResult) {
      return terminalResult;
    }

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
    };
  }

  private executeWithTerminalSession(input: {
    adapter: BaseProviderAdapter;
    provider: ProviderName;
    prompt: string;
    cwd: string;
    input: SpawnAgentRunInput;
  }): Promise<{
    missionId: string;
    runId: string;
    agentId: string;
    summary: string;
    source: "provider";
    outcome: "completed" | "blocked" | "needs_review";
    stderr?: string;
  } | null> {
    return new Promise((resolve) => {
      let output = "";
      let settled = false;
      let sessionId = "";

      const finish = (
        result: {
          missionId: string;
          runId: string;
          agentId: string;
          summary: string;
          source: "provider";
          outcome: "completed" | "blocked" | "needs_review";
          stderr?: string;
        } | null,
      ) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      try {
        sessionId = this.terminalSessionService.startSession({
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
            });
          },
        });
        input.input.onSessionStart?.({
          sessionId,
          provider: input.provider,
        });
      } catch {
        if (sessionId) {
          this.terminalSessionService.killSession(sessionId);
        }
        finish(null);
      }
    });
  }

  private spawnMockFallback(input: SpawnAgentRunInput) {
    setTimeout(() => {
      input.onComplete({
        missionId: input.missionId,
        runId: input.runId,
        agentId: input.agent.id,
        summary: `${input.agent.name} finished a mock pass for "${input.objective}".`,
        source: "mock",
        outcome:
          input.agent.role === "verification" ? "needs_review" : "completed",
      });
    }, 150);
  }

  private resolveProvider(preferred?: ProviderName): ProviderName {
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

  private defaultModelFor(provider: ProviderName): string | undefined {
    if (provider === "claude") {
      return "sonnet";
    }
    return "medium";
  }

  private resolveCwd(workspacePath?: string): string {
    if (workspacePath) {
      const resolved = path.resolve(workspacePath);
      if (fs.existsSync(resolved)) {
        return resolved;
      }
    }
    return process.cwd();
  }

  private buildPrompt(input: SpawnAgentRunInput): string {
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

  private summarizeProviderOutput(
    agent: AgentSnapshot,
    objective: string,
    result: ProviderExecutionResult,
  ): string {
    const firstLine = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => Boolean(line) && !/^status:/i.test(line));
    return (
      firstLine ||
      `${agent.name} completed a provider-backed pass for "${objective}".`
    );
  }

  private summarizeTerminalOutput(
    agent: AgentSnapshot,
    objective: string,
    output: string,
  ): string {
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
    return line || `${agent.name} completed a terminal-backed pass for "${objective}".`;
  }

  private parseOutcome(
    output: string,
    agent: AgentSnapshot,
  ): "completed" | "blocked" | "needs_review" {
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

  private describeFailure(
    provider: ProviderName,
    result: ProviderExecutionResult,
  ): string {
    return [
      `${provider} execution failed`,
      result.status,
      result.stderr,
      result.stdout,
    ]
      .filter(Boolean)
      .join(": ");
  }

  writeTerminalSession(sessionId: string, data: string) {
    return this.terminalSessionService.writeToSession(sessionId, data);
  }

  resizeTerminalSession(sessionId: string, cols: number, rows: number) {
    return this.terminalSessionService.resizeSession(sessionId, cols, rows);
  }

  killTerminalSession(sessionId: string) {
    this.terminalSessionService.killSession(sessionId);
  }
}
