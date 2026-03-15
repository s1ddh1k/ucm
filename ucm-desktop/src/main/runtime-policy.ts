import type {
  AgentLifecycleEvent,
  AgentSnapshot,
  MissionDetail,
  MissionSnapshot,
  RunDetail,
  RunEvent,
} from "../shared/contracts";

const impl: any = require("../../../packages/application/runtime-policy.js");

type MissionRuntimeStatus = MissionSnapshot["status"];

export const deriveMissionStatus = (
  currentStatus: MissionRuntimeStatus,
  eventKind: RunEvent["kind"],
): MissionRuntimeStatus => impl.deriveMissionStatus(currentStatus, eventKind);

export const deriveLifecycleKindFromDecision = (
  decision: string,
): AgentLifecycleEvent["kind"] | null =>
  impl.deriveLifecycleKindFromDecision(decision);

export const deriveLifecycleTransitions = (
  agents: AgentSnapshot[],
  missionDetail: MissionDetail | null,
  run: RunDetail,
  event: RunEvent,
): Array<{
  agentId: string;
  status: AgentSnapshot["status"];
  lifecycleKind: AgentLifecycleEvent["kind"];
  summary: string;
}> => impl.deriveLifecycleTransitions(agents, missionDetail, run, event);
