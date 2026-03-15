import type {
  AgentLifecycleEvent,
  AgentSnapshot,
  ReleaseRevisionRecord,
  HandoffRecord,
  RunDetail,
  RunEvent,
} from "../shared/contracts";
import type { RuntimeState } from "./runtime-state";

const impl: any = require("../../../packages/application/runtime-run-helpers.js");

export const findRun = (
  state: RuntimeState,
  runId: string,
): { missionId: string; run: RunDetail } | null => impl.findRun(state, runId);

export const hydrateRunDetail = (
  state: RuntimeState,
  run: RunDetail,
): RunDetail => impl.hydrateRunDetail(state, run);

export const appendReleaseRevision = (
  run: RunDetail,
  releaseId: string,
  input: { summary: string; timestampLabel: string },
): ReleaseRevisionRecord | null =>
  impl.appendReleaseRevision(run, releaseId, input);

export const appendHandoff = (
  run: RunDetail,
  input: Omit<HandoffRecord, "id">,
): void => impl.appendHandoff(run, input);

export const appendRunEvent = (
  state: RuntimeState,
  runId: string,
  event: Omit<RunEvent, "id" | "runId">,
): void => impl.appendRunEvent(state, runId, event);

export const markSteeringStatus = (
  state: RuntimeState,
  runId: string,
  fromStatus: "active",
  toStatus: "superseded" | "resolved",
): void => impl.markSteeringStatus(state, runId, fromStatus, toStatus);

export const setAgentStatus = (
  state: RuntimeState,
  missionId: string,
  agentId: string,
  status: AgentSnapshot["status"],
): void => impl.setAgentStatus(state, missionId, agentId, status);

export const appendLifecycleEvent = (
  state: RuntimeState,
  missionId: string,
  event: Omit<AgentLifecycleEvent, "id" | "missionId">,
): void => impl.appendLifecycleEvent(state, missionId, event);
