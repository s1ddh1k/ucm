const { readFile, writeFile, rename } = require("node:fs/promises");
const { MERGE_QUEUE_PATH } = require("../ucmd-constants.js");

const CONFLICT_RE = /conflict|CONFLICT|merge failed/i;

class MergeQueueManager {
  constructor({
    log,
    broadcastWs,
    config,
    mergeWorktrees,
    loadWorkspace,
    removeWorktrees,
    moveTask,
    updateTaskMeta,
    loadTask,
    normalizeProjects,
    ForgePipeline,
    wireEvents,
    activeForgePipelines,
    inflightTasks,
    markStateDirty,
    daemonState,
    drainTaskMetaQueue,
    flushStateNow,
  }) {
    this.projectQueues = new Map();
    this.log = log || (() => {});
    this.broadcastWs = broadcastWs || (() => {});
    this.config = config;
    this.mergeWorktrees = mergeWorktrees;
    this.loadWorkspace = loadWorkspace;
    this.removeWorktrees = removeWorktrees;
    this.moveTask = moveTask;
    this.updateTaskMeta = updateTaskMeta;
    this.loadTask = loadTask;
    this.normalizeProjects = normalizeProjects;
    this.ForgePipeline = ForgePipeline;
    this.wireEvents = wireEvents;
    this.activeForgePipelines = activeForgePipelines;
    this.inflightTasks = inflightTasks;
    this.markStateDirty = markStateDirty;
    this.daemonState = daemonState;
    this.drainTaskMetaQueue = drainTaskMetaQueue;
    this.flushStateNow = flushStateNow;
    this._saveQueue = Promise.resolve();
  }

  _getConfig() {
    const cfg = typeof this.config === "function" ? this.config() : this.config;
    return cfg?.mergeQueue || {};
  }

  // Queue structure: { current: entry|null, entries: entry[] }
  // current = actively merging/rebasing item (separated from entries to prevent sort/shift bugs)
  // entries = waiting queue (safe to sort by priority)
  _getQueue(project) {
    if (!this.projectQueues.has(project)) {
      this.projectQueues.set(project, { current: null, entries: [] });
    }
    return this.projectQueues.get(project);
  }

  _cleanupEmptyQueue(project) {
    const queue = this.projectQueues.get(project);
    if (queue && queue.entries.length === 0 && !queue.current) {
      this.projectQueues.delete(project);
    }
  }

  _cleanupDaemonState(taskId) {
    const ds =
      typeof this.daemonState === "function"
        ? this.daemonState()
        : this.daemonState;
    if (!ds) return;
    ds.activeTasks = (ds.activeTasks || []).filter((t) => t !== taskId);
    if (ds.suspendedTasks) {
      ds.suspendedTasks = ds.suspendedTasks.filter((t) => t !== taskId);
    }
    this.markStateDirty?.();
  }

  _scheduleNext(project) {
    setImmediate(() =>
      this._processNext(project).catch((e) => {
        this.log(
          `[merge-queue] processNext error for ${project}: ${e.message}`,
        );
        // ensure queue isn't stuck
        const queue = this.projectQueues.get(project);
        if (queue) queue.current = null;
      }),
    );
  }

  isEnabled() {
    return this._getConfig().enabled !== false;
  }

  isBusy(project) {
    const queue = this.projectQueues.get(project);
    return queue ? queue.entries.length > 0 || !!queue.current : false;
  }

  enqueue(taskId, project, priority = 0) {
    const mqConfig = this._getConfig();
    const queue = this._getQueue(project);

    // dedup: check both entries and current
    if (queue.entries.some((e) => e.taskId === taskId)) {
      this.log(`[merge-queue] ${taskId} already in queue for ${project}`);
      return;
    }
    if (queue.current && queue.current.taskId === taskId) {
      this.log(`[merge-queue] ${taskId} already processing for ${project}`);
      return;
    }

    if (queue.entries.length >= (mqConfig.maxQueueSize || 20)) {
      throw new Error(
        `merge queue full for project ${project} (max: ${mqConfig.maxQueueSize || 20})`,
      );
    }

    const entry = {
      taskId,
      project,
      priority,
      status: "queued",
      enqueuedAt: new Date().toISOString(),
      rebaseCount: 0,
    };

    queue.entries.push(entry);
    queue.entries.sort((a, b) => (b.priority || 0) - (a.priority || 0));

    if (this.updateTaskMeta) {
      this.updateTaskMeta(taskId, { mergeQueue: "queued" }).catch((e) =>
        this.log(
          `[merge-queue] updateTaskMeta error for ${taskId}: ${e.message}`,
        ),
      );
    }

    this.broadcastWs("mergeQueue:enqueued", {
      taskId,
      project,
      position: queue.entries.indexOf(entry),
      queueLength: queue.entries.length,
    });
    this.broadcastWs("mergeQueue:updated", {
      project,
      queueLength: queue.entries.length,
      processing: !!queue.current,
    });

    this.log(
      `[merge-queue] enqueued ${taskId} for ${project} (queue: ${queue.entries.length})`,
    );
    this.save().catch((e) =>
      this.log(`[merge-queue] save error: ${e.message}`),
    );

    if (!queue.current) {
      this._scheduleNext(project);
    }
  }

