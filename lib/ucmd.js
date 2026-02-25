#!/usr/bin/env node
const { spawn, execFile, execFileSync } = require("node:child_process");
const {
  readFile,
  writeFile,
  mkdir,
  readdir,
  unlink,
  rename,
  stat,
  rm,
} = require("node:fs/promises");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const _crypto = require("node:crypto");
const { promisify } = require("node:util");

const ucmdConstants = require("./ucmd-constants.js");
const ucmdTask = require("./ucmd-task.js");
const coreWorktree = require("./core/worktree");
const ucmdProposal = require("./ucmd-proposal.js");
const ucmdPrompt = require("./ucmd-prompt.js");
const ucmdObserver = require("./ucmd-observer.js");
const ucmdStructure = require("./ucmd-structure.js");
const { spawnAgent: coreSpawnAgent } = require("./core/agent");
const ucmdRefinement = require("./ucmd-refinement.js");
const ucmdHandlers = require("./ucmd-handlers.js");
const ucmdServer = require("./ucmd-server.js");
const { enqueueTaskFileOp } = require("./task-file-lock.js");
const { ForgePipeline, wireEvents } = require("./forge/index");
const { MergeQueueManager } = require("./core/merge-queue.js");
const {
  setMergeQueueManager: setDeliverMergeQueue,
} = require("./forge/deliver.js");
const hivemindStore = require("./hivemind/store");

const {
  TASKS_DIR,
  WORKTREES_DIR,
  WORKSPACES_DIR,
  ARTIFACTS_DIR,
  LOGS_DIR,
  CONFIG_PATH,
  SOCK_PATH,
  PID_PATH,
  LOG_PATH,
  STATE_PATH,
  TASK_STATES,
  STATE_DEBOUNCE_MS,
  MAX_LOG_BYTES,
  QUOTA_PROBE_INITIAL_MS,
  QUOTA_PROBE_MAX_MS,
  USAGE,
  DATA_VERSION,
  DEFAULT_CONFIG,
  RATE_LIMIT_RE,
} = ucmdConstants;

const {
  parseArgs,
  ensureDirectories,
  parseTaskFile,
  serializeTaskFile,
  normalizeProjects,
  validateGitProjects,
  readPid,
  isProcessAlive,
  cleanStaleFiles,
  defaultState,
  checkResources,
} = ucmdTask;

const { removeWorktrees } = coreWorktree;

const {
  handleObserve,
  handleObserveStatus,
  handleProposals,
  handleProposalApprove,
  handleProposalReject,
  handleProposalPriority,
  handleProposalEvaluate,
  handleProposalDelete,
  handleSnapshots,
  handleAnalyzeProject,
  handleResearchProject,
  maybeRunObserver,
  cleanupOldProposals,
  // Curation handlers
  handleCurationMode,
  handleSetCurationMode,
  handleCurationWeights,
  handleProposalScore,
  handleProposalScoreSet,
  handleProposalClusters,
  handleProposalClusterMerge,
  handleProposalClusterSplit,
  handleProposalConflicts,
  handleProposalDiscard,
  handleDiscardHistory,
  handleBigBetChecklist,
  handleProposalFeedback,
  handleScoringProfile,
} = ucmdObserver;

const {
  startRefinement,
  handleRefinementAnswer,
  switchToAutopilot,
  finalizeRefinement,
  cancelRefinement,
} = ucmdRefinement;

const {
  tryAutoApprove,
  submitTask,
  moveTask,
  loadTask,
  recoverRunningTasks,
  handleSubmit,
  handleStart,
  handleList,
  handleStatus,
  handleApprove,
  handleReject,
  handleCancel,
  handleRetry,
  handleDelete,
  handleDiff,
  handleLogs,
  handlePause,
  handleResume,
  handleStats,
  handleStageGateApprove,
  handleStageGateReject,
  handleGetConfig,
  handleSetConfig,
  handleUpdatePriority,
  handleMergeQueueStatus,
  handleMergeQueueRetry,
  handleMergeQueueSkip,
} = ucmdHandlers;

const { broadcastWs, startSocketServer } = ucmdServer;
const execFileAsync = promisify(execFile);

// ── Config ──

let config = null;

function deepMergeDefaults(target, defaults) {
  for (const [key, defaultValue] of Object.entries(defaults)) {
    if (target[key] === undefined) {
      target[key] = defaultValue;
    } else if (
      defaultValue &&
      typeof defaultValue === "object" &&
      !Array.isArray(defaultValue) &&
      target[key] &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      deepMergeDefaults(target[key], defaultValue);
    }
  }
  return target;
}

const RETRYABLE_IO_CODES = new Set([
  "EAGAIN",
  "EBUSY",
  "EMFILE",
  "ENFILE",
  "ENOSPC",
  "ETIMEDOUT",
]);

function isRetryableIoError(err) {
  return !!(err && err.code && RETRYABLE_IO_CODES.has(err.code));
}

function makeTempPath(filePath) {
  const nonce = _crypto.randomBytes(4).toString("hex");
  return `${filePath}.${process.pid}.${Date.now()}.${nonce}.tmp`;
}

function withIoContext(operation, err, context = {}) {
  const details = Object.entries(context)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
  const suffix = details ? ` (${details})` : "";
  const wrapped = new Error(`${operation} failed${suffix}: ${err.message}`);
  wrapped.code = err.code;
  wrapped.cause = err;
  wrapped.retryable = isRetryableIoError(err);
  Object.assign(wrapped, context);
  return wrapped;
}

async function atomicWriteFile(filePath, content, context = {}) {
  const tmpPath = makeTempPath(filePath);
  try {
    await writeFile(tmpPath, content);
    await rename(tmpPath, filePath);
  } catch (err) {
    let cleanupError = null;
    try {
      await rm(tmpPath, { force: true });
    } catch (cleanupErr) {
      cleanupError = cleanupErr;
    }
    const wrapped = withIoContext(context.operation || "atomic write", err, {
      ...context,
      filePath,
      tmpPath,
    });
    if (cleanupError) {
      wrapped.cleanupError = cleanupError;
      wrapped.message = `${wrapped.message}; tmp cleanup failed: ${cleanupError.message}`;
    }
    throw wrapped;
  }
}

