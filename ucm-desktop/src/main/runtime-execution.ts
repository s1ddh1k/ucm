import type {
  AgentSnapshot,
  BudgetClass,
  MissionSnapshot,
  RunDetail,
  RunEvent,
} from "../shared/contracts";
import type { ExecutionController } from "./execution-types";
import type { ProviderName } from "./provider-adapter";
import {
  appendLifecycleEvent,
  appendRunEvent,
  captureRunOutputBaseline,
  findRun,
  markSteeringStatus,
  setAgentStatus,
} from "./runtime-run-helpers";
import { buildRoleCompletionArtifacts } from "./runtime-role-completion-artifacts";
import {
  validateRoleContractRunCompletion,
  validateRoleContractRunStart,
  type RuntimeRoleRegistry,
} from "./runtime-role-registry";
import type { RuntimeState } from "./runtime-state";

type ExecutionCallbacks = {
  onSessionStart: (missionId: string, runId: string, session: {
    sessionId: string;
    provider: ProviderName;
  }) => void;
  onTerminalData: (missionId: string, runId: string, chunk: string) => void;
  onComplete: (result: {
    missionId: string;
    runId: string;
    agentId: string;
    summary: string;
    source: "provider" | "mock" | "local";
    outcome: "completed" | "blocked" | "needs_review";
    stderr?: string;
    stdout?: string;
    generatedPatch?: string;
  }) => void;
};

const MAX_TERMINAL_PREVIEW_LINES = 24;
const MAX_TERMINAL_PREVIEW_LINE_LENGTH = 240;

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
  roleRegistry?: RuntimeRoleRegistry;
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

  if (agent.status !== "running" && agent.status !== "needs_review") {
    return;
  }

  const budgetClass = run.budgetClass ?? inferBudgetClassForAgent(agent);
  const preferredProvider =
    run.providerPreference ?? inferProviderPreferenceForAgent(agent);
  const contractValidation = input.roleRegistry
    ? validateRoleContractRunStart({
        state,
        missionId,
        run,
        agent,
        roleRegistry: input.roleRegistry,
        preferredProvider,
      })
    : {
        valid: true,
        errors: [],
        providerPreference: preferredProvider,
      };

  if (!contractValidation.valid) {
    run.status = "blocked";
    setAgentStatus(state, missionId, agent.id, "blocked");
    appendRunEvent(state, runId, {
      kind: "blocked",
      agentId: agent.id,
      summary: `${agent.name} was blocked because the run role contract preconditions were not satisfied.`,
      createdAtLabel: "just now",
      metadata: {
        source: "role_contract_validation",
        roleContractId: run.roleContractId ?? "missing",
        agentRole: agent.role,
        reason: contractValidation.errors.join("; "),
      },
    });
    appendLifecycleEvent(state, missionId, {
      agentId: agent.id,
      kind: "blocked",
      summary: `${agent.name} is blocked until the required role contract inputs are satisfied.`,
      createdAtLabel: "just now",
    });
    return;
  }

  const workspaceId =
    state.workspaceIdByMissionId[missionId] ?? state.activeWorkspaceId;
  const workspacePath = state.workspaces.find(
    (item) => item.id === workspaceId,
  )?.rootPath;
  const steeringContext = collectSteeringContext(state, runId);
  const providerPreference = contractValidation.providerPreference;
  run.providerPreference = providerPreference;
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
    const providerLabel = providerPreference ?? "local";
    if (run.workspaceCommand?.trim()) {
      run.status = "blocked";
      run.providerPreference = undefined;
      setAgentStatus(state, missionId, agent.id, "blocked");
      appendRunEvent(state, runId, {
        kind: "blocked",
        agentId: agent.id,
        summary: `${agent.name} could not start because the local execution lane is saturated.`,
        createdAtLabel: "just now",
        metadata: {
          source: "local_lane_busy",
          budgetClass,
          provider: providerLabel,
        },
      });
      appendLifecycleEvent(state, missionId, {
        agentId: agent.id,
        kind: "blocked",
        summary: `${agent.name} is blocked until the local execution lane is free.`,
        createdAtLabel: "just now",
      });
      return;
    }
    run.status = "queued";
    run.providerPreference = providerPreference;
    setAgentStatus(state, missionId, agent.id, "queued");
    appendRunEvent(state, runId, {
      kind: "agent_status_changed",
      agentId: agent.id,
      summary: `${agent.name} is queued for the ${providerLabel} execution lane and will resume when capacity returns.`,
      createdAtLabel: "just now",
      metadata: {
        source: "provider_queue",
        budgetClass,
        provider: providerLabel,
      },
    });
    appendLifecycleEvent(state, missionId, {
      agentId: agent.id,
      kind: "queued",
      summary: `${agent.name} is waiting for the ${providerLabel} execution lane to reopen.`,
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
): ProviderName {
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
    source: "provider" | "mock" | "local";
    outcome: "completed" | "blocked" | "needs_review";
    stderr?: string;
    stdout?: string;
    generatedPatch?: string;
  },
  roleRegistry?: RuntimeRoleRegistry,
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
  located.run.outputBaseline =
    located.run.outputBaseline ?? captureRunOutputBaseline(located.run);
  located.run.status =
    input.outcome === "blocked"
      ? "blocked"
      : input.outcome === "needs_review"
        ? "needs_review"
        : "completed";

  const completion = buildRoleCompletionArtifacts({
    run: located.run,
    summary: input.summary,
    source: input.source,
    stdout: input.stdout,
    generatedPatch: input.generatedPatch,
  });
  if (completion.appendedDecisions.length > 0) {
    located.run.decisions = [...located.run.decisions, ...completion.appendedDecisions];
  }
  located.run.artifacts = [...located.run.artifacts, ...completion.artifacts];
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

  if (roleRegistry?.enforceRoleContracts) {
    const outputValidation = validateRoleContractRunCompletion({
      state,
      missionId: input.missionId,
      run: located.run,
      agent,
      roleRegistry,
    });
    if (!outputValidation.valid) {
      located.run.status = "blocked";
      setAgentStatus(state, input.missionId, input.agentId, "blocked");
      appendRunEvent(state, input.runId, {
        kind: "blocked",
        agentId: input.agentId,
        summary: `${agent.name} completed execution, but the role contract outputs are incomplete.`,
        createdAtLabel: "just now",
        metadata: {
          source: "role_contract_output_validation",
          roleContractId: located.run.roleContractId,
          reason: outputValidation.errors.join("; "),
        },
      });
      appendLifecycleEvent(state, input.missionId, {
        agentId: input.agentId,
        kind: "blocked",
        summary: `${agent.name} is blocked until the required role contract outputs are present.`,
        createdAtLabel: "just now",
      });
    }
  }

  return { run: located.run, agent };
}

export function recordTerminalSessionInState(
  state: RuntimeState,
  missionId: string,
  runId: string,
  session: { sessionId: string; provider: ProviderName },
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
    .map((line) =>
      line.length > MAX_TERMINAL_PREVIEW_LINE_LENGTH
        ? `${line.slice(0, MAX_TERMINAL_PREVIEW_LINE_LENGTH - 3)}...`
        : line,
    )
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

  run.terminalPreview = [...run.terminalPreview, ...normalized].slice(
    -MAX_TERMINAL_PREVIEW_LINES,
  );
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
