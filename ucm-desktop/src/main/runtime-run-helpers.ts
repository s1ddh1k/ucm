import type {
  AgentLifecycleEvent,
  AgentSnapshot,
  DeliverableRevisionRecord,
  HandoffRecord,
  RunDetail,
  RunEvent,
} from "../shared/contracts";
import type { RuntimeState } from "./runtime-state";

export function findRun(
  state: RuntimeState,
  runId: string,
): { missionId: string; run: RunDetail } | null {
  for (const [missionId, runs] of Object.entries(state.runsByMissionId)) {
    const run = runs.find((item) => item.id === runId);
    if (run) {
      return { missionId, run };
    }
  }
  return null;
}

export function hydrateRunDetail(state: RuntimeState, run: RunDetail): RunDetail {
  return {
    ...run,
    runEvents: state.runEventsByRunId[run.id] ?? [],
  };
}

export function appendDeliverableRevision(
  run: RunDetail,
  deliverableId: string,
  input: { summary: string; timestampLabel: string },
): DeliverableRevisionRecord | null {
  const deliverable = run.deliverables.find((item) => item.id === deliverableId);
  if (!deliverable) {
    return null;
  }

  const nextRevisionNumber =
    Math.max(0, ...deliverable.revisions.map((revision) => revision.revision)) + 1;
  const nextRevision: DeliverableRevisionRecord = {
    id: `${deliverable.id}-r${nextRevisionNumber}`,
    revision: nextRevisionNumber,
    summary: input.summary,
    createdAtLabel: input.timestampLabel,
    basedOnArtifactIds: run.artifacts.map((artifact) => artifact.id),
    status: "active",
  };

  deliverable.revisions = deliverable.revisions.map((revision) => ({
    ...revision,
    status: revision.status === "approved" ? "approved" : "superseded",
  }));
  deliverable.revisions = [...deliverable.revisions, nextRevision];
  deliverable.latestRevisionId = nextRevision.id;
  run.timeline = [
    ...run.timeline,
    {
      id: `tl-deliverable-${Date.now()}`,
      kind: "artifact_created",
      summary: `Generated ${deliverable.title} revision v${nextRevision.revision}.`,
      timestampLabel: input.timestampLabel,
    },
  ];
  return nextRevision;
}

export function appendHandoff(
  run: RunDetail,
  input: Omit<HandoffRecord, "id">,
) {
  run.handoffs = [
    ...run.handoffs.map((handoff) => ({
      ...handoff,
      status: handoff.status === "approved" ? ("approved" as const) : ("superseded" as const),
    })),
    {
      id: `handoff-${Date.now()}`,
      ...input,
    },
  ];
  run.timeline = [
    ...run.timeline,
    {
      id: `tl-handoff-${Date.now()}`,
      kind: "completed",
      summary: `Delivered revision ${input.deliverableRevisionId} to ${input.target ?? "human reviewer"}.`,
      timestampLabel: input.createdAtLabel,
    },
  ];
}

export function appendRunEvent(
  state: RuntimeState,
  runId: string,
  event: Omit<RunEvent, "id" | "runId">,
) {
  state.runEventsByRunId[runId] = [
    ...(state.runEventsByRunId[runId] ?? []),
    {
      id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      runId,
      ...event,
    },
  ];
}

export function markSteeringStatus(
  state: RuntimeState,
  runId: string,
  fromStatus: "active",
  toStatus: "superseded" | "resolved",
) {
  state.runEventsByRunId[runId] = (state.runEventsByRunId[runId] ?? []).map((event) => {
    if (event.kind !== "steering_submitted" || event.metadata?.status !== fromStatus) {
      return event;
    }
    return {
      ...event,
      metadata: {
        ...event.metadata,
        status: toStatus,
      },
    };
  });
}

export function setAgentStatus(
  state: RuntimeState,
  missionId: string,
  agentId: string,
  status: AgentSnapshot["status"],
) {
  const agents = state.agentsByMissionId[missionId] ?? [];
  state.agentsByMissionId[missionId] = agents.map((agent) =>
    agent.id === agentId ? { ...agent, status } : agent,
  );
}

export function appendLifecycleEvent(
  state: RuntimeState,
  missionId: string,
  event: Omit<AgentLifecycleEvent, "id" | "missionId">,
) {
  state.lifecycleEventsByMissionId[missionId] = [
    ...(state.lifecycleEventsByMissionId[missionId] ?? []),
    {
      id: `lc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      missionId,
      ...event,
    },
  ];
}