async function loadConfig() {
  try {
    config = JSON.parse(await readFile(CONFIG_PATH, "utf-8"));
  } catch (e) {
    if (e && e.code === "ENOENT") {
      // First run: create default config file
      config = { ...DEFAULT_CONFIG };
      await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
    } else {
      // Parse error or permission issue: use defaults in memory but don't overwrite
      // the file — the user may want to fix a syntax error in their config
      log(
        `loadConfig: failed to load ${CONFIG_PATH}: ${e.message} — using defaults in memory`,
      );
      config = { ...DEFAULT_CONFIG };
    }
  }
  deepMergeDefaults(config, DEFAULT_CONFIG);
  process.env.UCM_PROVIDER = config.provider || DEFAULT_CONFIG.provider;
  return config;
}

async function createTempWorkspace(taskId) {
  const workspacePath = path.join(WORKSPACES_DIR, taskId);
  await mkdir(workspacePath, { recursive: true });
  await execFileAsync("git", ["init"], {
    cwd: workspacePath,
    encoding: "utf-8",
  });
  await execFileAsync("git", ["commit", "--allow-empty", "-m", "init workspace"], {
    cwd: workspacePath,
    encoding: "utf-8",
  });
  return workspacePath;
}

async function updateTaskProject(taskId, projectPath) {
  return enqueueTaskFileOp(
    taskId,
    async () => {
      for (const state of TASK_STATES) {
        const taskPath = path.join(TASKS_DIR, state, `${taskId}.md`);
        let content;
        try {
          content = await readFile(taskPath, "utf-8");
        } catch (e) {
          if (e.code === "ENOENT") continue;
          throw withIoContext("updateTaskProject read", e, {
            taskId,
            state,
            taskPath,
            stage: "project-update",
          });
        }
        try {
          const { meta, body } = parseTaskFile(content);
          delete meta.projects;
          meta.project = projectPath;
          await atomicWriteFile(taskPath, serializeTaskFile(meta, body), {
            operation: "updateTaskProject write",
            taskId,
            state,
            taskPath,
            stage: "project-update",
          });
          return true;
        } catch (e) {
          if (e && e.taskId === taskId && e.taskPath === taskPath) throw e;
          throw withIoContext("updateTaskProject parse/write", e, {
            taskId,
            state,
            taskPath,
            stage: "project-update",
          });
        }
      }
      return false;
    },
    { log, label: "updateTaskProject" },
  );
}

const _metaUpdateQueue = new Map();

async function updateTaskMeta(taskId, updates) {
  const stageGate = updates?.stageGate || updates?.currentStage || "n/a";
  const current = enqueueTaskFileOp(
    taskId,
    async () => {
      for (const state of TASK_STATES) {
        const taskPath = path.join(TASKS_DIR, state, `${taskId}.md`);
        let content;
        try {
          content = await readFile(taskPath, "utf-8");
        } catch (e) {
          if (e.code === "ENOENT") continue;
          throw withIoContext("updateTaskMeta read", e, {
            taskId,
            state,
            taskPath,
            stageGate,
          });
        }
        try {
          const { meta, body } = parseTaskFile(content);
          Object.assign(meta, updates || {});
          await atomicWriteFile(taskPath, serializeTaskFile(meta, body), {
            operation: "updateTaskMeta write",
            taskId,
            state,
            taskPath,
            stageGate,
          });
          return true;
        } catch (e) {
          if (e && e.taskId === taskId && e.taskPath === taskPath) throw e;
          throw withIoContext("updateTaskMeta parse/write", e, {
            taskId,
            state,
            taskPath,
            stageGate,
          });
        }
      }
      return false;
    },
    {
      log,
      label: `updateTaskMeta(stage=${stageGate})`,
    },
  );
  _metaUpdateQueue.set(taskId, current);
  current.finally(() => {
    if (_metaUpdateQueue.get(taskId) === current)
      _metaUpdateQueue.delete(taskId);
  });
  return current;
}

async function drainTaskMetaQueue(taskId) {
  const pending = _metaUpdateQueue.get(taskId);
  if (pending) await pending.catch(() => {});
}

// ── Logging ──

let logStream = null;

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  if (logStream) {
    logStream.write(line);
  } else {
    process.stderr.write(line);
  }
}

ucmdProposal.setLog(log);
ucmdObserver.setLog(log);

async function truncateLogIfNeeded() {
  try {
    const stats = await stat(LOG_PATH);
    if (stats.size > MAX_LOG_BYTES) {
      const content = await readFile(LOG_PATH, "utf-8");
      const allLines = content.split("\n");
      const keepLines = allLines.slice(Math.floor(allLines.length / 2));
      await writeFile(LOG_PATH, keepLines.join("\n"));
    }
  } catch (e) {
    log(`[warning] log truncation failed: ${e.message}`);
  }
}

// ── Daemon State ──

let daemonState = null;
let mergeQueueManager = null;
let stateDirty = false;
let stateGeneration = 0; // incremented on each markStateDirty; prevents flush from clearing flag when new mutations arrived during write
let stateTimer = null;
let stateFlushRetryMs = STATE_DEBOUNCE_MS;
const MAX_STATE_FLUSH_RETRY_MS = 5_000;

function mergeStateStats(state) {
  const defaults = defaultState().stats;
  const savedStats =
    state && typeof state.stats === "object" && state.stats !== null
      ? state.stats
      : {};
  const merged = { ...defaults, ...savedStats };
  for (const [key, fallback] of Object.entries(defaults)) {
    if (typeof merged[key] !== "number" || Number.isNaN(merged[key])) {
      merged[key] = fallback;
    }
  }
  return merged;
}

