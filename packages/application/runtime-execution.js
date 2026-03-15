const {
  appendLifecycleEvent,
  appendRunEvent,
  findRun,
  markSteeringStatus,
  setAgentStatus,
} = require("./runtime-run-helpers.js");

function collectSteeringContext(state, runId) {
  return [...(state.runEventsByRunId[runId] ?? [])]
    .filter(
      (event) =>
        event.kind === "steering_submitted" &&
        event.metadata?.status !== "superseded" &&
        event.metadata?.status !== "resolved",
    )
    .slice(-3)
    .map(
      (event, index) =>
        `- S${index + 1}: ${event.metadata?.steering ?? event.summary}`,
    )
    .join("\n");
}

function maybeStartAgentExecutionInState(input) {
  const { state, missionId, runId, agentId, executionService, callbacks } = input;
  const agent = (state.agentsByMissionId[missionId] ?? []).find(
    (item) => item.id === agentId,
  );
  const run = (state.runsByMissionId[missionId] ?? []).find(
    (item) => item.id === runId,
  );
  if (!agent || !run) {
    return;
  }

  if (
    (agent.role !== "verification" &&
      agent.role !== "implementation" &&
      agent.role !== "research") ||
    agent.status !== "running"
  ) {
    return;
  }

  const workspaceId =
    state.workspaceIdByMissionId[missionId] ?? state.activeWorkspaceId;
  const workspacePath = state.workspaces.find(
    (item) => item.id === workspaceId,
  )?.rootPath;
  const steeringContext = collectSteeringContext(state, runId);
  const budgetClass = run.budgetClass ?? inferBudgetClassForAgent(agent);
  const providerPreference =
    run.providerPreference ?? inferProviderPreferenceForAgent(agent);
  const executionBudgetLimit =
    state.missionBudgetById[missionId]?.[budgetClass]?.limit;

  const started = executionService.spawnAgentRun({
    missionId,
    runId,
    agent,
    objective: agent.objective,
    budgetClass,
    providerPreference,
    executionBudgetLimit,
    workspacePath,
    workspaceCommand: run.workspaceCommand,
    steeringContext,
    onSessionStart: (session) => {
      callbacks.onSessionStart(missionId, runId, session);
    },
    onTerminalData: (chunk) => {
      callbacks.onTerminalData(missionId, runId, chunk);
    },
    onComplete: callbacks.onComplete,
  });

  if (started === false) {
    run.status = "queued";
    run.providerPreference = providerPreference;
    setAgentStatus(state, missionId, agent.id, "queued");
    appendRunEvent(state, runId, {
      kind: "agent_status_changed",
      agentId: agent.id,
      summary: `${agent.name} is queued for the ${providerPreference} window and will resume when capacity returns.`,
      createdAtLabel: "just now",
      metadata: {
        source: "provider_queue",
        budgetClass,
        provider: providerPreference,
      },
    });
    appendLifecycleEvent(state, missionId, {
      agentId: agent.id,
      kind: "queued",
      summary: `${agent.name} is waiting for the ${providerPreference} provider window to reopen.`,
      createdAtLabel: "just now",
    });
  }
}

function inferBudgetClassForAgent(agent) {
  if (agent.role === "research") {
    return "light";
  }
  if (agent.role === "design") {
    return "heavy";
  }
  return "standard";
}

function inferProviderPreferenceForAgent(agent) {
  if (agent.role === "implementation") {
    return "codex";
  }
  return "claude";
}

