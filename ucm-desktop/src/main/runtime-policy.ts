import type {
  AgentLifecycleEvent,
  AgentSnapshot,
  ArtifactRecord,
  MissionDetail,
  MissionSnapshot,
  RunDetail,
  RunEvent,
} from "../shared/contracts";

type MissionRuntimeStatus = MissionSnapshot["status"];

export function deriveMissionStatus(
  currentStatus: MissionRuntimeStatus,
  eventKind: RunEvent["kind"],
): MissionRuntimeStatus {
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

function phaseRequiresRole(
  phaseObjective: string,
  role: AgentSnapshot["role"],
): boolean {
  if (role === "verification") {
    return phaseObjective.includes("verify") || phaseObjective.includes("review");
  }
  if (role === "research") {
    return phaseObjective.includes("collect") || phaseObjective.includes("incident");
  }
  if (role === "implementation") {
    return (
      phaseObjective.includes("patch") ||
      phaseObjective.includes("execute") ||
      phaseObjective.includes("apply") ||
      phaseObjective.includes("implement")
    );
  }
  return false;
}

function artifactRequiresRole(
  artifactType: ArtifactRecord["type"] | undefined,
  role: AgentSnapshot["role"],
): boolean {
  if (role === "verification") {
    return artifactType === "diff" || artifactType === "test_result";
  }
  if (role === "implementation") {
    return artifactType === "report";
  }
  return false;
}

function blockerRequiresRole(
  requestedInput: string | undefined,
  role: AgentSnapshot["role"],
): boolean {
  if (role !== "research") return false;
  return requestedInput === "fixture_path" || requestedInput === "external_context";
}

export function deriveLifecycleTransitions(
  agents: AgentSnapshot[],
  missionDetail: MissionDetail | null,
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
  const activePhase = missionDetail?.phases.find((phase) => phase.status === "active");
  const phaseObjective = activePhase?.objective.toLowerCase() ?? "";
  const requestedInput = event.metadata?.requestedInput;
  const latestArtifactType = run.artifacts.at(-1)?.type;

  if (event.kind === "artifact_created") {
    const builder = agents.find((agent) => agent.role === "implementation");
    if (builder && builder.status === "idle" && phaseRequiresRole(phaseObjective, builder.role)) {
      transitions.push({
        agentId: builder.id,
        status: "running",
        lifecycleKind: "resumed",
        summary: `${builder.name} resumed because the active phase now has executable work.`,
      });
    }

    const verifier = agents.find((agent) => agent.role === "verification");
    if (
      verifier &&
      verifier.status === "idle" &&
      (artifactRequiresRole(latestArtifactType, verifier.role) ||
        phaseRequiresRole(phaseObjective, verifier.role))
    ) {
      transitions.push({
        agentId: verifier.id,
        status: "running",
        lifecycleKind: "resumed",
        summary: `${verifier.name} resumed because a new artifact is ready for verification.`,
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
        summary: `${blockedAgent.name} moved to blocked after the latest run event.`,
      });
    }

    const researcher = agents.find((agent) => agent.role === "research");
    if (
      researcher &&
      researcher.status === "idle" &&
      blockerRequiresRole(requestedInput, researcher.role)
    ) {
      transitions.push({
        agentId: researcher.id,
        status: "running",
        lifecycleKind: "resumed",
        summary: `${researcher.name} resumed because the blocker may need extra context.`,
      });
    }
  }

  if (event.kind === "review_requested" || event.kind === "needs_review") {
    const verifier = agents.find((agent) => agent.role === "verification");
    if (verifier && verifier.status !== "needs_review") {
      transitions.push({
        agentId: verifier.id,
        status: "needs_review",
        lifecycleKind: "reviewing",
        summary: `${verifier.name} moved into review because a reviewer-facing packet is ready.`,
      });
    }
  }

  if (event.kind === "completed") {
    const builder = event.agentId
      ? agents.find((agent) => agent.id === event.agentId)
      : agents.find((agent) => agent.role === "implementation");
    if (builder && builder.status !== "idle") {
      transitions.push({
        agentId: builder.id,
        status: "idle",
        lifecycleKind: "parked",
        summary: `${builder.name} parked after the active run reported completion.`,
      });
    }
  }

  if (event.kind === "steering_submitted") {
    const blockedImplementation =
      agents.find(
        (agent) => agent.role === "implementation" && agent.status === "blocked",
      ) ??
      (event.agentId ? agents.find((agent) => agent.id === event.agentId) : null);
    if (blockedImplementation) {
      transitions.push({
        agentId: blockedImplementation.id,
        status: "running",
        lifecycleKind: "resumed",
        summary: `${blockedImplementation.name} resumed after human steering was attached to the run.`,
      });
    }
  }

  return transitions;
}