async function loadState() {
  try {
    daemonState = JSON.parse(await readFile(STATE_PATH, "utf-8"));
    if (typeof daemonState !== "object" || daemonState === null) {
      log("loadState: state file contained non-object value, using defaults");
      daemonState = defaultState();
    }
    daemonState.stats = mergeStateStats(daemonState);
    if (!Array.isArray(daemonState.activeTasks)) daemonState.activeTasks = [];
    if (!Array.isArray(daemonState.suspendedTasks))
      daemonState.suspendedTasks = [];
    if (typeof daemonState.daemonStatus !== "string")
      daemonState.daemonStatus = "running";
  } catch (e) {
    log(`loadState: failed to load state file, using defaults: ${e.message}`);
    daemonState = defaultState();
  }

  const stateVersion = daemonState.dataVersion || 0;
  if (stateVersion < DATA_VERSION) {
    log(`migrating state: v${stateVersion} → v${DATA_VERSION}`);
    if (stateVersion < 1) {
      delete daemonState.restartPending;
    }
    daemonState.dataVersion = DATA_VERSION;
    await flushState();
  }
}

let _flushQueue = Promise.resolve();

async function flushState() {
  if (!daemonState) return;
  const op = _flushQueue.then(async () => {
    const gen = stateGeneration;
    await atomicWriteFile(STATE_PATH, JSON.stringify(daemonState, null, 2), {
      operation: "flushState",
      stage: "daemon-state",
      stateGeneration: gen,
    });
    if (stateGeneration === gen) stateDirty = false;
  });
  _flushQueue = op.catch((e) => {
    const kind = e && e.retryable ? "retryable" : "fatal";
    log(`flushState queue error (${kind}): ${e.message}`);
  });
  return op; // propagate errors to caller
}

function scheduleStateFlush(delayMs = STATE_DEBOUNCE_MS) {
  if (stateTimer) return;
  stateTimer = setTimeout(async () => {
    stateTimer = null;
    if (!stateDirty) {
      stateFlushRetryMs = STATE_DEBOUNCE_MS;
      return;
    }
    try {
      await flushState();
      stateFlushRetryMs = STATE_DEBOUNCE_MS;
    } catch (e) {
      const kind = e && e.retryable ? "retryable" : "fatal";
      stateFlushRetryMs = Math.min(
        Math.max(stateFlushRetryMs * 2, STATE_DEBOUNCE_MS),
        MAX_STATE_FLUSH_RETRY_MS,
      );
      log(
        `state flush error (${kind}): ${e.message} — retry in ${stateFlushRetryMs}ms`,
      );
      if (stateDirty) scheduleStateFlush(stateFlushRetryMs);
    }
  }, delayMs);
}

function markStateDirty() {
  stateDirty = true;
  stateGeneration++;
  scheduleStateFlush();
}

// Flush state immediately for critical transitions (task done/failed, daemon pause)
async function flushStateNow() {
  if (stateTimer) {
    clearTimeout(stateTimer);
    stateTimer = null;
  }
  stateDirty = true;
  stateGeneration++;
  try {
    await flushState();
    stateFlushRetryMs = STATE_DEBOUNCE_MS;
  } catch (e) {
    const kind = e && e.retryable ? "retryable" : "fatal";
    log(`critical state flush error (${kind}): ${e.message}`);
    if (stateDirty) scheduleStateFlush(stateFlushRetryMs);
  }
}

function getResourcePressure(resources) {
  const rc = config?.resources || DEFAULT_CONFIG.resources;
  if (resources.diskFreeGb !== null && resources.diskFreeGb < rc.diskMinFreeGb)
    return "critical";
  if (resources.cpuLoad > rc.cpuThreshold) return "pressure";
  if (resources.memoryFreeMb < rc.memoryMinFreeMb) return "pressure";
  return "normal";
}

// ── Cleanup ──

async function findOrphanWorktrees() {
  const orphans = [];
  try {
    const entries = await readdir(WORKTREES_DIR);
    for (const entry of entries) {
      const found = await loadTask(entry);
      if (!found) orphans.push(entry);
    }
  } catch (e) {
    if (e && e.code !== "ENOENT")
      log(`findOrphanWorktrees: readdir failed: ${e.message}`);
  }
  return orphans;
}

async function performCleanup(options = {}) {
  const retentionDays =
    options.retentionDays ??
    (config?.cleanup || DEFAULT_CONFIG.cleanup).retentionDays;
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let cleaned = 0;

  for (const state of ["done", "failed"]) {
    const stateDir = path.join(TASKS_DIR, state);
    let files;
    try {
      files = await readdir(stateDir);
    } catch (e) {
      if (e.code !== "ENOENT")
        log(`cleanup: failed to read ${stateDir}: ${e.message}`);
      continue;
    }

    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const taskId = file.replace(".md", "");
      try {
        const content = await readFile(path.join(stateDir, file), "utf-8");
        const { meta } = parseTaskFile(content);
        const completed = meta.completedAt
          ? new Date(meta.completedAt).getTime()
          : 0;
        if (completed && completed < cutoff) {
          const projects = normalizeProjects(meta);
          await removeWorktrees(taskId, projects);
          try {
            await rm(path.join(ARTIFACTS_DIR, taskId), { recursive: true });
          } catch (e) {
            if (e.code !== "ENOENT")
              log(
                `cleanup: failed to remove artifacts for ${taskId}: ${e.message}`,
              );
          }
          try {
            await unlink(path.join(LOGS_DIR, `${taskId}.log`));
          } catch (e) {
            if (e.code !== "ENOENT")
              log(
                `cleanup: failed to remove log file for ${taskId}: ${e.message}`,
              );
          }
          try {
            await rm(path.join(LOGS_DIR, taskId), { recursive: true });
          } catch (e) {
            if (e.code !== "ENOENT")
              log(
                `cleanup: failed to remove log dir for ${taskId}: ${e.message}`,
              );
          }
          try {
            await rm(path.join(WORKSPACES_DIR, taskId), { recursive: true });
          } catch (e) {
            if (e.code !== "ENOENT")
              log(
                `cleanup: failed to remove workspace for ${taskId}: ${e.message}`,
              );
          }
          cleaned++;
          log(`cleaned up task: ${taskId}`);
        }
      } catch (e) {
        log(`cleanup error for ${taskId}: ${e.message}`);
      }
    }
  }

  // orphan worktrees
  const orphans = await findOrphanWorktrees();
  for (const orphanId of orphans) {
    try {
      await rm(path.join(WORKTREES_DIR, orphanId), { recursive: true });
      cleaned++;
      log(`removed orphan worktree: ${orphanId}`);
    } catch (e) {
      if (e.code !== "ENOENT")
        log(
          `cleanup: failed to remove orphan worktree ${orphanId}: ${e.message}`,
        );
    }
  }

  return { cleaned, orphans: orphans.length };
}