function completeAgentRunInState(state, input) {
  const located = findRun(state, input.runId);
  if (!located) {
    return null;
  }
  const agent = (state.agentsByMissionId[input.missionId] ?? []).find(
    (item) => item.id === input.agentId,
  );
  if (!agent) {
    return null;
  }

  const nextArtifact =
    agent.role === "implementation"
      ? {
          id: `art-builder-${Date.now()}`,
          type: "diff",
          title:
            input.source === "provider"
              ? "Provider builder diff note"
              : input.source === "local"
                ? "Local workspace diff"
                : "Mock builder diff",
          preview: input.generatedPatch
            ? "Workspace changes were captured from git diff."
            : input.summary,
          filePatches: [
            {
              path:
                input.generatedPatch && input.generatedPatch.includes("diff --git")
                  ? extractPrimaryPatchPath(input.generatedPatch)
                  : "command-output.txt",
              summary: "Generated implementation patch surface",
              patch:
                input.generatedPatch ||
                `diff --git a/command-output.txt b/command-output.txt
@@
+${input.summary}`,
            },
          ],
        }
      : {
          id: `art-verifier-${Date.now()}`,
          type: "test_result",
          title:
            input.source === "provider"
              ? "Provider verifier completion report"
              : input.source === "local"
                ? "Local workspace command report"
                : "Mock verifier completion report",
          preview: input.stdout || input.summary,
        };

  located.run.artifacts = [...located.run.artifacts, nextArtifact];
  located.run.timeline = [
    ...located.run.timeline,
    {
      id: `tl-verifier-${Date.now()}`,
      kind:
        input.outcome === "blocked"
          ? "blocked"
          : input.outcome === "needs_review"
            ? "needs_review"
            : agent.role === "implementation"
              ? "artifact_created"
              : "completed",
      summary:
        input.source === "provider"
          ? `${input.summary}${input.stderr ? " (stderr captured)" : ""}`
          : input.source === "local"
            ? `${input.summary}${input.stderr ? " (command exited with stderr)" : ""}`
            : input.summary,
      timestampLabel: "just now",
    },
  ];
  setAgentStatus(
    state,
    input.missionId,
    input.agentId,
    input.outcome === "blocked"
      ? "blocked"
      : input.outcome === "needs_review"
        ? "needs_review"
        : "idle",
  );
  appendRunEvent(state, input.runId, {
    kind:
      input.outcome === "blocked"
        ? "blocked"
        : input.outcome === "needs_review"
          ? "needs_review"
          : agent.role === "implementation"
            ? "artifact_created"
            : "completed",
    agentId: input.agentId,
    summary: input.summary,
    createdAtLabel: "just now",
    metadata: {
      source:
        input.source === "provider"
          ? "provider_execution_service"
          : input.source === "local"
            ? "local_workspace_command"
            : "mock_execution_service",
    },
  });
  appendLifecycleEvent(state, input.missionId, {
    agentId: input.agentId,
    kind:
      input.outcome === "blocked"
        ? "blocked"
        : input.outcome === "needs_review"
          ? "reviewing"
          : "parked",
    summary:
      input.outcome === "blocked"
        ? `${agent.name} completed a ${input.source} pass and stayed blocked on unresolved input.`
        : input.outcome === "needs_review"
          ? `${agent.name} completed a ${input.source} pass and is waiting for review.`
          : `${agent.name} completed a ${input.source} pass and parked after emitting an artifact.`,
    createdAtLabel: "just now",
  });
  if (input.outcome === "completed" || input.outcome === "needs_review") {
    markSteeringStatus(state, input.runId, "active", "resolved");
  }
  if (input.session) {
    recordTerminalSessionInState(state, input.missionId, input.runId, input.session);
  }

  return { run: located.run, agent };
}

function extractPrimaryPatchPath(patch) {
  const match = patch.match(/^diff --git a\/(.+?) b\//m);
  return match?.[1] ?? "workspace.diff";
}

function recordTerminalSessionInState(state, missionId, runId, session) {
  const run = (state.runsByMissionId[missionId] ?? []).find(
    (item) => item.id === runId,
  );
  if (!run) {
    return false;
  }

  run.session = session;
  run.terminalSessionId = session.interactive ? session.sessionId : undefined;
  run.terminalProvider = session.interactive ? session.provider : undefined;
  if (session.interactive) {
    run.activeSurface = "terminal";
  }
  return true;
}

function appendTerminalPreviewInState(state, missionId, runId, chunk) {
  const normalized = chunk
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
  if (normalized.length === 0) {
    return false;
  }

  const run = (state.runsByMissionId[missionId] ?? []).find(
    (item) => item.id === runId,
  );
  if (!run) {
    return false;
  }

  run.terminalPreview = [...run.terminalPreview, ...normalized].slice(-24);
  return true;
}

function updateMissionStatusInState(state, missionId, nextStatus) {
  state.missions = state.missions.map((mission) =>
    mission.id === missionId ? { ...mission, status: nextStatus } : mission,
  );

  const missionDetail = state.missionDetailsById[missionId];
  if (missionDetail) {
    state.missionDetailsById[missionId] = {
      ...missionDetail,
      status: nextStatus,
    };
  }
}

function advanceMissionStatusInState(state, missionId, eventKind, deriveMissionStatus) {
  const currentMission = state.missions.find((mission) => mission.id === missionId);
  const nextStatus = deriveMissionStatus(
    currentMission?.status ?? "queued",
    eventKind,
  );

  updateMissionStatusInState(state, missionId, nextStatus);
}

module.exports = {
  advanceMissionStatusInState,
  appendTerminalPreviewInState,
  collectSteeringContext,
  completeAgentRunInState,
  maybeStartAgentExecutionInState,
  recordTerminalSessionInState,
  updateMissionStatusInState,
};