  async _processNext(project) {
    const queue = this._getQueue(project);
    if (queue.current || queue.entries.length === 0) {
      this._cleanupEmptyQueue(project);
      return;
    }

    const entry = queue.entries.shift();
    queue.current = entry;
    entry.status = "merging";

    if (this.updateTaskMeta) {
      this.updateTaskMeta(entry.taskId, { mergeQueue: "merging" }).catch((e) =>
        this.log(
          `[merge-queue] updateTaskMeta error for ${entry.taskId}: ${e.message}`,
        ),
      );
    }

    this.broadcastWs("mergeQueue:merging", { taskId: entry.taskId, project });
    this.log(`[merge-queue] merging ${entry.taskId} for ${project}`);

    const startTime = Date.now();

    try {
      await this._attemptMerge(entry);

      const durationMs = Date.now() - startTime;
      queue.current = null;

      this.broadcastWs("mergeQueue:merged", {
        taskId: entry.taskId,
        project,
        durationMs,
      });
      this.broadcastWs("mergeQueue:updated", {
        project,
        queueLength: queue.entries.length,
        processing: false,
      });
      this.log(
        `[merge-queue] merged ${entry.taskId} for ${project} (${durationMs}ms)`,
      );

      await this.save();
      this._cleanupEmptyQueue(project);

      if (queue.entries.length > 0) {
        this._scheduleNext(project);
      }
    } catch (error) {
      try {
        await this._handleMergeFailure(entry, queue, project, error);
      } catch (fatalError) {
        this.log(
          `[merge-queue] fatal error handling merge failure for ${entry.taskId}: ${fatalError.message}`,
        );
        // last resort: unlock queue so it doesn't get stuck
        queue.current = null;
        await this.save().catch(() => {});
        if (queue.entries.length > 0) {
          this._scheduleNext(project);
        }
      }
    }
  }

  async _attemptMerge(entry) {
    const task = await this.loadTask(entry.taskId);
    if (!task) throw new Error(`task not found: ${entry.taskId}`);

    const projects = this.normalizeProjects(task);
    await this.mergeWorktrees(entry.taskId, projects, {
      log: (msg) => this.log(`[merge-queue] ${msg}`),
    });

    this._cleanupDaemonState(entry.taskId);

    await this.moveTask(entry.taskId, "running", "done", {
      mergeQueue: null,
      mergeRebaseCount: null,
    });

    this.log(`[merge-queue] ${entry.taskId} merged and moved to done`);
  }

