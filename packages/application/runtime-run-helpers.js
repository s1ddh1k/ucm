function findRun(state, runId) {
  for (const [missionId, runs] of Object.entries(state.runsByMissionId)) {
    const run = runs.find((item) => item.id === runId);
    if (run) {
      return { missionId, run };
    }
  }
  return null;
}

function hydrateRunDetail(state, run) {
  return {
    ...run,
    runEvents: state.runEventsByRunId[run.id] ?? [],
  };
}

function appendReleaseRevision(run, releaseId, input) {
  const release = run.releases.find((item) => item.id === releaseId);
  if (!release) {
    return null;
  }

  const nextRevisionNumber =
    Math.max(0, ...release.revisions.map((revision) => revision.revision)) + 1;
  const nextRevision = {
    id: `${release.id}-r${nextRevisionNumber}`,
    revision: nextRevisionNumber,
    summary: input.summary,
    createdAtLabel: input.timestampLabel,
    basedOnArtifactIds: run.artifacts.map((artifact) => artifact.id),
    status: "active",
  };

  release.revisions = release.revisions.map((revision) => ({
    ...revision,
    status: revision.status === "approved" ? "approved" : "superseded",
  }));
  release.revisions = [...release.revisions, nextRevision];
  release.latestRevisionId = nextRevision.id;
  run.timeline = [
    ...run.timeline,
    {
      id: `tl-release-${Date.now()}`,
      kind: "artifact_created",
      summary: `Generated ${release.title} version v${nextRevision.revision}.`,
      timestampLabel: input.timestampLabel,
    },
  ];
  return nextRevision;
}

function appendHandoff(run, input) {
  run.handoffs = [
    ...run.handoffs.map((handoff) => ({
      ...handoff,
      status: handoff.status === "approved" ? "approved" : "superseded",
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
      summary: `Delivered release ${input.releaseRevisionId} to ${input.target ?? "human reviewer"}.`,
      timestampLabel: input.createdAtLabel,
    },
  ];
}

function appendRunEvent(state, runId, event) {
  state.runEventsByRunId[runId] = [
    ...(state.runEventsByRunId[runId] ?? []),
    {
      id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      runId,
      ...event,
    },
  ];
}

function markSteeringStatus(state, runId, fromStatus, toStatus) {
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

function setAgentStatus(state, missionId, agentId, status) {
  const agents = state.agentsByMissionId[missionId] ?? [];
  state.agentsByMissionId[missionId] = agents.map((agent) =>
    agent.id === agentId ? { ...agent, status } : agent,
  );
}

function appendLifecycleEvent(state, missionId, event) {
  state.lifecycleEventsByMissionId[missionId] = [
    ...(state.lifecycleEventsByMissionId[missionId] ?? []),
    {
      id: `lc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      missionId,
      ...event,
    },
  ];
}

module.exports = {
  appendReleaseRevision,
  appendHandoff,
  appendLifecycleEvent,
  appendRunEvent,
  findRun,
  hydrateRunDetail,
  markSteeringStatus,
  setAgentStatus,
};