async function loadProjectPreferences(projectPath) {
  try {
    const ucmConfig = JSON.parse(
      await readFile(path.join(projectPath, ".ucm.json"), "utf-8"),
    );
    const prefs = ucmConfig.preferences;
    if (!prefs) return "";
    if (Array.isArray(prefs)) return prefs.map((p) => `- ${p}`).join("\n");
    return String(prefs);
  } catch (e) {
    if (e.code !== "ENOENT")
      log(`loadProjectPreferences: ${projectPath}: ${e.message}`);
    return "";
  }
}

// ── Pipeline Engine ──

const inflightTasks = new Set();
const activeChildren = new Map(); // taskId → child process
let hmdChild = null; // spawned hivemind daemon child process

// daemon-level spawnAgent wrapper: adds broadcastWs logging + activeChildren tracking
function spawnAgent(prompt, opts) {
  const { timeoutMs, onLog: extraLog, ...rest } = opts;
  return coreSpawnAgent(prompt, {
    ...rest,
    hardTimeoutMs: timeoutMs,
    onLog: (line) => {
      broadcastWs("task:log", { taskId: opts.taskId, line });
      if (extraLog) extraLog(line);
    },
    onChild: (child) => activeChildren.set(opts.taskId, child),
  }).finally(() => activeChildren.delete(opts.taskId));
}

// ── Forge Pipeline Integration ──

const activeForgePipelines = new Map();

function mapPipelineToForge(name) {
  if (!name || name === "auto") return null;
  const mapping = {
    quick: "small",
    implement: "small",
    thorough: "large",
    research: "medium",
    trivial: "trivial",
    small: "small",
    medium: "medium",
    large: "large",
  };
  return mapping[name] ?? null;
}

async function runForge(taskId) {
  const task = await loadTask(taskId);
  if (!task) throw new Error(`task not found: ${taskId}`);

  const projects = normalizeProjects(task);
  let project = projects[0]?.path || null;

  if (!project) {
    project = await createTempWorkspace(taskId);
    await updateTaskProject(taskId, project);
    log(`[${taskId}] using temp workspace: ${project}`);
  } else {
    validateGitProjects(projects);
    project = projects[0].path;
  }

  await moveTask(taskId, "pending", "running");
  // Deduplicate: filter first, then add — prevents race where includes() check passes
  // for two concurrent calls before either push() executes
  daemonState.activeTasks = daemonState.activeTasks.filter((t) => t !== taskId);
  daemonState.activeTasks.push(taskId);
  markStateDirty();

  const forgePipeline = mapPipelineToForge(task.pipeline);
  const stageApproval = config?.stageApproval || DEFAULT_CONFIG.stageApproval;
  const fp = new ForgePipeline({
    taskId,
    input: `${task.title}\n\n${task.body || ""}`.trim(),
    project,
    pipeline: forgePipeline,
    autoApprove: true,
    stageApproval,
  });

  activeForgePipelines.set(taskId, fp);
  wireEvents(fp, (event, data) => {
    broadcastWs(event, { ...data, taskId });
    if (event === "agent:output" && data.chunk) {
      broadcastWs("task:log", { taskId, line: data.chunk });
    }
    if (event === "stage:gate") {
      updateTaskMeta(taskId, { stageGate: data.stage }).catch((e) =>
        log(`[${taskId}] updateTaskMeta error: ${e.message}`),
      );
    }
    if (event === "stage:gate_resolved") {
      updateTaskMeta(taskId, { stageGate: null }).catch((e) =>
        log(`[${taskId}] updateTaskMeta error: ${e.message}`),
      );
    }
  });

  let mergeQueued = false;
  try {
    const dag = await fp.run();
    await drainTaskMetaQueue(taskId);
    const status = dag.status;

    if (status === "merge_queued") {
      // task enqueued to merge queue — don't move task, merge queue will handle transitions
      mergeQueued = true;
      log(`[${taskId}] forge completed → merge queue (waiting for merge)`);
      daemonState.stats.tasksCompleted++;
    } else if (status === "done" || status === "auto_merged") {
      await moveTask(taskId, "running", "done");
      daemonState.stats.tasksCompleted++;
      log(`[${taskId}] forge completed → done`);
    } else if (status === "review") {
      await moveTask(taskId, "running", "review");
      daemonState.stats.tasksCompleted++;
      log(`[${taskId}] forge completed → review`);
      tryAutoApprove(taskId).catch((e) =>
        log(`[${taskId}] tryAutoApprove error: ${e.message}`),
      );
    } else {
      await moveTask(taskId, "running", "failed");
      daemonState.stats.tasksFailed++;
      log(`[${taskId}] forge completed → failed (status: ${status})`);
    }
  } catch (e) {
    log(`[${taskId}] forge error: ${e.message}`);
    await drainTaskMetaQueue(taskId);
    if (RATE_LIMIT_RE.test(e.message)) {
      try {
        await moveTask(taskId, "running", "pending");
      } catch (moveErr) {
        log(`[${taskId}] moveTask recovery failed: ${moveErr.message}`);
      }
      await handleQuotaExceeded();
    } else {
      try {
        await moveTask(taskId, "running", "failed");
      } catch (moveErr) {
        log(`[${taskId}] moveTask to failed failed: ${moveErr.message}`);
      }
      daemonState.stats.tasksFailed++;
    }
  } finally {
    activeForgePipelines.delete(taskId);
    // merge_queued: keep task in activeTasks — merge queue will clean up when done
    if (!mergeQueued) {
      daemonState.activeTasks = daemonState.activeTasks.filter(
        (t) => t !== taskId,
      );
    }
    await flushStateNow();
  }
}

