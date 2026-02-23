const { execFileSync } = require("child_process");
const { readFile, writeFile, rename, mkdir, rm } = require("fs/promises");
const fs = require("fs");
const path = require("path");
const { WORKTREES_DIR, ARTIFACTS_DIR } = require("./constants");
const { git, expandHome, isGitRepo } = require("../ucmd-task.js");

// worktree 동시 접근 방지를 위한 lockfile
const LOCK_TIMEOUT_MS = 5 * 60 * 1000;

async function acquireLock(taskId) {
  const lockPath = path.join(WORKTREES_DIR, `${taskId}.lock`);
  await mkdir(WORKTREES_DIR, { recursive: true });

  // stale lock 체크: PID가 죽었거나 타임아웃 초과 시 제거
  try {
    const stat = fs.statSync(lockPath);
    let isStale = Date.now() - stat.mtimeMs > LOCK_TIMEOUT_MS;

    if (!isStale) {
      // PID가 lock 파일에 기록되어 있으면 프로세스 생존 여부 확인
      try {
        const content = fs.readFileSync(lockPath, "utf-8");
        const pid = parseInt(content.split("\n")[0], 10);
        if (pid && pid !== process.pid) {
          try { process.kill(pid, 0); } catch { isStale = true; }
        }
      } catch { /* lock 파일 읽기 실패 → 타임아웃 기반 폴백 */ }
    }

    if (isStale) {
      fs.unlinkSync(lockPath);
    }
  } catch (e) {
    if (e.code !== "ENOENT") console.error(`[acquireLock] stale lock check failed for ${taskId}: ${e.message}`);
  }

  try {
    fs.writeFileSync(lockPath, `${process.pid}\n${new Date().toISOString()}`, { flag: "wx" });
    return lockPath;
  } catch (e) {
    if (e.code === "EEXIST") {
      throw new Error(`worktree locked for task ${taskId}. Another operation may be in progress.`);
    }
    throw e;
  }
}

function releaseLock(taskId) {
  const lockPath = path.join(WORKTREES_DIR, `${taskId}.lock`);
  try { fs.unlinkSync(lockPath); } catch (e) {
    if (e.code !== "ENOENT") console.error(`[releaseLock] failed to release lock for ${taskId}: ${e.message}`);
  }
}

