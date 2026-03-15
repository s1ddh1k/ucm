import type { AgentSnapshot, RunDetail, RunEvent } from "../shared/contracts";
import type { RuntimeState } from "./runtime-state";

const impl: any = require("../../../packages/application/runtime-scheduler.js");

export const scheduleFollowupRunInState = (input: {
  state: RuntimeState;
  missionId: string;
  sourceRun: RunDetail;
  sourceEvent: RunEvent;
  agent: AgentSnapshot;
}): {
  outcome: "scheduled" | "reused" | "blocked";
  runId: string;
  agentId: string;
  status: RunDetail["status"];
  ruleId: string;
  spawnMode: "execute" | "queue_only";
  reason?: string;
} | null => impl.scheduleFollowupRunInState(input);
