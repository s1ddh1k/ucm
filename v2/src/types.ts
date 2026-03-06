export interface SpawnOpts {
  cwd: string;
  provider: "claude" | "codex";
  model?: string;
  idleTimeoutMs?: number;
  hardTimeoutMs?: number;
  onData?: (chunk: string) => void;
}

export interface SpawnResult {
  status: "ok" | "error" | "timeout" | "rate_limited" | "loop_killed";
  text: string;
  exitCode: number | null;
  durationMs: number;
}

export type SpawnAgent = (prompt: string, opts: SpawnOpts) => Promise<SpawnResult>;

export interface VerifyResult {
  passed: boolean;
  keepChanges: boolean;
  reason: string;
}

export type ToolName = "specify" | "decompose" | "ux-review" | "polish";

export type ToolStage = "preflight" | "review";

export interface AdaptiveToolPlan {
  tool: ToolName;
  stage: ToolStage;
  rationale: string;
}

export interface AdaptivePlan {
  summary: string;
  tools: AdaptiveToolPlan[];
}

export interface ReviewIssue {
  severity: "critical" | "major" | "minor";
  summary: string;
  where?: string;
  fix?: string;
  source?: ToolName;
}

export interface ToolResult {
  tool: ToolName;
  stage: ToolStage;
  iteration: number;
  status: "ok" | "failed";
  rationale: string;
  summary: string;
  raw: string;
  blocking: boolean;
  checklist: string[];
  evidence: string[];
  expectedFiles: string[];
  issues: ReviewIssue[];
}

export interface ReviewFile {
  path: string;
  additions: number;
  deletions: number;
  patch: string;
}

export interface ReviewPack {
  baseBranch: string;
  branchName: string;
  changedFiles: string[];
  commits: string[];
  diffStat: string;
  diff: string;
  finalReason: string;
  testOutput: string;
  iterations: number;
  toolResults: ToolResult[];
  reviewIssues: ReviewIssue[];
  files: ReviewFile[];
}

export interface Task {
  goal: string;
  context: string;
  acceptance: string;
  constraints?: string;
}

export type LoopEvent =
  | { type: "implement_start"; iteration: number }
  | { type: "implement_done"; iteration: number }
  | { type: "verify_start"; iteration: number }
  | { type: "verify_done"; result: VerifyResult }
  | { type: "tool_start"; tool: ToolName; stage: ToolStage; iteration: number }
  | { type: "tool_done"; result: ToolResult }
  | { type: "review_blocked"; iteration: number; summary: string; issues: ReviewIssue[] }
  | { type: "test_start" }
  | { type: "test_done"; passed: boolean; output: string }
  | { type: "passed" }
  | { type: "max_iterations" }
  | { type: "error"; message: string };

export interface Config {
  provider: "claude" | "codex";
  model?: string;
  projectPath: string;
  maxIterations: number;
  idleTimeoutMs: number;
  hardTimeoutMs: number;
  autoApprove: boolean;
  resume?: boolean;
  testCommand?: string;
}

export interface WorktreeInfo {
  worktreePath: string;
  branchName: string;
  baseBranch: string;
  projectPath: string;
}