// 민감 정보 패턴 (source + flags 분리 저장하여 매 호출마다 fresh regex 생성)
const SENSITIVE_PATTERN_DEFS = [
  { source: "(?:api[_-]?key|apikey)\\s*[:=]\\s*[\"']?[\\w\\-]{20,}", flags: "gi" },
  { source: "(?:secret|password|passwd|token)\\s*[:=]\\s*[\"']?[\\w\\-]{8,}", flags: "gi" },
  { source: "(?:AWS_SECRET_ACCESS_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY)\\s*[:=]\\s*\\S+", flags: "gi" },
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

async function createWorktrees(taskId, projects, { log = () => {} } = {}) {
  await acquireLock(taskId);
  try {
    const taskWorktreeDir = path.join(WORKTREES_DIR, taskId);
    await mkdir(taskWorktreeDir, { recursive: true });

    const branchName = `ucm/${taskId}`;
    const workspaceProjects = [];

    for (const project of projects) {
      const originPath = path.resolve(project.path);
      const worktreePath = path.join(taskWorktreeDir, project.name);

      const baseCommit = git(["rev-parse", "HEAD"], originPath);

      try {
        git(["branch", branchName], originPath);
      } catch (e) {
        if (!e.stderr?.includes("already exists")) throw e;
      }

      git(["worktree", "add", worktreePath, branchName], originPath);

      workspaceProjects.push({
        name: project.name,
        path: worktreePath,
        origin: originPath,
        role: project.role || "primary",
        baseCommit,
      });
    }

    const workspace = { taskId, projects: workspaceProjects };
    const wsPath = path.join(taskWorktreeDir, "workspace.json");
    const wsTmp = wsPath + ".tmp";
    await writeFile(wsTmp, JSON.stringify(workspace, null, 2) + "\n");
    await rename(wsTmp, wsPath);

    return workspace;
  } finally {
    releaseLock(taskId);
  }
}

async function loadWorkspace(taskId) {
  const workspacePath = path.join(WORKTREES_DIR, taskId, "workspace.json");
  try {
    return JSON.parse(await readFile(workspacePath, "utf-8"));
  } catch (e) {
    if (e.code !== "ENOENT") console.error(`[loadWorkspace] failed to load workspace for ${taskId}: ${e.message}`);
    return null;
  }
}

function loadWorkspaceSync(taskId) {
  const workspacePath = path.join(WORKTREES_DIR, taskId, "workspace.json");
  try {
    return JSON.parse(fs.readFileSync(workspacePath, "utf-8"));
  } catch (e) {
    if (e.code !== "ENOENT") console.error(`[loadWorkspaceSync] failed to load workspace for ${taskId}: ${e.message}`);
    return null;
  }
}

// 머지 시 경고할 민감 파일 패턴
const SENSITIVE_FILE_PATTERNS = [
  /\.env($|\.)/, /\.key$/, /\.pem$/, /\.p12$/, /\.pfx$/,
  /credentials\.json$/, /\.secret$/, /id_rsa/, /\.keystore$/,
];

async function mergeWorktrees(taskId, projects, { log = () => {} } = {}) {
  await acquireLock(taskId);
  try {
    const branchName = `ucm/${taskId}`;
    const workspace = await loadWorkspace(taskId);
    const errors = [];

    for (const project of projects) {
      const originPath = path.resolve(project.origin || project.path);
      const worktreePath = path.join(WORKTREES_DIR, taskId, project.name);

      try {
        const currentBranch = git(["rev-parse", "--abbrev-ref", "HEAD"], originPath);

        const status = git(["status", "--porcelain"], worktreePath);
        if (status) {
          git(["add", "-A"], worktreePath);
          git(["commit", "-m", `chore: uncommitted changes for ${taskId}`], worktreePath);
          log(`auto-committed uncommitted changes in ${project.name}`);
        }

        const wsProject = workspace?.projects?.find((p) => p.name === project.name);
        const baseCommit = wsProject?.baseCommit;
        const tipCommit = git(["rev-parse", "HEAD"], worktreePath);

        if (baseCommit && tipCommit === baseCommit) {
          log(`skip merge ${project.name}: no changes on ${branchName}`);
        } else {
          // 민감 파일 수정 경고
          try {
            const diffArgs = baseCommit ? ["diff", "--name-only", baseCommit] : ["diff", "--name-only", "HEAD"];
            const changed = git(diffArgs, worktreePath).split("\n").filter(Boolean);
            const sensitiveFiles = changed.filter((f) => SENSITIVE_FILE_PATTERNS.some((p) => p.test(f)));
            if (sensitiveFiles.length > 0) {
              log(`[WARN] sensitive files modified: ${sensitiveFiles.join(", ")}`);
            }
          } catch (e) {
            log(`[warn] sensitive file check failed for ${project.name}: ${(e.stderr || e.message || "").slice(0, 200)}`);
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
                log(`[warn] stash pop conflict in ${project.name}, run 'git stash pop' manually`);
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

    try { await rm(path.join(WORKTREES_DIR, taskId), { recursive: true }); } catch (e) {
      if (e.code !== "ENOENT") log(`[warn] worktree dir cleanup failed for ${taskId}: ${e.message}`);
    }
  } finally {
    releaseLock(taskId);
  }
}

async function removeWorktrees(taskId, projects) {
  await acquireLock(taskId);
  try {
    const branchName = `ucm/${taskId}`;

    for (const project of projects) {
      const originPath = path.resolve(expandHome(project.origin || project.path));
      const worktreePath = path.join(WORKTREES_DIR, taskId, project.name);

      try {
        git(["worktree", "remove", "--force", worktreePath], originPath);
      } catch (e) {
        const msg = e.stderr || e.message || "";
        if (!msg.includes("not a working tree") && !msg.includes("is not a valid")) {
          console.error(`[removeWorktrees] worktree remove failed for ${taskId}/${project.name}: ${msg.slice(0, 200)}`);
        }
      }
      try {
        git(["worktree", "prune"], originPath);
      } catch (e) {
        console.error(`[removeWorktrees] worktree prune failed for ${taskId}/${project.name}: ${(e.stderr || e.message || "").slice(0, 200)}`);
      }
      try {
        git(["branch", "-D", branchName], originPath);
      } catch (e) {
        const msg = e.stderr || e.message || "";
        if (!msg.includes("not found")) {
          console.error(`[removeWorktrees] branch delete failed for ${taskId}/${project.name}: ${msg.slice(0, 200)}`);
        }
      }
    }

    try {
      await rm(path.join(WORKTREES_DIR, taskId), { recursive: true });
    } catch (e) {
      if (e.code !== "ENOENT") {
        console.error(`[removeWorktrees] directory rm failed for ${taskId}: ${e.message}`);
      }
    }
  } finally {
    releaseLock(taskId);
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
    if (!fs.existsSync(worktreePath)) {
      diffs.push({
        project: project.name,
        diff: "(worktree missing: no diff available for this task)",
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
      const args = baseCommit ? ["diff", "--stat", baseCommit] : ["diff", "--stat", "HEAD"];
      const output = execFileSync("git", args, { cwd: worktreePath, encoding: "utf-8" }).trim();
      stats.push({ project: project.name, stat: output || "(no changes)" });
    } catch (e) {
      stats.push({ project: project.name, stat: `(error: ${(e.stderr || e.message || "unknown").slice(0, 100)})` });
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
  const taskTmp = taskPath + ".tmp";
  await writeFile(taskTmp, taskContent);
  await rename(taskTmp, taskPath);

  const memory = { timeline: [], metrics: { totalSpawns: 0, result: null } };
  const memoryPath = path.join(artifactDir, "memory.json");
  const memoryTmp = memoryPath + ".tmp";
  await writeFile(memoryTmp, JSON.stringify(memory, null, 2) + "\n");
  await rename(memoryTmp, memoryPath);

  try {
    git(["init"], artifactDir);
    git(["add", "-A"], artifactDir);
    git(["commit", "-m", "init: task submitted"], artifactDir);
  } catch (e) {
    console.error(`[initArtifacts] git init failed for ${taskId}: ${(e.stderr || e.message || "").slice(0, 200)}`);
  }
}

async function saveArtifact(taskId, filename, content) {
  const artifactDir = path.join(ARTIFACTS_DIR, taskId);
  await mkdir(artifactDir, { recursive: true });
  const safeContent = sanitizeContent(content);
  const filePath = path.join(artifactDir, filename);
  const tmpPath = filePath + ".tmp";
  await writeFile(tmpPath, safeContent);
  await rename(tmpPath, filePath);
  try {
    git(["add", filename], artifactDir);
    git(["commit", "-m", `save: ${filename}`], artifactDir);
  } catch (e) {
    const msg = e.stderr || e.message || "";
    if (!msg.includes("nothing to commit")) console.error(`[saveArtifact] git commit failed for ${taskId}/${filename}: ${msg.slice(0, 200)}`);
  }
}

async function loadArtifact(taskId, filename) {
  return readFile(path.join(ARTIFACTS_DIR, taskId, filename), "utf-8");
}

async function updateMemory(taskId, updates) {
  const artifactDir = path.join(ARTIFACTS_DIR, taskId);
  let memory;
  try {
    memory = JSON.parse(await readFile(path.join(artifactDir, "memory.json"), "utf-8"));
  } catch (e) {
    if (e.code !== "ENOENT") {
      console.error(`[updateMemory] failed to load memory.json for ${taskId} (resetting to default): ${e.message}`);
    }
    memory = { timeline: [], metrics: { totalSpawns: 0, result: null } };
  }

  if (updates.timelineEntry) memory.timeline.push(updates.timelineEntry);
  if (updates.metrics) Object.assign(memory.metrics, updates.metrics);

  const memoryPath = path.join(artifactDir, "memory.json");
  const tmpPath = memoryPath + ".tmp";
  await writeFile(tmpPath, JSON.stringify(memory, null, 2) + "\n");
  await rename(tmpPath, memoryPath);
  try {
    git(["add", "memory.json"], artifactDir);
    git(["commit", "-m", "update memory"], artifactDir);
  } catch (e) {
    const msg = e.stderr || e.message || "";
    if (!msg.includes("nothing to commit")) console.error(`[updateMemory] git commit failed for ${taskId}: ${msg.slice(0, 200)}`);
  }
}

async function cleanupTask(taskId) {
  const removed = { worktrees: false, artifacts: false, forge: false };

  // lock 파일 해제
  releaseLock(taskId);

  // worktrees 정리
  const worktreeDir = path.join(WORKTREES_DIR, taskId);
  try {
    const workspace = await loadWorkspace(taskId);
    if (workspace) {
      await removeWorktrees(taskId, workspace.projects);
    }
    removed.worktrees = true;
  } catch (e) {
    console.error(`[cleanupTask] worktree cleanup failed for ${taskId}, falling back to rm: ${e.message}`);
    try {
      await rm(worktreeDir, { recursive: true }); removed.worktrees = true;
    } catch (e2) {
      if (e2.code !== "ENOENT") console.error(`[cleanupTask] worktree rm failed for ${taskId}: ${e2.message}`);
    }
  }

  // artifacts 정리
  const artifactDir = path.join(ARTIFACTS_DIR, taskId);
  try {
    await rm(artifactDir, { recursive: true }); removed.artifacts = true;
  } catch (e) {
    if (e.code !== "ENOENT") console.error(`[cleanupTask] artifact rm failed for ${taskId}: ${e.message}`);
  }

  // forge dir 정리
  const forgeDir = path.join(require("./constants").FORGE_DIR, taskId);
  try {
    await rm(forgeDir, { recursive: true }); removed.forge = true;
  } catch (e) {
    if (e.code !== "ENOENT") console.error(`[cleanupTask] forge rm failed for ${taskId}: ${e.message}`);
  }

  return removed;
}

async function gcTasks({ maxAgeDays = 30, statuses = ["done", "failed", "aborted"] } = {}) {
  const { FORGE_DIR } = require("./constants");
  const { readdir } = require("fs/promises");
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
    if (e.code !== "ENOENT") console.error(`[gcTasks] failed to read forge dir: ${e.message}`);
  }

  return cleaned;
}

module.exports = {
  git,
  expandHome,
  isGitRepo,
  createWorktrees, loadWorkspace, loadWorkspaceSync, mergeWorktrees, removeWorktrees,
  getWorktreeDiff, getWorktreeDiffStat, getWorktreeCwd,
  initArtifacts, saveArtifact, loadArtifact, updateMemory,
  cleanupTask, gcTasks,
  sanitizeContent, acquireLock, releaseLock,
};
