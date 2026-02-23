const { readFile, writeFile, readdir, unlink, rm, rename, open } = require("fs/promises");
const path = require("path");

const {
  TASKS_DIR, ARTIFACTS_DIR, LOGS_DIR, WORKSPACES_DIR,
  TASK_STATES, DEFAULT_CONFIG, CONFIG_PATH,
} = require("./ucmd-constants.js");

const {
  parseTaskFile, serializeTaskFile, generateTaskId,
  expandHome, normalizeProjects, extractMeta,
} = require("./ucmd-task.js");

const { ForgePipeline, wireEvents } = require("./forge/index");

const {
  removeWorktrees, mergeWorktrees, getWorktreeDiff,
  loadArtifact, updateMemory, saveArtifact,
} = require("./core/worktree");

const { evaluateProposal } = require("./ucmd-observer.js");
const { isSelfTarget, selfSafetyGate } = require("./ucmd-sandbox.js");
const { TaskDag } = require("./core/task");

const LIST_DAG_SUMMARY_CONCURRENCY = 8;
const DEFAULT_LOG_LINES = 100;
const MAX_LOG_LINES = 2000;
const LOG_TAIL_CHUNK_BYTES = 64 * 1024;

async function loadDagSummary(taskId) {
  try {
    const dag = await TaskDag.load(taskId);
    const inputTokens = dag.tokenUsage?.input || 0;
    const outputTokens = dag.tokenUsage?.output || 0;
    const totalTokens = inputTokens + outputTokens;
    return {
      currentStage: dag.currentStage,
      pipeline: dag.pipeline,
      stageHistory: dag.stageHistory.map((s) => ({
        stage: s.stage,
        status: s.status,
        durationMs: s.durationMs,
        timestamp: s.timestamp,
        tokenUsage: s.tokenUsage || null,
      })),
      tokenUsage: dag.tokenUsage ? {
        ...dag.tokenUsage,
        total: totalTokens,
        inputTokens,
        outputTokens,
        totalTokens,
      } : null,
    };
  } catch {
    return null;
  }
}

let deps = {};

function setDeps(d) { deps = d; }

async function mapWithConcurrency(items, concurrency, mapper) {
  const limit = Math.max(1, Math.floor(concurrency) || 1);
  let next = 0;

  async function runWorker() {
    while (next < items.length) {
      const index = next++;
      await mapper(items[index], index);
    }
  }

  const workerCount = Math.min(limit, items.length);
  const workers = [];
  for (let i = 0; i < workerCount; i++) {
    workers.push(runWorker());
  }
  await Promise.all(workers);
}

function normalizeLogLineLimit(lines) {
  const value = Number(lines);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_LOG_LINES;
  return Math.min(MAX_LOG_LINES, Math.floor(value));
}

async function readLogTail(logPath, lineLimit) {
  const handle = await open(logPath, "r");
  try {
    const info = await handle.stat();
    if (!info.size) return "";

    let position = info.size;
    let newlineCount = 0;
    let content = "";
    while (position > 0 && newlineCount <= lineLimit) {
      const start = Math.max(0, position - LOG_TAIL_CHUNK_BYTES);
      const length = position - start;
      const buffer = Buffer.allocUnsafe(length);
      await handle.read(buffer, 0, length, start);
      const chunk = buffer.toString("utf-8");
      newlineCount += (chunk.match(/\n/g) || []).length;
      content = chunk + content;
      position = start;
    }

    return content.replace(/\r\n/g, "\n").split("\n").slice(-lineLimit).join("\n");
  } finally {
    await handle.close();
  }
}

// ── Task File Management ──

async function submitTask(title, body, options = {}) {
  const taskId = generateTaskId();
  const meta = {
    id: taskId,
    title,
    state: "pending",
    priority: options.priority || 0,
    created: new Date().toISOString(),
  };

  if (options.project) {
    meta.project = path.resolve(expandHome(options.project));
  }
  if (options.projects) {
    meta.projects = options.projects;
  }
  if (options.pipeline) {
    meta.pipeline = options.pipeline;
  }
  if (options.autopilotSession) {
    meta.autopilotSession = options.autopilotSession;
  }

  const taskContent = serializeTaskFile(meta, body);
  const taskPath = path.join(TASKS_DIR, "pending", `${taskId}.md`);
  const tmpPath = taskPath + ".tmp";
  await writeFile(tmpPath, taskContent);
  await rename(tmpPath, taskPath);

  deps.log(`task submitted: ${taskId} — ${title}`);
  const result = { id: taskId, ...meta };
  deps.broadcastWs("task:created", result);
  return result;
}

