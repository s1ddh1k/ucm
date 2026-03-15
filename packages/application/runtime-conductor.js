const { deriveLifecycleKindFromDecision } = require("./runtime-policy.js");
const {
  appendReleaseRevision,
  appendHandoff,
  appendLifecycleEvent,
  appendRunEvent,
  setAgentStatus,
} = require("./runtime-run-helpers.js");

function decideFromContext(context) {
  const { event, latestArtifactType, hasRelease } = context;

  if (!hasRelease) {
    return {
      decision: "observe",
      summary: "Autopilot skipped conductor output because no release is available yet.",
    };
  }

  if (event.kind === "blocked") {
    const missingInput = event.metadata?.requestedInput;
    return {
      decision: "prepare_revision_and_request_steering",
      summary: missingInput
        ? `Blocked work needs brief steering about ${missingInput}.`
        : "Blocked work needs a concise steering packet for the human observer.",
      revisionSummary: missingInput
        ? `Autopilot packaged the current blocker, missing input (${missingInput}), and latest artifacts for a brief human steer.`
        : "Autopilot packaged the current blocker, resume context, and latest artifacts for a brief human steer.",
      handoffTarget: "human reviewer",
    };
  }

  if (event.kind === "needs_review" || event.kind === "completed") {
    return {
      decision: "prepare_revision_and_request_review",
      summary:
        "Review-ready work should arrive as a fresh release version in the reviewer inbox.",
      revisionSummary:
        latestArtifactType === "test_result"
          ? "Autopilot assembled the latest test and verification evidence into a review packet for the human observer."
          : "Autopilot assembled the latest run state into a passive review packet for the human observer.",
      handoffTarget: "human reviewer",
    };
  }

  if (event.kind === "artifact_created") {
    return {
      decision: "prepare_revision",
      summary:
        latestArtifactType === "diff"
          ? "A new diff appeared, so the current handoff packet should be refreshed."
          : "New artifacts should roll into the current release without interrupting the loop.",
      revisionSummary:
        latestArtifactType === "diff"
          ? "Autopilot rolled the latest code diff into a fresh release version for passive review."
          : "Autopilot rolled the latest artifacts into a fresh release version for passive review.",
    };
  }

  if (
    event.kind === "review_requested" ||
    event.kind === "steering_requested" ||
    event.kind === "steering_submitted" ||
    event.kind === "agent_status_changed"
  ) {
    return {
      decision: "observe",
      summary: "Autopilot recorded the orchestration event and is waiting for the next material change.",
    };
  }

  return {
    decision: "observe",
    summary: "Autopilot observed the event and left the run unchanged.",
  };
}

function applyConductorDecision(state, run, decision) {
  if (decision.decision === "observe") {
    return;
  }

  const release = run.releases[0];
  if (!release) {
    return;
  }

  const revision = appendReleaseRevision(run, release.id, {
    summary: decision.revisionSummary,
    timestampLabel: "just now",
  });
  if (!revision) {
    return;
  }

  if (
    decision.decision === "prepare_revision_and_request_review" ||
    decision.decision === "prepare_revision_and_request_steering"
  ) {
    const nextAgentStatus =
      decision.decision === "prepare_revision_and_request_review"
        ? "needs_review"
        : "blocked";
    const nextRunStatus =
      decision.decision === "prepare_revision_and_request_review"
        ? "needs_review"
        : "blocked";
    run.status = nextRunStatus;
    setAgentStatus(state, run.missionId, run.agentId, nextAgentStatus);
    appendRunEvent(state, run.id, {
      kind: "agent_status_changed",
      agentId: run.agentId,
      summary: `Active agent status changed to ${nextAgentStatus}.`,
      createdAtLabel: "just now",
      metadata: {
        status: nextAgentStatus,
      },
    });
    const lifecycleKind = deriveLifecycleKindFromDecision(decision.decision);
    if (lifecycleKind) {
      appendLifecycleEvent(state, run.missionId, {
        agentId: run.agentId,
        kind: lifecycleKind,
        summary:
          decision.decision === "prepare_revision_and_request_review"
            ? "Active agent moved into review after the conductor requested human review."
            : "Active agent was parked behind a blocker while the conductor requested brief steering.",
        createdAtLabel: "just now",
      });
    }
    appendHandoff(run, {
      releaseRevisionId: revision.id,
      channel: "inbox",
      target: decision.handoffTarget,
      createdAtLabel: "just now",
      status: "active",
    });
    appendRunEvent(state, run.id, {
      kind:
        decision.decision === "prepare_revision_and_request_review"
          ? "review_requested"
          : "steering_requested",
      agentId: run.agentId,
      summary: decision.summary,
      createdAtLabel: "just now",
    });
  }

  run.decisions = [
    ...run.decisions,
    {
      id: `d-autopilot-${Date.now()}`,
      category: "orchestration",
      summary: decision.summary,
      rationale:
        "Conductor decisions are event-driven so the system reacts to one concrete state change at a time.",
    },
  ];
}

module.exports = {
  applyConductorDecision,
  decideFromContext,
};
