const { execFileSync } = require("node:child_process");
const {
  readFile,
  writeFile,
  rename,
  mkdir,
  rm,
  stat: statFile,
  unlink,
  access,
} = require("node:fs/promises");
const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const { WORKTREES_DIR, ARTIFACTS_DIR } = require("./constants");
const { git, expandHome, isGitRepo } = require("../ucmd-task.js");
const { enqueueTaskFileOp } = require("../task-file-lock.js");

// worktree 동시 접근 방지를 위한 lockfile
const LOCK_TIMEOUT_MS = 5 * 60 * 1000;
const RETRYABLE_WORKTREE_CODES = new Set(["ELOCKED", "EAGAIN", "EBUSY"]);

function errorDetail(error) {
  return String(error?.stderr || error?.message || error || "").trim();
}

function isLockContentionError(error) {
  return (
    error?.code === "ELOCKED" ||
    /worktree locked for task/i.test(String(error?.message || ""))
  );
}

function parseLockOwner(lockContent) {
  const firstLine = String(lockContent || "")
    .split("\n")[0]
    .trim();
  if (!firstLine) return { pid: null, token: null };
  const [pidPart, tokenPart = null] = firstLine.split(":", 2);
  const pid = Number.parseInt(pidPart, 10);
  return {
    pid: Number.isInteger(pid) && pid > 0 ? pid : null,
    token: tokenPart || null,
  };
}

function makeTempPath(filePath) {
  const nonce = crypto.randomBytes(4).toString("hex");
  return `${filePath}.${process.pid}.${Date.now()}.${nonce}.tmp`;
}

async function writeFileAtomic(filePath, content) {
  const tmpPath = makeTempPath(filePath);
  try {
    await writeFile(tmpPath, content);
    await rename(tmpPath, filePath);
  } catch (e) {
    try {
      await rm(tmpPath, { force: true });
    } catch {
      // best-effort cleanup only
    }
    throw e;
  }
}

async function acquireLock(taskId) {
  const lockPath = path.join(WORKTREES_DIR, `${taskId}.lock`);
  await mkdir(WORKTREES_DIR, { recursive: true });

  // stale lock 체크: PID가 죽었거나 타임아웃 초과 시 제거
  try {
    const lockStat = await statFile(lockPath);
    const timedOut = Date.now() - lockStat.mtimeMs > LOCK_TIMEOUT_MS;
    let isStale = false;

    // PID가 lock 파일에 기록되어 있으면 프로세스 생존 여부를 항상 먼저 확인
    // (스테이지 타임아웃이 lock 타임아웃보다 길 수 있으므로 PID 우선)
    let pidChecked = false;
    try {
      const content = await readFile(lockPath, "utf-8");
      const { pid } = parseLockOwner(content);
      if (pid) {
        pidChecked = true;
        try {
          process.kill(pid, 0);
        } catch {
          isStale = true;
        }
      }
    } catch {
      /* lock 파일 읽기 실패 → 타임아웃 기반 폴백 */
    }

    // PID 확인이 불가능한 경우에만 타임아웃 기반 폴백
    if (!pidChecked && timedOut) {
      isStale = true;
    }

    if (isStale) {
      await unlink(lockPath);
    }
  } catch (e) {
    if (e.code !== "ENOENT")
      console.error(
        `[acquireLock] stale lock check failed for ${taskId}: ${e.message}`,
      );
  }

  try {
    const ownerToken = crypto.randomBytes(8).toString("hex");
    await writeFile(
      lockPath,
      `${process.pid}:${ownerToken}\n${new Date().toISOString()}\n`,
      {
        flag: "wx",
      },
    );
    return { taskId, lockPath, ownerToken };
  } catch (e) {
    if (e.code === "EEXIST") {
      const wrapped = new Error(
        `worktree locked for task ${taskId}. Another operation may be in progress.`,
      );
      wrapped.code = "ELOCKED";
      wrapped.taskId = taskId;
      wrapped.stage = "worktree-lock";
      wrapped.filePath = lockPath;
      wrapped.retryable = true;
      wrapped.cause = e;
      throw wrapped;
    }
    throw e;
  }
}

