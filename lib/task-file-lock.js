const _taskFileOpChains = new Map();

function enqueueTaskFileOp(taskId, operation, options = {}) {
  const normalizedTaskId =
    typeof taskId === "string" ? taskId.trim() : String(taskId || "");
  if (!normalizedTaskId) {
    throw new Error("enqueueTaskFileOp: taskId required");
  }
  if (typeof operation !== "function") {
    throw new Error(
      `enqueueTaskFileOp: operation must be a function (task: ${normalizedTaskId})`,
    );
  }

  const log = typeof options.log === "function" ? options.log : () => {};
  const label =
    typeof options.label === "string" && options.label
      ? options.label
      : "task-file-op";

  const previous = _taskFileOpChains.get(normalizedTaskId) || Promise.resolve();
  const current = previous
    .catch((e) => {
      log(
        `[${normalizedTaskId}] ${label}: prior operation failed (continuing): ${e.message}`,
      );
    })
    .then(operation);

  _taskFileOpChains.set(normalizedTaskId, current);
  const release = () => {
    if (_taskFileOpChains.get(normalizedTaskId) === current) {
      _taskFileOpChains.delete(normalizedTaskId);
    }
  };
  current.then(release, release).catch((e) => {
    log(`[${normalizedTaskId}] ${label}: lock cleanup error: ${e.message}`);
  });
  return current;
}

module.exports = { enqueueTaskFileOp };