async function requeueSuspendedTasks() {
  if (!daemonState.suspendedTasks || daemonState.suspendedTasks.length === 0)
    return;

  const tasksToRequeue = [...daemonState.suspendedTasks];
  const failedTaskIds = [];
  let enqueued = 0;

  for (const taskId of tasksToRequeue) {
    const currentTask = await loadTask(taskId);
    if (!currentTask) {
      log(
        `[${taskId}] requeue: skipped stale suspended entry (task not found)`,
      );
      continue;
    }
    if (currentTask.state === "pending") {
      const alreadyQueuedPending =
        taskQueueIds.has(taskId) ||
        taskQueue.some((queued) => queued.id === taskId);
      if (!alreadyQueuedPending && !inflightTasks.has(taskId)) {
        taskQueue.push(currentTask);
        taskQueueIds.add(currentTask.id);
        enqueued++;
      }
      log(
        `[${taskId}] requeue: task already pending${alreadyQueuedPending ? " (already queued)" : ""}`,
      );
      continue;
    }
    if (currentTask.state !== "running" || !currentTask.suspended) {
      log(
        `[${taskId}] requeue: skipped stale suspended entry (state=${currentTask.state}, suspended=${!!currentTask.suspended})`,
      );
      continue;
    }

    try {
      await moveTask(taskId, "running", "pending", {
        suspended: null,
        suspendedStage: null,
        suspendedReason: null,
      });
      const alreadyQueued =
        taskQueueIds.has(taskId) ||
        taskQueue.some((queued) => queued.id === taskId);
      if (!alreadyQueued && !inflightTasks.has(taskId)) {
        const task = await loadTask(taskId);
        if (task) {
          taskQueue.push(task);
          taskQueueIds.add(task.id);
          enqueued++;
        }
      }
      log(
        `[${taskId}] requeued suspended task → pending${alreadyQueued ? " (already queued)" : ""}`,
      );
    } catch (e) {
      if (e && e.code === "ENOENT") {
        log(
          `[${taskId}] requeue: skipped stale suspended entry during move (${e.message})`,
        );
        continue;
      }
      log(`[${taskId}] requeue error: ${e.message}`);
      failedTaskIds.push(taskId);
    }
  }

  if (enqueued > 0) {
    taskQueue.sort((a, b) => {
      if ((b.priority || 0) !== (a.priority || 0))
        return (b.priority || 0) - (a.priority || 0);
      return (a.created || "").localeCompare(b.created || "");
    });
    log(
      `requeue: enqueued ${enqueued} suspended task(s) (queue: ${taskQueue.length})`,
    );
    wakeProcessLoop();
  }

  daemonState.suspendedTasks = failedTaskIds;
  markStateDirty();

  if (failedTaskIds.length > 0) {
    throw new Error(
      `failed to requeue ${failedTaskIds.length} suspended task(s): ${failedTaskIds.join(", ")}`,
    );
  }
}

// ── Scan + Processing Loop ──

const taskQueue = [];
const taskQueueIds = new Set(); // O(1) dedup lookup
let shutdownRequested = false;
let processLoopSleepTimer = null;
let processLoopSleepResolve = null;

function wakeProcessLoop() {
  if (processLoopSleepTimer) {
    clearTimeout(processLoopSleepTimer);
    processLoopSleepTimer = null;
  }
  if (processLoopSleepResolve) {
    const resolve = processLoopSleepResolve;
    processLoopSleepResolve = null;
    resolve();
  }
}

function sleepProcessLoop(ms) {
  return new Promise((resolve) => {
    processLoopSleepResolve = resolve;
    processLoopSleepTimer = setTimeout(() => {
      processLoopSleepTimer = null;
      processLoopSleepResolve = null;
      resolve();
    }, ms);
  });
}

async function processLoop() {
  while (!shutdownRequested) {
    try {
      if (daemonState.daemonStatus !== "paused" && taskQueue.length > 0) {
        const resources = await checkResources();
        const pressure = getResourcePressure(resources);

        if (pressure === "critical") {
          const cc = config?.cleanup || DEFAULT_CONFIG.cleanup;
          if (cc.autoCleanOnDiskPressure) {
            log("disk critical — triggering auto cleanup");
            try {
              await performCleanup({ retentionDays: 1 });
            } catch (e) {
              log(`auto cleanup error: ${e.message}`);
            }
          }
        }

        if (pressure !== "critical") {
          const activeCount = inflightTasks.size;
          const maxConcurrency = config?.concurrency || 1;

          if (activeCount < maxConcurrency) {
            const task = taskQueue.shift();
            if (task) taskQueueIds.delete(task.id);
            if (task && !inflightTasks.has(task.id)) {
              inflightTasks.add(task.id);
              runForge(task.id)
                .catch((e) => {
                  log(`forge error for ${task.id}: ${e.message}`);
                })
                .finally(() => {
                  inflightTasks.delete(task.id);
                });
            }
          }
        } else {
          log("resource critical — skipping task pickup");
        }
      }
    } catch (e) {
      log(`processLoop iteration error: ${e.message}`);
    }

    await sleepProcessLoop(taskQueue.length > 0 ? 1000 : 5000);
  }
}

// ── ccusage Quota Check ──