async function releaseLock(lockRef) {
  const isObjectRef =
    lockRef && typeof lockRef === "object" && !Array.isArray(lockRef);
  const taskId = isObjectRef ? lockRef.taskId : lockRef;
  const lockPath =
    (isObjectRef && lockRef.lockPath) ||
    path.join(WORKTREES_DIR, `${taskId}.lock`);
  const ownerToken = isObjectRef ? lockRef.ownerToken : null;

  try {
    if (ownerToken) {
      const current = parseLockOwner(await readFile(lockPath, "utf-8"));
      if (current.token && current.token !== ownerToken) {
        console.error(
          `[releaseLock] lock ownership changed for ${taskId}; skipping unlock`,
        );
        return;
      }
    }
    await unlink(lockPath);
  } catch (e) {
    if (e.code === "ENOENT") return;
    try {
      await rm(lockPath, { force: true });
    } catch (cleanupErr) {
      console.error(
        `[releaseLock] failed to release lock for ${taskId} (path: ${lockPath}): ${e.message}; cleanup: ${cleanupErr.message}`,
      );
      return;
    }
    console.error(
      `[releaseLock] lock release required fallback rm for ${taskId} (path: ${lockPath}): ${e.message}`,
    );
  }
}

// 민감 정보 패턴 (source + flags 분리 저장하여 매 호출마다 fresh regex 생성)
const SENSITIVE_PATTERN_DEFS = [
  {
    source: "(?:api[_-]?key|apikey)\\s*[:=]\\s*[\"']?[\\w\\-]{20,}",
    flags: "gi",
  },
  {
    source: "(?:secret|password|passwd|token)\\s*[:=]\\s*[\"']?[\\w\\-]{8,}",
    flags: "gi",
  },
  {
    source:
      "(?:AWS_SECRET_ACCESS_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY)\\s*[:=]\\s*\\S+",
    flags: "gi",
  },
  { source: "Bearer\\s+[\\w\\-.]+", flags: "g" },
  { source: "ghp_[\\w]{36}", flags: "g" },
  { source: "sk-[\\w]{32,}", flags: "g" },
];

function sanitizeContent(content) {
  if (!content || typeof content !== "string") return content;
  let sanitized = content;
  for (const def of SENSITIVE_PATTERN_DEFS) {
    const pattern = new RegExp(def.source, def.flags);
    sanitized = sanitized.replace(pattern, (match) => {
      const prefix = match.slice(0, Math.min(10, Math.floor(match.length / 3)));
      return `${prefix}[REDACTED]`;
    });
  }
  return sanitized;
}

async function rollbackWorktreeSetup({
  taskId,
  branchName,
  taskWorktreeDir,
  createdProjects,
}) {
  const rollbackErrors = [];

  for (let i = createdProjects.length - 1; i >= 0; i--) {
    const created = createdProjects[i];
    try {
      git(
        ["worktree", "remove", "--force", created.worktreePath],
        created.originPath,
      );
    } catch (e) {
      const msg = errorDetail(e);
      if (
        !msg.includes("not a working tree") &&
        !msg.includes("is not a valid")
      ) {
        rollbackErrors.push(
          `worktree remove ${created.projectName}: ${msg.slice(0, 160)}`,
        );
      }
    }
    try {
      git(["worktree", "prune"], created.originPath);
    } catch (e) {
      rollbackErrors.push(
        `worktree prune ${created.projectName}: ${errorDetail(e).slice(0, 160)}`,
      );
    }

    if (!created.branchCreated) continue;
    try {
      git(["branch", "-D", branchName], created.originPath);
    } catch (e) {
      const msg = errorDetail(e);
      if (!msg.includes("not found")) {
        rollbackErrors.push(
          `branch delete ${created.projectName}: ${msg.slice(0, 160)}`,
        );
      }
    }
  }

  try {
    await rm(taskWorktreeDir, { recursive: true, force: true });
  } catch (e) {
    if (e.code !== "ENOENT") {
      rollbackErrors.push(`dir remove: ${e.message.slice(0, 160)}`);
    }
  }

  if (rollbackErrors.length > 0) {
    console.error(
      `[createWorktrees] rollback had errors for ${taskId}: ${rollbackErrors.join("; ")}`,
    );
  }
}

