import type {
  AgentSnapshot,
  BudgetClass,
  MissionSnapshot,
  RunDetail,
  RunEvent,
} from "../shared/contracts";
import type { ExecutionController } from "./execution-types";
import {
  appendLifecycleEvent,
  appendRunEvent,
  findRun,
  markSteeringStatus,
  setAgentStatus,
} from "./runtime-run-helpers";
import type { RuntimeState } from "./runtime-state";

type ExecutionCallbacks = {
  onSessionStart: (missionId: string, runId: string, session: {
    sessionId: string;
    provider: "claude" | "codex";
  }) => void;
  onTerminalData: (missionId: string, runId: string, chunk: string) => void;
  onComplete: (result: {
    missionId: string;
    runId: string;
    agentId: string;
    summary: string;
    source: "provider" | "mock";
    outcome: "completed" | "blocked" | "needs_review";
    stderr?: string;
  }) => void;
};

export function collectSteeringContext(
  state: RuntimeState,
  runId: string,
): string {
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

export function maybeStartAgentExecutionInState(input: {
  state: RuntimeState;
  missionId: string;
  runId: string;
  agentId: string;
  executionService: ExecutionController;
  callbacks: ExecutionCallbacks;
}) {
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

function inferBudgetClassForAgent(agent: AgentSnapshot): BudgetClass {
  if (agent.role === "research") {
    return "light";
  }
  if (agent.role === "design") {
    return "heavy";
  }
  return "standard";
}

function inferProviderPreferenceForAgent(
  agent: AgentSnapshot,
): "claude" | "codex" {
  if (agent.role === "implementation") {
    return "codex";
  }
  return "claude";
}

export function completeAgentRunInState(
  state: RuntimeState,
  input: {
    missionId: string;
    runId: string;
    agentId: string;
    summary: string;
    source: "provider" | "mock";
    outcome: "completed" | "blocked" | "needs_review";
    stderr?: string;
  },
): { run: RunDetail; agent: AgentSnapshot } | null {
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
          type: "diff" as const,
          title:
            input.source === "provider"
              ? "Provider builder diff note"
              : "Mock builder diff",
          preview: input.summary,
        }
      : {
          id: `art-verifier-${Date.now()}`,
          type: "test_result" as const,
          title:
            input.source === "provider"
              ? "Provider verifier completion report"
              : "Mock verifier completion report",
          preview: input.summary,
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

  return { run: located.run, agent };
}

export function recordTerminalSessionInState(
  state: RuntimeState,
  missionId: string,
  runId: string,
  session: { sessionId: string; provider: "claude" | "codex" },
): boolean {
  const run = (state.runsByMissionId[missionId] ?? []).find(
    (item) => item.id === runId,
  );
  if (!run) {
    return false;
  }

  run.terminalSessionId = session.sessionId;
  run.terminalProvider = session.provider;
  run.activeSurface = "terminal";
  return true;
}

export function appendTerminalPreviewInState(
  state: RuntimeState,
  missionId: string,
  runId: string,
  chunk: string,
): boolean {
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

export function updateMissionStatusInState(
  state: RuntimeState,
  missionId: string,
  nextStatus: MissionSnapshot["status"],
) {
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

export function advanceMissionStatusInState(
  state: RuntimeState,
  missionId: string,
  eventKind: RunEvent["kind"],
  deriveMissionStatus: (
    current: MissionSnapshot["status"],
    eventKind: RunEvent["kind"],
  ) => MissionSnapshot["status"],
) {
  const currentMission = state.missions.find((mission) => mission.id === missionId);
  const nextStatus = deriveMissionStatus(
    currentMission?.status ?? "queued",
    eventKind,
  );

  updateMissionStatusInState(state, missionId, nextStatus);
}
