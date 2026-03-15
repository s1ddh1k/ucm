import type {
  AgentLifecycleEvent,
  AgentSnapshot,
  MissionDetail,
  MissionSnapshot,
  RunDetail,
  RunEvent,
  WorkspaceSummary,
} from "../shared/contracts";

export type RuntimeState = {
  activeWorkspaceId: string;
  activeMissionId: string;
  activeRunId: string;
  missionBudgetById: Record<
    string,
    Record<"light" | "standard" | "heavy", { limit: number; used: number }>
  >;
  workspaces: WorkspaceSummary[];
  missions: MissionSnapshot[];
  missionDetailsById: Record<string, MissionDetail>;
  workspaceIdByMissionId: Record<string, string>;
  agentsByMissionId: Record<string, AgentSnapshot[]>;
  runsByMissionId: Record<string, RunDetail[]>;
  runEventsByRunId: Record<string, RunEvent[]>;
  lifecycleEventsByMissionId: Record<string, AgentLifecycleEvent[]>;
  autopilotHandledEventIdsByRunId: Record<string, string[]>;
};

export function createEmptyRuntimeState(): RuntimeState {
  return {
    activeWorkspaceId: "",
    activeMissionId: "",
    activeRunId: "",
    missionBudgetById: {},
    workspaces: [],
    missions: [],
    missionDetailsById: {},
    workspaceIdByMissionId: {},
    agentsByMissionId: {},
    runsByMissionId: {},
    runEventsByRunId: {},
    lifecycleEventsByMissionId: {},
    autopilotHandledEventIdsByRunId: {},
  };
}

export function cloneRuntimeState(state: RuntimeState): RuntimeState {
  return JSON.parse(JSON.stringify(state)) as RuntimeState;
}

export function timestampLabelFromRevision(revision: number): string {
  return revision === 1 ? "just now" : `${revision - 1} version${revision > 2 ? "s" : ""} later`;
}