async function createWorktrees(taskId, projects) {
  const lockHandle = await acquireLock(taskId);
  try {
    const taskWorktreeDir = path.join(WORKTREES_DIR, taskId);
    await mkdir(taskWorktreeDir, { recursive: true });

    const branchName = `ucm/${taskId}`;
    const workspaceProjects = [];
    const wsPath = path.join(taskWorktreeDir, "workspace.json");
    const createdProjects = [];

    try {
      for (const project of projects) {
        const originPath = path.resolve(project.path);
        const worktreePath = path.join(taskWorktreeDir, project.name);

        const baseCommit = git(["rev-parse", "HEAD"], originPath);

        let branchCreated = false;
        try {
          git(["branch", branchName], originPath);
          branchCreated = true;
        } catch (e) {
          if (!e.stderr?.includes("already exists")) throw e;
        }

        git(["worktree", "add", worktreePath, branchName], originPath);

        createdProjects.push({
          projectName: project.name,
          originPath,
          worktreePath,
          branchCreated,
        });
        workspaceProjects.push({
          name: project.name,
          path: worktreePath,
          origin: originPath,
          role: project.role || "primary",
          baseCommit,
        });
      }

      const workspace = { taskId, projects: workspaceProjects };
      await writeFileAtomic(wsPath, `${JSON.stringify(workspace, null, 2)}\n`);
      return workspace;
    } catch (e) {
      await rollbackWorktreeSetup({
        taskId,
        branchName,
        taskWorktreeDir,
        createdProjects,
      });

      const wrapped = new Error(
        `[createWorktrees] failed for task ${taskId} (stage: setup, filePath: ${wsPath}): ${errorDetail(e).slice(0, 300)}`,
      );
      wrapped.code = e.code;
      wrapped.taskId = taskId;
      wrapped.stage = "worktree-setup";
      wrapped.filePath = wsPath;
      wrapped.retryable = RETRYABLE_WORKTREE_CODES.has(e.code);
      wrapped.cause = e;
      throw wrapped;
    }
  } finally {
    await releaseLock(lockHandle);
  }
}

async function loadWorkspace(taskId) {
  const workspacePath = path.join(WORKTREES_DIR, taskId, "workspace.json");
  try {
    return JSON.parse(await readFile(workspacePath, "utf-8"));
  } catch (e) {
    if (e.code !== "ENOENT")
      console.error(
        `[loadWorkspace] failed to load workspace for ${taskId}: ${e.message}`,
      );
    return null;
  }
}

function loadWorkspaceSync(taskId) {
  const workspacePath = path.join(WORKTREES_DIR, taskId, "workspace.json");
  try {
    return JSON.parse(fs.readFileSync(workspacePath, "utf-8"));
  } catch (e) {
    if (e.code !== "ENOENT")
      console.error(
        `[loadWorkspaceSync] failed to load workspace for ${taskId}: ${e.message}`,
      );
    return null;
  }
}

// 머지 시 경고할 민감 파일 패턴
const SENSITIVE_FILE_PATTERNS = [
  /\.env($|\.)/,
  /\.key$/,
  /\.pem$/,
  /\.p12$/,
  /\.pfx$/,
  /credentials\.json$/,
  /\.secret$/,
  /id_rsa/,
  /\.keystore$/,
];