const _moveTaskChains = new Map();

function enqueueTaskMove(taskId, operation) {
  const previous = _moveTaskChains.get(taskId) || Promise.resolve();
  const current = previous
    .catch((e) => { deps.log(`enqueueTaskMove: prior operation for ${taskId} failed: ${e.message}`); })
    .then(operation);
  _moveTaskChains.set(taskId, current);
  current.finally(() => {
    if (_moveTaskChains.get(taskId) === current) {
      _moveTaskChains.delete(taskId);
    }
  }).catch((e) => { deps.log(`enqueueTaskMove: cleanup error for ${taskId}: ${e.message}`); });
  return current;
}

async function moveTask(taskId, from, to, metaUpdates) {
  return enqueueTaskMove(taskId, async () => {
    const srcPath = path.join(TASKS_DIR, from, `${taskId}.md`);
    const dstPath = path.join(TASKS_DIR, to, `${taskId}.md`);
    const tmpPath = dstPath + ".tmp";

    const content = await readFile(srcPath, "utf-8");
    const { meta, body } = parseTaskFile(content);
    meta.state = to;
    if (to === "running") meta.startedAt = new Date().toISOString();
    if (to === "pending" || to === "running") delete meta.completedAt;
    if (to === "review" || to === "done" || to === "failed") meta.completedAt = new Date().toISOString();

    // Apply optional meta updates (e.g., feedback, clearing fields)
    if (metaUpdates) {
      for (const [key, value] of Object.entries(metaUpdates)) {
        if (value === undefined || value === null) delete meta[key];
        else meta[key] = value;
      }
    }

    // Cache DAG summary in meta for done/failed tasks to avoid re-loading on list
    if ((to === "done" || to === "failed") && meta.id && !meta.tokenUsage) {
      try {
        const dagSummary = await loadDagSummary(meta.id);
        if (dagSummary) {
          if (dagSummary.tokenUsage) meta.tokenUsage = dagSummary.tokenUsage;
          if (dagSummary.pipeline) meta.pipelineType = dagSummary.pipeline;
          if (dagSummary.currentStage) meta.currentStage = dagSummary.currentStage;
        }
      } catch {
        // Non-critical — list will fall back to loading DAG on-demand
      }
    }

    // Write to tmp, then atomic rename to destination, then remove source
    await writeFile(tmpPath, serializeTaskFile(meta, body));
    await rename(tmpPath, dstPath);
    try {
      await unlink(srcPath);
    } catch (error) {
      if (error && error.code !== "ENOENT") {
        // Source cleanup failed but destination already has updated metadata.
        // Keep destination (authoritative) and log orphaned source for later cleanup.
        deps.log(`moveTask: failed to remove source ${from}/${taskId}.md: ${error.message} (orphaned)`);
      }
    }
    deps.broadcastWs("task:updated", { taskId, state: to });
  });
}

async function scanPendingTasks() {
  const pendingDir = path.join(TASKS_DIR, "pending");
  let files;
  try {
    files = await readdir(pendingDir);
  } catch (e) {
    if (e && e.code !== "ENOENT") deps.log(`scanPendingTasks: readdir failed: ${e.message}`);
    return [];
  }

  const tasks = [];
  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    try {
      const content = await readFile(path.join(pendingDir, file), "utf-8");
      const { meta, body } = parseTaskFile(content);
      tasks.push({ ...meta, body });
    } catch (e) {
      deps.log(`scanPendingTasks: skipping ${file}: ${e.message}`);
    }
  }

  // sort by priority (desc) then created (asc)
  tasks.sort((a, b) => {
    if ((b.priority || 0) !== (a.priority || 0)) return (b.priority || 0) - (a.priority || 0);
    return (a.created || "").localeCompare(b.created || "");
  });

  return tasks;
}

async function loadTask(taskId) {
  for (const state of TASK_STATES) {
    const taskPath = path.join(TASKS_DIR, state, `${taskId}.md`);
    try {
      const content = await readFile(taskPath, "utf-8");
      const { meta, body } = parseTaskFile(content);
      return { ...meta, body, state };
    } catch {
      /* file not in this state dir, expected */
    }
  }
  return null;
}

