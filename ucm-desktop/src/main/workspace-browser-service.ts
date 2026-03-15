import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { WorkspaceBrowserEntry, WorkspaceBrowserSnapshot } from "../shared/contracts";
import { normalizeWorkspacePathInput } from "./workspace-discovery";

function directoryExists(targetPath: string): boolean {
  try {
    return fs.statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

function hasRepositoryMarker(targetPath: string): boolean {
  return (
    fs.existsSync(path.join(targetPath, ".git")) ||
    fs.existsSync(path.join(targetPath, ".jj"))
  );
}

function resolveBrowserPath(rootPath?: string): string {
  if (!rootPath?.trim()) {
    return os.homedir();
  }

  let candidatePath = normalizeWorkspacePathInput(rootPath);
  while (!directoryExists(candidatePath)) {
    const parentPath = path.dirname(candidatePath);
    if (parentPath === candidatePath) {
      return os.homedir();
    }
    candidatePath = parentPath;
  }

  return candidatePath;
}

function sortEntries(
  left: WorkspaceBrowserEntry,
  right: WorkspaceBrowserEntry,
): number {
  if (left.isRepositoryRoot !== right.isRepositoryRoot) {
    return left.isRepositoryRoot ? -1 : 1;
  }
  return left.name.localeCompare(right.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function browseWorkspaceDirectories(input?: {
  rootPath?: string;
}): WorkspaceBrowserSnapshot {
  const currentPath = resolveBrowserPath(input?.rootPath);
  const parentPath = path.dirname(currentPath);
  const directories = fs
    .readdirSync(currentPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const entryPath = path.join(currentPath, entry.name);
      return {
        name: entry.name,
        path: entryPath,
        isRepositoryRoot: hasRepositoryMarker(entryPath),
      } satisfies WorkspaceBrowserEntry;
    })
    .sort(sortEntries);

  return {
    currentPath,
    parentPath: parentPath === currentPath ? null : parentPath,
    homePath: os.homedir(),
    directories,
  };
}

export function createWorkspaceDirectory(input: {
  parentPath: string;
  directoryName: string;
}): WorkspaceBrowserSnapshot {
  const parentPath = resolveBrowserPath(input.parentPath);
  const directoryName = input.directoryName.trim();

  if (
    !directoryName ||
    directoryName === "." ||
    directoryName === ".." ||
    directoryName.includes(path.sep) ||
    directoryName.includes("/") ||
    directoryName.includes("\\")
  ) {
    throw new Error("invalid_directory_name");
  }

  const nextPath = path.join(parentPath, directoryName);
  try {
    fs.mkdirSync(nextPath);
  } catch (error) {
    if (
      typeof error === "object" &&
      error &&
      "code" in error &&
      error.code === "EEXIST"
    ) {
      throw new Error("directory_exists");
    }
    throw error;
  }
  return browseWorkspaceDirectories({ rootPath: nextPath });
}
