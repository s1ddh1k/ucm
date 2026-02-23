const net = require("net");
const fs = require("fs");

const {
  SOCK_PATH, MAX_SOCKET_REQUEST_BYTES,
} = require("./ucmd-constants.js");
const { MAX_CONCURRENT_TASKS } = require("./core/constants");

let deps = {};

function setDeps(d) { deps = d; }

function broadcastWs(event, data) {
  if (socketSubscribers.size > 0) {
    const line = JSON.stringify({ event, data }) + "\n";
    for (const conn of socketSubscribers) {
      try { conn.write(line); } catch { socketSubscribers.delete(conn); }
    }
  }
}

function ensureForgeCapacity() {
  const activeCount = deps.activeForgePipelines?.size || 0;
  if (activeCount >= MAX_CONCURRENT_TASKS) {
    throw new Error(`concurrent task limit reached (${MAX_CONCURRENT_TASKS}). Wait for a task to finish or increase UCM_MAX_CONCURRENT.`);
  }
}

function assertForgeResumeReady(taskId) {
  ensureForgeCapacity();
  if (deps.activeForgePipelines?.has(taskId)) {
    throw new Error(`task ${taskId} is already running`);
  }
}

function lastFailedStage(dag) {
  const history = Array.isArray(dag?.stageHistory) ? dag.stageHistory : [];
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]?.status === "fail") return history[i].stage;
  }
  return null;
}

function assertResumableTaskState(task) {
  if (!task || typeof task.state !== "string") return;
  if (task.state === "review" || task.state === "failed") {
    return;
  }
  if (task.state === "running" && task.suspended === true) {
    return;
  }
  throw new Error(`cannot resume task in state: ${task.state}`);
}

function updateStageGateMeta(taskId, stage) {
  if (typeof deps.updateTaskMeta !== "function") return;
  deps.updateTaskMeta(taskId, { stageGate: stage }).catch((e) => {
    if (deps.log) deps.log(`[${taskId}] updateTaskMeta error: ${e.message}`);
  });
}

function markDaemonTaskRunning(taskId) {
  if (typeof deps.daemonState !== "function") return;
  const daemonState = deps.daemonState();
  if (!daemonState) return;

  let changed = false;
  if (!Array.isArray(daemonState.activeTasks)) {
    daemonState.activeTasks = [];
    changed = true;
  }
  if (!daemonState.activeTasks.includes(taskId)) {
    daemonState.activeTasks.push(taskId);
    changed = true;
  }
  if (Array.isArray(daemonState.suspendedTasks)) {
    const nextSuspended = daemonState.suspendedTasks.filter((t) => t !== taskId);
    if (nextSuspended.length !== daemonState.suspendedTasks.length) {
      daemonState.suspendedTasks = nextSuspended;
      changed = true;
    }
  }
  if (changed) deps.markStateDirty?.();
}

function clearDaemonTaskTracking(taskId) {
  if (typeof deps.daemonState !== "function") return;
  const daemonState = deps.daemonState();
  if (!daemonState) return;

  let changed = false;
  if (Array.isArray(daemonState.activeTasks)) {
    const nextActive = daemonState.activeTasks.filter((t) => t !== taskId);
    if (nextActive.length !== daemonState.activeTasks.length) {
      daemonState.activeTasks = nextActive;
      changed = true;
    }
  }
  if (Array.isArray(daemonState.suspendedTasks)) {
    const nextSuspended = daemonState.suspendedTasks.filter((t) => t !== taskId);
    if (nextSuspended.length !== daemonState.suspendedTasks.length) {
      daemonState.suspendedTasks = nextSuspended;
      changed = true;
    }
  }
  if (changed) deps.markStateDirty?.();
}

function markDaemonTaskSuspended(taskId) {
  if (typeof deps.daemonState !== "function") return;
  const daemonState = deps.daemonState();
  if (!daemonState) return;

  let changed = false;
  if (!Array.isArray(daemonState.suspendedTasks)) {
    daemonState.suspendedTasks = [];
    changed = true;
  }
  if (!daemonState.suspendedTasks.includes(taskId)) {
    daemonState.suspendedTasks.push(taskId);
    changed = true;
  }
  if (Array.isArray(daemonState.activeTasks)) {
    const nextActive = daemonState.activeTasks.filter((t) => t !== taskId);
    if (nextActive.length !== daemonState.activeTasks.length) {
      daemonState.activeTasks = nextActive;
      changed = true;
    }
  }
  if (changed) deps.markStateDirty?.();
}

