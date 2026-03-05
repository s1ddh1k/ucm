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

export interface Task {
  goal: string;
  context: string;
  acceptance: string;
}

export type LoopEvent =
  | { type: "implement_start"; iteration: number }
  | { type: "implement_done"; iteration: number }
  | { type: "verify_start"; iteration: number }
  | { type: "verify_done"; result: VerifyResult }
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
  testCommand?: string;
}

export interface WorktreeInfo {
  worktreePath: string;
  branchName: string;
  baseBranch: string;
  projectPath: string;
}