async function recoverRunningTasks() {
  const runningDir = path.join(TASKS_DIR, "running");
  let files;
  try {
    files = await readdir(runningDir);
  } catch (e) {
    if (e && e.code !== "ENOENT") deps.log(`recoverRunningTasks: readdir failed: ${e.message}`);
    return 0;
  }

  const daemonState = deps.daemonState();
  let recovered = 0;
  let trackingChanged = false;
  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const taskId = file.replace(".md", "");

    // if no pipeline is actively running for this task, check if suspended
    if (!deps.inflightTasks.has(taskId)) {
      try {
        const content = await readFile(path.join(runningDir, file), "utf-8");
        const { meta } = parseTaskFile(content);
        if (meta.suspended) {
          // keep suspended tasks in running/ — add to suspended list for later resume
          if (!daemonState.suspendedTasks) daemonState.suspendedTasks = [];
          if (!daemonState.suspendedTasks.includes(taskId)) {
            daemonState.suspendedTasks.push(taskId);
            trackingChanged = true;
          }
          deps.log(`preserved suspended task: ${taskId} (stage: ${meta.suspendedStage || "unknown"})`);
          continue;
        }
      } catch (e) {
        deps.log(`recoverRunningTasks: failed to check suspended state for ${taskId}: ${e.message}`);
      }
      try {
        // clean up existing worktrees before re-queuing
        const content = await readFile(path.join(runningDir, file), "utf-8");
        const { meta } = parseTaskFile(content);
        const projects = normalizeProjects(meta);
        await removeWorktrees(taskId, projects);
        await moveTask(taskId, "running", "pending");
        deps.log(`recovered orphaned task: ${taskId} (running → pending, worktrees cleaned)`);
        recovered++;
      } catch (e) {
        deps.log(`failed to recover task ${taskId}: ${e.message}`);
      }
    }
  }

  if (trackingChanged) {
    deps.markStateDirty?.();
  }

  return recovered;
}

// ── Socket Method Handlers ──

async function handleSubmit(params) {
  const { title, body, project, projects, priority, pipeline, taskFile } = params;

  if (taskFile) {
    const { meta, body: fileBody } = parseTaskFile(taskFile);
    return submitTask(
      meta.title || "untitled",
      fileBody,
      { project: meta.project, projects: meta.projects, priority: meta.priority, pipeline: meta.pipeline },
    );
  }

  if (!title) throw new Error("title required");
  return submitTask(title, body || "", { project, projects, priority, pipeline });
}

async function handleStart(params) {
  const { taskId } = params;
  if (!taskId) throw new Error("taskId required");

  const task = await loadTask(taskId);
  if (!task) throw new Error(`task not found: ${taskId}`);
  if (task.state !== "pending") throw new Error(`task is not pending: ${task.state}`);

  if (deps.inflightTasks.has(taskId)) {
    return { id: taskId, status: "running" };
  }
  if (deps.taskQueueIds?.has?.(taskId)) {
    return { id: taskId, status: "queued" };
  }
  if (deps.taskQueue.some((queued) => queued.id === taskId)) {
    return { id: taskId, status: "queued" };
  }

  deps.taskQueue.push(task);
  deps.taskQueueIds?.add?.(taskId);
  deps.taskQueue.sort((a, b) => {
    if ((b.priority || 0) !== (a.priority || 0)) return (b.priority || 0) - (a.priority || 0);
    return (a.created || "").localeCompare(b.created || "");
  });

  if (typeof deps.wakeProcessLoop === "function") {
    deps.wakeProcessLoop();
  }

  deps.log(`task queued: ${taskId}`);
  deps.broadcastWs("task:updated", { taskId, state: "pending" });
  return { id: taskId, status: "queued" };
}