function _checkQuotaViaCcusage() {
  try {
    const output = execFileSync("ccusage", ["blocks", "--json"], {
      encoding: "utf-8",
      timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const data = JSON.parse(output);
    const qc = config?.quota || DEFAULT_CONFIG.quota;
    const mode = qc.modes[qc.mode] || qc.modes.work;
    const usagePercent = data.usagePercent ?? data.usage_percent ?? null;
    const budgetPercent = mode.windowBudgetPercent;
    if (usagePercent === null) return null;
    return {
      available: usagePercent < qc.hardLimitPercent,
      usagePercent,
      budgetPercent,
      softLimitExceeded: usagePercent >= qc.softLimitPercent,
      hardLimitExceeded: usagePercent >= qc.hardLimitPercent,
    };
  } catch (e) {
    if (e.code !== "ENOENT") log(`checkQuotaViaCcusage: ${e.message}`);
    return null;
  }
}

// ── Quota Management ──

let probeTimer = null;
let probeIntervalMs = QUOTA_PROBE_INITIAL_MS;

async function handleQuotaExceeded() {
  if (daemonState.daemonStatus === "paused") return;

  daemonState.daemonStatus = "paused";
  daemonState.pausedAt = new Date().toISOString();
  daemonState.pauseReason = "quota_exceeded";
  try {
    await flushStateNow();
  } catch (e) {
    log(`[warning] failed to persist paused state: ${e.message}`);
  }
  log("quota exceeded — daemon paused, starting probe timer");

  probeIntervalMs = QUOTA_PROBE_INITIAL_MS;
  scheduleProbe();
}

function scheduleProbe() {
  if (probeTimer) clearTimeout(probeTimer);
  probeTimer = setTimeout(probeQuota, probeIntervalMs);
  log(`next quota probe in ${Math.round(probeIntervalMs / 1000)}s`);
}

async function probeQuota() {
  probeTimer = null;
  log("probing quota...");

  let result;
  try {
    result = await spawnAgent("Reply with exactly: OK", {
      cwd: os.homedir(),
      provider: config.provider || DEFAULT_CONFIG.provider,
      model: config.model || DEFAULT_CONFIG.model,
      timeoutMs: 60000,
      taskId: "_probe",
      stage: "probe",
    });
  } catch (e) {
    log(`quota probe failed: ${e.message}`);
    probeIntervalMs = Math.min(probeIntervalMs * 2, QUOTA_PROBE_MAX_MS);
    scheduleProbe();
    return;
  }

  if (result.status === "done") {
    log("quota recovered — resuming daemon");
    daemonState.daemonStatus = "running";
    daemonState.pausedAt = null;
    daemonState.pauseReason = null;
    probeIntervalMs = QUOTA_PROBE_INITIAL_MS;
    markStateDirty();
    // requeue suspended tasks — await so failures trigger a retry probe
    try {
      await requeueSuspendedTasks();
    } catch (e) {
      log(`requeue suspended error: ${e.message} — scheduling retry probe`);
      scheduleProbe();
    }
  } else {
    probeIntervalMs = Math.min(probeIntervalMs * 2, QUOTA_PROBE_MAX_MS);
    log(
      `quota still exceeded, backing off to ${Math.round(probeIntervalMs / 1000)}s`,
    );
    scheduleProbe();
  }
}

// ── Hivemind Daemon (hmd) auto-spawn ──

function isHmdRunning() {
  try {
    if (!fs.existsSync(hivemindStore.PID_PATH)) return false;
    const pid = parseInt(
      fs.readFileSync(hivemindStore.PID_PATH, "utf-8").trim(),
      10,
    );
    if (!pid || Number.isNaN(pid)) return false;
    process.kill(pid, 0); // signal 0 = check if process exists
    return true;
  } catch {
    return false;
  }
}

function spawnHmd() {
  // Skip if hivemind is not initialized (no ~/.hivemind/ or no config)
  const hivemindDir = hivemindStore.HIVEMIND_DIR;
  if (
    !fs.existsSync(hivemindDir) ||
    !fs.existsSync(hivemindStore.CONFIG_PATH)
  ) {
    log("hmd: skipped — hivemind not initialized (run 'hm init' first)");
    return;
  }

  // Skip if already running
  if (isHmdRunning()) {
    log("hmd: already running, skipping spawn");
    return;
  }

  try {
    // Clean stale socket if present
    if (fs.existsSync(hivemindStore.SOCK_PATH)) {
      try {
        fs.unlinkSync(hivemindStore.SOCK_PATH);
      } catch (e) {
        if (e.code !== "ENOENT")
          log(`hmd: failed to remove stale socket: ${e.message}`);
      }
    }

    const hmdPath = path.join(__dirname, "../bin/hmd.js");
    const hmdLogPath = hivemindStore.LOG_PATH;

    // Ensure daemon directory exists
    const daemonDir = path.dirname(hmdLogPath);
    fs.mkdirSync(daemonDir, { recursive: true });

    const logFd = fs.openSync(hmdLogPath, "a");
    const child = spawn(process.execPath, [hmdPath, "start", "--foreground"], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });
    child.unref();
    fs.closeSync(logFd);

    hmdChild = child;

    child.on("exit", (code, signal) => {
      log(
        `hmd: exited (code=${code}, signal=${signal})${shutdownRequested ? "" : " — unexpected"}`,
      );
      if (hmdChild === child) hmdChild = null;
    });

    log(`hmd: spawned (pid: ${child.pid})`);
  } catch (e) {
    log(`hmd: failed to spawn: ${e.message}`);
    hmdChild = null;
  }
}

function stopHmd() {
  if (!hmdChild) return;

  const pid = hmdChild.pid;
  try {
    hmdChild.kill("SIGTERM");
    log(`hmd: sent SIGTERM (pid: ${pid})`);
  } catch (e) {
    if (e.code !== "ESRCH")
      log(`hmd: failed to SIGTERM (pid: ${pid}): ${e.message}`);
  }
  hmdChild = null;
}

// ── Daemon Lifecycle ──

let intervals = [];

async function startDaemon(foreground, devMode, opts = {}) {
  await ensureDirectories();
  await cleanStaleFiles();

  if (!foreground) {
    await truncateLogIfNeeded();
    const logFd = fs.openSync(LOG_PATH, "a");
    const spawnArgs = [__filename, "start", "--foreground"];
    if (devMode) spawnArgs.push("--dev");
    const child = spawn(process.execPath, spawnArgs, {
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });
    child.unref();
    fs.closeSync(logFd);

    await writeFile(PID_PATH, String(child.pid));
    console.log(`ucmd started (pid: ${child.pid})`);
    process.exit(0);
  }

  // foreground mode
  logStream = fs.createWriteStream(LOG_PATH, { flags: "a" });
  logStream.on("error", (err) => {
    console.error(`logStream error: ${err.message}`);
    try {
      logStream.end();
    } catch (e2) {
      console.error(`logStream.end() error: ${e2.message}`);
    }
    logStream = null;
  });

  if (!opts.embedded) {
    process.on("uncaughtException", (err) => {
      const msg = `[FATAL] uncaughtException: ${err.stack || err.message}`;
      if (logStream) logStream.write(`${msg}\n`);
      else console.error(msg);
      process.exit(1);
    });
    process.on("unhandledRejection", (reason) => {
      const msg = `[ERROR] unhandledRejection: ${reason instanceof Error ? reason.stack : reason}`;
      if (logStream) logStream.write(`${msg}\n`);
      else console.error(msg);
    });
  }

  await writeFile(PID_PATH, String(process.pid));
  await loadConfig();
  await loadState();

  // reset activeTasks from previous run
  daemonState.activeTasks = [];
  markStateDirty();

  // ── Merge Queue ──
  mergeQueueManager = new MergeQueueManager({
    log,
    broadcastWs,
    config: () => config,
    mergeWorktrees: coreWorktree.mergeWorktrees,
    loadWorkspace: coreWorktree.loadWorkspace,
    removeWorktrees: coreWorktree.removeWorktrees,
    moveTask,
    updateTaskMeta,
    loadTask,
    normalizeProjects,
    ForgePipeline,
    wireEvents,
    activeForgePipelines,
    inflightTasks,
    markStateDirty,
    daemonState: () => daemonState,
    drainTaskMetaQueue,
    flushStateNow,
  });
  await mergeQueueManager.load();
  setDeliverMergeQueue(mergeQueueManager);

  // ── Wire module dependencies ──
  ucmdObserver.setDeps({
    config: () => config,
    daemonState: () => daemonState,
    spawnAgent,
    broadcastWs,
    submitTask,
    markStateDirty,
    handlers: () => ({ handleSetConfig }),
  });

  ucmdRefinement.setDeps({
    config: () => config,
    daemonState: () => daemonState,
    spawnAgent,
    broadcastWs,
    submitTask,
    markStateDirty,
    log,
  });

  ucmdHandlers.setDeps({
    config: () => config,
    daemonState: () => daemonState,
    log,
    broadcastWs,
    markStateDirty,
    inflightTasks,
    taskQueue,
    taskQueueIds,
    wakeProcessLoop,
    getResourcePressure,
    requeueSuspendedTasks,
    getProbeTimer: () => probeTimer,
    setProbeTimer: (timer) => {
      probeTimer = timer;
    },
    getProbeIntervalMs: () => probeIntervalMs,
    setProbeIntervalMs: (ms) => {
      probeIntervalMs = ms;
    },
    QUOTA_PROBE_INITIAL_MS,
    activeForgePipelines,
    updateTaskMeta,
    drainTaskMetaQueue,
    flushStateNow,
    reloadConfig: loadConfig,
    mergeQueueManager,
    isHmdRunning,
  });

  ucmdServer.setDeps({
    config: () => config,
    daemonState: () => daemonState,
    markStateDirty,
    log,
    activeForgePipelines,
    loadTask,
    moveTask,
    updateTaskMeta,
    drainTaskMetaQueue,
    handlers: () => ({
      handleSubmit,
      handleStart,
      handleList,
      handleStatus,
      handleApprove,
      handleReject,
      handleCancel,
      handleRetry,
      handleDelete,
      handleDiff,
      handleLogs,
      handlePause,
      handleResume,
      handleStats,
      startRefinement,
      finalizeRefinement,
      cancelRefinement,
      handleRefinementAnswer,
      switchToAutopilot,
      handleObserve,
      handleObserveStatus,
      handleProposals,
      handleProposalApprove,
      handleProposalReject,
      handleProposalDelete,
      handleProposalPriority,
      handleProposalEvaluate,
      handleSnapshots,
      handleAnalyzeProject,
      handleResearchProject,
      performCleanup,
      handleStageGateApprove,
      handleStageGateReject,
      handleGetConfig,
      handleSetConfig,
      handleUpdatePriority,
      handleMergeQueueStatus,
      handleMergeQueueRetry,
      handleMergeQueueSkip,
      // Curation handlers
      handleCurationMode,
      handleSetCurationMode,
      handleCurationWeights,
      handleProposalScore,
      handleProposalScoreSet,
      handleProposalClusters,
      handleProposalClusterMerge,
      handleProposalClusterSplit,
      handleProposalConflicts,
      handleProposalDiscard,
      handleDiscardHistory,
      handleBigBetChecklist,
      handleProposalFeedback,
      handleScoringProfile,
    }),
    gracefulShutdown,
  });

  log("daemon starting...");

  // recover orphaned running tasks from previous daemon crash
  const recovered = await recoverRunningTasks();
  if (recovered > 0) log(`recovered ${recovered} orphaned task(s)`);

  await startSocketServer();
  log(`socket listening: ${SOCK_PATH}`);

  // auto-spawn hivemind daemon (non-blocking)
  try {
    spawnHmd();
  } catch (e) {
    log(`hmd: auto-spawn error: ${e.message}`);
  }

  if (!opts.embedded) {
    process.on("SIGTERM", gracefulShutdown);
    process.on("SIGINT", gracefulShutdown);
  }

  const rc = config.resources || DEFAULT_CONFIG.resources;
  let resourceCheckRunning = false;
  const resourceTimer = setInterval(async () => {
    if (resourceCheckRunning) return; // skip if previous check still in progress
    resourceCheckRunning = true;
    try {
      const resources = await checkResources();
      const pressure = getResourcePressure(resources);
      if (pressure !== "normal")
        log(
          `resource pressure: ${pressure} (cpu=${resources.cpuLoad.toFixed(2)}, mem=${Math.round(resources.memoryFreeMb)}MB, disk=${resources.diskFreeGb !== null ? `${resources.diskFreeGb.toFixed(1)}GB` : "n/a"})`,
        );
      broadcastWs("stats:updated", await handleStats());
    } catch (e) {
      log(`resource check error: ${e.message}`);
    } finally {
      resourceCheckRunning = false;
    }
  }, rc.checkIntervalMs);
  intervals.push(resourceTimer);

  // observer timer
  const observerConfig = config.observer || DEFAULT_CONFIG.observer;
  const automationConfig = config.automation || DEFAULT_CONFIG.automation;
  const observerEnabled =
    observerConfig.enabled || automationConfig.autoPropose;
  if (observerEnabled) {
    const observerTimer = setInterval(() => {
      maybeRunObserver();
    }, observerConfig.intervalMs);
    intervals.push(observerTimer);
    log(
      `observer enabled (interval: ${observerConfig.intervalMs}ms, taskTrigger: ${observerConfig.taskCountTrigger})`,
    );
  }

  // periodic daemon log truncation (every hour)
  const logTruncateTimer = setInterval(
    () => {
      truncateLogIfNeeded().catch((e) =>
        log(`log truncate error: ${e.message}`),
      );
    },
    60 * 60 * 1000,
  );
  intervals.push(logTruncateTimer);

  // proposal cleanup (daily)
  const proposalCleanupTimer = setInterval(
    () => {
      cleanupOldProposals().catch((e) =>
        log(`proposal cleanup error: ${e.message}`),
      );
    },
    24 * 60 * 60 * 1000,
  );
  intervals.push(proposalCleanupTimer);

  log(`daemon ready (${taskQueue.length} task(s) queued)`);

  processLoop().catch((e) => log(`processLoop fatal: ${e.message}`));
}

async function gracefulShutdown() {
  log("shutting down...");
  shutdownRequested = true;
  wakeProcessLoop();

  for (const timer of intervals) clearInterval(timer);
  intervals = [];
  if (stateTimer) {
    clearTimeout(stateTimer);
    stateTimer = null;
  }
  if (probeTimer) {
    clearTimeout(probeTimer);
    probeTimer = null;
  }

  // abort in-flight forge pipelines and await DAG saves
  if (activeForgePipelines.size > 0) {
    log(`aborting ${activeForgePipelines.size} forge pipeline(s)...`);
    const abortPromises = [];
    for (const [taskId, fp] of activeForgePipelines) {
      abortPromises.push(
        fp.abort().catch((e) => {
          log(`abort forge pipeline error for ${taskId}: ${e.message}`);
        }),
      );
      log(`aborted forge pipeline for ${taskId}`);
    }
    // Wait for abort operations (DAG save, worktree cleanup) to complete
    // with a timeout to avoid hanging the shutdown
    await Promise.race([
      Promise.allSettled(abortPromises),
      new Promise((r) => setTimeout(r, 5000)),
    ]);
  }

  // kill in-flight agent processes
  if (activeChildren.size > 0) {
    log(`killing ${activeChildren.size} in-flight agent(s)...`);
    for (const [taskId, child] of activeChildren) {
      try {
        child.kill("SIGTERM");
      } catch (e) {
        if (e.code !== "ESRCH")
          log(`failed to SIGTERM agent for ${taskId}: ${e.message}`);
      }
      log(`sent SIGTERM to agent for ${taskId} (pid: ${child.pid})`);
    }
    // wait briefly for processes to exit
    const deadline = Date.now() + 5000;
    while (activeChildren.size > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
    }
    // force kill remaining
    for (const [taskId, child] of activeChildren) {
      try {
        child.kill("SIGKILL");
      } catch (e) {
        if (e.code !== "ESRCH")
          log(`failed to SIGKILL agent for ${taskId}: ${e.message}`);
      }
      log(`sent SIGKILL to agent for ${taskId}`);
    }
  }

  // stop hivemind daemon if we spawned it
  try {
    stopHmd();
  } catch (e) {
    log(`hmd stop error: ${e.message}`);
  }

  // save merge queue state
  try {
    await mergeQueueManager.save();
  } catch (e) {
    log(`merge queue save error: ${e.message}`);
  }

  if (stateDirty) {
    try {
      await flushState();
    } catch (e) {
      log(`shutdown flush error: ${e.message}`);
    }
  }

  const { socketSubscribers: ss, socketServer: getSock } = ucmdServer;

  for (const conn of ss) {
    try {
      conn.end();
    } catch (e) {
      log(`conn.end error during shutdown: ${e.message}`);
    }
  }
  ss.clear();

  const currentSock = getSock();
  if (currentSock) {
    currentSock.close();
    try {
      await unlink(SOCK_PATH);
    } catch (e) {
      if (e.code !== "ENOENT") log(`failed to unlink socket: ${e.message}`);
    }
  }

  try {
    await unlink(PID_PATH);
  } catch (e) {
    if (e.code !== "ENOENT") log(`failed to unlink PID file: ${e.message}`);
  }

  log("daemon stopped");
  if (logStream) logStream.end();
  if (!embeddedMode) process.exit(0);
}

let embeddedMode = false;
function setEmbeddedMode(value) {
  embeddedMode = value;
}

async function stopDaemon() {
  const pid = await readPid();
  if (!pid) {
    console.log("ucmd is not running");
    return;
  }

  if (!isProcessAlive(pid)) {
    console.log("ucmd is not running (stale PID)");
    await cleanStaleFiles();
    return;
  }

  process.kill(pid, "SIGTERM");
  console.log(`ucmd stopped (pid: ${pid})`);
}

// ── Main ──

async function main() {
  const opts = parseArgs(process.argv);

  if (!opts.command && opts.foreground) {
    await startDaemon(true, opts.dev);
    return;
  }

  if (!opts.command) {
    console.log(USAGE);
    process.exit(1);
  }

  await ensureDirectories();

  switch (opts.command) {
    case "start":
      await startDaemon(opts.foreground, opts.dev);
      break;
    case "stop":
      await stopDaemon();
      break;
    default:
      console.error(`알 수 없는 커맨드: ${opts.command}`);
      console.log(USAGE);
      process.exit(1);
  }
}

module.exports = {
  ...ucmdConstants,
  ...ucmdTask,
  ...coreWorktree,
  ...ucmdProposal,
  ...ucmdPrompt,
  ...ucmdObserver,
  ...ucmdStructure,
  createTempWorkspace,
  updateTaskProject,
  loadConfig,
  getResourcePressure,
  broadcastWs,
  loadProjectPreferences,
  mapPipelineToForge,
  mergeStateStats,
  isHmdRunning,
  spawnHmd,
  stopHmd,
  startDaemon,
  gracefulShutdown,
  setEmbeddedMode,
  main,
};

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
