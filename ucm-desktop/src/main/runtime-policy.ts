import type {
  AgentLifecycleEvent,
  AgentSnapshot,
  MissionDetail,
  MissionSnapshot,
  RunDetail,
  RunEvent,
} from "../shared/contracts";
import { findLatestActionableArtifactType } from "./runtime-run-helpers";

type MissionRuntimeStatus = MissionSnapshot["status"];

export function deriveMissionStatus(
  currentStatus: MissionRuntimeStatus,
  eventKind: RunEvent["kind"],
): MissionRuntimeStatus {
  if (currentStatus === "completed") {
    return "completed";
  }

  if (
    eventKind === "needs_review" ||
    eventKind === "review_requested" ||
    eventKind === "completed"
  ) {
    return "review";
  }

  if (
    eventKind === "artifact_created" ||
    eventKind === "blocked" ||
    eventKind === "steering_submitted"
  ) {
    return "running";
  }

  return currentStatus;
}

export function deriveLifecycleKindFromDecision(
  decision: string,
): AgentLifecycleEvent["kind"] | null {
  if (decision === "prepare_revision_and_request_review") {
    return "reviewing";
  }
  if (decision === "prepare_revision_and_request_steering") {
    return "blocked";
  }
  return null;
}

export function deriveLifecycleTransitions(
  agents: AgentSnapshot[],
  _missionDetail: MissionDetail | null,
  run: RunDetail,
  event: RunEvent,
): Array<{
  agentId: string;
  status: AgentSnapshot["status"];
  lifecycleKind: AgentLifecycleEvent["kind"];
  summary: string;
}> {
  const transitions: Array<{
    agentId: string;
    status: AgentSnapshot["status"];
    lifecycleKind: AgentLifecycleEvent["kind"];
    summary: string;
  }> = [];

  const planner = agents.find((agent) => agent.role === "coordination");
  const builder = agents.find((agent) => agent.role === "implementation");
  const verifier = agents.find((agent) => agent.role === "verification");
  const latestArtifactType = findLatestActionableArtifactType(run);

  if (event.kind === "artifact_created") {
    // Builder produced a diff → wake verifier
    if (
      verifier &&
      verifier.status === "idle" &&
      latestArtifactType === "diff"
    ) {
      transitions.push({
        agentId: verifier.id,
        status: "running",
        lifecycleKind: "resumed",
        summary: `${verifier.name} resumed because a diff is ready for verification.`,
      });
    }
  }

  if (event.kind === "blocked") {
    const blockedAgent = event.agentId
      ? agents.find((agent) => agent.id === event.agentId)
      : null;
    if (blockedAgent && blockedAgent.status !== "blocked") {
      transitions.push({
        agentId: blockedAgent.id,
        status: "blocked",
        lifecycleKind: "blocked",
        summary: `${blockedAgent.name} moved to blocked.`,
      });
    }
  }

  if (event.kind === "completed") {
    const completedAgent = event.agentId
      ? agents.find((agent) => agent.id === event.agentId)
      : null;

    // Planner completed → park planner, wake builder
    if (planner && completedAgent?.id === planner.id) {
      transitions.push({
        agentId: planner.id,
        status: "idle",
        lifecycleKind: "parked",
        summary: `${planner.name} parked after producing the spec.`,
      });
      if (builder && builder.status === "idle") {
        transitions.push({
          agentId: builder.id,
          status: "running",
          lifecycleKind: "resumed",
          summary: `${builder.name} resumed because the planner produced a spec.`,
        });
      }
    }

    // Builder completed → park it
    if (builder && completedAgent?.id === builder.id && builder.status !== "idle") {
      transitions.push({
        agentId: builder.id,
        status: "idle",
        lifecycleKind: "parked",
        summary: `${builder.name} parked after completion.`,
      });
    }

    // Verifier completed → park it
    if (verifier && completedAgent?.id === verifier.id && verifier.status !== "idle") {
      transitions.push({
        agentId: verifier.id,
        status: "idle",
        lifecycleKind: "parked",
        summary: `${verifier.name} parked after completion.`,
      });
    }
  }

  if (event.kind === "steering_submitted") {
    // Resume blocked planner or builder on steering
    const blocked = planner?.status === "blocked" ? planner : builder?.status === "blocked" ? builder : null;
    if (blocked) {
      transitions.push({
        agentId: blocked.id,
        status: "running",
        lifecycleKind: "resumed",
        summary: `${blocked.name} resumed after human steering.`,
      });
    }
  }

  return transitions;
}
