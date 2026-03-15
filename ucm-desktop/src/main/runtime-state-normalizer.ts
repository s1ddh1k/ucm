import path from "node:path";
import type { WorkspaceSummary } from "../shared/contracts";
import type { RuntimeState } from "./runtime-state";
import {
  createWorkspaceSummary,
  discoverWorkspaceSummaries,
  isWorkspacePathAvailable,
} from "./workspace-discovery";

export function normalizeRuntimeState(
  state: RuntimeState,
  cwd = process.cwd(),
): RuntimeState {
  const discoveredWorkspaces = discoverWorkspaceSummaries(cwd);
  const validStoredWorkspaces = state.workspaces.filter((workspace) =>
    isWorkspacePathAvailable(workspace.rootPath),
  );
  const workspaceByPath = new Map<string, WorkspaceSummary>();

  for (const workspace of [...discoveredWorkspaces, ...validStoredWorkspaces]) {
    const normalizedRootPath = path.resolve(workspace.rootPath);
    workspaceByPath.set(normalizedRootPath, {
      ...workspace,
      rootPath: normalizedRootPath,
    });
  }

  if (workspaceByPath.size === 0) {
    const fallbackWorkspace = createWorkspaceSummary(cwd, true);
    workspaceByPath.set(fallbackWorkspace.rootPath, fallbackWorkspace);
  }

  const workspaces = [...workspaceByPath.values()];
  const activeWorkspaceId = workspaces.some(
    (workspace) => workspace.id === state.activeWorkspaceId,
  )
    ? state.activeWorkspaceId
    : workspaces[0]?.id ?? "";
  const normalizedWorkspaceIds = new Set(
    workspaces.map((workspace) => workspace.id),
  );
  const workspaceIdByMissionId = { ...state.workspaceIdByMissionId };

  for (const mission of state.missions) {
    const workspaceId = workspaceIdByMissionId[mission.id];
    if (!workspaceId || !normalizedWorkspaceIds.has(workspaceId)) {
      workspaceIdByMissionId[mission.id] = activeWorkspaceId;
    }
  }

  const activeWorkspaceMissions = state.missions.filter(
    (mission) => workspaceIdByMissionId[mission.id] === activeWorkspaceId,
  );
  const activeMissionId = activeWorkspaceMissions.some(
    (mission) => mission.id === state.activeMissionId,
  )
    ? state.activeMissionId
    : activeWorkspaceMissions[0]?.id ?? "";
  const activeMissionRuns = activeMissionId
    ? state.runsByMissionId[activeMissionId] ?? []
    : [];
  const activeRunId = activeMissionRuns.some(
    (run) => run.id === state.activeRunId,
  )
    ? state.activeRunId
    : activeMissionRuns[0]?.id ?? "";

  return {
    ...state,
    activeWorkspaceId,
    activeMissionId,
    activeRunId,
    workspaceIdByMissionId,
    workspaces: workspaces.map((workspace) => ({
      ...workspace,
      active: workspace.id === activeWorkspaceId,
    })),
  };
}