async function handleList(params) {
  const statusFilter = params.status;
  const projectFilter = params.project ? path.resolve(params.project) : null;
  const titleFilter = params.title ? params.title.toLowerCase() : null;
  const pipelineFilter = params.pipeline || null;
  const hasPriorityFilter = params.minPriority !== undefined && params.minPriority !== null && params.minPriority !== "";
  const priorityFilter = hasPriorityFilter ? Number(params.minPriority) : null;
  const includeDag = params.includeDag !== false; // default true
  const tasks = [];
  const dagSummaryTargets = [];

  if (statusFilter && !TASK_STATES.includes(statusFilter)) {
    throw new Error(`invalid status filter: ${statusFilter}`);
  }
  if (hasPriorityFilter && !Number.isFinite(priorityFilter)) {
    throw new Error(`invalid minPriority filter: ${params.minPriority}`);
  }
  const states = statusFilter ? [statusFilter] : TASK_STATES;
  for (const state of states) {
    const stateDir = path.join(TASKS_DIR, state);
    let files;
    try { files = await readdir(stateDir); } catch (e) { if (e && e.code !== "ENOENT") deps.log(`handleList: readdir failed for ${state}: ${e.message}`); continue; }

    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      try {
        const content = await readFile(path.join(stateDir, file), "utf-8");
        const { meta } = parseTaskFile(content);

        if (projectFilter) {
          const taskProjects = normalizeProjects(meta);
          if (!taskProjects.some((p) => path.resolve(p.path) === projectFilter)) continue;
        }
        if (titleFilter && !(meta.title || "").toLowerCase().includes(titleFilter)) continue;
        if (pipelineFilter && meta.pipeline !== pipelineFilter) continue;
        if (priorityFilter != null && (meta.priority || 0) < priorityFilter) continue;

        const task = { ...meta, state };
        if (state === "pending" || state === "running") {
          delete task.completedAt;
        }

        // Defer DAG summary I/O and process with bounded concurrency.
        // Skip DAG loading for done/failed tasks that already have cached tokenUsage.
        if (includeDag && state !== "pending" && meta.id) {
          if ((state === "done" || state === "failed") && meta.tokenUsage) {
            task.tokenUsage = meta.tokenUsage;
            if (meta.pipelineType) task.pipelineType = meta.pipelineType;
            if (meta.currentStage) task.currentStage = meta.currentStage;
          } else {
            dagSummaryTargets.push(task);
          }
        }

        tasks.push(task);
      } catch (e) {
        deps.log(`handleList: skipping ${file}: ${e.message}`);
      }
    }
  }

  await mapWithConcurrency(dagSummaryTargets, LIST_DAG_SUMMARY_CONCURRENCY, async (task) => {
    const dagSummary = await loadDagSummary(task.id);
    if (!dagSummary) return;
    task.currentStage = dagSummary.currentStage;
    task.pipelineType = dagSummary.pipeline;
    task.stageHistory = dagSummary.stageHistory;
    task.tokenUsage = dagSummary.tokenUsage;
  });

  return tasks;
}

async function countTasksByState() {
  const counts = {};
  for (const state of TASK_STATES) {
    const stateDir = path.join(TASKS_DIR, state);
    try {
      const files = await readdir(stateDir);
      counts[state] = files.filter((f) => f.endsWith(".md")).length;
    } catch (e) {
      if (e && e.code !== "ENOENT") deps.log(`countTasksByState: readdir failed for ${state}: ${e.message}`);
      counts[state] = 0;
    }
  }
  return counts;
}

async function handleStatus(params) {
  const daemonState = deps.daemonState();
  if (params.taskId) {
    const task = await loadTask(params.taskId);
    if (!task) throw new Error(`task not found: ${params.taskId}`);
    if (task.state === "pending" || task.state === "running") {
      delete task.completedAt;
    }

    // Enrich with DAG data if available
    const dagSummary = await loadDagSummary(params.taskId);
    if (dagSummary) {
      task.currentStage = dagSummary.currentStage;
      task.pipelineType = dagSummary.pipeline;
      task.stageHistory = dagSummary.stageHistory;
      task.tokenUsage = dagSummary.tokenUsage;
    }
    return task;
  }
  const counts = await countTasksByState();
  return {
    pid: process.pid,
    uptime: Math.floor(process.uptime()),
    daemonStatus: daemonState.daemonStatus,
    pausedAt: daemonState.pausedAt,
    pauseReason: daemonState.pauseReason,
    activeTasks: daemonState.activeTasks,
    queueLength: deps.taskQueue.length,
    tasksCompleted: counts.done,
    tasksFailed: counts.failed,
    totalSpawns: daemonState.stats.totalSpawns,
  };
}

