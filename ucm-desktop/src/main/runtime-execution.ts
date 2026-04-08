import type {
  AgentSnapshot,
  BudgetClass,
  ExecutionAttempt,
  MissionSnapshot,
  RunDetail,
  RunExecutionStats,
  RunEvent,
  SessionLease,
  SessionReusePolicy,
  WakeupRequest,
  WakeupSource,
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
import { compileLearningProposal } from "./runtime-proposal-compiler";
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
    executionAttemptId?: string;
    leaseId?: string;
    affinityKey?: string;
    reusable?: boolean;
  }) => void;
  onTerminalData: (missionId: string, runId: string, chunk: string) => void;
  onComplete: (result: {
    missionId: string;
    runId: string;
    agentId: string;
    wakeupRequestId?: string;
    executionAttemptId?: string;
    summary: string;
    source: "provider" | "mock" | "local";
    outcome: "completed" | "blocked" | "needs_review";
    stderr?: string;
    stdout?: string;
    generatedPatch?: string;
    executionStats?: RunExecutionStats;
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

function buildExecutionObjective(run: RunDetail, agent: AgentSnapshot): string {
  const parts = [run.title, run.summary, agent.objective]
    .map((value) => value?.trim())
    .filter((value, index, values) => Boolean(value) && values.indexOf(value) === index);
  return parts.join("\n");
}

function buildExecutionContextSummary(run: RunDetail): string {
  const recentArtifacts = run.artifacts
    .slice(-6)
    .map((artifact) => {
      const kind = artifact.contractKind ?? artifact.type;
      return `- ${kind}: ${artifact.title} — ${artifact.preview}`;
    });
  return recentArtifacts.join("\n");
}

function finalizeExecutionStatsForRun(
  state: RuntimeState,
  runId: string,
  outcome: "completed" | "blocked" | "needs_review",
  stats?: RunExecutionStats,
): RunExecutionStats | undefined {
  if (!stats) {
    return undefined;
  }

  const runEvents = state.runEventsByRunId[runId] ?? [];
  const blockedEvents = runEvents.filter((event) => event.kind === "blocked").length;
  const steeringEvents = runEvents.filter(
    (event) => event.kind === "steering_submitted",
  ).length;

  return {
    ...stats,
    blockerCount: blockedEvents + (outcome === "blocked" ? 1 : 0),
    steeringCount: steeringEvents,
  };
}

export function maybeStartAgentExecutionInState(input: {
  state: RuntimeState;
  missionId: string;
  runId: string;
  agentId: string;
  triggerSource?: WakeupSource;
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
  const workspaceId =
    state.workspaceIdByMissionId[missionId] ?? state.activeWorkspaceId;
  const workspacePath = state.workspaces.find(
    (item) => item.id === workspaceId,
  )?.rootPath;
  const steeringContext = collectSteeringContext(state, runId);
  const objective = buildExecutionObjective(run, agent);
  const contextSummary = buildExecutionContextSummary(run);
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
  const provider = run.workspaceCommand?.trim()
    ? "local"
    : contractValidation.providerPreference ?? preferredProvider ?? "local";

  if (!contractValidation.valid) {
    const wakeupRequest = appendWakeupRequestInState(state, {
      missionId,
      runId,
      workspaceId,
      source: input.triggerSource ?? (run.origin ? "followup" : "automation"),
      reason: `Start ${agent.name} for ${run.title}.`,
    });
    const executionAttemptId = startExecutionAttemptInState(state, {
      missionId,
      runId,
      wakeupRequestId: wakeupRequest.id,
      provider,
      estimatedPromptTokens: estimateExecutionPromptTokens(
        objective,
        contextSummary,
        steeringContext,
      ),
      localityScoreHint: contextSummary?.trim() ? 1 : 0,
    });
    markWakeupRequestStatusInState(
      state,
      missionId,
      wakeupRequest.id,
      "cancelled",
    );
    markExecutionAttemptStatusInState(
      state,
      runId,
      executionAttemptId,
      "blocked",
      {
        errorCode: "role_contract_precondition_failed",
        errorMessage: contractValidation.errors.join("; "),
        stderrExcerpt: excerptText(contractValidation.errors.join("; ")),
      },
    );
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
  const providerPreference = contractValidation.providerPreference;
  run.providerPreference = providerPreference;
  const executionBudgetLimit =
    state.missionBudgetById[missionId]?.[budgetClass]?.limit;
  const sessionReusePolicy = resolveSessionReusePolicy(run, agent, provider);
  const sessionAffinityKey =
    run.sessionAffinityKey ??
    `${missionId}:${agent.role}:${provider}`;
  const wakeupRequest = appendWakeupRequestInState(state, {
    missionId,
    runId,
    workspaceId,
    source: input.triggerSource ?? (run.origin ? "followup" : "automation"),
    reason: `Start ${agent.name} for ${run.title}.`,
  });
  const sessionLease = allocateSessionLeaseInState(state, {
    missionId,
    runId,
    workspaceId,
    provider,
    reusePolicy: sessionReusePolicy,
    affinityKey: sessionAffinityKey,
  });
  const executionAttemptId = startExecutionAttemptInState(state, {
    missionId,
    runId,
    wakeupRequestId: wakeupRequest.id,
    provider,
    sessionLeaseId: sessionLease?.id,
    estimatedPromptTokens: estimateExecutionPromptTokens(
      objective,
      contextSummary,
      steeringContext,
    ),
    localityScoreHint: contextSummary?.trim() ? 1 : 0,
  });
  attachAttemptToSessionLeaseInState(state, workspaceId, sessionLease?.id, executionAttemptId);

  const started = executionService.spawnAgentRun({
    missionId,
    runId,
    agent,
    wakeupRequestId: wakeupRequest.id,
    executionAttemptId,
    sessionLeaseId: sessionLease?.id,
    resumeSessionId: sessionLease?.sessionId,
    sessionReusePolicy,
    sessionAffinityKey,
    objective,
    roleContractId: run.roleContractId,
    budgetClass,
    providerPreference,
    executionBudgetLimit,
    workspacePath,
    workspaceCommand: run.workspaceCommand,
    steeringContext,
    contextSummary,
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
    markWakeupRequestStatusInState(
      state,
      missionId,
      wakeupRequest.id,
      "queued",
    );
    markExecutionAttemptStatusInState(
      state,
      runId,
      executionAttemptId,
      run.workspaceCommand?.trim() ? "blocked" : "cancelled",
      run.workspaceCommand?.trim()
        ? {
            errorCode: "local_lane_busy",
            errorMessage: "Local execution lane is saturated.",
            stderrExcerpt: "Local execution lane is saturated.",
          }
        : {
            errorCode: "provider_lane_busy",
            errorMessage: `Provider lane for ${providerLabel} is saturated.`,
            stderrExcerpt: `Provider lane for ${providerLabel} is saturated.`,
          },
    );
    markSessionLeaseStatusInState(
      state,
      workspaceId,
      sessionLease?.id,
      run.workspaceCommand?.trim() ? "cooldown" : "warm",
    );
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

function estimateExecutionPromptTokens(
  objective: string,
  contextSummary?: string,
  steeringContext?: string,
): number {
  const joined = [objective, contextSummary, steeringContext]
    .filter((value) => Boolean(value?.trim()))
    .join("\n\n");
  return Math.max(1, Math.ceil(joined.length / 4));
}

function appendWakeupRequestInState(
  state: RuntimeState,
  input: {
    missionId: string;
    runId: string;
    workspaceId?: string;
    source: WakeupSource;
    reason?: string;
  },
): WakeupRequest {
  const wakeupRequest: WakeupRequest = {
    id: `wr-${input.runId}-${Date.now()}`,
    workspaceId: input.workspaceId ?? state.activeWorkspaceId,
    missionId: input.missionId,
    runId: input.runId,
    source: input.source,
    status: "claimed",
    requestedAt: new Date().toISOString(),
    requestedBy: input.source === "manual" ? "user" : "runtime",
    reason: input.reason,
  };
  state.wakeupRequestsByMissionId[input.missionId] = [
    ...(state.wakeupRequestsByMissionId[input.missionId] ?? []),
    wakeupRequest,
  ];
  return wakeupRequest;
}

function markWakeupRequestStatusInState(
  state: RuntimeState,
  missionId: string,
  wakeupRequestId: string | undefined,
  status: WakeupRequest["status"],
) {
  if (!wakeupRequestId) return;
  state.wakeupRequestsByMissionId[missionId] = (
    state.wakeupRequestsByMissionId[missionId] ?? []
  ).map((request) =>
    request.id === wakeupRequestId ? { ...request, status } : request,
  );
}

function findLatestOpenExecutionAttempt(
  state: RuntimeState,
  runId: string,
  executionAttemptId?: string,
): ExecutionAttempt | null {
  const attempts = state.executionAttemptsByRunId[runId] ?? [];
  const targetAttemptId =
    executionAttemptId ??
    [...attempts].reverse().find((attempt) => !attempt.finishedAt)?.id;
  if (!targetAttemptId) {
    return null;
  }
  return attempts.find((attempt) => attempt.id === targetAttemptId) ?? null;
}

function startExecutionAttemptInState(
  state: RuntimeState,
  input: {
    missionId: string;
    runId: string;
    wakeupRequestId?: string;
    provider: ExecutionAttempt["provider"];
    sessionLeaseId?: string;
    estimatedPromptTokens?: number;
    localityScoreHint?: number;
  },
): string {
  const attempts = state.executionAttemptsByRunId[input.runId] ?? [];
  const attemptId = `att-${input.runId}-${attempts.length + 1}`;
  const attempt: ExecutionAttempt = {
    id: attemptId,
    workspaceId: state.workspaceIdByMissionId[input.missionId] ?? state.activeWorkspaceId,
    missionId: input.missionId,
    runId: input.runId,
    wakeupRequestId: input.wakeupRequestId,
    attemptNumber: attempts.length + 1,
    provider: input.provider,
    status: "running",
    startedAt: new Date().toISOString(),
    estimatedPromptTokens: input.estimatedPromptTokens,
    localityScore: input.localityScoreHint,
    sessionLeaseId: input.sessionLeaseId,
  };
  state.executionAttemptsByRunId[input.runId] = [...attempts, attempt];
  return attemptId;
}

function allocateSessionLeaseInState(
  state: RuntimeState,
  input: {
    missionId: string;
    runId: string;
    workspaceId: string;
    provider: ExecutionAttempt["provider"];
    reusePolicy: SessionReusePolicy;
    affinityKey: string;
  },
): SessionLease | null {
  if (input.provider === "local") return null;
  if (input.reusePolicy === "ephemeral") {
    const lease: SessionLease = {
      id: `lease-${input.provider}-${Date.now()}`,
      provider: input.provider,
      workspaceId: input.workspaceId,
      missionId: input.missionId,
      runId: input.runId,
      affinityKey: input.affinityKey,
      status: "busy",
      reusePolicy: input.reusePolicy,
      lastUsedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      rotationReason: "ephemeral_policy",
    };
    state.sessionLeasesByWorkspaceId[input.workspaceId] = [
      ...(state.sessionLeasesByWorkspaceId[input.workspaceId] ?? []),
      lease,
    ];
    return lease;
  }
  const existing = (state.sessionLeasesByWorkspaceId[input.workspaceId] ?? []).find(
    (lease) =>
      lease.provider === input.provider &&
      lease.affinityKey === input.affinityKey &&
      lease.status !== "expired",
  );
  if (existing) {
    const updated: SessionLease = {
      ...existing,
      missionId: input.missionId,
      runId: input.runId,
      status: "busy",
      lastUsedAt: new Date().toISOString(),
    };
    state.sessionLeasesByWorkspaceId[input.workspaceId] = (
      state.sessionLeasesByWorkspaceId[input.workspaceId] ?? []
    ).map((lease) => (lease.id === updated.id ? updated : lease));
    return updated;
  }

  const lease: SessionLease = {
    id: `lease-${input.provider}-${Date.now()}`,
    provider: input.provider,
    workspaceId: input.workspaceId,
    missionId: input.missionId,
    runId: input.runId,
    affinityKey: input.affinityKey,
    status: "busy",
    reusePolicy: input.reusePolicy,
    lastUsedAt: new Date().toISOString(),
  };
  state.sessionLeasesByWorkspaceId[input.workspaceId] = [
    ...(state.sessionLeasesByWorkspaceId[input.workspaceId] ?? []),
    lease,
  ];
  return lease;
}

function attachAttemptToSessionLeaseInState(
  state: RuntimeState,
  workspaceId: string,
  leaseId: string | undefined,
  executionAttemptId: string,
) {
  if (!leaseId) return;
  state.sessionLeasesByWorkspaceId[workspaceId] = (
    state.sessionLeasesByWorkspaceId[workspaceId] ?? []
  ).map((lease) =>
    lease.id === leaseId
      ? {
          ...lease,
          lastAttemptId: executionAttemptId,
          lastUsedAt: new Date().toISOString(),
        }
      : lease,
  );
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
    wakeupRequestId?: string;
    executionAttemptId?: string;
    summary: string;
    source: "provider" | "mock" | "local";
    outcome: "completed" | "blocked" | "needs_review";
    stderr?: string;
    stdout?: string;
    generatedPatch?: string;
    executionStats?: RunExecutionStats;
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
  completeExecutionAttemptInState(state, {
    missionId: input.missionId,
    runId: input.runId,
    executionAttemptId: input.executionAttemptId,
    wakeupRequestId: input.wakeupRequestId,
    outcome: input.outcome,
    stdout: input.stdout,
    stderr: input.stderr,
    executionStats: input.executionStats,
  });
  located.run.executionStats = finalizeExecutionStatsForRun(
    state,
    input.runId,
    input.outcome,
    input.executionStats,
  );
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
  if (
    located.run.roleContractId === "learning_agent" &&
    (input.outcome === "completed" || input.outcome === "needs_review")
  ) {
    const compiled = compileLearningProposal({
      state,
      run: located.run,
    });
    if (compiled.appendedDecisions.length > 0) {
      located.run.decisions = [...located.run.decisions, ...compiled.appendedDecisions];
    }
    if (compiled.artifacts.length > 0) {
      located.run.artifacts = [...located.run.artifacts, ...compiled.artifacts];
    }
  }
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
      annotateExecutionAttemptFailureInState(
        state,
        input.runId,
        input.executionAttemptId,
        {
          status: "blocked",
          errorCode: "role_contract_output_validation_failed",
          errorMessage: outputValidation.errors.join("; "),
        },
      );
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
  session: {
    sessionId: string;
    provider: ProviderName;
    executionAttemptId?: string;
    leaseId?: string;
    affinityKey?: string;
    reusable?: boolean;
  },
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
  const attempts = state.executionAttemptsByRunId[runId] ?? [];
  const targetAttemptId =
    session.executionAttemptId ??
    [...attempts].reverse().find((attempt) => !attempt.finishedAt)?.id;
  if (targetAttemptId) {
    state.executionAttemptsByRunId[runId] = attempts.map((attempt) =>
      attempt.id === targetAttemptId
        ? {
            ...attempt,
            sessionId: session.sessionId,
            terminalSessionId: session.sessionId,
          }
        : attempt,
    );
  }
  bindSessionLeaseToSessionInState(
    state,
    missionId,
    runId,
    session.leaseId,
    targetAttemptId,
    session.sessionId,
  );
  return true;
}

function markExecutionAttemptStatusInState(
  state: RuntimeState,
  runId: string,
  executionAttemptId: string | undefined,
  status: ExecutionAttempt["status"],
  details?: {
    errorCode?: string;
    errorMessage?: string;
    stderrExcerpt?: string;
  },
) {
  if (!executionAttemptId) return;
  state.executionAttemptsByRunId[runId] = (
    state.executionAttemptsByRunId[runId] ?? []
  ).map((attempt) =>
    attempt.id === executionAttemptId
        ? {
          ...attempt,
          status,
          finishedAt: new Date().toISOString(),
          errorCode: details?.errorCode ?? attempt.errorCode,
          errorMessage: details?.errorMessage ?? attempt.errorMessage,
          stderrExcerpt: details?.stderrExcerpt ?? attempt.stderrExcerpt,
        }
      : attempt,
  );
}

function annotateExecutionAttemptFailureInState(
  state: RuntimeState,
  runId: string,
  executionAttemptId: string | undefined,
  details: {
    status?: ExecutionAttempt["status"];
    errorCode: string;
    errorMessage: string;
  },
) {
  const attempt = findLatestOpenExecutionAttempt(state, runId, executionAttemptId)
    ?? (executionAttemptId
      ? (state.executionAttemptsByRunId[runId] ?? []).find(
          (candidate) => candidate.id === executionAttemptId,
        ) ?? null
      : (state.executionAttemptsByRunId[runId] ?? []).at(-1) ?? null);
  if (!attempt) return;
  state.executionAttemptsByRunId[runId] = (
    state.executionAttemptsByRunId[runId] ?? []
  ).map((candidate) =>
    candidate.id === attempt.id
      ? {
          ...candidate,
          status: details.status ?? candidate.status,
          errorCode: details.errorCode,
          errorMessage: details.errorMessage,
          stderrExcerpt: excerptText(details.errorMessage),
        }
      : candidate,
  );
}

export function interruptAgentRunInState(
  state: RuntimeState,
  input: {
    missionId: string;
    runId: string;
    executionAttemptId?: string;
    wakeupRequestId?: string;
    reason: string;
    errorCode?: string;
  },
) {
  const attempt = findLatestOpenExecutionAttempt(
    state,
    input.runId,
    input.executionAttemptId,
  );
  if (!attempt) {
    return false;
  }

  const finishedAt = new Date().toISOString();
  state.executionAttemptsByRunId[input.runId] = (
    state.executionAttemptsByRunId[input.runId] ?? []
  ).map((candidate) =>
    candidate.id === attempt.id
      ? {
          ...candidate,
          status: "cancelled",
          finishedAt,
          errorCode: input.errorCode ?? "interrupted",
          errorMessage: input.reason,
          stderrExcerpt: excerptText(input.reason),
        }
      : candidate,
  );
  markWakeupRequestStatusInState(
    state,
    input.missionId,
    input.wakeupRequestId ?? attempt.wakeupRequestId,
    "cancelled",
  );
  if (attempt.sessionLeaseId) {
    markSessionLeaseStatusInState(
      state,
      attempt.workspaceId,
      attempt.sessionLeaseId,
      "cooldown",
    );
  }
  return true;
}

function completeExecutionAttemptInState(
  state: RuntimeState,
  input: {
    missionId: string;
    runId: string;
    executionAttemptId?: string;
    wakeupRequestId?: string;
    outcome: "completed" | "blocked" | "needs_review";
    stdout?: string;
    stderr?: string;
    executionStats?: RunExecutionStats;
  },
) {
  const attempts = state.executionAttemptsByRunId[input.runId] ?? [];
  const targetAttemptId = findLatestOpenExecutionAttempt(
    state,
    input.runId,
    input.executionAttemptId,
  )?.id;
  if (targetAttemptId) {
    let completedAttempt: ExecutionAttempt | null = null;
    state.executionAttemptsByRunId[input.runId] = attempts.map((attempt) =>
      attempt.id === targetAttemptId
        ? {
            ...attempt,
            status:
              input.outcome === "completed"
                ? "succeeded"
                : input.outcome === "needs_review"
                  ? "succeeded"
                  : "blocked",
            finishedAt: new Date().toISOString(),
            stdoutExcerpt: excerptText(input.stdout),
            stderrExcerpt: excerptText(input.stderr),
            outputChars:
              (input.stdout?.length ?? 0) + (input.stderr?.length ?? 0),
            latencyMs: input.executionStats?.latencyMs,
            estimatedPromptTokens:
              input.executionStats?.estimatedPromptTokens ??
              attempt.estimatedPromptTokens,
            localityScore:
              input.executionStats?.localityScore ?? attempt.localityScore,
          }
        : attempt,
    );
    completedAttempt =
      state.executionAttemptsByRunId[input.runId].find(
        (attempt) => attempt.id === targetAttemptId,
      ) ?? null;
    if (completedAttempt?.sessionLeaseId) {
      markSessionLeaseStatusInState(
        state,
        completedAttempt.workspaceId,
        completedAttempt.sessionLeaseId,
        input.outcome === "blocked" ? "cooldown" : "warm",
      );
    }
  }
  markWakeupRequestStatusInState(
    state,
    input.missionId,
    input.wakeupRequestId,
    "completed",
  );
}

function excerptText(value?: string, maxLength = 1_200): string | undefined {
  if (!value) return undefined;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}

function bindSessionLeaseToSessionInState(
  state: RuntimeState,
  missionId: string,
  runId: string,
  leaseId: string | undefined,
  executionAttemptId: string | undefined,
  sessionId: string,
) {
  const workspaceId =
    state.workspaceIdByMissionId[missionId] ?? state.activeWorkspaceId;
  const targetLeaseId =
    leaseId ??
    (state.executionAttemptsByRunId[runId] ?? []).find(
      (attempt) => attempt.id === executionAttemptId,
    )?.sessionLeaseId;
  if (!targetLeaseId) return;
  state.sessionLeasesByWorkspaceId[workspaceId] = (
    state.sessionLeasesByWorkspaceId[workspaceId] ?? []
  ).map((lease) =>
    lease.id === targetLeaseId
      ? {
          ...lease,
          sessionId,
          status: "busy",
          lastAttemptId: executionAttemptId ?? lease.lastAttemptId,
          lastUsedAt: new Date().toISOString(),
        }
      : lease,
  );
}

function markSessionLeaseStatusInState(
  state: RuntimeState,
  workspaceId: string,
  leaseId: string | undefined,
  status: SessionLease["status"],
) {
  if (!leaseId) return;
  state.sessionLeasesByWorkspaceId[workspaceId] = (
    state.sessionLeasesByWorkspaceId[workspaceId] ?? []
  ).map((lease) =>
    lease.id === leaseId
      ? {
          ...lease,
          status,
          lastUsedAt: new Date().toISOString(),
        }
      : lease,
  );
}

function resolveSessionReusePolicy(
  run: RunDetail,
  agent: AgentSnapshot,
  provider: ExecutionAttempt["provider"],
): SessionReusePolicy {
  if (run.sessionReusePolicy) {
    return run.sessionReusePolicy;
  }
  if (provider === "local") {
    return "ephemeral";
  }
  if (agent.role === "implementation") {
    return "prefer_reuse";
  }
  if (agent.role === "verification") {
    return "prefer_reuse";
  }
  return "ephemeral";
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