function startForgePipeline(fp, taskId, logPrefix = "forge", hooks = {}) {
  ensureForgeCapacity();
  if (deps.activeForgePipelines?.has(taskId)) {
    throw new Error(`task ${taskId} is already running`);
  }

  const { wireEvents } = require("./forge/index");
  deps.activeForgePipelines?.set(taskId, fp);
  wireEvents(fp, (event, data) => {
    broadcastWs(event, { ...data, taskId });
    if (event === "agent:output" && data.chunk) {
      broadcastWs("task:log", { taskId, line: data.chunk });
    }
    if (event === "stage:gate") {
      updateStageGateMeta(taskId, data.stage);
    }
    if (event === "stage:gate_resolved") {
      updateStageGateMeta(taskId, null);
    }
  });

  fp.run()
    .then(async (result) => {
      if (typeof hooks.onSuccess === "function") {
        try {
          await hooks.onSuccess(result);
        } catch (e) {
          deps.log?.(`[${logPrefix}] onSuccess hook error for ${taskId}: ${e.message}`);
        }
      }
    })
    .catch(async (e) => {
      if (deps.log) deps.log(`[${logPrefix}] error for ${taskId}: ${e.message}`);
      broadcastWs("pipeline:error", { taskId, error: e.message });
      if (typeof hooks.onError === "function") {
        try {
          await hooks.onError(e);
        } catch (hookError) {
          deps.log?.(`[${logPrefix}] onError hook error for ${taskId}: ${hookError.message}`);
        }
      }
    })
    .finally(async () => {
      deps.activeForgePipelines?.delete(taskId);
      clearDaemonTaskTracking(taskId);
      if (typeof hooks.onFinally === "function") {
        try {
          await hooks.onFinally();
        } catch (e) {
          deps.log?.(`[${logPrefix}] onFinally hook error for ${taskId}: ${e.message}`);
        }
      }
    });
}

// ── Socket Server ──

let socketServer = null;
const socketSubscribers = new Set();

function startSocketServer() {
  return new Promise((resolve, reject) => {
    socketServer = net.createServer((conn) => {
      let data = "";
      conn.on("data", (chunk) => {
        data += chunk;
        if (data.length > MAX_SOCKET_REQUEST_BYTES) {
          conn.end(JSON.stringify({ id: null, ok: false, error: "request too large" }) + "\n");
          return;
        }
        let newlineIndex;
        while ((newlineIndex = data.indexOf("\n")) !== -1) {
          const requestLine = data.slice(0, newlineIndex);
          data = data.slice(newlineIndex + 1);
          handleSocketRequest(requestLine, conn);
        }
      });
      conn.on("error", (e) => {
        socketSubscribers.delete(conn);
        if (deps.log) deps.log(`socket conn error: ${e.message}`);
      });
    });

    socketServer.on("error", (e) => {
      if (e.code === "EADDRINUSE") {
        try { fs.unlinkSync(SOCK_PATH); } catch {}
        socketServer.listen(SOCK_PATH, () => resolve());
      } else {
        reject(e);
      }
    });

    socketServer.listen(SOCK_PATH, () => resolve());
  });
}