async function handleApprove(params) {
  const { taskId, score } = params;
  if (!taskId) throw new Error("taskId required");

  const task = await loadTask(taskId);
  if (!task) throw new Error(`task not found: ${taskId}`);
  if (task.state !== "review") throw new Error(`task is not in review state: ${task.state}`);

  const daemonState = deps.daemonState();
  const projects = normalizeProjects(task);

  // Self-modification safety gate
  const config = deps.config();
  const selfConfig = config?.selfImprove || {};
  if (selfConfig.enabled && projects.some((p) => isSelfTarget(p.path))) {
    if (selfConfig.requirePassingTests !== false) {
      const gate = await selfSafetyGate(taskId, projects[0].path);
      if (!gate.safe) {
        throw new Error(`self-modification safety gate failed: ${gate.reason}`);
      }
      deps.log(`[${taskId}] self-modification safety gate passed (backup: ${gate.backupBranch})`);
    }
  }

  await mergeWorktrees(taskId, projects, { log: deps.log });

  if (score !== undefined) {
    await updateMemory(taskId, { metrics: { score } });
  }

  daemonState.activeTasks = daemonState.activeTasks.filter((t) => t !== taskId);
  if (daemonState.suspendedTasks) {
    daemonState.suspendedTasks = daemonState.suspendedTasks.filter((t) => t !== taskId);
  }
  deps.markStateDirty();

  await moveTask(taskId, "review", "done");
  deps.log(`task approved: ${taskId}`);

  // 제안 기반 태스크면 평가 실행
  evaluateProposal(taskId).catch((e) => deps.log(`[evaluate] ${taskId}: ${e.message}`));

  return { id: taskId, status: "done" };
}

async function handleReject(params) {
  const { taskId, feedback } = params;
  if (!taskId) throw new Error("taskId required");

  const task = await loadTask(taskId);
  if (!task) throw new Error(`task not found: ${taskId}`);
  if (task.state !== "review") throw new Error(`task is not in review state: ${task.state}`);

  const projects = normalizeProjects(task);
  const config = deps.config();

  if (feedback) {
    // resubmit with feedback — keep worktree, resume from implement step via forge
    await saveArtifact(taskId, "rejection-feedback.md", feedback);
    await moveTask(taskId, "review", "running", {
      feedback,
      completedAt: null,
      suspended: true,
      suspendedStage: "implement",
      suspendedReason: "reject_feedback",
    });

    const daemonState = deps.daemonState();
    if (!Array.isArray(daemonState.activeTasks)) daemonState.activeTasks = [];
    if (!daemonState.activeTasks.includes(taskId)) {
      daemonState.activeTasks.push(taskId);
    }
    if (Array.isArray(daemonState.suspendedTasks)) {
      daemonState.suspendedTasks = daemonState.suspendedTasks.filter((t) => t !== taskId);
    }
    deps.markStateDirty();

    const project = projects[0]?.path;
    const stageApproval = deps.config()?.stageApproval || {};
    const fp = new ForgePipeline({
      taskId,
      project,
      autopilot: true,
      stageApproval,
      resumeFrom: "implement",
    });
    deps.activeForgePipelines?.set(taskId, fp);
    deps.inflightTasks?.add(taskId);
    wireEvents(fp, (event, data) => {
      deps.broadcastWs(event, { ...data, taskId });
      if (event === "agent:output" && data.chunk) {
        deps.broadcastWs("task:log", { taskId, line: data.chunk });
      }
      if (event === "stage:gate") {
        deps.updateTaskMeta?.(taskId, { stageGate: data.stage });
      }
      if (event === "stage:gate_resolved") {
        deps.updateTaskMeta?.(taskId, { stageGate: null });
      }
    });
    fp.run().then(async (dag) => {
      const status = dag.status;
      if (status === "done" || status === "auto_merged") {
        await moveTask(taskId, "running", "done", {
          suspended: null,
          suspendedStage: null,
          suspendedReason: null,
        });
      } else if (status === "review") {
        await moveTask(taskId, "running", "review", {
          suspended: null,
          suspendedStage: null,
          suspendedReason: null,
        });
      } else {
        await moveTask(taskId, "running", "failed", {
          suspended: null,
          suspendedStage: null,
          suspendedReason: null,
        });
      }
    }).catch(async (e) => {
      deps.log(`reject-feedback forge error for ${taskId}: ${e.message}`);
      try {
        await moveTask(taskId, "running", "failed", {
          suspended: null,
          suspendedStage: null,
          suspendedReason: null,
        });
      } catch (e2) {
        deps.log(`reject-feedback moveTask to failed also errored for ${taskId}: ${e2.message}`);
      }
    }).finally(() => {
      deps.activeForgePipelines?.delete(taskId);
      deps.inflightTasks?.delete(taskId);
      const ds = deps.daemonState();
      if (Array.isArray(ds.activeTasks)) {
        ds.activeTasks = ds.activeTasks.filter((t) => t !== taskId);
      }
      if (Array.isArray(ds.suspendedTasks)) {
        ds.suspendedTasks = ds.suspendedTasks.filter((t) => t !== taskId);
      }
      deps.markStateDirty();
    });

    deps.log(`task rejected with feedback, resuming via forge: ${taskId}`);
    return { id: taskId, status: "running" };
  }

  // reject without feedback — discard
  await removeWorktrees(taskId, projects);
  await moveTask(taskId, "review", "failed");

  const daemonState = deps.daemonState();
  let trackingChanged = false;
  if (Array.isArray(daemonState.activeTasks)) {
    const nextActive = daemonState.activeTasks.filter((t) => t !== taskId);
    trackingChanged = trackingChanged || nextActive.length !== daemonState.activeTasks.length;
    daemonState.activeTasks = nextActive;
  }
  if (Array.isArray(daemonState.suspendedTasks)) {
    const nextSuspended = daemonState.suspendedTasks.filter((t) => t !== taskId);
    trackingChanged = trackingChanged || nextSuspended.length !== daemonState.suspendedTasks.length;
    daemonState.suspendedTasks = nextSuspended;
  }
  if (trackingChanged) {
    deps.markStateDirty();
  }

  deps.log(`task rejected: ${taskId}`);
  return { id: taskId, status: "failed" };
}

