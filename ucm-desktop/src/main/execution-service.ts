import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type { AgentSnapshot } from "../shared/contracts";
import { ClaudeAdapter } from "./providers/claude-adapter";
import { CodexAdapter } from "./providers/codex-adapter";
import { GeminiAdapter } from "./providers/gemini-adapter";
import { LocalAdapter } from "./providers/local-adapter";
import type {
  BaseProviderAdapter,
  ProviderExecutionResult,
  ProviderName,
} from "./provider-adapter";
import { TerminalSessionService } from "./terminal-session-service";
import type {
  ExecutionController,
  ExecutionSessionSnapshot,
  ProviderAdapterRegistry,
  SpawnAgentRunInput,
  TerminalSessionController,
} from "./execution-types";

const MAX_CAPTURED_PROVIDER_OUTPUT_CHARS = 24_000;
const MAX_CAPTURED_LOCAL_OUTPUT_CHARS = 32_000;
const MAX_CAPTURED_STDERR_CHARS = 12_000;
const MAX_GENERATED_PATCH_CHARS = 80_000;

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
        gemini: new GeminiAdapter(),
        local: new LocalAdapter(),
      } satisfies ProviderAdapterRegistry);
    this.terminalSessionService =
      options?.terminalSessionService ?? new TerminalSessionService();
    this.providerLimits = {
      claude: options?.providerLimits?.claude ?? 1,
      codex: options?.providerLimits?.codex ?? 1,
      gemini: options?.providerLimits?.gemini ?? 1,
      local: options?.providerLimits?.local ?? 2,
    };
  }

  spawnAgentRun(input: SpawnAgentRunInput) {
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
      .catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : String(error);
        input.onComplete({
          missionId: input.missionId,
          runId: input.runId,
          agentId: input.agent.id,
          summary: `Provider execution failed: ${message}`,
          source: "provider",
          outcome: "blocked",
          stderr: message,
        });
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
    source: "provider" | "local";
    outcome: "completed" | "blocked" | "needs_review";
    stderr?: string;
    stdout?: string;
    generatedPatch?: string;
  }> {
    if (input.workspaceCommand?.trim()) {
      return this.executeLocalWorkspaceCommand(input);
    }

    const provider = this.resolveProvider(input.providerPreference);
    if (provider === "local") {
      throw new Error("local provider is reserved for workspace commands");
    }
    const adapter = this.providerAdapters[provider];
    const prompt = this.buildPrompt(input);
    const cwd = this.resolveCwd(input.workspacePath);
    if (this.supportsTerminalSession(provider)) {
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
    }

    const result = await adapter.execute({
      prompt,
      cwd,
      model: this.defaultModelFor(provider),
      timeoutMs: 300000,
    });
    const stdout = clampCapturedText(
      result.stdout,
      MAX_CAPTURED_PROVIDER_OUTPUT_CHARS,
    );
    const stderr = clampCapturedText(result.stderr, MAX_CAPTURED_STDERR_CHARS);

    if (result.status !== "done" || !stdout.trim()) {
      throw new Error(this.describeFailure(provider, { ...result, stdout, stderr }));
    }

    return {
      missionId: input.missionId,
      runId: input.runId,
      agentId: input.agent.id,
      summary: this.summarizeProviderOutput(input.agent, input.objective, {
        ...result,
        stdout,
        stderr,
      }),
      source: "provider",
      outcome: this.parseOutcome(stdout, input.agent),
      stderr: stderr || undefined,
      stdout: stdout || undefined,
    };
  }

  private async executeLocalWorkspaceCommand(
    input: SpawnAgentRunInput,
  ): Promise<{
    missionId: string;
    runId: string;
    agentId: string;
    summary: string;
    source: "local";
    outcome: "completed" | "blocked" | "needs_review";
    stderr?: string;
    stdout?: string;
    generatedPatch?: string;
  }> {
    const cwd = this.resolveCwd(input.workspacePath);
    const command = input.workspaceCommand?.trim();
    if (!command) {
      throw new Error("workspace command is required");
    }

    const output = await this.executeShellCommand({
      command,
      cwd,
      onData: (chunk) => {
        input.onTerminalData?.(chunk);
      },
    });
    const generatedPatch = await this.captureGitDiff(cwd);

    return {
      missionId: input.missionId,
      runId: input.runId,
      agentId: input.agent.id,
      summary: this.summarizeLocalCommand(command, output.stdout, output.stderr),
      source: "local",
      outcome: output.exitCode === 0 ? "completed" : "blocked",
      stderr: output.stderr || undefined,
      stdout: output.stdout || undefined,
      generatedPatch: generatedPatch || undefined,
    };
  }

  private executeWithTerminalSession(input: {
    adapter: BaseProviderAdapter;
    provider: Exclude<ProviderName, "local">;
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
    session?: ExecutionSessionSnapshot;
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
          session?: ExecutionSessionSnapshot;
        } | null,
      ) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      const sessionSnapshot: ExecutionSessionSnapshot = {
        sessionId: "",
        provider: input.provider,
        transport: "provider_terminal",
        cwd: input.cwd,
        workspaceMode: "process",
        interactive: true,
      };

      try {
        sessionId = this.terminalSessionService.startSession({
          command: input.adapter.createCommand({
            prompt: input.prompt,
            cwd: input.cwd,
            model: this.defaultModelFor(input.provider),
            timeoutMs: 300000,
          }),
          prompt: input.prompt,
          provider: input.provider,
          onData: (chunk) => {
            output = appendCapturedText(
              output,
              chunk,
              MAX_CAPTURED_PROVIDER_OUTPUT_CHARS,
            );
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
              session: { ...sessionSnapshot, sessionId },
            });
          },
        });
        sessionSnapshot.sessionId = sessionId;
        input.input.onSessionStart?.({ ...sessionSnapshot, sessionId });
      } catch {
        if (sessionId) {
          this.terminalSessionService.killSession(sessionId);
        }
        finish(null);
      }
    });
  }

  private executeShellCommand(input: {
    command: string;
    cwd: string;
    onData?: (chunk: string) => void;
  }): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
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
        stdout = appendCapturedText(stdout, text, MAX_CAPTURED_LOCAL_OUTPUT_CHARS);
        input.onData?.(text);
      });
      child.stderr.on("data", (chunk) => {
        const text = chunk.toString();
        stderr = appendCapturedText(stderr, text, MAX_CAPTURED_STDERR_CHARS);
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

  private captureGitDiff(cwd: string): Promise<string> {
    return new Promise((resolve) => {
      try {
        const child = spawn(
          "git",
          ["diff", "--no-ext-diff", "--", "."],
          {
            cwd,
            env: { ...process.env },
            stdio: ["ignore", "pipe", "ignore"],
          },
        );

        let stdout = "";

        child.stdout.on("data", (chunk) => {
          stdout = appendCapturedText(
            stdout,
            chunk.toString(),
            MAX_GENERATED_PATCH_CHARS,
          );
        });
        child.on("error", () => {
          resolve("");
        });
        child.on("close", (exitCode) => {
          if (exitCode !== 0) {
            resolve("");
            return;
          }
          resolve(stdout.trim());
        });
      } catch {
        resolve("");
      }
    });
  }

  private resolveProvider(preferred?: ProviderName): ProviderName {
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
    if (raw === "codex") {
      return "codex";
    }
    if (raw === "gemini") {
      return "gemini";
    }
    return "claude";
  }

  private defaultModelFor(provider: ProviderName): string | undefined {
    if (provider === "local") {
      return undefined;
    }
    if (provider === "claude") {
      return "sonnet";
    }
    if (provider === "codex") {
      return "medium";
    }
    return undefined;
  }

  private supportsTerminalSession(
    provider: Exclude<ProviderName, "local">,
  ): boolean {
    return provider !== "gemini";
  }

  private summarizeLocalCommand(
    command: string,
    stdout: string,
    stderr: string,
  ): string {
    const firstLine =
      stdout.split(/\r?\n/).find((line) => line.trim()) ||
      stderr.split(/\r?\n/).find((line) => line.trim());
    return firstLine || `Local command completed: ${command}`;
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
    const roleInstruction = this.buildRoleInstruction(input.agent.role);
    return [
      `You are ${input.agent.name}, acting in role ${input.agent.role}.`,
      `Objective: ${input.objective}`,
      steeringSection,
      roleInstruction,
      "When done, end with exactly one status line:",
      "Status: completed | blocked | needs_review",
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

  private buildRoleInstruction(role: string): string {
    switch (role) {
      case "implementation":
        return "Implement the objective. Read the relevant code, make the changes, and run tests if available.";
      case "verification":
        return "Verify the objective. Read the code, run tests, and report pass/fail results with evidence.";
      case "design":
        return "Analyze the objective. Read the relevant code and produce a design recommendation with trade-offs.";
      case "research":
        return "Research the objective. Gather context from the codebase and summarize findings with references.";
      case "coordination":
        return "Assess the current state of the mission. Identify blockers, risks, and the next action needed.";
      default:
        return "Complete the objective and report what changed, what remains risky, and what should happen next.";
    }
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

function appendCapturedText(
  current: string,
  chunk: string,
  maxChars: number,
): string {
  return clampCapturedText(`${current}${chunk}`, maxChars);
}

function clampCapturedText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  const separator = "\n...[truncated output]...\n";
  const headLength = Math.max(0, Math.floor((maxChars - separator.length) * 0.4));
  const tailLength = Math.max(0, maxChars - separator.length - headLength);
  return `${value.slice(0, headLength)}${separator}${value.slice(-tailLength)}`;
}
