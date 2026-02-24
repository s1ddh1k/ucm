const crypto = require("node:crypto");
const { readFile, writeFile, mkdir, rename, rm } = require("node:fs/promises");
const path = require("node:path");
const { FORGE_DIR } = require("./constants");

const _taskSaveChains = new Map();

function generateForgeId() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand = crypto.randomBytes(2).toString("hex");
  return `forge-${date}-${rand}`;
}

function makeTempPath(filePath) {
  const nonce = crypto.randomBytes(4).toString("hex");
  return `${filePath}.${process.pid}.${Date.now()}.${nonce}.tmp`;
}

class TaskDag {
  constructor({
    id,
    status = "pending",
    pipeline,
    spec,
    title,
    tasks = [],
    createdAt,
    startedAt,
    completedAt,
    updatedAt,
    currentStage,
    stageHistory,
    warnings,
    tokenUsage,
  } = {}) {
    this.id = id || generateForgeId();
    this.status = status;
    this.pipeline = pipeline;
    this.title = title || null;
    this.spec = spec || null;
    this.tasks = tasks;
    this.createdAt = createdAt || new Date().toISOString();
    this.startedAt = startedAt || null;
    this.completedAt = completedAt || null;
    this.updatedAt = updatedAt || this.createdAt;
    this.currentStage = currentStage || null;
    this.stageHistory = stageHistory || [];
    this.warnings = warnings || [];
    this.tokenUsage = tokenUsage || { input: 0, output: 0 };
  }

  addTask({ id, title, description, blockedBy = [], estimatedFiles = [] }) {
    if (this.tasks.some((t) => t.id === id)) {
      throw new Error(`duplicate task id: ${id}`);
    }
    const existingIds = new Set(this.tasks.map((t) => t.id));
    const invalidDeps = blockedBy.filter(
      (depId) => depId !== id && !existingIds.has(depId),
    );
    if (invalidDeps.length > 0) {
      this.warnings.push(
        `task ${id}: unresolved blockedBy refs: ${invalidDeps.join(", ")}`,
      );
    }
    this.tasks.push({
      id,
      title,
      description: description || "",
      status: "pending",
      blockedBy,
      estimatedFiles,
      startedAt: null,
      completedAt: null,
      worktreeCwd: null,
    });
  }

  updateTaskStatus(taskId, status) {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error(`task not found: ${taskId}`);
    task.status = status;
    if (status === "in_progress" && !task.startedAt) {
      task.startedAt = new Date().toISOString();
    }
    if (status === "done" || status === "failed") {
      task.completedAt = new Date().toISOString();
    }
  }

  addTokenUsage(input, output) {
    this.tokenUsage.input += input || 0;
    this.tokenUsage.output += output || 0;
  }

  totalTokens() {
    return this.tokenUsage.input + this.tokenUsage.output;
  }

  isOverBudget(budget) {
    if (!budget || budget <= 0) return false;
    return this.totalTokens() > budget;
  }

  getReadyTasks() {
    return this.tasks.filter((task) => {
      if (task.status !== "pending") return false;
      return task.blockedBy.every((depId) => {
        const dep = this.tasks.find((t) => t.id === depId);
        return dep && dep.status === "done";
      });
    });
  }

  getWaves() {
    const waves = [];
    const completed = new Set();
    const remaining = new Set(this.tasks.map((t) => t.id));

    while (remaining.size > 0) {
      const wave = [];
      for (const taskId of remaining) {
        const task = this.tasks.find((t) => t.id === taskId);
        const ready = task.blockedBy.every((depId) => completed.has(depId));
        if (ready) wave.push(taskId);
      }
      if (wave.length === 0) {
        const cycleIds = [...remaining].join(", ");
        throw new Error(`cycle detected in task DAG: ${cycleIds}`);
      }
      waves.push(wave);
      for (const taskId of wave) {
        remaining.delete(taskId);
        completed.add(taskId);
      }
    }

    return waves;
  }

  validateDeps() {
    const ids = new Set(this.tasks.map((t) => t.id));
    const dangling = [];
    for (const task of this.tasks) {
      for (const depId of task.blockedBy) {
        if (!ids.has(depId)) dangling.push({ task: task.id, dep: depId });
      }
    }
    if (dangling.length > 0) {
      const details = dangling.map((d) => `${d.task} → ${d.dep}`).join(", ");
      throw new Error(`dangling blockedBy references: ${details}`);
    }
  }

  allDone() {
    return this.tasks.every((t) => t.status === "done");
  }

  anyFailed() {
    return this.tasks.some((t) => t.status === "failed");
  }

  recordStage(stage, status, durationMs, stageTokenUsage) {
    this.stageHistory.push({
      stage,
      status,
      durationMs,
      timestamp: new Date().toISOString(),
      tokenUsage: stageTokenUsage || null,
    });
    this.updatedAt = new Date().toISOString();
  }

  toJSON() {
    return {
      id: this.id,
      status: this.status,
      pipeline: this.pipeline,
      title: this.title,
      spec: this.spec,
      tasks: this.tasks,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      updatedAt: this.updatedAt,
      currentStage: this.currentStage,
      stageHistory: this.stageHistory,
      warnings: this.warnings,
      tokenUsage: this.tokenUsage,
    };
  }

  async save() {
    const saveKey = this.id || "__unknown__";
    const prev = _taskSaveChains.get(saveKey) || Promise.resolve();
    const current = prev
      .catch((e) => {
        console.error(
          `[TaskDag:${saveKey}] save queue error (continuing): ${e.message}`,
        );
      })
      .then(() => this._doSave());
    _taskSaveChains.set(saveKey, current);
    this._saving = current; // kept for compatibility with existing tests/callers
    try {
      await current;
    } finally {
      if (_taskSaveChains.get(saveKey) === current) {
        _taskSaveChains.delete(saveKey);
      }
    }
  }

  async _doSave() {
    this.updatedAt = new Date().toISOString();
    const dir = path.join(FORGE_DIR, this.id);
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, "task.json");
    const tmpPath = makeTempPath(filePath);
    try {
      await writeFile(tmpPath, `${JSON.stringify(this.toJSON(), null, 2)}\n`);
      await rename(tmpPath, filePath);
    } catch (e) {
      try {
        await rm(tmpPath, { force: true });
      } catch {
        // best-effort cleanup only
      }
      const wrapped = new Error(
        `task save failed: ${this.id} (file: ${filePath}) (${e.message})`,
      );
      wrapped.code = e.code;
      wrapped.taskId = this.id;
      wrapped.filePath = filePath;
      wrapped.cause = e;
      throw wrapped;
    }
  }

  static async load(id) {
    const filePath = path.join(FORGE_DIR, id, "task.json");
    let data;
    try {
      data = JSON.parse(await readFile(filePath, "utf-8"));
    } catch (e) {
      if (e.code === "ENOENT") throw new Error(`task not found: ${id}`);
      throw new Error(`task load failed: ${id} (${e.message})`);
    }
    return new TaskDag(data);
  }

  static async list() {
    const { readdir } = require("node:fs/promises");
    try {
      const entries = await readdir(FORGE_DIR);
      const tasks = [];
      for (const entry of entries) {
        if (!entry.startsWith("forge-")) continue;
        try {
          const dag = await TaskDag.load(entry);
          tasks.push(dag);
        } catch (e) {
          console.error(`[TaskDag] failed to load ${entry}: ${e.message}`);
        }
      }
      return tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch (e) {
      if (e.code === "ENOENT") return [];
      console.error(`[TaskDag] list failed: ${e.message}`);
      return [];
    }
  }
}

module.exports = { TaskDag, generateForgeId };
