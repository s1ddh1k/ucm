// Task types
export interface StageHistoryEntry {
  stage: string;
  status: string;
  durationMs?: number;
  timestamp?: string;
  tokenUsage?: { input?: number; output?: number } | null;
}

export interface TokenUsage {
  input?: number;
  output?: number;
  total?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  [key: string]: number | undefined;
}

export interface Task {
  id: string;
  title: string;
  state: TaskState;
  priority: number;
  created: string;
  startedAt?: string;
  completedAt?: string;
  project?: string;
  projects?: ProjectRef[];
  pipeline?: string;
  currentStage?: string;
  pipelineType?: string;
  stageHistory?: StageHistoryEntry[];
  tokenUsage?: TokenUsage;
  feedback?: string;
  refined?: boolean;
  body?: string;
  suspended?: boolean;
  suspendedStage?: string;
  stageGate?: string;
}

export type TaskState = "pending" | "running" | "review" | "done" | "failed";

export interface ProjectRef {
  path: string;
  role?: string;
}

// Stats
export interface DaemonStats {
  pid: number;
  uptime: number;
  daemonStatus: "running" | "paused" | "offline";
  activeTasks: string[];
  suspendedTasks: string[];
  queueLength: number;
  resources: ResourceInfo;
  resourcePressure: string;
  pipelines: string[];
  tasksCompleted: number;
  tasksFailed: number;
  totalSpawns: number;
  llm?: {
    provider: string;
    model: string;
    envProvider?: string | null;
  };
}

export interface ResourceInfo {
  cpuLoad: number; // CPU load average normalized to core count
  memoryFreeMb: number; // free memory in MB
  diskFreeGb: number | null; // free disk in GB (null if unavailable)
}

// Diff — backend getWorktreeDiff returns an array directly
export type DiffResult = Array<{
  project: string;
  diff: string;
}>;

// Artifacts
export interface Artifacts {
  taskId: string;
  summary: string | null;
  memory: Record<string, unknown> | null;
  files: string[];
  contents: Record<string, unknown>;
}

// Verify report artifact
export interface VerifyReport {
  passed: boolean;
  testsPassed: boolean;
  reviewPassed: boolean;
  testFailures: string[];
  issues: Array<{ severity: string; description: string; file?: string }>;
  summary: string;
}

// Polish summary artifact
export interface PolishSummary {
  lenses: Array<{
    lens: string;
    rounds: number;
    issuesFound: number;
    converged: boolean;
  }>;
  totalRounds: number;
  totalIssuesFound: number;
}

// UX review artifact
export interface UxReviewReport {
  score: number;
  summary: string;
  canUserAccomplishGoal: { goal: string; result: string; blockers: string[] };
  usabilityIssues: Array<{
    severity: string;
    description: string;
    where?: string;
    fix?: string;
  }>;
  confusingElements: string[];
  positives: string[];
  mobile: { usable: boolean; issues: string[] };
}

// Proposals — matches parseProposalFile + listProposals response
export interface Proposal {
  id: string;
  title: string;
  category: string;
  risk: string;
  priority: number;
  status: ProposalStatus;
  problem: string;
  change: string;
  expectedImpact: string;
  created: string;
  observationCycle?: number;
  dedupHash?: string;
  implementedBy?: string | null;
  project?: string;
  relatedTasks?: string[];
  evaluation?: ProposalEvaluation;
}

export type ProposalStatus =
  | "proposed"
  | "approved"
  | "rejected"
  | "implemented";

export interface ProposalEvaluation {
  regulatorApproved: boolean;
  regulatorReason?: string;
  score?: number;
}

// Observer — matches handleObserveStatus response
export interface ObserverStatus {
  cycle: number;
  lastRunAt: string | null;
  taskCountAtLastRun: number;
  observerConfig: Record<string, unknown>;
  latestSnapshot: {
    timestamp: string;
    [key: string]: unknown;
  } | null;
}

// Browse
export interface BrowseResult {
  current: string;
  parent: string;
  directories: Array<{ name: string; path: string }>;
}

// WebSocket events
export interface WsEvent {
  event: string;
  data: Record<string, unknown>;
}

// Daemon status — /api/daemon/status returns { online: true, ...stats } or { online: false }
export type DaemonStatus = ({ online: true } & DaemonStats) | { online: false };

// Stage Approval Config
export interface StageApprovalConfig {
  clarify: boolean;
  specify: boolean;
  decompose: boolean;
  design: boolean;
  implement: boolean;
  verify: boolean;
  "ux-review": boolean;
  polish: boolean;
  integrate: boolean;
  [stage: string]: boolean;
}

export interface UcmConfig {
  provider?: string;
  model?: string;
  stageApproval: StageApprovalConfig;
  [key: string]: unknown;
}

// Hivemind
export interface ZettelSource {
  adapter: string;
  ref: string;
  timestamp?: string;
}

export interface Zettel {
  id: string;
  kind: string;
  title: string;
  body: string;
  keywords: Record<string, number>;
  links?: string[];
  source?: ZettelSource | null;
  attention?: string | null;
  memoryType?: string;
  createdAt: string;
  lastAccessed: string;
  boostCount?: number;
  supersededBy?: string;
}

// Search results have a subset of fields + score
export interface ZettelSearchResult {
  id: string;
  score: number;
  rrf: number;
  decay: number;
  title: string;
  kind: string;
  keywords: Record<string, number>;
  createdAt: string;
  supersededBy?: string;
}

export interface HivemindStats {
  totalZettels: number;
  totalKeywords: number;
  byKind: Record<string, number>;
  queueLength: number;
  processing: boolean;
}

export interface GcResult {
  archived: number;
  wouldArchive?: number;
  total: number;
}

export interface ReindexResult {
  zettels: number;
  keywords: number;
}

// Refinement
export interface RefinementQuestion {
  id: string;
  question: string;
  options?: string[];
  context?: string;
}
