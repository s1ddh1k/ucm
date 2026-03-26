const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function directoryExists(targetPath) {
  try {
    return fs.statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

function sanitizeSegment(value) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "workspace"
  );
}

function findGitRoot(startPath) {
  if (!startPath || !directoryExists(startPath)) {
    return null;
  }

  try {
    const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: startPath,
      encoding: "utf8",
    });
    if (result.status !== 0) {
      return null;
    }
    const resolved = result.stdout.trim();
    return resolved ? path.resolve(resolved) : null;
  } catch {
    return null;
  }
}

class GitWorktreeManager {
  constructor(options = {}) {
    this.rootPath =
      options.rootPath ?? path.join(os.homedir(), ".ucm", "worktrees");
    this.runContexts = new Map();
    this.gitRootCache = new Map();
  }

  prepareRunWorkspace(input = {}) {
    const runId = input.runId ?? "";
    if (runId && this.runContexts.has(runId)) {
      return this.runContexts.get(runId);
    }

    if (!input.workspacePath) {
      const context = {
        cwd: process.cwd(),
        workspaceMode: "process",
        workspaceRootPath: undefined,
        worktreePath: undefined,
      };
      if (runId) {
        this.runContexts.set(runId, context);
      }
      return context;
    }

    const fallbackCwd = this.resolveFallbackCwd(input.workspacePath);
    const gitRoot = this.findGitRoot(fallbackCwd);
    if (!gitRoot) {
      const context = {
        cwd: fallbackCwd,
        workspaceMode: input.workspacePath ? "workspace" : "process",
        workspaceRootPath: input.workspacePath ? fallbackCwd : undefined,
        worktreePath: undefined,
      };
      if (runId) {
        this.runContexts.set(runId, context);
      }
      return context;
    }

    const workspaceName = sanitizeSegment(path.basename(gitRoot));
    const worktreePath = path.join(
      this.rootPath,
      `${workspaceName}-${sanitizeSegment(runId || Date.now().toString())}`,
    );

    const context = this.ensureGitWorktree({
      gitRoot,
      worktreePath,
      fallbackCwd,
    });
    if (runId) {
      this.runContexts.set(runId, context);
    }
    return context;
  }

  releaseRunWorkspace(runId, options = {}) {
    const existing = this.runContexts.get(runId);
    if (!existing) {
      return false;
    }
    this.runContexts.delete(runId);

    if (!options.remove || !existing.worktreePath || !existing.workspaceRootPath) {
      return true;
    }

    try {
      const result = spawnSync(
        "git",
        ["worktree", "remove", "--force", existing.worktreePath],
        {
          cwd: existing.workspaceRootPath,
          encoding: "utf8",
        },
      );
      return result.status === 0;
    } catch {
      return false;
    }
  }

  findGitRoot(startPath) {
    const cacheKey = path.resolve(startPath);
    if (this.gitRootCache.has(cacheKey)) {
      return this.gitRootCache.get(cacheKey);
    }

    const gitRoot = findGitRoot(cacheKey);
    this.gitRootCache.set(cacheKey, gitRoot);
    return gitRoot;
  }

  ensureGitWorktree(input) {
    fs.mkdirSync(this.rootPath, { recursive: true });

    if (directoryExists(input.worktreePath) && fs.existsSync(path.join(input.worktreePath, ".git"))) {
      return {
        cwd: input.worktreePath,
        workspaceMode: "git_worktree",
        workspaceRootPath: input.gitRoot,
        worktreePath: input.worktreePath,
      };
    }

    const result = spawnSync(
      "git",
      ["worktree", "add", "--detach", input.worktreePath, "HEAD"],
      {
        cwd: input.gitRoot,
        encoding: "utf8",
      },
    );
    if (result.status !== 0) {
      return {
        cwd: input.fallbackCwd,
        workspaceMode: "workspace",
        workspaceRootPath: input.gitRoot,
        worktreePath: undefined,
      };
    }

    return {
      cwd: input.worktreePath,
      workspaceMode: "git_worktree",
      workspaceRootPath: input.gitRoot,
      worktreePath: input.worktreePath,
    };
  }

  resolveFallbackCwd(workspacePath) {
    if (workspacePath) {
      const resolved = path.resolve(workspacePath);
      if (directoryExists(resolved)) {
        return resolved;
      }
    }
    return process.cwd();
  }
}

module.exports = {
  GitWorktreeManager,
};
