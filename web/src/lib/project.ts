import type { Proposal, Task } from "@/api/types";

const UNKNOWN_PROJECT_KEY = "__unknown__";
const UNKNOWN_PROJECT_LABEL = "Unknown Project";

function basename(projectPath: string): string {
  const trimmed = projectPath.trim().replace(/[\\/]+$/, "");
  if (!trimmed) return UNKNOWN_PROJECT_LABEL;
  const parts = trimmed.split(/[\\/]/).filter(Boolean);
  if (parts.length === 0) return UNKNOWN_PROJECT_LABEL;
  return parts[parts.length - 1];
}

export function getProjectKey(projectPath?: string | null): string {
  if (!projectPath || !String(projectPath).trim()) return UNKNOWN_PROJECT_KEY;
  return String(projectPath).trim();
}

export function encodeProjectKeyForRoute(projectKey: string): string {
  return encodeURIComponent(projectKey);
}

export function decodeProjectKeyFromRoute(
  routeProjectKey?: string | null,
): string {
  if (!routeProjectKey) return UNKNOWN_PROJECT_KEY;
  try {
    return decodeURIComponent(routeProjectKey);
  } catch {
    return routeProjectKey;
  }
}

export function getProjectLabel(projectPath?: string | null): string {
  if (!projectPath || !String(projectPath).trim()) return UNKNOWN_PROJECT_LABEL;
  return basename(String(projectPath));
}

export function getTaskProjectPath(task: Task): string | null {
  if (task.project && String(task.project).trim())
    return String(task.project).trim();
  if (task.projects && task.projects.length > 0) {
    const first = task.projects[0];
    if (first && typeof first.path === "string" && first.path.trim())
      return first.path.trim();
  }
  return null;
}

export function getTaskProjectLabel(task: Task): string {
  return getProjectLabel(getTaskProjectPath(task));
}

export function getProposalProjectPath(proposal: Proposal): string | null {
  if (!proposal.project || !String(proposal.project).trim()) return null;
  return String(proposal.project).trim();
}

export function getProposalProjectLabel(proposal: Proposal): string {
  return getProjectLabel(getProposalProjectPath(proposal));
}

export { UNKNOWN_PROJECT_KEY, UNKNOWN_PROJECT_LABEL };
