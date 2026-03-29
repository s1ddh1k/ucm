import type {
  AgentSnapshot,
  BudgetClass,
  RoleContractId,
  RunExecutionStats,
} from "../shared/contracts";
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
  source: "provider" | "mock" | "local";
  outcome: AgentRunOutcome;
  stderr?: string;
  stdout?: string;
  generatedPatch?: string;
  session?: ExecutionSessionSnapshot;
  executionStats?: RunExecutionStats;
};

export type WorkspaceExecutionMode = "process" | "workspace" | "git_worktree";

export type SessionTransport =
  | "provider_terminal"
  | "provider_pipe"
  | "local_shell";

export type ExecutionSessionSnapshot = {
  sessionId: string;
  provider: ProviderName;
  transport: SessionTransport;
  cwd: string;
  workspaceMode: WorkspaceExecutionMode;
  workspaceRootPath?: string;
  worktreePath?: string;
  interactive: boolean;
};

export type SpawnAgentRunInput = {
  missionId: string;
  runId: string;
  agent: AgentSnapshot;
  objective: string;
  roleContractId?: RoleContractId;
  budgetClass: BudgetClass;
  providerPreference?: ProviderName;
  executionBudgetLimit?: number;
  workspacePath?: string;
  workspaceCommand?: string;
  steeringContext?: string;
  contextSummary?: string;
  onSessionStart?: (session: ExecutionSessionSnapshot) => void;
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
