import type { AgentSnapshot, BudgetClass } from "../shared/contracts";
import type {
  BaseProviderAdapter,
  ProviderExecutionResult,
  ProviderName,
} from "./provider-adapter";

export type AgentRunOutcome = "completed" | "blocked" | "needs_review";

export type AgentRunCompletion = {
  missionId: string;
  runId: string;
  agentId: string;
  summary: string;
  source: "provider" | "mock";
  outcome: AgentRunOutcome;
  stderr?: string;
};

export type SpawnAgentRunInput = {
  missionId: string;
  runId: string;
  agent: AgentSnapshot;
  objective: string;
  budgetClass: BudgetClass;
  providerPreference?: ProviderName;
  executionBudgetLimit?: number;
  workspacePath?: string;
  steeringContext?: string;
  onSessionStart?: (session: {
    sessionId: string;
    provider: ProviderName;
  }) => void;
  onTerminalData?: (chunk: string) => void;
  onComplete: (result: AgentRunCompletion) => void;
};

export type TerminalSessionCommand = {
  cmd: string;
  args: string[];
  cwd?: string;
};

export type StartTerminalSessionInput = {
  command: TerminalSessionCommand;
  prompt: string;
  provider: ProviderName;
  onData: (chunk: string) => void;
  onExit: (result: { exitCode: number; signal: number }) => void;
};

export interface TerminalSessionController {
  startSession(input: StartTerminalSessionInput): string;
  killSession(sessionId: string): void;
  writeToSession(sessionId: string, data: string): boolean;
  resizeSession(sessionId: string, cols: number, rows: number): boolean;
}

export interface ExecutionController {
  spawnAgentRun(input: SpawnAgentRunInput): boolean | void;
  writeTerminalSession(sessionId: string, data: string): boolean;
  resizeTerminalSession(sessionId: string, cols: number, rows: number): boolean;
  killTerminalSession(sessionId: string): void;
}

export type ProviderAdapterRegistry = Record<ProviderName, BaseProviderAdapter>;

export type ProviderExecutionSummaryInput = {
  missionId: string;
  runId: string;
  agentId: string;
  objective: string;
  provider: ProviderName;
  result: ProviderExecutionResult;
};
