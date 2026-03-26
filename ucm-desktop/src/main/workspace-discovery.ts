import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { WorkspaceSummary } from "../shared/contracts";

const DISCOVERY_ROOTS = [
  path.join(os.homedir(), "git"),
  path.join(os.homedir(), "work"),
  path.join(os.homedir(), "src"),
  path.join(os.homedir(), ".ucm", "worktrees"),
];

function directoryExists(targetPath: string): boolean {
  try {
    return fs.statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

export function normalizeWorkspacePathInput(
  inputPath: string,
  cwd = process.cwd(),
): string {
  const trimmedPath = inputPath.trim();
  if (!trimmedPath) {
    return "";
  }

  if (trimmedPath === "~") {
    return os.homedir();
  }

  if (trimmedPath.startsWith(`~${path.sep}`) || trimmedPath.startsWith("~/")) {
    return path.join(os.homedir(), trimmedPath.slice(2));
  }

  return path.resolve(cwd, trimmedPath);
}

function hasGitMarker(targetPath: string): boolean {
  return (
    fs.existsSync(path.join(targetPath, ".git")) ||
    fs.existsSync(path.join(targetPath, ".jj"))
  );
}

function findGitRoot(startPath: string): string | null {
  let currentPath = path.resolve(startPath);
  while (true) {
    if (directoryExists(currentPath) && hasGitMarker(currentPath)) {
      return currentPath;
    }
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      return null;
    }
    currentPath = parentPath;
  }
}

function listGitChildren(rootPath: string): string[] {
  if (!directoryExists(rootPath)) {
    return [];
  }

  return fs
    .readdirSync(rootPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(rootPath, entry.name))
    .filter((childPath) => hasGitMarker(childPath));
}

function toWorkspaceId(rootPath: string): string {
  const safeName = path
    .basename(rootPath)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "workspace";

  let hash = 0;
  for (const char of rootPath) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return `ws-${safeName}-${hash.toString(36).slice(0, 6)}`;
}

export function createWorkspaceSummary(
  rootPath: string,
  active = false,
): WorkspaceSummary {
  return {
    id: toWorkspaceId(rootPath),
    name: path.basename(rootPath),
    rootPath,
    active,
  };
}

const DISCOVERY_CACHE_TTL_MS = 30_000;
let discoveryCache: { startPath: string; result: WorkspaceSummary[]; expiresAt: number } | null = null;

export function discoverWorkspaceSummaries(startPath = process.cwd()): WorkspaceSummary[] {
  const now = Date.now();
  if (discoveryCache && discoveryCache.startPath === startPath && now < discoveryCache.expiresAt) {
    return discoveryCache.result;
  }

  const candidates = new Map<string, WorkspaceSummary>();
  const currentGitRoot = findGitRoot(startPath);
  const currentRoot = currentGitRoot ?? (directoryExists(startPath) ? path.resolve(startPath) : null);

  if (currentRoot) {
    candidates.set(currentRoot, createWorkspaceSummary(currentRoot));
  }

  for (const rootPath of DISCOVERY_ROOTS) {
    for (const childPath of listGitChildren(rootPath)) {
      candidates.set(childPath, createWorkspaceSummary(childPath));
    }
  }

  const result = [...candidates.values()];
  discoveryCache = { startPath, result, expiresAt: now + DISCOVERY_CACHE_TTL_MS };
  return result;
}

export function invalidateDiscoveryCache() {
  discoveryCache = null;
}

export function isWorkspacePathAvailable(rootPath: string): boolean {
  return directoryExists(rootPath);
}