async function handleSocketRequest(line, conn) {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    conn.end(JSON.stringify({ id: null, ok: false, error: "invalid JSON" }) + "\n");
    return;
  }

  const { id, method, params } = request;
  const h = deps.handlers();
  function requireSessionId(p) {
    const sessionId = typeof p?.sessionId === "string" ? p.sessionId.trim() : "";
    if (!sessionId) throw new Error("sessionId required");
    return sessionId;
  }
  function requireRefinementStartParams(p) {
    const params = (p && typeof p === "object" && !Array.isArray(p)) ? { ...p } : {};
    const title = typeof params.title === "string" ? params.title.trim() : "";
    if (!title) throw new Error("title required");
    params.title = title;
    return params;
  }
  function isMissingAnswerValue(value) {
    if (value == null) return true;
    if (typeof value === "string") return value.trim() === "";
    return false;
  }
  const socketHandlers = {
    submit: h.handleSubmit,
    start: h.handleStart,
    list: h.handleList,
    status: h.handleStatus,
    approve: h.handleApprove,
    reject: h.handleReject,
    cancel: h.handleCancel,
    retry: h.handleRetry,
    delete: h.handleDelete,
    diff: h.handleDiff,
    logs: h.handleLogs,
    pause: () => h.handlePause(),
    resume: async (p) => {
      if (p && p.taskId) {
        // forge resume: 중단된 forge 태스크 재실행
        const { ForgePipeline, assertResumableDagStatus, resolveResumeProject } = require("./forge/index");
        const { TaskDag } = require("./core/task");
        const project = await resolveResumeProject(p.taskId, p.project);
        let existingDag;
        try {
          existingDag = await TaskDag.load(p.taskId);
          assertResumableDagStatus(existingDag);
        } catch (e) {
          throw new Error(`resume failed: ${e.message}`);
        }

        // Fail fast before mutating task/state so resume rejection is side-effect free.
        assertForgeResumeReady(p.taskId);

        let task = null;
        if (typeof deps.loadTask === "function") {
          task = await deps.loadTask(p.taskId);
          assertResumableTaskState(task);
        }

        let movedToRunning = false;
        let previousState = null;
        let clearedSuspendedMeta = null;
        if (task && (task.state === "review" || task.state === "failed") && typeof deps.moveTask === "function") {
          previousState = task.state;
          await deps.moveTask(p.taskId, task.state, "running", {
            completedAt: null,
            suspended: null,
            suspendedStage: null,
            suspendedReason: null,
          });
          movedToRunning = true;
        }
        if (task && task.state === "running" && task.suspended === true && typeof deps.updateTaskMeta === "function") {
          clearedSuspendedMeta = {
            suspendedStage: task.suspendedStage,
            suspendedReason: task.suspendedReason,
          };
          await deps.updateTaskMeta(p.taskId, {
            completedAt: null,
            suspended: null,
            suspendedStage: null,
            suspendedReason: null,
          });
        }

        markDaemonTaskRunning(p.taskId);
        if (!movedToRunning) {
          broadcastWs("task:updated", { taskId: p.taskId, state: "running" });
        }

        const fp = new ForgePipeline({
          taskId: p.taskId,
          project,
          pipeline: existingDag.pipeline,
          autopilot: p.autopilot,
          tokenBudget: p.tokenBudget,
          resumeFrom: p.fromStage || lastFailedStage(existingDag) || "implement",
        });
        try {
          startForgePipeline(fp, p.taskId, "resume", {
            onSuccess: async (dag) => {
              if (typeof deps.moveTask !== "function") return;
              const status = dag?.status;
              let targetState = null;
              if (status === "done" || status === "auto_merged") targetState = "done";
              else if (status === "review") targetState = "review";
              else if (status === "failed" || status === "rejected" || status === "aborted") targetState = "failed";
              if (!targetState) return;
              try {
                await deps.moveTask(p.taskId, "running", targetState, {
                  suspended: null,
                  suspendedStage: null,
                  suspendedReason: null,
                });
              } catch (e) {
                deps.log?.(`[resume] final transition failed for ${p.taskId}: ${e.message}`);
              }
            },
            onError: async () => {
              if (typeof deps.moveTask !== "function") return;
              try {
                await deps.moveTask(p.taskId, "running", "failed", {
                  suspended: null,
                  suspendedStage: null,
                  suspendedReason: null,
                });
              } catch {}
            },
          });
        } catch (e) {
          clearDaemonTaskTracking(p.taskId);
          if (clearedSuspendedMeta && typeof deps.updateTaskMeta === "function") {
            const restoreSuspendedMeta = { suspended: true };
            if (clearedSuspendedMeta.suspendedStage != null) {
              restoreSuspendedMeta.suspendedStage = clearedSuspendedMeta.suspendedStage;
            }
            if (clearedSuspendedMeta.suspendedReason != null) {
              restoreSuspendedMeta.suspendedReason = clearedSuspendedMeta.suspendedReason;
            }
            try {
              await deps.updateTaskMeta(p.taskId, restoreSuspendedMeta);
              markDaemonTaskSuspended(p.taskId);
            } catch (rollbackError) {
              deps.log?.(`[resume] suspended-meta rollback failed for ${p.taskId}: ${rollbackError.message}`);
            }
          }
          if (movedToRunning && previousState && typeof deps.moveTask === "function") {
            try {
              await deps.moveTask(p.taskId, "running", previousState);
            } catch (rollbackError) {
              deps.log?.(`[resume] rollback failed for ${p.taskId}: ${rollbackError.message}`);
            }
          }
          throw e;
        }
        return { ok: true, taskId: p.taskId };
      }
      // daemon resume (unpause)
      return h.handleResume();
    },
    stats: () => h.handleStats(),
    cleanup: (p) => h.performCleanup(p),
    observe: () => h.handleObserve(),
    observe_status: () => h.handleObserveStatus(),
    proposals: (p) => h.handleProposals(p),
    proposal_approve: (p) => h.handleProposalApprove(p),
    proposal_reject: (p) => h.handleProposalReject(p),
    proposal_delete: (p) => h.handleProposalDelete(p),
    proposal_priority: (p) => h.handleProposalPriority(p),
    proposal_evaluate: (p) => h.handleProposalEvaluate(p),
    snapshots: () => h.handleSnapshots(),
    analyze_project: (p) => h.handleAnalyzeProject(p),
    research_project: (p) => h.handleResearchProject(p),
    start_refinement: (p) => h.startRefinement(requireRefinementStartParams(p)),
    finalize_refinement: (p) => h.finalizeRefinement(requireSessionId(p)),
    cancel_refinement: (p) => h.cancelRefinement(requireSessionId(p)),
    refinement_answer: (p) => {
      const sessionId = requireSessionId(p);
      const nestedAnswer = p?.answer;
      if (nestedAnswer && typeof nestedAnswer === "object" && !Array.isArray(nestedAnswer)) {
        const { answer: nestedAnswerAlias, ...normalizedNestedAnswer } = nestedAnswer;
        if (
          isMissingAnswerValue(normalizedNestedAnswer.value)
          && typeof nestedAnswerAlias === "string"
        ) {
          normalizedNestedAnswer.value = nestedAnswerAlias;
        }
        return h.handleRefinementAnswer(sessionId, normalizedNestedAnswer);
      }
      const { answer: answerAlias, sessionId: _sid, ...flatAnswer } = p || {};
      if (isMissingAnswerValue(flatAnswer.value) && typeof answerAlias === "string") {
        flatAnswer.value = answerAlias;
      }
      return h.handleRefinementAnswer(sessionId, flatAnswer);
    },
    refinement_autopilot: (p) => h.switchToAutopilot(requireSessionId(p)),
    autopilot_start: (p) => h.handleAutopilotStart(p),
    autopilot_pause: (p) => h.handleAutopilotPause(p),
    autopilot_resume: (p) => h.handleAutopilotResume(p),
    autopilot_stop: (p) => h.handleAutopilotStop(p),
    autopilot_status: () => h.handleAutopilotStatus(),
    autopilot_session: (p) => h.handleAutopilotSession(p),
    autopilot_approve_item: (p) => h.handleAutopilotApproveItem(p),
    autopilot_reject_item: (p) => h.handleAutopilotRejectItem(p),
    autopilot_feedback_item: (p) => h.handleAutopilotFeedbackItem(p),
    autopilot_releases: (p) => h.handleAutopilotReleases(p),
    autopilot_directive_add: (p) => h.handleAutopilotDirectiveAdd(p),
    autopilot_directive_edit: (p) => h.handleAutopilotDirectiveEdit(p),
    autopilot_directive_delete: (p) => h.handleAutopilotDirectiveDelete(p),
    autopilot_directive_list: (p) => h.handleAutopilotDirectiveList(p),
    stage_gate_approve: (p) => h.handleStageGateApprove(p),
    stage_gate_reject: (p) => h.handleStageGateReject(p),
    get_config: () => h.handleGetConfig(),
    set_config: (p) => h.handleSetConfig(p),
    update_priority: (p) => h.handleUpdatePriority(p),
    forge: async (p) => {
      if (!p.input || (typeof p.input === "string" && !p.input.trim())) {
        throw new Error("input required");
      }
      const { ForgePipeline } = require("./forge/index");
      const fp = new ForgePipeline({
        input: p.input,
        project: p.project,
        pipeline: p.pipeline,
        autopilot: p.autopilot,
        tokenBudget: p.tokenBudget,
      });
      const forgeTaskId = fp.taskId;
      startForgePipeline(fp, forgeTaskId, "forge");
      return { ok: true, taskId: forgeTaskId };
    },
    shutdown: null,
  };

  if (method === "subscribe") {
    conn.write(JSON.stringify({ id, ok: true }) + "\n");
    const daemonState = deps.daemonState();
    conn.write(JSON.stringify({ event: "daemon:status", data: { status: daemonState?.daemonStatus || "running" } }) + "\n");
    socketSubscribers.add(conn);
    conn.on("close", () => socketSubscribers.delete(conn));
    conn.on("error", () => socketSubscribers.delete(conn));
    return;
  }

  if (method === "shutdown") {
    conn.end(JSON.stringify({ id, ok: true }) + "\n");
    deps.gracefulShutdown();
    return;
  }

  const handler = socketHandlers[method];
  if (!handler) {
    conn.end(JSON.stringify({ id, ok: false, error: `unknown method: ${method}` }) + "\n");
    return;
  }

  try {
    const result = await handler(params || {});
    conn.end(JSON.stringify({ id, ok: true, data: result }) + "\n");
  } catch (e) {
    deps.log(`[socket] ${method} error: ${e.message}`);
    conn.end(JSON.stringify({ id, ok: false, error: e.message }) + "\n");
  }
}

module.exports = {
  setDeps,
  broadcastWs,
  startSocketServer,
  socketSubscribers,
  socketServer: () => socketServer,
};
