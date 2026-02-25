const path = require("node:path");
const os = require("node:os");

// ── Directory Constants ──

const UCM_DIR = process.env.UCM_DIR || path.join(os.homedir(), ".ucm");
const TASKS_DIR = path.join(UCM_DIR, "tasks");
const WORKTREES_DIR = path.join(UCM_DIR, "worktrees");
const WORKSPACES_DIR = path.join(UCM_DIR, "workspaces");
const ARTIFACTS_DIR = path.join(UCM_DIR, "artifacts");
const LOGS_DIR = path.join(UCM_DIR, "logs");
const DAEMON_DIR = path.join(UCM_DIR, "daemon");
const LESSONS_DIR = path.join(UCM_DIR, "lessons");
const PROPOSALS_DIR = path.join(UCM_DIR, "proposals");
const SNAPSHOTS_DIR = path.join(UCM_DIR, "snapshots");
const CONFIG_PATH = path.join(UCM_DIR, "config.json");

const SOCK_PATH = path.join(DAEMON_DIR, "ucm.sock");
const PID_PATH = path.join(DAEMON_DIR, "ucmd.pid");
const LOG_PATH = path.join(DAEMON_DIR, "ucmd.log");
const STATE_PATH = path.join(DAEMON_DIR, "state.json");
const MERGE_QUEUE_PATH = path.join(DAEMON_DIR, "merge-queue.json");
const CURATION_MODE_PATH = path.join(DAEMON_DIR, "curation-mode.json");
const DEFERRED_PROPOSALS_PATH = path.join(DAEMON_DIR, "deferred-proposals.json");
const CLUSTERS_PATH = path.join(PROPOSALS_DIR, "clusters.json");
const FEEDBACK_PATH = path.join(PROPOSALS_DIR, "feedback.json");
const DISCARD_HISTORY_PATH = path.join(PROPOSALS_DIR, "discard-history.json");
const CURATION_LOG_PATH = path.join(PROPOSALS_DIR, "curation-log.jsonl");

// ── Task & Meta Constants ──

const TASK_STATES = ["pending", "running", "review", "done", "failed"];
const META_KEYS = new Set([
  "id",
  "title",
  "status",
  "priority",
  "created",
  "startedAt",
  "completedAt",
  "project",
  "projects",
  "feedback",
  "currentStage",
  "pipeline",
  "pipelineType",
  "tokenUsage",

  "refined",
  "stageGate",
  "mergeQueue",
  "mergeRebaseCount",
]);

// ── Timing Constants ──

const STATE_DEBOUNCE_MS = 1000;
const MAX_LOG_BYTES = 10 * 1024 * 1024;
const MAX_SOCKET_REQUEST_BYTES = 1024 * 1024;
const SOCKET_READY_TIMEOUT_MS = 5000;
const SOCKET_POLL_INTERVAL_MS = 100;
const CLIENT_TIMEOUT_MS = 30 * 1000;
const SHUTDOWN_WAIT_MS = 10 * 1000;

const QUOTA_PROBE_INITIAL_MS = 5 * 60 * 1000;
const QUOTA_PROBE_MAX_MS = 30 * 60 * 1000;

// ── Template & Usage ──

const TEMPLATES_DIR = path.join(__dirname, "..", "templates");

const USAGE = `ucmd — UCM 데몬

Usage:
  ucmd start [--foreground]   데몬 시작
  ucmd stop                   데몬 종료
  ucmd --foreground           포그라운드 실행

Options:
  --foreground       포그라운드 실행 (디버깅용)
  --dev              프론트엔드 개발 모드 (web/dist index.html 매 요청 리로드)
  --help             도움말`;

// ── Pipeline & Proposal Constants ──

const PROPOSAL_STATUSES = ["proposed", "packaging", "packaged", "held", "approved", "rejected", "implemented"];
const VALID_CATEGORIES = new Set([
  "template",
  "core",
  "config",
  "test",
  "bugfix",
  "ux",
  "architecture",
  "performance",
  "docs",
  "research",
]);
const VALID_RISKS = new Set(["low", "medium", "high"]);

// ── Data & Source Constants ──

const DATA_VERSION = 1;
const SOURCE_ROOT = path.resolve(__dirname, "..");

// ── Default Config ──