async function handleCancel(params) {
  const { taskId } = params;
  if (!taskId) throw new Error("taskId required");

  const task = await loadTask(taskId);
  if (!task) throw new Error(`task not found: ${taskId}`);

  // Abort running pipeline before removing worktrees
  const fp = deps.activeForgePipelines?.get(taskId);
  if (fp) {
    try { await fp.abort(); } catch (e) { deps.log(`abort failed for ${taskId}: ${e.message}`); }
    deps.activeForgePipelines.delete(taskId);
  }

  const daemonState = deps.daemonState();
  const projects = normalizeProjects(task);
  await removeWorktrees(taskId, projects);

  if (task.state !== "done" && task.state !== "failed") {
    await moveTask(taskId, task.state, "failed");
  }

  // clean up from active/suspended lists
  daemonState.activeTasks = daemonState.activeTasks.filter((t) => t !== taskId);
  if (daemonState.suspendedTasks) {
    daemonState.suspendedTasks = daemonState.suspendedTasks.filter((t) => t !== taskId);
  }
  deps.markStateDirty();

  deps.log(`task cancelled: ${taskId}`);
  return { id: taskId, status: "failed" };
}

async function handleRetry(params) {
  const { taskId } = params;
  if (!taskId) throw new Error("taskId required");
  const task = await loadTask(taskId);
  if (!task) throw new Error(`task not found: ${taskId}`);
  if (task.state !== "failed") throw new Error(`task is not failed: ${task.state}`);

  const projects = normalizeProjects(task);
  await removeWorktrees(taskId, projects);

  const daemonState = deps.daemonState();
  let trackingChanged = false;
  if (Array.isArray(daemonState.activeTasks)) {
    const nextActive = daemonState.activeTasks.filter((t) => t !== taskId);
    trackingChanged = trackingChanged || nextActive.length !== daemonState.activeTasks.length;
    daemonState.activeTasks = nextActive;
  }
  if (Array.isArray(daemonState.suspendedTasks)) {
    const nextSuspended = daemonState.suspendedTasks.filter((t) => t !== taskId);
    trackingChanged = trackingChanged || nextSuspended.length !== daemonState.suspendedTasks.length;
    daemonState.suspendedTasks = nextSuspended;
  }
  if (trackingChanged) {
    deps.markStateDirty();
  }

  await moveTask(taskId, "failed", "pending");
  deps.log(`task retried: ${taskId}`);
  deps.broadcastWs("task:updated", { taskId, state: "pending" });
  return { id: taskId, status: "pending" };
}