  async _handleMergeFailure(entry, queue, project, error) {
    this.log(
      `[merge-queue] merge failed for ${entry.taskId}: ${error.message}`,
    );
    const mqConfig = this._getConfig();
    const maxRebaseAttempts = mqConfig.maxRebaseAttempts || 2;
    const conflictResolution = mqConfig.conflictResolution || "llm";

    const isConflict = CONFLICT_RE.test(error.message);

    if (
      !isConflict ||
      conflictResolution === "manual" ||
      entry.rebaseCount >= maxRebaseAttempts
    ) {
      await this._failEntry(entry, queue, project, error.message);
      return;
    }

    this.broadcastWs("mergeQueue:conflict", {
      taskId: entry.taskId,
      project,
      files: this._extractConflictFiles(error.message),
    });

    entry.rebaseCount++;
    entry.status = "rebasing";

    if (this.updateTaskMeta) {
      this.updateTaskMeta(entry.taskId, {
        mergeQueue: "rebasing",
        mergeRebaseCount: entry.rebaseCount,
      }).catch(() => {});
    }

    this.broadcastWs("mergeQueue:rebasing", {
      taskId: entry.taskId,
      project,
      attempt: entry.rebaseCount,
      maxAttempts: maxRebaseAttempts,
    });
    this.log(
      `[merge-queue] rebasing ${entry.taskId} (attempt ${entry.rebaseCount}/${maxRebaseAttempts})`,
    );

    try {
      const task = await this.loadTask(entry.taskId);
      if (!task) throw new Error(`task not found: ${entry.taskId}`);
      const projects = this.normalizeProjects(task);

      await this.removeWorktrees(entry.taskId, projects);

      // rebase all projects, not just the first
      const projectPath = projects[0]?.path;
      const fp = new this.ForgePipeline({
        taskId: entry.taskId,
        project: projectPath,
        autopilot: true,
        resumeFrom: "implement",
      });

      this.activeForgePipelines?.set(entry.taskId, fp);
      this.inflightTasks?.add(entry.taskId);

      this.wireEvents(fp, (event, data) => {
        this.broadcastWs(event, { ...data, taskId: entry.taskId });
      });

      const dag = await fp.run();
      if (this.drainTaskMetaQueue) {
        await this.drainTaskMetaQueue(entry.taskId);
      }

      this.activeForgePipelines?.delete(entry.taskId);
      this.inflightTasks?.delete(entry.taskId);

      const status = dag.status;
      // rebase succeeded: deliver may return "merge_queued" (enqueue is no-op since entry is current)
      if (
        status === "done" ||
        status === "auto_merged" ||
        status === "merge_queued"
      ) {
        // re-queue for merge attempt
        entry.status = "queued";
        this.log(
          `[merge-queue] rebase complete for ${entry.taskId}, re-attempting merge`,
        );
        queue.entries.unshift(entry);
        queue.current = null;
        await this.save();
        this._scheduleNext(project);
      } else {
        // pipeline didn't succeed → fail
        this._cleanupDaemonState(entry.taskId);
        queue.current = null;

        this.broadcastWs("mergeQueue:failed", {
          taskId: entry.taskId,
          project,
          error: `rebase pipeline status: ${status}`,
        });

        try {
          await this.moveTask(
            entry.taskId,
            "running",
            status === "review" ? "review" : "failed",
            {
              mergeQueue: status === "review" ? "conflict" : null,
              mergeRebaseCount: null,
            },
          );
        } catch (moveError) {
          this.log(
            `[merge-queue] moveTask error for ${entry.taskId}: ${moveError.message}`,
          );
        }

        await this.save();
        this._cleanupEmptyQueue(project);
        if (queue.entries.length > 0) {
          this._scheduleNext(project);
        }
      }
    } catch (rebaseError) {
      this.log(
        `[merge-queue] rebase error for ${entry.taskId}: ${rebaseError.message}`,
      );
      this.activeForgePipelines?.delete(entry.taskId);
      this.inflightTasks?.delete(entry.taskId);
      await this._failEntry(entry, queue, project, rebaseError.message);
    }
  }

  async _failEntry(entry, queue, project, errorMessage) {
    queue.current = null;
    this._cleanupDaemonState(entry.taskId);

    if (this.updateTaskMeta) {
      this.updateTaskMeta(entry.taskId, { mergeQueue: "conflict" }).catch(
        () => {},
      );
    }

    this.broadcastWs("mergeQueue:failed", {
      taskId: entry.taskId,
      project,
      error: errorMessage,
    });
    this.broadcastWs("mergeQueue:updated", {
      project,
      queueLength: queue.entries.length,
      processing: false,
    });

    this.log(
      `[merge-queue] ${entry.taskId} failed (${entry.rebaseCount} rebase attempt(s)), moving to review`,
    );
    try {
      await this.moveTask(entry.taskId, "running", "review", {
        mergeQueue: "conflict",
        mergeRebaseCount: null,
      });
    } catch (moveError) {
      this.log(
        `[merge-queue] moveTask to review failed for ${entry.taskId}: ${moveError.message}`,
      );
    }

    await this.save();
    this._cleanupEmptyQueue(project);
    if (queue.entries.length > 0) {
      this._scheduleNext(project);
    }
  }

  _extractConflictFiles(errorMessage) {
    const matches = errorMessage.match(
      /CONFLICT \(content\): Merge conflict in (.+)/g,
    );
    if (!matches) return [];
    return matches.map((m) =>
      m.replace(/CONFLICT \(content\): Merge conflict in /, ""),
    );
  }

  remove(taskId) {
    for (const [project, queue] of this.projectQueues) {
      // refuse to remove currently processing entry
      if (queue.current && queue.current.taskId === taskId) {
        this.log(
          `[merge-queue] cannot remove ${taskId}: currently ${queue.current.status}`,
        );
        return null;
      }
      const index = queue.entries.findIndex((e) => e.taskId === taskId);
      if (index !== -1) {
        const removed = queue.entries.splice(index, 1)[0];
        this.broadcastWs("mergeQueue:updated", {
          project,
          queueLength: queue.entries.length,
          processing: !!queue.current,
        });
        this.log(`[merge-queue] removed ${taskId} from queue`);
        this.save().catch((e) =>
          this.log(`[merge-queue] save error: ${e.message}`),
        );
        // if we removed the head of the waiting queue and nothing is processing, kick off next
        if (!queue.current && queue.entries.length > 0) {
          this._scheduleNext(project);
        }
        this._cleanupEmptyQueue(project);
        return removed;
      }
    }
    return null;
  }

