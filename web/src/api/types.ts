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
  hivemind?: {
    running: boolean;
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
  scores?: ProposalScores;
  scoreSource?: "ai" | "user" | "mixed";
  weightProfile?: string;
  modeEligibility?: "stabilization" | "big_bet" | "both";
  clusterId?: string | null;
  packagedAt?: string;
  packagingMode?: "interactive" | "autopilot" | "hybrid";
  overallConfidence?: number;
  dimensionConfidence?: Record<string, number>;
  questionsAsked?: number;
  curationHistory?: Array<Record<string, unknown>>;
}

export type ProposalStatus =
  | "proposed"
  | "packaging"
  | "packaged"
  | "held"
  | "approved"
  | "rejected"
  | "implemented";

export interface ProposalEvaluation {
  regulatorApproved: boolean;
  regulatorReason?: string;
  score?: number;
}

// Curation types
export type CurationMode = "stabilization" | "big_bet";

export interface CurationModeData {
  mode: CurationMode;
  since: string;
  forcedBy: "user" | "auto" | null;
  history: Array<{
    from: CurationMode;
    to: CurationMode;
    timestamp: string;
    triggeredBy: "auto" | "user";
    reason: string;
  }>;
  transitionScore?: Record<string, unknown> | null;
  config?: Record<string, unknown>;
}

export interface ProposalScores {
  impact: number;
  urgency: number;
  uncertainty: number;
  executionCost: number;
  cwFitness: number;
}

export interface ProposalCluster {
  id: string;
  representativeId: string;
  title: string;
  category: string;
  members: Array<{
    proposalId: string;
    role: "representative" | "variant";
    relationship: "duplicate" | "complementary";
  }>;
  mergedScores: ProposalScores;
  mergedPriority: number;
}

export interface ClusterData {
  version: number;
  clusters: Record<string, ProposalCluster>;
  proposalToCluster: Record<string, string>;
}

export interface ConflictResult {
  proposalId: string;
  conflicts: Array<{
    type: string;
    severity: "critical" | "high" | "medium";
    conflictsWith: string;
    detail: string;
  }>;
}

export interface ReadinessChecklist {
  proposalId: string;
  ready: boolean;
  checklist: Record<string, { passed: boolean; detail: string; blocking?: string[] }>;
  computedAt: string;
  promotable: boolean;
}

export interface DiscardRecord {
  proposalId: string;
  title: string;
  category: string;
  risk: string;
  project: string | null;
  dedupHash: string;
  discardedAt: string;
  actor: string;
  reason: string;
  reasonDetail: string;
}

export interface WeightProfile {
  key: string;
  label: string;
  weights: Record<string, number>;
  active: boolean;
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