async function handleDelete(params) {
  const { taskId } = params;
  if (!taskId) throw new Error("taskId required");
  const task = await loadTask(taskId);
  if (!task) throw new Error(`task not found: ${taskId}`);
  if (task.state !== "failed" && task.state !== "done") {
    throw new Error(`can only delete done/failed tasks: ${task.state}`);
  }

  const projects = normalizeProjects(task);
  await removeWorktrees(taskId, projects);

  // remove task file
  const taskPath = path.join(TASKS_DIR, task.state, `${taskId}.md`);
  try { await unlink(taskPath); } catch (e) { if (e.code !== "ENOENT") deps.log(`delete: failed to remove task file for ${taskId}: ${e.message}`); }

  // remove logs (task log file + stage log directory) and artifacts
  try { await unlink(path.join(LOGS_DIR, `${taskId}.log`)); } catch (e) { if (e.code !== "ENOENT") deps.log(`delete: failed to remove log file for ${taskId}: ${e.message}`); }
  try { await rm(path.join(LOGS_DIR, taskId), { recursive: true }); } catch (e) { if (e.code !== "ENOENT") deps.log(`delete: failed to remove log dir for ${taskId}: ${e.message}`); }
  try { await rm(path.join(ARTIFACTS_DIR, taskId), { recursive: true }); } catch (e) { if (e.code !== "ENOENT") deps.log(`delete: failed to remove artifacts for ${taskId}: ${e.message}`); }

  deps.log(`task deleted: ${taskId}`);
  deps.broadcastWs("task:deleted", { taskId });
  return { id: taskId, status: "deleted" };
}

async function handleDiff(params) {
  const { taskId } = params;
  if (!taskId) throw new Error("taskId required");

  const task = await loadTask(taskId);
  if (!task) throw new Error(`task not found: ${taskId}`);

  const projects = normalizeProjects(task);
  return getWorktreeDiff(taskId, projects);
}

async function handleLogs(params) {
  const { taskId, lines } = params;
  if (!taskId) throw new Error("taskId required");

  const logPath = path.join(LOGS_DIR, `${taskId}.log`);
  try {
    const count = normalizeLogLineLimit(lines);
    return await readLogTail(logPath, count);
  } catch {
    return "(no logs)";
  }
}

function handlePause() {
  const daemonState = deps.daemonState();
  daemonState.daemonStatus = "paused";
  daemonState.pausedAt = new Date().toISOString();
  daemonState.pauseReason = "manual";
  deps.markStateDirty();
  deps.log("daemon paused (manual)");
  deps.broadcastWs("daemon:status", { status: "paused" });
  return { status: "paused" };
}

async function handleResume() {
  const daemonState = deps.daemonState();
  const probeTimer = deps.getProbeTimer?.();
  if (probeTimer) {
    clearTimeout(probeTimer);
    deps.setProbeTimer?.(null);
  }
  deps.setProbeIntervalMs?.(deps.QUOTA_PROBE_INITIAL_MS);

  try {
    await deps.requeueSuspendedTasks();
  } catch (e) {
    daemonState.daemonStatus = "paused";
    if (!daemonState.pausedAt) daemonState.pausedAt = new Date().toISOString();
    daemonState.pauseReason = "resume_requeue_failed";
    deps.markStateDirty();
    deps.log(`daemon resume failed while requeueing suspended tasks: ${e.message}`);
    deps.broadcastWs("daemon:status", { status: "paused" });
    throw new Error(`resume failed: ${e.message}`);
  }

  daemonState.daemonStatus = "running";
  daemonState.pausedAt = null;
  daemonState.pauseReason = null;
  deps.markStateDirty();
  deps.log("daemon resumed");
  deps.broadcastWs("daemon:status", { status: "running" });
  return { status: "running" };
}

async function handleStats() {
  const daemonState = deps.daemonState();
  const config = deps.config();
  const { checkResources } = require("./ucmd-task.js");
  const resources = await checkResources();
  const { FORGE_PIPELINES } = require("./core/constants");
  const counts = await countTasksByState();
  const llmProvider = config?.provider || process.env.UCM_PROVIDER || DEFAULT_CONFIG.provider;
  const llmModel = config?.model || DEFAULT_CONFIG.model;
  return {
    pid: process.pid,
    uptime: Math.floor(process.uptime()),
    daemonStatus: daemonState.daemonStatus,
    activeTasks: daemonState.activeTasks,
    suspendedTasks: daemonState.suspendedTasks || [],
    queueLength: deps.taskQueue.length,
    resources,
    resourcePressure: deps.getResourcePressure(resources),
    pipelines: Object.keys(FORGE_PIPELINES),
    tasksCompleted: counts.done,
    tasksFailed: counts.failed,
    totalSpawns: daemonState.stats.totalSpawns,
    llm: {
      provider: llmProvider,
      model: llmModel,
    },
  };
}

