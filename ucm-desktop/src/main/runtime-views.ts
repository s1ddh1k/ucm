import {
  formatBudgetLabel,
  listBudgetBuckets,
  listProviderWindows,
  summarizeMission,
} from "../../../packages/application/runtime-core.js";
import type {
  MissionDetail,
  MissionSnapshot,
  RunDetail,
  ShellSnapshot,
} from "../shared/contracts";
import type { RuntimeState } from "./runtime-state";
import { hydrateRunDetail } from "./runtime-run-helpers";

function listWorkspaceMissions(state: RuntimeState) {
  return state.missions.filter(
    (mission) =>
      state.workspaceIdByMissionId[mission.id] === state.activeWorkspaceId,
  );
}

export function listMissionSnapshots(state: RuntimeState): MissionSnapshot[] {
  return listWorkspaceMissions(state).map((mission) => summarizeMission(state, mission));
}

export function getActiveMissionDetail(state: RuntimeState): MissionDetail | null {
  return state.activeMissionId
    ? (state.missionDetailsById[state.activeMissionId] ?? null)
    : null;
}

export function getActiveRunDetail(state: RuntimeState): RunDetail | null {
  if (!state.activeMissionId) {
    return null;
  }
  const runs = state.runsByMissionId[state.activeMissionId] ?? [];
  const run =
    runs.find((item) => item.id === state.activeRunId) ?? runs[0] ?? null;
  return run ? hydrateRunDetail(state, run) : null;
}

export function listRunsForActiveMission(state: RuntimeState): RunDetail[] {
  if (!state.activeMissionId) {
    return [];
  }
  return (state.runsByMissionId[state.activeMissionId] ?? []).map((run) =>
    hydrateRunDetail(state, run),
  );
}

export function buildShellSnapshot(state: RuntimeState): ShellSnapshot {
  const workspace =
    state.workspaces.find((item) => item.id === state.activeWorkspaceId) ??
    state.workspaces[0];
  const workspaceMissionIds = new Set(
    Object.entries(state.workspaceIdByMissionId)
      .filter(([, workspaceId]) => workspaceId === workspace?.id)
      .map(([missionId]) => missionId),
  );
  const workspaceMissions = state.missions.filter((mission) =>
    workspaceMissionIds.has(mission.id),
  );
  const mission =
    workspaceMissions.find((item) => item.id === state.activeMissionId) ??
    workspaceMissions[0];
  const agents = mission ? state.agentsByMissionId[mission.id] ?? [] : [];

  return {
    workspaceName: workspace?.name ?? "No workspace",
    missionName: mission?.title ?? "No mission",
    budgetLabel: formatBudgetLabel(state, mission?.id),
    budgetBuckets: listBudgetBuckets(state, mission?.id),
    providerWindows: listProviderWindows(state, state.activeWorkspaceId),
    activeAgents: agents.filter((agent) => agent.status !== "idle").length,
    blockedAgents: agents.filter((agent) => agent.status === "blocked").length,
    reviewCount: agents.filter((agent) => agent.status === "needs_review").length,
    agents,
    lifecycleEvents: (
      state.lifecycleEventsByMissionId[mission?.id ?? ""] ?? []
    ).slice(-6).reverse(),
    missions: workspaceMissions.slice(0, 6).map((item) => summarizeMission(state, item)),
  };
}