async function mergeWorktrees(taskId, projects, { log = () => {} } = {}) {
  const lockHandle = await acquireLock(taskId);
  try {
    const branchName = `ucm/${taskId}`;
    const workspace = await loadWorkspace(taskId);
    const errors = [];

    for (const project of projects) {
      const originPath = path.resolve(project.origin || project.path);
      const worktreePath = path.join(WORKTREES_DIR, taskId, project.name);

      try {
        const currentBranch = git(
          ["rev-parse", "--abbrev-ref", "HEAD"],
          originPath,
        );

        const status = git(["status", "--porcelain"], worktreePath);
        if (status) {
          git(["add", "-A"], worktreePath);
          git(
            ["commit", "-m", `chore: uncommitted changes for ${taskId}`],
            worktreePath,
          );
          log(`auto-committed uncommitted changes in ${project.name}`);
        }

        const wsProject = workspace?.projects?.find(
          (p) => p.name === project.name,
        );
        const baseCommit = wsProject?.baseCommit;
        const tipCommit = git(["rev-parse", "HEAD"], worktreePath);

        if (baseCommit && tipCommit === baseCommit) {
          log(`skip merge ${project.name}: no changes on ${branchName}`);
        } else {
          // 민감 파일 수정 경고
          try {
            const diffArgs = baseCommit
              ? ["diff", "--name-only", baseCommit]
              : ["diff", "--name-only", "HEAD"];
            const changed = git(diffArgs, worktreePath)
              .split("\n")
              .filter(Boolean);
            const sensitiveFiles = changed.filter((f) =>
              SENSITIVE_FILE_PATTERNS.some((p) => p.test(f)),
            );
            if (sensitiveFiles.length > 0) {
              log(
                `[WARN] sensitive files modified: ${sensitiveFiles.join(", ")}`,
              );
            }
          } catch (e) {
            log(
              `[warn] sensitive file check failed for ${project.name}: ${(e.stderr || e.message || "").slice(0, 200)}`,
            );
          }
          const originStatus = git(["status", "--porcelain"], originPath);
          let stashed = false;
          if (originStatus) {
            git(["stash", "push", "-m", `ucm-merge-${taskId}`], originPath);
            stashed = true;
            log(`stashed changes in ${project.name} before merge`);
          }
          try {
            git(["merge", branchName, "--no-edit"], originPath);
            log(`merged ${project.name}: ${branchName} → ${currentBranch}`);
          } finally {
            if (stashed) {
              try {
                git(["stash", "pop"], originPath);
                log(`restored stashed changes in ${project.name}`);
              } catch {
                log(
                  `[warn] stash pop conflict in ${project.name}, run 'git stash pop' manually`,
                );
              }
            }
          }
        }

        git(["worktree", "remove", worktreePath], originPath);
        git(["branch", "-d", branchName], originPath);
      } catch (e) {
        const msg = e.stderr || e.message;
        errors.push({ project: project.name, error: msg });
      }
    }

    if (errors.length > 0) {
      const details = errors.map((e) => `${e.project}: ${e.error}`).join("; ");
      throw new Error(`merge failed: ${details}`);
    }

    try {
      await rm(path.join(WORKTREES_DIR, taskId), { recursive: true });
    } catch (e) {
      if (e.code !== "ENOENT")
        log(`[warn] worktree dir cleanup failed for ${taskId}: ${e.message}`);
    }
  } finally {
    await releaseLock(lockHandle);
  }
}

async function removeWorktrees(taskId, projects) {
  const lockHandle = await acquireLock(taskId);
  try {
    const branchName = `ucm/${taskId}`;

    for (const project of projects) {
      const originPath = path.resolve(
        expandHome(project.origin || project.path),
      );
      const worktreePath = path.join(WORKTREES_DIR, taskId, project.name);

      try {
        git(["worktree", "remove", "--force", worktreePath], originPath);
      } catch (e) {
        const msg = e.stderr || e.message || "";
        if (
          !msg.includes("not a working tree") &&
          !msg.includes("is not a valid")
        ) {
          console.error(
            `[removeWorktrees] worktree remove failed for ${taskId}/${project.name}: ${msg.slice(0, 200)}`,
          );
        }
      }
      try {
        git(["worktree", "prune"], originPath);
      } catch (e) {
        console.error(
          `[removeWorktrees] worktree prune failed for ${taskId}/${project.name}: ${(e.stderr || e.message || "").slice(0, 200)}`,
        );
      }
      try {
        git(["branch", "-D", branchName], originPath);
      } catch (e) {
        const msg = e.stderr || e.message || "";
        if (!msg.includes("not found")) {
          console.error(
            `[removeWorktrees] branch delete failed for ${taskId}/${project.name}: ${msg.slice(0, 200)}`,
          );
        }
      }
    }

    try {
      await rm(path.join(WORKTREES_DIR, taskId), { recursive: true });
    } catch (e) {
      if (e.code !== "ENOENT") {
        console.error(
          `[removeWorktrees] directory rm failed for ${taskId}: ${e.message}`,
        );
      }
    }
  } finally {
    await releaseLock(lockHandle);
  }
}

async function getWorktreeDiff(taskId, projects) {
  const workspace = await loadWorkspace(taskId);
  const diffs = [];

  for (const project of projects) {
    const wsProject = workspace?.projects?.find((p) => p.name === project.name);
    if (!workspace || !wsProject) {
      diffs.push({
        project: project.name,
        diff: "(worktree metadata unavailable: task workspace not found)",
      });
      continue;
    }

    const worktreePath = path.join(WORKTREES_DIR, taskId, project.name);
    try {
      await access(worktreePath);
    } catch (e) {
      if (e?.code === "ENOENT") {
        diffs.push({
          project: project.name,
          diff: "(worktree missing: no diff available for this task)",
        });
        continue;
      }
      diffs.push({
        project: project.name,
        diff: `(error: unable to access worktree: ${e.message})`,
      });
      continue;
    }

    const baseCommit = wsProject?.baseCommit;

    try {
      const args = baseCommit ? ["diff", baseCommit] : ["diff", "HEAD"];
      const diff = git(args, worktreePath);
      diffs.push({ project: project.name, diff: diff || "(no changes)" });
    } catch (e) {
      diffs.push({ project: project.name, diff: `(error: ${e.message})` });
    }
  }

  return diffs;
}

