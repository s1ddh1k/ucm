import path from "node:path";
import type { WorkspaceSummary } from "../shared/contracts";
import type { RuntimeState } from "./runtime-state";
import {
  createWorkspaceSummary,
  isWorkspacePathAvailable,
  normalizeWorkspacePathInput,
} from "./workspace-discovery";

export function addWorkspaceInState(
  state: RuntimeState,
  input: { rootPath: string },
): WorkspaceSummary[] {
  const normalizedRootPath = normalizeWorkspacePathInput(input.rootPath);
  if (!isWorkspacePathAvailable(normalizedRootPath)) {
    throw new Error("invalid_workspace_path");
  }

  const nextWorkspace = createWorkspaceSummary(normalizedRootPath);
  const workspaceByPath = new Map(
    state.workspaces.map((workspace) => [workspace.rootPath, workspace]),
  );
  workspaceByPath.set(normalizedRootPath, nextWorkspace);

  state.workspaces = [...workspaceByPath.values()];
  state.activeWorkspaceId = nextWorkspace.id;
  state.workspaces = state.workspaces.map((workspace) => ({
    ...workspace,
    active: workspace.id === nextWorkspace.id,
  }));

  const workspaceMissions = state.missions.filter(
    (mission) => state.workspaceIdByMissionId[mission.id] === nextWorkspace.id,
  );
  state.activeMissionId = workspaceMissions[0]?.id ?? "";
  state.activeRunId = state.activeMissionId
    ? (state.runsByMissionId[state.activeMissionId] ?? [])[0]?.id ?? ""
    : "";

  return state.workspaces;
}