const DEFAULT_CONFIG = {
  concurrency: 1,
  provider: "claude",
  model: "opus",
  scanIntervalMs: 10000,
  httpPort: 17171,
  uiPort: 17172,
  resources: {
    cpuThreshold: 0.8,
    memoryMinFreeMb: 2048,
    diskMinFreeGb: 5,
    checkIntervalMs: 30000,
  },
  cleanup: {
    retentionDays: 7,
    autoCleanOnDiskPressure: true,
  },
  quota: {
    source: "ccusage",
    mode: "work",
    modes: {
      work: { windowBudgetPercent: 50 },
      off: { windowBudgetPercent: 90 },
    },
    softLimitPercent: 80,
    hardLimitPercent: 95,
  },
  infra: {
    slots: 1,
    composeFile: "docker-compose.test.yml",
    upTimeoutMs: 60000,
    downAfterTest: true,
    browserSlots: 1,
  },
  observer: {
    enabled: true,
    intervalMs: 14400000,
    taskCountTrigger: 10,
    maxProposalsPerCycle: 5,
    dataWindowDays: 7,
    proposalRetentionDays: 30,
    perspectives: [
      "functionality",
      "ux_usability",
      "architecture",
      "quality",
      "docs_vision",
    ],
    researchEnabled: true,
    researchAfterReleases: 2,
    perspectivesByMode: {
      stabilization: ["functionality", "quality", "stabilization_analysis"],
      big_bet: ["functionality", "ux_usability", "architecture", "quality", "docs_vision"],
    },
    curation: {
      enabled: true,
      model: null,
      timeoutMs: 120000,
      maxInputProposals: 80,
      maxProposedPerProject: 12,
      autoRejectOnApprove: true,
    },
    qualityGate: {
      enabled: true,
      model: "sonnet",
      timeoutMs: 60000,
      minScore: 3,
    },
  },
  selfImprove: {
    enabled: false,
    maxRisk: "low",
    maxIterations: 5,
    requireAllTestLayers: true,
    requireHumanApproval: true,
    backupBranch: true,
    testTimeoutMs: 300000,
  },
  stageApproval: {
    clarify: true,
    specify: true,
    decompose: true,
    design: true,
    implement: true,
    verify: true,
    "ux-review": true,
    polish: true,
    integrate: true,
  },
  regulator: {
    enabled: true,
    maxRiskForAutoApprove: "low",
    blockRecentlyFailed: true,
    recentFailedWindowDays: 30,
    blockHighRiskCore: true,
    modeAwareBlocking: true,
    stabilizationExceptions: ["bugfix"],
    blockRecentlyDiscarded: true,
    discardedWindowDays: 14,
  },
  curation: {
    defaultMode: "stabilization",
    autoTransition: true,
    transitionThresholds: {
      toBigBet: {
        successRate: 0.90,
        firstPassRate: 0.80,
        openBugCount: 0,
        minStabilizationDays: 7,
        complexityTrend: "decreasing",
      },
      toStabilization: {
        successRate: 0.75,
        failingStageRate: 0.30,
        openBugCount: 5,
      },
    },
    scoring: {
      enabled: true,
      autoScore: false,
      activeProfile: "default",
      profiles: {
        default: {
          label: "Balanced",
          weights: { impact: 0.30, urgency: 0.25, uncertainty: -0.20, executionCost: -0.15, cwFitness: 0.10 },
        },
        stabilization: {
          label: "안정화 중심",
          weights: { impact: 0.20, urgency: 0.35, uncertainty: -0.25, executionCost: -0.10, cwFitness: 0.10 },
        },
        growth: {
          label: "확장 / Big Bet",
          weights: { impact: 0.40, urgency: 0.10, uncertainty: -0.10, executionCost: -0.15, cwFitness: 0.25 },
        },
        "quick-wins": {
          label: "빠른 성과",
          weights: { impact: 0.20, urgency: 0.15, uncertainty: -0.10, executionCost: -0.35, cwFitness: 0.20 },
        },
      },
    },
    clustering: {
      enabled: true,
      similarityThreshold: 0.40,
      maxClusterSize: 8,
      llmConfirmation: true,
    },
    conflicts: {
      enabled: true,
      autoCheck: false,
      deferOnHardConflict: true,
    },
    discard: {
      retentionDays: 90,
      maxRecords: 500,
    },
    bigBetChecklist: {
      requireAllPassing: true,
      autoCheck: true,
    },
    feedback: {
      enabled: true,
      autoRecord: true,
      halfLifeDays: 30,
      archiveAfterDays: 180,
      calibrationMinSamples: 3,
      weightAdjustRate: 0.1,
    },
  },
  mergeQueue: {
    enabled: true,
    maxQueueSize: 20,
    maxRebaseAttempts: 2,
    conflictResolution: "llm",
    mergeTimeoutMs: 300000,
  },
  automation: {
    autoExecute: false,
    autoApprove: false,
    autoPropose: false,
    autoConvert: false,
    autoCluster: false,
    autoScore: false,
    conflictCheck: false,
    projects: {},
  },
};

// ── Misc Constants ──

const MAX_SNAPSHOTS = 30;
const RATE_LIMIT_RE = /rate.limit|429|quota|overloaded/i;

module.exports = {
  UCM_DIR,
  TASKS_DIR,
  WORKTREES_DIR,
  WORKSPACES_DIR,
  ARTIFACTS_DIR,
  LOGS_DIR,
  DAEMON_DIR,
  LESSONS_DIR,
  PROPOSALS_DIR,
  SNAPSHOTS_DIR,
  CONFIG_PATH,
  SOCK_PATH,
  PID_PATH,
  LOG_PATH,
  STATE_PATH,
  MERGE_QUEUE_PATH,
  CURATION_MODE_PATH,
  DEFERRED_PROPOSALS_PATH,
  CLUSTERS_PATH,
  FEEDBACK_PATH,
  DISCARD_HISTORY_PATH,
  CURATION_LOG_PATH,
  TASK_STATES,
  META_KEYS,
  STATE_DEBOUNCE_MS,
  MAX_LOG_BYTES,
  MAX_SOCKET_REQUEST_BYTES,
  SOCKET_READY_TIMEOUT_MS,
  SOCKET_POLL_INTERVAL_MS,
  CLIENT_TIMEOUT_MS,
  SHUTDOWN_WAIT_MS,
  QUOTA_PROBE_INITIAL_MS,
  QUOTA_PROBE_MAX_MS,
  TEMPLATES_DIR,
  USAGE,
  PROPOSAL_STATUSES,
  VALID_CATEGORIES,
  VALID_RISKS,
  DATA_VERSION,
  SOURCE_ROOT,
  DEFAULT_CONFIG,
  MAX_SNAPSHOTS,
  RATE_LIMIT_RE,
};