  retry(_taskId) {
    // conflict entries are already removed from queue by _failEntry,
    // so always return false — handler will re-enqueue from "review" state
    return false;
  }

  skip(taskId) {
    const removed = this.remove(taskId);
    if (removed) {
      this.log(`[merge-queue] skipped ${taskId}`);
      if (this.updateTaskMeta) {
        this.updateTaskMeta(taskId, {
          mergeQueue: null,
          mergeRebaseCount: null,
        }).catch(() => {});
      }
    }
    return !!removed;
  }

  getStatus(project) {
    if (project) {
      const queue = this.projectQueues.get(project);
      if (!queue)
        return {
          project,
          processing: false,
          current: null,
          entries: [],
          queueLength: 0,
        };
      return {
        project,
        processing: !!queue.current,
        current: queue.current
          ? {
              taskId: queue.current.taskId,
              status: queue.current.status,
              priority: queue.current.priority,
              enqueuedAt: queue.current.enqueuedAt,
              rebaseCount: queue.current.rebaseCount,
            }
          : null,
        entries: queue.entries.map((e) => ({
          taskId: e.taskId,
          status: e.status,
          priority: e.priority,
          enqueuedAt: e.enqueuedAt,
          rebaseCount: e.rebaseCount,
        })),
        queueLength: queue.entries.length + (queue.current ? 1 : 0),
      };
    }

    const result = {};
    for (const [proj, queue] of this.projectQueues) {
      if (queue.entries.length === 0 && !queue.current) continue;
      result[proj] = {
        processing: !!queue.current,
        current: queue.current
          ? {
              taskId: queue.current.taskId,
              status: queue.current.status,
              priority: queue.current.priority,
              enqueuedAt: queue.current.enqueuedAt,
              rebaseCount: queue.current.rebaseCount,
            }
          : null,
        entries: queue.entries.map((e) => ({
          taskId: e.taskId,
          status: e.status,
          priority: e.priority,
          enqueuedAt: e.enqueuedAt,
          rebaseCount: e.rebaseCount,
        })),
        queueLength: queue.entries.length + (queue.current ? 1 : 0),
      };
    }
    return result;
  }

  async load() {
    this.projectQueues.clear();
    try {
      const data = JSON.parse(await readFile(MERGE_QUEUE_PATH, "utf-8"));
      if (data && typeof data === "object") {
        for (const [project, queueData] of Object.entries(data)) {
          const entries = Array.isArray(queueData.entries)
            ? queueData.entries
            : [];
          // include persisted current entry (was processing when daemon stopped)
          if (queueData.current) {
            queueData.current.status = "queued";
            entries.unshift(queueData.current);
          }
          for (const entry of entries) {
            if (entry.status === "merging" || entry.status === "rebasing") {
              entry.status = "queued";
            }
          }
          if (entries.length > 0) {
            this.projectQueues.set(project, { current: null, entries });
          }
        }
        this.log(
          `[merge-queue] loaded ${this.projectQueues.size} project queue(s)`,
        );

        for (const [project] of this.projectQueues) {
          this._scheduleNext(project);
        }
      }
    } catch (e) {
      if (e.code !== "ENOENT") {
        this.log(`[merge-queue] load error: ${e.message}`);
      }
    }
  }

  async save() {
    // snapshot state synchronously to avoid reference mutation during async write
    const snapshot = {};
    for (const [project, queue] of this.projectQueues) {
      if (queue.entries.length > 0 || queue.current) {
        snapshot[project] = {
          current: queue.current ? { ...queue.current } : null,
          entries: queue.entries.map((e) => ({ ...e })),
        };
      }
    }

    const op = this._saveQueue
      .catch(() => {})
      .then(async () => {
        try {
          const content = `${JSON.stringify(snapshot, null, 2)}\n`;
          const tmpPath = `${MERGE_QUEUE_PATH}.tmp`;
          await writeFile(tmpPath, content);
          await rename(tmpPath, MERGE_QUEUE_PATH);
        } catch (e) {
          this.log(`[merge-queue] save error: ${e.message}`);
          throw e;
        }
      });
    this._saveQueue = op.catch((e) =>
      this.log(`[merge-queue] save queue error: ${e.message}`),
    );
    return op;
  }
}

module.exports = { MergeQueueManager };