function getWorktreeDiffStat(taskId, projects) {
  const workspace = loadWorkspaceSync(taskId);
  const stats = [];
  for (const project of projects) {
    const worktreePath = path.join(WORKTREES_DIR, taskId, project.name);
    const wsProject = workspace?.projects?.find((p) => p.name === project.name);
    const baseCommit = wsProject?.baseCommit;
    try {
      const args = baseCommit
        ? ["diff", "--stat", baseCommit]
        : ["diff", "--stat", "HEAD"];
      const output = execFileSync("git", args, {
        cwd: worktreePath,
        encoding: "utf-8",
      }).trim();
      stats.push({ project: project.name, stat: output || "(no changes)" });
    } catch (e) {
      stats.push({
        project: project.name,
        stat: `(error: ${(e.stderr || e.message || "unknown").slice(0, 100)})`,
      });
    }
  }
  return stats;
}

function getWorktreeCwd(taskId, projects) {
  const taskWorktreeDir = path.join(WORKTREES_DIR, taskId);
  if (projects.length === 1) {
    return path.join(taskWorktreeDir, projects[0].name);
  }
  return taskWorktreeDir;
}

async function initArtifacts(taskId, taskContent) {
  const artifactDir = path.join(ARTIFACTS_DIR, taskId);
  await mkdir(artifactDir, { recursive: true });

  const taskPath = path.join(artifactDir, "task.md");
  await writeFileAtomic(taskPath, taskContent);

  const memory = { timeline: [], metrics: { totalSpawns: 0, result: null } };
  const memoryPath = path.join(artifactDir, "memory.json");
  await writeFileAtomic(memoryPath, `${JSON.stringify(memory, null, 2)}\n`);

  try {
    git(["init"], artifactDir);
    git(["add", "-A"], artifactDir);
    git(["commit", "-m", "init: task submitted"], artifactDir);
  } catch (e) {
    console.error(
      `[initArtifacts] git init failed for ${taskId}: ${(e.stderr || e.message || "").slice(0, 200)}`,
    );
  }
}

async function saveArtifact(taskId, filename, content) {
  const artifactDir = path.join(ARTIFACTS_DIR, taskId);
  await mkdir(artifactDir, { recursive: true });
  const safeContent = sanitizeContent(content);
  const filePath = path.join(artifactDir, filename);
  await writeFileAtomic(filePath, safeContent);
  try {
    git(["add", filename], artifactDir);
    git(["commit", "-m", `save: ${filename}`], artifactDir);
  } catch (e) {
    const msg = e.stderr || e.message || "";
    if (!msg.includes("nothing to commit"))
      console.error(
        `[saveArtifact] git commit failed for ${taskId}/${filename}: ${msg.slice(0, 200)}`,
      );
  }
}

async function loadArtifact(taskId, filename) {
  return readFile(path.join(ARTIFACTS_DIR, taskId, filename), "utf-8");
}

async function updateMemory(taskId, updates) {
  return enqueueTaskFileOp(
    taskId,
    async () => {
      const artifactDir = path.join(ARTIFACTS_DIR, taskId);
      await mkdir(artifactDir, { recursive: true });
      const memoryPath = path.join(artifactDir, "memory.json");
      let memory;
      try {
        memory = JSON.parse(await readFile(memoryPath, "utf-8"));
      } catch (e) {
        if (e.code !== "ENOENT") {
          console.error(
            `[updateMemory] failed to load memory.json for ${taskId} (resetting to default): ${e.message}`,
          );
        }
        memory = { timeline: [], metrics: { totalSpawns: 0, result: null } };
      }

      if (updates.timelineEntry) memory.timeline.push(updates.timelineEntry);
      if (updates.metrics) Object.assign(memory.metrics, updates.metrics);

      await writeFileAtomic(memoryPath, `${JSON.stringify(memory, null, 2)}\n`);
      try {
        git(["add", "memory.json"], artifactDir);
        git(["commit", "-m", "update memory"], artifactDir);
      } catch (e) {
        const msg = e.stderr || e.message || "";
        if (!msg.includes("nothing to commit"))
          console.error(
            `[updateMemory] git commit failed for ${taskId}: ${msg.slice(0, 200)}`,
          );
      }
    },
    { label: "updateMemory", log: (line) => console.error(line) },
  );
}