function handleStageGateApprove(params) {
  const { taskId } = params;
  if (!taskId) throw new Error("taskId required");
  const fp = deps.activeForgePipelines?.get(taskId);
  if (!fp) throw new Error(`no active pipeline for task: ${taskId}`);
  const resolved = fp.resolveGate("approve");
  if (!resolved) throw new Error(`no pending gate for task: ${taskId}`);
  return { id: taskId, action: "approved" };
}

function handleStageGateReject(params) {
  const { taskId, feedback } = params;
  if (!taskId) throw new Error("taskId required");
  const fp = deps.activeForgePipelines?.get(taskId);
  if (!fp) throw new Error(`no active pipeline for task: ${taskId}`);
  const resolved = fp.resolveGate("reject", feedback);
  if (!resolved) throw new Error(`no pending gate for task: ${taskId}`);
  return { id: taskId, action: "rejected" };
}

function handleGetConfig() {
  return deps.config();
}

const VALID_PROVIDERS = new Set(["claude", "codex", "gemini"]);
let _configWriteLock = Promise.resolve();

async function handleSetConfig(params) {
  if (params.provider !== undefined) {
    if (typeof params.provider !== "string" || !VALID_PROVIDERS.has(params.provider)) {
      throw new Error(`invalid provider: ${params.provider} (valid: ${[...VALID_PROVIDERS].join(", ")})`);
    }
  }
  if (params.model !== undefined) {
    if (typeof params.model !== "string" || !params.model.trim()) {
      throw new Error("model must be a non-empty string");
    }
  }
  // Serialize config writes to prevent lost-update races from concurrent calls
  const operation = _configWriteLock.catch((e) => { deps.log(`config write lock error (non-fatal): ${e.message}`); }).then(async () => {
    const current = deps.config();
    const merged = { ...current, ...params };
    const tmpPath = CONFIG_PATH + ".tmp";
    await writeFile(tmpPath, JSON.stringify(merged, null, 2) + "\n");
    await rename(tmpPath, CONFIG_PATH);
    await deps.reloadConfig();
    const reloaded = deps.config();
    deps.broadcastWs("config:updated", reloaded);
    return reloaded;
  });
  _configWriteLock = operation.catch((e) => { deps.log(`config write error (non-fatal): ${e.message}`); });
  return operation;
}

async function handleUpdatePriority(params) {
  const { taskId, priority } = params;
  if (!taskId) throw new Error("taskId required");
  if (priority == null || typeof priority !== "number") throw new Error("priority must be a number");

  const task = await loadTask(taskId);
  if (!task) throw new Error(`task not found: ${taskId}`);
  if (task.state !== "pending") throw new Error(`can only change priority of pending tasks: ${task.state}`);

  const taskPath = path.join(TASKS_DIR, "pending", `${taskId}.md`);
  const content = await readFile(taskPath, "utf-8");
  const { meta, body } = parseTaskFile(content);
  meta.priority = priority;
  const tmpPath = taskPath + ".tmp";
  await writeFile(tmpPath, serializeTaskFile(meta, body));
  await rename(tmpPath, taskPath);

  // Re-sort queue if task is queued
  const queueIdx = deps.taskQueue.findIndex((t) => t.id === taskId);
  if (queueIdx !== -1) {
    deps.taskQueue[queueIdx].priority = priority;
    deps.taskQueue.sort((a, b) => {
      if ((b.priority || 0) !== (a.priority || 0)) return (b.priority || 0) - (a.priority || 0);
      return (a.created || "").localeCompare(b.created || "");
    });
  }

  deps.log(`task priority updated: ${taskId} → ${priority}`);
  deps.broadcastWs("task:updated", { taskId, priority });
  return { id: taskId, priority };
}

module.exports = {
  setDeps,
  submitTask, moveTask, scanPendingTasks, loadTask, recoverRunningTasks,
  handleSubmit, handleStart, handleList, handleStatus,
  handleApprove, handleReject, handleCancel,
  handleRetry, handleDelete, handleDiff, handleLogs,
  handlePause, handleResume, handleStats,
  handleStageGateApprove, handleStageGateReject,
  handleGetConfig, handleSetConfig,
  handleUpdatePriority,
};
