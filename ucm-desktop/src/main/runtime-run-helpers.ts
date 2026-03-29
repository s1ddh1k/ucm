import type {
  ArtifactRecord,
  AgentLifecycleEvent,
  AgentSnapshot,
  DeliverableRevisionRecord,
  HandoffRecord,
  RunDetail,
  RunEvent,
  RunOutputBaseline,
} from "../shared/contracts";
import type { RuntimeState } from "./runtime-state";
import { createArtifactRecord } from "./runtime-artifact-records";

const MAX_RUN_EVENTS_PER_RUN = 200;
const MAX_LIFECYCLE_EVENTS_PER_MISSION = 100;
const MAX_HANDLED_EVENT_IDS_PER_RUN = 200;

const NON_ACTIONABLE_ARTIFACT_CONTRACT_KINDS = new Set([
  "spec_brief",
  "acceptance_checks",
  "success_metrics",
  "decision_record",
  "historical_replay_result",
  "task_backlog",
  "run_trace",
  "evidence_pack",
]);

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
    evidencePacks: [],
    runEvents: state.runEventsByRunId[run.id] ?? [],
  };
}

export function countDeliverableRevisions(run: RunDetail): number {
  return (run.deliverables ?? []).reduce(
    (sum, deliverable) => sum + deliverable.revisions.length,
    0,
  );
}

export function captureRunOutputBaseline(run: RunDetail): RunOutputBaseline {
  const artifactContractCounts = run.artifacts.reduce<Record<string, number>>(
    (counts, artifact) => {
      if (artifact.contractKind) {
        counts[artifact.contractKind] = (counts[artifact.contractKind] ?? 0) + 1;
      }
      return counts;
    },
    {},
  );
  return {
    artifactCount: run.artifacts.length,
    artifactContractCounts,
    diffArtifactCount: run.artifacts.filter((artifact) => artifact.type === "diff").length,
    testArtifactCount: run.artifacts.filter((artifact) => artifact.type === "test_result").length,
    reportArtifactCount: run.artifacts.filter((artifact) => artifact.type === "report").length,
    decisionCount: run.decisions.length,
    deliverableRevisionCount: countDeliverableRevisions(run),
    handoffCount: run.handoffs.length,
    timelineCount: run.timeline.length,
  };
}

export function ensureRunOutputBaseline(run: RunDetail): RunDetail {
  if (run.outputBaseline) {
    return run;
  }
  return {
    ...run,
    outputBaseline: captureRunOutputBaseline(run),
  };
}

export function findLatestActionableArtifact(
  run: Pick<RunDetail, "artifacts">,
): ArtifactRecord | undefined {
  return [...run.artifacts]
    .reverse()
    .find(
      (artifact) =>
        !artifact.contractKind ||
        !NON_ACTIONABLE_ARTIFACT_CONTRACT_KINDS.has(artifact.contractKind),
    );
}

export function findLatestActionableArtifactType(
  run: Pick<RunDetail, "artifacts">,
): RunDetail["artifacts"][number]["type"] | undefined {
  return findLatestActionableArtifact(run)?.type;
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
  run.artifacts = [
    ...run.artifacts,
    createArtifactRecord({
      id: `art-deliverable-${nextRevision.id}`,
      type: "report",
      title: `${deliverable.title} revision v${nextRevision.revision}`,
      preview: nextRevision.summary,
      contractKind: "deliverable_revision",
      payload: {
        deliverableId: deliverable.id,
        deliverableKind: deliverable.kind,
        revisionId: nextRevision.id,
        revisionNumber: nextRevision.revision,
        summary: nextRevision.summary,
        basedOnArtifactIds: nextRevision.basedOnArtifactIds,
        status: nextRevision.status,
      },
      relatedArtifactIds: nextRevision.basedOnArtifactIds,
    }),
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
  const latestHandoff = run.handoffs.at(-1);
  if (latestHandoff) {
    run.artifacts = [
      ...run.artifacts,
      createArtifactRecord({
        id: `art-handoff-${latestHandoff.id}`,
        type: "handoff",
        title: `Handoff ${latestHandoff.id}`,
        preview: `Delivered ${latestHandoff.deliverableRevisionId} to ${latestHandoff.target ?? "human reviewer"}.`,
        contractKind: "handoff_record",
        payload: {
          deliverableRevisionId: latestHandoff.deliverableRevisionId,
          channel: latestHandoff.channel,
          target: latestHandoff.target ?? "human reviewer",
          status: latestHandoff.status,
          relatedArtifactIds: [latestHandoff.deliverableRevisionId],
        },
        relatedArtifactIds: [latestHandoff.deliverableRevisionId],
      }),
    ];
  }
}

export function appendRunEvent(
  state: RuntimeState,
  runId: string,
  event: Omit<RunEvent, "id" | "runId">,
) {
  const events = state.runEventsByRunId[runId] ?? [];
  events.push({
    id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    runId,
    ...event,
  });
  state.runEventsByRunId[runId] =
    events.length > MAX_RUN_EVENTS_PER_RUN
      ? events.slice(-MAX_RUN_EVENTS_PER_RUN)
      : events;
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
  const events = state.lifecycleEventsByMissionId[missionId] ?? [];
  events.push({
    id: `lc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    missionId,
    ...event,
  });
  state.lifecycleEventsByMissionId[missionId] =
    events.length > MAX_LIFECYCLE_EVENTS_PER_MISSION
      ? events.slice(-MAX_LIFECYCLE_EVENTS_PER_MISSION)
      : events;
}