async function cleanupTask(taskId) {
  const removed = { worktrees: false, artifacts: false, forge: false };

  // worktrees 정리
  // Note: acquireLock (called by removeWorktrees) already detects stale locks
  // via PID liveness check + timeout, so no need to pre-release here.
  // Pre-releasing creates a race window where another process could acquire
  // the lock between release and removeWorktrees' acquireLock call, causing
  // removeWorktrees to fail and fall back to brute-force rm (which bypasses
  // git worktree remove, leaving git metadata out of sync).
  const worktreeDir = path.join(WORKTREES_DIR, taskId);
  try {
    const workspace = await loadWorkspace(taskId);
    if (workspace) {
      await removeWorktrees(taskId, workspace.projects);
    } else {
      const lockHandle = await acquireLock(taskId);
      try {
        await rm(worktreeDir, { recursive: true, force: true });
      } finally {
        await releaseLock(lockHandle);
      }
    }
    removed.worktrees = true;
  } catch (e) {
    if (isLockContentionError(e)) {
      console.error(
        `[cleanupTask] worktree cleanup deferred for ${taskId}: lock is busy (${errorDetail(e).slice(0, 200)})`,
      );
    } else {
      console.error(
        `[cleanupTask] worktree cleanup failed for ${taskId}, falling back to locked rm: ${errorDetail(e).slice(0, 200)}`,
      );
      let lockHandle = null;
      try {
        lockHandle = await acquireLock(taskId);
        await rm(worktreeDir, { recursive: true, force: true });
        removed.worktrees = true;
      } catch (e2) {
        if (isLockContentionError(e2)) {
          console.error(
            `[cleanupTask] worktree rm deferred for ${taskId}: lock is busy (${errorDetail(e2).slice(0, 200)})`,
          );
        } else if (e2.code !== "ENOENT") {
          console.error(
            `[cleanupTask] worktree rm failed for ${taskId}: ${e2.message}`,
          );
        }
      } finally {
        if (lockHandle) {
          await releaseLock(lockHandle);
        }
      }
    }
  }

  // artifacts 정리
  const artifactDir = path.join(ARTIFACTS_DIR, taskId);
  try {
    await rm(artifactDir, { recursive: true });
    removed.artifacts = true;
  } catch (e) {
    if (e.code !== "ENOENT")
      console.error(
        `[cleanupTask] artifact rm failed for ${taskId}: ${e.message}`,
      );
  }

  // forge dir 정리
  const forgeDir = path.join(require("./constants").FORGE_DIR, taskId);
  try {
    await rm(forgeDir, { recursive: true });
    removed.forge = true;
  } catch (e) {
    if (e.code !== "ENOENT")
      console.error(
        `[cleanupTask] forge rm failed for ${taskId}: ${e.message}`,
      );
  }

  return removed;
}

async function gcTasks({
  maxAgeDays = 30,
  statuses = ["done", "failed", "aborted"],
} = {}) {
  const { FORGE_DIR } = require("./constants");
  const { readdir } = require("node:fs/promises");
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const cleaned = [];

  try {
    const entries = await readdir(FORGE_DIR);
    for (const entry of entries) {
      if (!entry.startsWith("forge-")) continue;
      try {
        const taskPath = path.join(FORGE_DIR, entry, "task.json");
        const data = JSON.parse(await readFile(taskPath, "utf-8"));

        // createdAt 기준으로 오래된 태스크만 정리
        const createdTime = new Date(data.createdAt || 0).getTime();
        if (createdTime > cutoff) continue;

        if (!statuses.includes(data.status)) continue;

        await cleanupTask(entry);
        cleaned.push(entry);
      } catch (e) {
        console.error(`[gcTasks] failed to process ${entry}: ${e.message}`);
      }
    }
  } catch (e) {
    if (e.code !== "ENOENT")
      console.error(`[gcTasks] failed to read forge dir: ${e.message}`);
  }

  return cleaned;
}

module.exports = {
  git,
  expandHome,
  isGitRepo,
  createWorktrees,
  loadWorkspace,
  loadWorkspaceSync,
  mergeWorktrees,
  removeWorktrees,
  getWorktreeDiff,
  getWorktreeDiffStat,
  getWorktreeCwd,
  initArtifacts,
  saveArtifact,
  loadArtifact,
  updateMemory,
  cleanupTask,
  gcTasks,
  sanitizeContent,
  acquireLock,
  releaseLock,
};
