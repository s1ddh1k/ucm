import path from "node:path";
import { resolveUserDataPath } from "./user-data-path";
import type {
  BudgetBucket,
  ExecutionAttempt,
  MissionDetail,
  RunAutopilotBurstResult,
  MissionSnapshot,
  RunAutopilotResult,
  RunDetail,
  RunEvent,
  SessionLease,
  ShellSnapshot,
  WakeupRequest,
  WorkspaceSummary,
} from "../shared/contracts";
import { ExecutionService } from "./execution-service";
import { PROVIDER_CAPABILITIES, type ProviderName } from "./provider-adapter";
import {
  type RuntimeStoreLike,
  RuntimeStore,
  type RuntimeStateChangeReason,
} from "./runtime-store";
import {
  type RuntimeState,
  cloneSeed,
} from "./runtime-state";
import {
  createWorkspaceSummary,
  discoverWorkspaceSummaries,
  isWorkspacePathAvailable,
} from "./workspace-discovery";
import {
  deriveLifecycleTransitions,
  deriveMissionStatus,
} from "./runtime-policy";
import {
  applyConductorDecision,
  decideFromContext,
} from "./runtime-conductor";
import {
  appendLifecycleEvent,
  appendRunEvent,
  captureRunOutputBaseline,
  ensureRunOutputBaseline,
  findRun,
  findLatestActionableArtifactType,
  hydrateRunDetail,
  setAgentStatus,
} from "./runtime-run-helpers";
import {
  approveDeliverableRevisionInState,
  createMissionInState,
  generateDeliverableRevisionInState,
  handoffDeliverableInState,
  submitSteeringInState,
} from "./runtime-mutations";
import { buildMissionContextArtifacts } from "./runtime-context-artifacts";
import {
  advanceMissionStatusInState,
  appendTerminalPreviewInState,
  completeAgentRunInState,
  interruptAgentRunInState,
  maybeStartAgentExecutionInState,
  recordTerminalSessionInState,
  updateMissionStatusInState,
} from "./runtime-execution";
import type { ExecutionController } from "./execution-types";
import { scheduleFollowupRunInState } from "./runtime-scheduler";
import {
  findQueuedRunToResume,
  listProviderWindowsForWorkspace,
} from "./runtime-provider-broker";
import {
  ROLE_CONTRACT_IDS,
  inferRoleContractIdForRun,
  loadRuntimeRoleRegistry,
  type RuntimeRoleRegistry,
} from "./runtime-role-registry";

const WORKSPACE_DISCOVERY_REFRESH_MS = 30_000;
const TERMINAL_PREVIEW_FLUSH_MS = 250;
const TERMINAL_PREVIEW_IMMEDIATE_FLUSH_BYTES = 8_192;
const KNOWN_ROLE_CONTRACT_IDS = new Set(ROLE_CONTRACT_IDS);

type PendingTerminalPreview = {
  missionId: string;
  runId: string;
  chunks: string[];
  size: number;
};

export class RuntimeService {
  private store: RuntimeStoreLike<RuntimeState>;
  private executionService: ExecutionController;
  private roleRegistry: RuntimeRoleRegistry | null;
  private state!: RuntimeState;
  private lastWorkspaceDiscoveryAt = 0;
  private pendingTerminalPreviews = new Map<string, PendingTerminalPreview>();
  private terminalPreviewFlushTimer: NodeJS.Timeout | null = null;
  private onStateChange?: (
    reason: RuntimeStateChangeReason,
  ) => void;

  constructor(options?: {
    onStateChange?: (reason: RuntimeStateChangeReason) => void;
    executionService?: ExecutionController;
    store?: RuntimeStoreLike<RuntimeState>;
    roleRegistry?: RuntimeRoleRegistry;
  }) {
    this.executionService = options?.executionService ?? new ExecutionService();
    this.onStateChange = options?.onStateChange;
    this.roleRegistry = options?.roleRegistry ?? null;
    this.store =
      options?.store ??
      new RuntimeStore(
        path.join(resolveUserDataPath(), "runtime-state.json"),
        cloneSeed,
        (parsed, seed) => ({
        activeWorkspaceId: parsed.activeWorkspaceId ?? seed.activeWorkspaceId,
        activeMissionId: parsed.activeMissionId ?? seed.activeMissionId,
        activeRunId: parsed.activeRunId ?? seed.activeRunId,
        missionBudgetById: parsed.missionBudgetById ?? seed.missionBudgetById,
        workspaces: parsed.workspaces ?? seed.workspaces,
          missions: parsed.missions ?? seed.missions,
          missionDetailsById: parsed.missionDetailsById ?? seed.missionDetailsById,
          workspaceIdByMissionId:
            parsed.workspaceIdByMissionId ?? seed.workspaceIdByMissionId,
          agentsByMissionId: parsed.agentsByMissionId ?? seed.agentsByMissionId,
          runsByMissionId: parsed.runsByMissionId ?? seed.runsByMissionId,
          runEventsByRunId: parsed.runEventsByRunId ?? {},
          lifecycleEventsByMissionId: parsed.lifecycleEventsByMissionId ?? {},
          autopilotHandledEventIdsByRunId:
            parsed.autopilotHandledEventIdsByRunId ?? {},
          wakeupRequestsByMissionId:
            parsed.wakeupRequestsByMissionId ?? {},
          executionAttemptsByRunId:
            parsed.executionAttemptsByRunId ?? {},
          sessionLeasesByWorkspaceId:
            parsed.sessionLeasesByWorkspaceId ?? {},
        }),
        this.onStateChange,
      );

    const normalizedState = this.normalizeState(this.store.read());
    this.state = normalizedState;
    this.lastWorkspaceDiscoveryAt = Date.now();
    this.store.write(normalizedState);
  }

  private getRoleRegistry(): RuntimeRoleRegistry {
    const roleRegistry = this.roleRegistry ?? loadRuntimeRoleRegistry();
    this.roleRegistry = roleRegistry;
    return roleRegistry;
  }

  private readState(): RuntimeState {
    return this.state;
  }

  private writeState(
    state: RuntimeState,
    options?: { emitChange?: boolean; projectState?: boolean },
  ) {
    const normalizedState = this.normalizeState(state, { includeDiscovery: false });
    this.state = normalizedState;
    this.store.write(normalizedState, options);
  }

  private refreshWorkspaceDiscovery(force = false): RuntimeState {
    const now = Date.now();
    if (!force && now - this.lastWorkspaceDiscoveryAt < WORKSPACE_DISCOVERY_REFRESH_MS) {
      return this.state;
    }

    const previousFingerprint = this.workspaceDiscoveryFingerprint(this.state);
    const refreshedState = this.normalizeState(this.state, { includeDiscovery: true });
    this.state = refreshedState;
    this.lastWorkspaceDiscoveryAt = now;

    if (previousFingerprint !== this.workspaceDiscoveryFingerprint(refreshedState)) {
      this.store.write(refreshedState);
    }

    return refreshedState;
  }

  private workspaceDiscoveryFingerprint(state: RuntimeState): string {
    return JSON.stringify({
      activeWorkspaceId: state.activeWorkspaceId,
      activeMissionId: state.activeMissionId,
      activeRunId: state.activeRunId,
      workspaces: state.workspaces.map((workspace) => ({
        id: workspace.id,
        rootPath: workspace.rootPath,
        active: workspace.active,
      })),
      workspaceIdByMissionId: state.workspaceIdByMissionId,
    });
  }

  private queueTerminalPreview(
    missionId: string,
    runId: string,
    chunk: string,
  ) {
    const key = `${missionId}:${runId}`;
    const pending = this.pendingTerminalPreviews.get(key) ?? {
      missionId,
      runId,
      chunks: [],
      size: 0,
    };
    pending.chunks.push(chunk);
    pending.size += chunk.length;
    this.pendingTerminalPreviews.set(key, pending);

    if (pending.size >= TERMINAL_PREVIEW_IMMEDIATE_FLUSH_BYTES) {
      this.flushPendingTerminalPreviews(key);
      return;
    }

    if (this.terminalPreviewFlushTimer) {
      return;
    }

    this.terminalPreviewFlushTimer = setTimeout(() => {
      this.terminalPreviewFlushTimer = null;
      this.flushPendingTerminalPreviews();
    }, TERMINAL_PREVIEW_FLUSH_MS);
    this.terminalPreviewFlushTimer.unref?.();
  }

  private flushPendingTerminalPreviews(targetKey?: string): boolean {
    if (!targetKey && this.terminalPreviewFlushTimer) {
      clearTimeout(this.terminalPreviewFlushTimer);
      this.terminalPreviewFlushTimer = null;
    }

    const pendingEntries = targetKey
      ? [this.pendingTerminalPreviews.get(targetKey)].filter(
          (entry): entry is PendingTerminalPreview => Boolean(entry),
        )
      : [...this.pendingTerminalPreviews.values()];
    if (pendingEntries.length === 0) {
      return false;
    }

    const state = this.readState();
    let updated = false;
    for (const entry of pendingEntries) {
      updated =
        appendTerminalPreviewInState(
          state,
          entry.missionId,
          entry.runId,
          entry.chunks.join(""),
        ) || updated;
      this.pendingTerminalPreviews.delete(`${entry.missionId}:${entry.runId}`);
    }

    if (updated) {
      this.writeState(state, { emitChange: false, projectState: false });
      this.onStateChange?.("terminal_updated");
    }

    return updated;
  }

  listWorkspaces(): WorkspaceSummary[] {
    return this.refreshWorkspaceDiscovery().workspaces;
  }

  addWorkspace(input: { rootPath: string }): WorkspaceSummary[] {
    const normalizedRootPath = path.resolve(input.rootPath);
    if (!isWorkspacePathAvailable(normalizedRootPath)) {
      return this.readState().workspaces;
    }

    const state = this.readState();
    const nextWorkspace = createWorkspaceSummary(normalizedRootPath);
    const workspaceByPath = new Map(
      state.workspaces.map((workspace) => [workspace.rootPath, workspace]),
    );
    workspaceByPath.set(normalizedRootPath, nextWorkspace);

    state.workspaces = [...workspaceByPath.values()];
    state.activeWorkspaceId = nextWorkspace.id;
    state.workspaces = state.workspaces.map((workspace) => ({
      ...workspace,
      active: workspace.id === nextWorkspace.id,
    }));

    const workspaceMissions = state.missions.filter(
      (mission) => state.workspaceIdByMissionId[mission.id] === nextWorkspace.id,
    );
    state.activeMissionId = workspaceMissions[0]?.id ?? "";
    state.activeRunId = state.activeMissionId
      ? (state.runsByMissionId[state.activeMissionId] ?? [])[0]?.id ?? ""
      : "";

    this.writeState(state);
    return this.readState().workspaces;
  }

  listMissions(): MissionSnapshot[] {
    const state = this.readState();
    return state.missions
      .filter(
        (mission) =>
          state.workspaceIdByMissionId[mission.id] === state.activeWorkspaceId,
      )
      .map((mission) => this.summarizeMission(state, mission));
  }

  private summarizeMission(
    state: RuntimeState,
    mission: MissionSnapshot,
  ): MissionSnapshot {
    const runs = state.runsByMissionId[mission.id] ?? [];
    const focusRun =
      runs.find(
        (run) => run.status === "blocked" || run.status === "needs_review",
      ) ??
      runs.find((run) => run.status === "running" || run.status === "queued") ??
      runs.at(-1) ??
      null;

    return {
      ...mission,
      lineStatus: focusRun?.status,
      latestResult: focusRun?.summary,
      artifactCount: focusRun?.artifacts.length ?? 0,
      attentionRequired:
        focusRun?.status === "blocked" || focusRun?.status === "needs_review",
    };
  }

  setActiveWorkspace(input: { workspaceId: string }): WorkspaceSummary[] {
    const state = this.readState();
    const targetWorkspace = state.workspaces.find(
      (workspace) => workspace.id === input.workspaceId,
    );
    if (!targetWorkspace) {
      return state.workspaces;
    }

    state.activeWorkspaceId = targetWorkspace.id;
    state.workspaces = state.workspaces.map((workspace) => ({
      ...workspace,
      active: workspace.id === targetWorkspace.id,
    }));

    const workspaceMissions = state.missions.filter(
      (mission) => state.workspaceIdByMissionId[mission.id] === targetWorkspace.id,
    );
    const nextMission =
      workspaceMissions.find((mission) => mission.id === state.activeMissionId) ??
      workspaceMissions[0] ??
      null;

    state.activeMissionId = nextMission?.id ?? "";
    const nextRuns = nextMission ? state.runsByMissionId[nextMission.id] ?? [] : [];
    state.activeRunId =
      nextRuns.find((run) => run.id === state.activeRunId)?.id ??
      nextRuns[0]?.id ??
      "";

    this.writeState(state);
    return state.workspaces;
  }

  getActiveMission(): MissionDetail | null {
    const state = this.readState();
    return state.activeMissionId
      ? (state.missionDetailsById[state.activeMissionId] ?? null)
      : null;
  }

  setActiveMission(input: { missionId: string }): MissionDetail | null {
    const state = this.readState();
    const mission = state.missions.find((item) => item.id === input.missionId);
    if (!mission) {
      return this.getActiveMission();
    }

    const workspaceId = state.workspaceIdByMissionId[mission.id];
    state.activeMissionId = mission.id;
    const missionRuns = state.runsByMissionId[mission.id] ?? [];
    state.activeRunId =
      missionRuns.find((run) => run.id === state.activeRunId)?.id ??
      missionRuns[0]?.id ??
      "";
    if (workspaceId) {
      state.activeWorkspaceId = workspaceId;
      state.workspaces = state.workspaces.map((workspace) => ({
        ...workspace,
        active: workspace.id === workspaceId,
      }));
    }

    this.writeState(state);
    return state.missionDetailsById[mission.id] ?? null;
  }

  createMission(input: {
    workspaceId: string;
    title: string;
    goal: string;
    command?: string;
  }): MissionSnapshot {
    const state = this.readState();
    const mission = createMissionInState(state, input);
    this.writeState(state);
    const runId = `r-${mission.id}`;
    const agentId = input.command?.trim()
      ? `a-builder-${mission.id}`
      : `a-planner-${mission.id}`;
    this.startAgentExecution({
      missionId: mission.id,
      runId,
      agentId,
    });
    return mission;
  }

  getActiveRun(): RunDetail | null {
    const state = this.readState();
    if (!state.activeMissionId) {
      return null;
    }
    const runs = state.runsByMissionId[state.activeMissionId] ?? [];
    const run =
      runs.find((item) => item.id === state.activeRunId) ?? runs[0] ?? null;
    return run ? hydrateRunDetail(state, run) : null;
  }

  listRunsForActiveMission(): RunDetail[] {
    const state = this.readState();
    if (!state.activeMissionId) {
      return [];
    }
    return (state.runsByMissionId[state.activeMissionId] ?? []).map((run) =>
      hydrateRunDetail(state, run),
    );
  }

  listWakeupRequestsForRun(input: { runId: string }): WakeupRequest[] {
    const state = this.readState();
    const located = findRun(state, input.runId);
    if (!located) {
      return [];
    }
    return [...(state.wakeupRequestsByMissionId[located.missionId] ?? [])]
      .filter((request) => request.runId === input.runId)
      .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  }

  listExecutionAttemptsForRun(input: { runId: string }): ExecutionAttempt[] {
    const state = this.readState();
    return [...(state.executionAttemptsByRunId[input.runId] ?? [])].sort(
      (a, b) => a.attemptNumber - b.attemptNumber,
    );
  }

  listSessionLeasesForRun(input: { runId: string }): SessionLease[] {
    const state = this.readState();
    const located = findRun(state, input.runId);
    if (!located) {
      return [];
    }
    const workspaceId =
      state.workspaceIdByMissionId[located.missionId] ?? state.activeWorkspaceId;
    return [...(state.sessionLeasesByWorkspaceId[workspaceId] ?? [])]
      .filter(
        (lease) =>
          lease.missionId === located.missionId ||
          lease.runId === input.runId ||
          lease.lastAttemptId ===
            (state.executionAttemptsByRunId[input.runId] ?? []).at(-1)?.id,
      )
      .map((lease) => ({
        ...lease,
        resumable:
          lease.status === "warm" &&
          Boolean(lease.sessionId) &&
          PROVIDER_CAPABILITIES[lease.provider].resumeSupport !== "none",
      }))
      .sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
  }

  setActiveRun(input: { runId: string }): RunDetail | null {
    const state = this.readState();
    const located = findRun(state, input.runId);
    if (!located) {
      return this.getActiveRun();
    }

    state.activeMissionId = located.missionId;
    state.activeRunId = located.run.id;
    const workspaceId = state.workspaceIdByMissionId[located.missionId];
    if (workspaceId) {
      state.activeWorkspaceId = workspaceId;
      state.workspaces = state.workspaces.map((workspace) => ({
        ...workspace,
        active: workspace.id === workspaceId,
      }));
    }

    this.writeState(state);
    return hydrateRunDetail(state, located.run);
  }

  retryRun(input: { runId: string }): RunDetail | null {
    const state = this.readState();
    const located = findRun(state, input.runId);
    if (!located?.run.workspaceCommand?.trim()) {
      return this.getActiveRun();
    }

    const sourceRun = located.run;
    const missionId = located.missionId;
    const workspaceId = state.workspaceIdByMissionId[missionId];
    const nextRunId = `r-${missionId}-retry-${Date.now()}`;
    const latestSourceEvent = (state.runEventsByRunId[sourceRun.id] ?? []).at(-1);
    const retryEventId = `ev-retry-${Date.now()}`;
    const builderAgent =
      (state.agentsByMissionId[missionId] ?? []).find(
        (agent) => agent.role === "implementation",
      ) ?? null;
    if (!builderAgent) {
      return this.getActiveRun();
    }

    const nextRun: RunDetail = {
      ...sourceRun,
      id: nextRunId,
      agentId: builderAgent.id,
      roleContractId: "builder_agent",
      title: sourceRun.title.includes("(retry)")
        ? sourceRun.title
        : `${sourceRun.title} (retry)`,
      status: "running",
      summary: `Re-running "${sourceRun.workspaceCommand}" in the selected workspace.`,
      terminalSessionId: undefined,
      terminalProvider: undefined,
      terminalPreview: [
        `$ ${sourceRun.workspaceCommand}`,
        "Manual re-run started from the desktop app.",
      ],
      origin: {
        parentRunId: sourceRun.id,
        sourceEventId: latestSourceEvent?.id ?? retryEventId,
        sourceEventKind: latestSourceEvent?.kind ?? "completed",
        schedulerRuleId: "manual_retry",
        spawnMode: "execute",
        budgetClass:
          sourceRun.budgetClass ?? sourceRun.origin?.budgetClass ?? "standard",
      },
      timeline: [
        {
          id: `tl-start-${nextRunId}`,
          kind: "started",
          summary: "Manual re-run was started from the desktop app.",
          timestampLabel: "just now",
        },
      ],
      decisions: [
        {
          id: `d-retry-${nextRunId}`,
          category: "orchestration",
          summary: "Restart the same workspace command as a fresh run.",
          rationale:
            "Keep the previous run intact and capture the retry as a separate execution record.",
        },
      ],
      artifacts: [],
      runEvents: [],
      deliverables: [],
      handoffs: [],
    };
    const missionDetail = state.missionDetailsById[missionId] ?? null;
    const mission = state.missions.find((item) => item.id === missionId) ?? null;
    if (missionDetail) {
      nextRun.artifacts = buildMissionContextArtifacts({
        missionId,
        runId: nextRunId,
        title: mission?.title ?? sourceRun.title,
        goal: mission?.goal ?? missionDetail.goal,
        missionDetail,
        decisions: nextRun.decisions,
      });
    }
    nextRun.outputBaseline = captureRunOutputBaseline(nextRun);

    state.runsByMissionId[missionId] = [
      ...(state.runsByMissionId[missionId] ?? []),
      nextRun,
    ];
    state.runEventsByRunId[nextRunId] = [
      {
        id: retryEventId,
        runId: nextRunId,
        agentId: builderAgent.id,
        kind: "agent_status_changed",
        summary: "Manual re-run requested from the desktop app.",
        createdAtLabel: "just now",
        metadata: {
          source: "manual_retry",
          command: sourceRun.workspaceCommand ?? "",
        },
      },
    ];
    state.activeMissionId = missionId;
    state.activeRunId = nextRunId;
    if (workspaceId) {
      state.activeWorkspaceId = workspaceId;
      state.workspaces = state.workspaces.map((workspace) => ({
        ...workspace,
        active: workspace.id === workspaceId,
      }));
    }
    updateMissionStatusInState(state, missionId, "running");
    setAgentStatus(state, missionId, builderAgent.id, "running");
    appendLifecycleEvent(state, missionId, {
      agentId: builderAgent.id,
      kind: "resumed",
      summary: "Builder restarted the workspace command from the desktop app.",
      createdAtLabel: "just now",
    });

    this.writeState(state);
    this.startAgentExecution({
      missionId,
      runId: nextRunId,
      agentId: builderAgent.id,
    });
    return this.getActiveRun();
  }

  generateDeliverableRevision(input: {
    runId: string;
    deliverableId: string;
    summary: string;
  }): RunDetail | null {
    const state = this.readState();
    const nextRun = generateDeliverableRevisionInState(state, input);
    this.writeState(state);
    return nextRun;
  }

  handoffDeliverable(input: {
    runId: string;
    deliverableRevisionId: string;
    channel: "inbox" | "share" | "export";
    target?: string;
  }): RunDetail | null {
    const state = this.readState();
    const nextRun = handoffDeliverableInState(state, input);
    this.writeState(state);
    return nextRun;
  }

  approveDeliverableRevision(input: {
    runId: string;
    deliverableRevisionId: string;
  }): RunDetail | null {
    const state = this.readState();
    const approved = approveDeliverableRevisionInState(state, input);
    if (!approved) {
      return null;
    }
    updateMissionStatusInState(state, approved.missionId, "completed");
    this.writeState(state);
    return approved.run;
  }

  autopilotStep(): RunAutopilotResult {
    const state = this.readState();
    const result = this.autopilotStepOnState(state);
    if (result.eventKind !== "none") {
      this.writeState(state);
    }
    return result;
  }

  private autopilotStepOnState(state: RuntimeState): RunAutopilotResult {
    const located = this.findNextAutopilotTarget(state);
    if (!located) {
      const activeRun = this.resolveActiveRun(state);
      return {
        run: activeRun,
        eventKind: "none",
        decision: "observe",
        summary: "Autopilot found no pending run events across active missions.",
      };
    }

    const { event: latestEvent } = located;
    state.activeMissionId = located.missionId;
    state.activeRunId = located.run.id;
    const workspaceId = state.workspaceIdByMissionId[located.missionId];
    if (workspaceId) {
      state.activeWorkspaceId = workspaceId;
      state.workspaces = state.workspaces.map((workspace) => ({
        ...workspace,
        active: workspace.id === workspaceId,
      }));
    }

    const decision = decideFromContext({
      run: located.run,
      event: latestEvent,
      latestArtifactType: findLatestActionableArtifactType(located.run),
      hasDeliverable: (located.run.deliverables ?? []).length > 0,
    });
    advanceMissionStatusInState(state, located.missionId, latestEvent.kind, deriveMissionStatus);
    this.applyAgentLifecyclePolicy(
      state,
      located.missionId,
      located.run,
      latestEvent,
    );
    applyConductorDecision(state, located.run, decision);

    const handledIds = state.autopilotHandledEventIdsByRunId[located.run.id] ?? [];
    handledIds.push(latestEvent.id);
    state.autopilotHandledEventIdsByRunId[located.run.id] =
      handledIds.length > 200 ? handledIds.slice(-200) : handledIds;
    return {
      run: hydrateRunDetail(state, located.run),
      eventKind:
        latestEvent.kind === "blocked" ||
        latestEvent.kind === "agent_status_changed" ||
        latestEvent.kind === "needs_review" ||
        latestEvent.kind === "review_requested" ||
        latestEvent.kind === "steering_requested" ||
        latestEvent.kind === "artifact_created" ||
        latestEvent.kind === "completed"
          ? latestEvent.kind
          : "none",
      decision: decision.decision,
      summary: decision.summary,
    };
  }

  private resolveActiveRun(state: RuntimeState): RunDetail | null {
    if (!state.activeMissionId) {
      return null;
    }
    const runs = state.runsByMissionId[state.activeMissionId] ?? [];
    const run =
      runs.find((item) => item.id === state.activeRunId) ?? runs[0] ?? null;
    return run ? hydrateRunDetail(state, run) : null;
  }

  private findNextAutopilotTarget(state: RuntimeState):
    | { missionId: string; run: RunDetail; event: RunEvent }
    | null {
    const missionIds = [
      state.activeMissionId,
      ...state.missions.map((mission) => mission.id).filter((id) => id !== state.activeMissionId),
    ];

    for (const missionId of missionIds) {
      const runs = state.runsByMissionId[missionId] ?? [];
      const orderedRuns = [
        ...runs.filter((run) => run.id === state.activeRunId),
        ...runs.filter((run) => run.id !== state.activeRunId),
      ];

      for (const run of orderedRuns) {
        const handledIds = new Set(
          state.autopilotHandledEventIdsByRunId[run.id] ?? [],
        );
        const nextEvent = [...(state.runEventsByRunId[run.id] ?? [])]
          .reverse()
          .find((event) => !handledIds.has(event.id));
        if (nextEvent) {
          return { missionId, run, event: nextEvent };
        }
      }
    }

    return null;
  }

  tickAutopilot(): RunAutopilotResult {
    const state = this.readState();
    let dirty = this.resumeQueuedRuns(state);
    const burst = this.autopilotBurstOnState(state);
    dirty = dirty || burst.appliedCount > 0;
    if (dirty) {
      this.writeState(state);
      this.onStateChange?.("autopilot_applied");
    }
    return burst.lastResult;
  }

  autopilotBurst(input?: { maxSteps?: number }): RunAutopilotBurstResult {
    const state = this.readState();
    const burst = this.autopilotBurstOnState(state, input);
    if (burst.appliedCount > 0) {
      this.writeState(state);
    }
    return burst;
  }

  private autopilotBurstOnState(
    state: RuntimeState,
    input?: { maxSteps?: number },
  ): RunAutopilotBurstResult {
    const maxSteps = Math.max(1, Math.min(16, input?.maxSteps ?? 6));
    const steps: RunAutopilotResult[] = [];

    for (let index = 0; index < maxSteps; index += 1) {
      const next = this.autopilotStepOnState(state);
      steps.push(next);
      if (next.eventKind === "none") {
        break;
      }
    }

    const actionableSteps = steps.filter((step) => step.eventKind !== "none");
    const lastResult =
      steps.at(-1) ??
      ({
        run: this.resolveActiveRun(state),
        eventKind: "none",
        decision: "observe",
        summary: "Autopilot burst had no work to process.",
      } satisfies RunAutopilotResult);

    return {
      steps,
      appliedCount: actionableSteps.length,
      lastResult,
    };
  }

  submitSteering(input: { runId: string; text: string }): RunDetail | null {
    const state = this.readState();
    const nextRun = submitSteeringInState(state, input);
    this.writeState(state);
    return nextRun;
  }

  getShellSnapshot(): ShellSnapshot {
    const state = this.readState();
    const workspace =
      state.workspaces.find((item) => item.id === state.activeWorkspaceId) ??
      state.workspaces[0];
    const workspaceMissionIds = new Set(
      Object.entries(state.workspaceIdByMissionId)
        .filter(([, workspaceId]) => workspaceId === workspace?.id)
        .map(([missionId]) => missionId),
    );
    const workspaceMissions = state.missions.filter((mission) =>
      workspaceMissionIds.has(mission.id),
    );
    const mission =
      workspaceMissions.find((item) => item.id === state.activeMissionId) ??
      workspaceMissions[0];
    const agents = mission ? state.agentsByMissionId[mission.id] ?? [] : [];

    return {
      workspaceName: workspace?.name ?? "No workspace",
      missionName: mission?.title ?? "No mission",
      budgetLabel: this.formatBudgetLabel(state, mission?.id),
      budgetBuckets: this.listBudgetBuckets(state, mission?.id),
      providerWindows: listProviderWindowsForWorkspace(
        state,
        state.activeWorkspaceId,
      ),
      activeAgents: agents.filter((agent) => agent.status !== "idle").length,
      blockedAgents: agents.filter((agent) => agent.status === "blocked").length,
      reviewCount: agents.filter((agent) => agent.status === "needs_review").length,
      agents,
      lifecycleEvents: (
        state.lifecycleEventsByMissionId[mission?.id ?? ""] ?? []
      ).slice(-6).reverse(),
      missions: workspaceMissions.slice(0, 6).map((item) => this.summarizeMission(state, item)),
    };
  }

  private formatBudgetLabel(state: RuntimeState, missionId?: string): string {
    const budgetBuckets = this.listBudgetBuckets(state, missionId);
    if (budgetBuckets.length === 0) {
      return "No budget";
    }

    const used = budgetBuckets.reduce((sum, bucket) => sum + bucket.used, 0);
    const limit = budgetBuckets.reduce((sum, bucket) => sum + bucket.limit, 0);
    return `${used} / ${limit} budget slots`;
  }

  private listBudgetBuckets(
    state: RuntimeState,
    missionId?: string,
  ): BudgetBucket[] {
    const budget = missionId ? state.missionBudgetById[missionId] : null;
    if (!budget) {
      return [];
    }

    return [
      { className: "light", ...budget.light },
      { className: "standard", ...budget.standard },
      { className: "heavy", ...budget.heavy },
    ];
  }

  private normalizeState(
    state: RuntimeState,
    options?: { includeDiscovery?: boolean },
  ): RuntimeState {
    const discoveredWorkspaces =
      options?.includeDiscovery === false ? [] : discoverWorkspaceSummaries();
    const validStoredWorkspaces = state.workspaces.filter((workspace) =>
      isWorkspacePathAvailable(workspace.rootPath),
    );
    const workspaceByPath = new Map<string, WorkspaceSummary>();

    for (const workspace of [...discoveredWorkspaces, ...validStoredWorkspaces]) {
      const normalizedRootPath = path.resolve(workspace.rootPath);
      workspaceByPath.set(normalizedRootPath, {
        ...workspace,
        rootPath: normalizedRootPath,
      });
    }

    if (workspaceByPath.size === 0) {
      const fallbackWorkspace = createWorkspaceSummary(process.cwd(), true);
      workspaceByPath.set(fallbackWorkspace.rootPath, fallbackWorkspace);
    }

    const workspaces = [...workspaceByPath.values()];
    const activeWorkspaceId = workspaces.some(
      (workspace) => workspace.id === state.activeWorkspaceId,
    )
      ? state.activeWorkspaceId
      : workspaces[0]?.id ?? "";
    const normalizedWorkspaceIds = new Set(
      workspaces.map((workspace) => workspace.id),
    );
    const workspaceIdByMissionId = { ...state.workspaceIdByMissionId };

    for (const mission of state.missions) {
      const workspaceId = workspaceIdByMissionId[mission.id];
      if (!workspaceId || !normalizedWorkspaceIds.has(workspaceId)) {
        workspaceIdByMissionId[mission.id] = activeWorkspaceId;
      }
    }

    const activeWorkspaceMissions = state.missions.filter(
      (mission) => workspaceIdByMissionId[mission.id] === activeWorkspaceId,
    );
    const activeMissionId = activeWorkspaceMissions.some(
      (mission) => mission.id === state.activeMissionId,
    )
      ? state.activeMissionId
      : activeWorkspaceMissions[0]?.id ?? "";
    const activeMissionRuns = activeMissionId
      ? state.runsByMissionId[activeMissionId] ?? []
      : [];
    const activeRunId = activeMissionRuns.some(
      (run) => run.id === state.activeRunId,
    )
      ? state.activeRunId
      : activeMissionRuns[0]?.id ?? "";

    return {
      ...state,
      activeWorkspaceId,
      activeMissionId,
      activeRunId,
      runsByMissionId: Object.fromEntries(
        Object.entries(state.runsByMissionId).map(([missionId, runs]) => {
          const agentsById = new Map(
            (state.agentsByMissionId[missionId] ?? []).map((agent) => [agent.id, agent]),
          );
          return [
            missionId,
            runs.map((run) => {
              const agent = agentsById.get(run.agentId);
              const roleContractId =
                run.roleContractId &&
                KNOWN_ROLE_CONTRACT_IDS.has(run.roleContractId)
                  ? run.roleContractId
                  : inferRoleContractIdForRun(run, agent?.role);
              return {
                ...ensureRunOutputBaseline(run),
                roleContractId,
              };
            }),
          ];
        }),
      ),
      workspaceIdByMissionId,
      workspaces: workspaces.map((workspace) => ({
        ...workspace,
        active: workspace.id === activeWorkspaceId,
      })),
    };
  }

  private resumeQueuedRuns(state: RuntimeState): boolean {
    const candidate = findQueuedRunToResume(state);
    if (!candidate) {
      return false;
    }
    const { run: queuedRun, provider } = candidate;

    const missionId = queuedRun.missionId;
    queuedRun.status = "running";
    const agent = (state.agentsByMissionId[missionId] ?? []).find(
      (item) => item.id === queuedRun.agentId,
    );
    if (agent) {
      setAgentStatus(state, missionId, agent.id, "running");
      appendLifecycleEvent(state, missionId, {
        agentId: agent.id,
        kind: "resumed",
        summary: `${agent.name} resumed because the ${provider} provider window reopened.`,
        createdAtLabel: "just now",
      });
      appendRunEvent(state, queuedRun.id, {
        kind: "agent_status_changed",
        agentId: agent.id,
        summary: `${agent.name} resumed automatically after the ${provider} provider window reopened.`,
        createdAtLabel: "just now",
        metadata: {
          source: "provider_resume",
          provider,
        },
      });
      maybeStartAgentExecutionInState({
        state,
        missionId,
        runId: queuedRun.id,
        agentId: agent.id,
        executionService: this.executionService,
        roleRegistry: this.getRoleRegistry(),
        callbacks: {
          onSessionStart: (nextMissionId, nextRunId, session) => {
            this.recordTerminalSession(nextMissionId, nextRunId, session);
          },
          onTerminalData: (nextMissionId, nextRunId, chunk) => {
            this.appendTerminalPreview(nextMissionId, nextRunId, chunk);
          },
          onComplete: (result) => {
            this.completeAgentRun(result);
          },
        },
      });
      return true;
    }

    return false;
  }

  writeTerminal(input: { sessionId: string; data: string }): boolean {
    const payload = input.data;
    if (!payload.trim()) {
      return false;
    }
    return this.executionService.writeTerminalSession(
      input.sessionId,
      payload.endsWith("\n") ? payload : `${payload}\n`,
    );
  }

  resizeTerminal(input: {
    sessionId: string;
    cols: number;
    rows: number;
  }): boolean {
    const cols = Math.max(40, Math.min(240, Math.floor(input.cols)));
    const rows = Math.max(12, Math.min(80, Math.floor(input.rows)));
    return this.executionService.resizeTerminalSession(input.sessionId, cols, rows);
  }

  killTerminal(input: { sessionId: string }): boolean {
    const state = this.readState();
    const located = Object.entries(state.runsByMissionId).find(([, runs]) =>
      runs.some((run) => run.terminalSessionId === input.sessionId),
    );
    if (!located) {
      return false;
    }

    const [missionId, runs] = located;
    const run = runs.find((item) => item.terminalSessionId === input.sessionId);
    if (!run) {
      return false;
    }

    this.executionService.killTerminalSession(input.sessionId);
    const latestAttempt = [...(state.executionAttemptsByRunId[run.id] ?? [])]
      .reverse()
      .find((attempt) => !attempt.finishedAt);
    interruptAgentRunInState(state, {
      missionId,
      runId: run.id,
      executionAttemptId: latestAttempt?.id,
      wakeupRequestId: latestAttempt?.wakeupRequestId,
      reason: "Human observer stopped the live terminal session.",
      errorCode: "terminal_killed",
    });
    run.status = "blocked";
    run.terminalSessionId = undefined;
    run.timeline = [
      ...run.timeline,
      {
        id: `tl-terminal-stop-${Date.now()}`,
        kind: "blocked",
        summary: "Human observer stopped the live terminal session.",
        timestampLabel: "just now",
      },
    ];
    appendRunEvent(state, run.id, {
      kind: "blocked",
      agentId: run.agentId,
      summary: "Live terminal session was stopped by the human observer.",
      createdAtLabel: "just now",
      metadata: {
        source: "terminal_kill",
      },
    });
    setAgentStatus(state, missionId, run.agentId, "blocked");
    appendLifecycleEvent(state, missionId, {
      agentId: run.agentId,
      kind: "blocked",
      summary: "Live terminal session was stopped by the human observer.",
      createdAtLabel: "just now",
    });
    this.writeState(state);
    return true;
  }

  private applyAgentLifecyclePolicy(
    state: RuntimeState,
    missionId: string,
    run: RunDetail,
    event: RunEvent,
  ) {
    const agents = state.agentsByMissionId[missionId] ?? [];
    const missionDetail = state.missionDetailsById[missionId] ?? null;
    const transitions = deriveLifecycleTransitions(
      agents,
      missionDetail,
      run,
      event,
    );

    for (const transition of transitions) {
      const agent = (state.agentsByMissionId[missionId] ?? []).find(
        (item) => item.id === transition.agentId,
      );
      if (!agent) {
        continue;
      }

      const scheduledRun = scheduleFollowupRunInState({
        state,
        missionId,
        sourceRun: run,
        sourceEvent: event,
        agent,
      });

      if (
        transition.status === "running" &&
        transition.agentId !== run.agentId &&
        !scheduledRun
      ) {
        continue;
      }

      setAgentStatus(state, missionId, transition.agentId, transition.status);
      appendLifecycleEvent(state, missionId, {
        agentId: transition.agentId,
        kind: transition.lifecycleKind,
        summary: transition.summary,
        createdAtLabel: "just now",
      });
      appendRunEvent(state, event.runId, {
        kind: "agent_status_changed",
        agentId: transition.agentId,
        summary: transition.summary,
        createdAtLabel: "just now",
        metadata: {
          status: transition.status,
          sourceEvent: event.kind,
        },
      });

      if (transition.status !== "running" && transition.status !== "needs_review") {
        continue;
      }

      if (scheduledRun?.outcome === "blocked") {
        appendRunEvent(state, event.runId, {
          kind: "agent_status_changed",
          agentId: transition.agentId,
          summary:
            scheduledRun.reason ??
            `Governor blocked ${scheduledRun.ruleId} follow-up work.`,
          createdAtLabel: "just now",
          metadata: {
            status: "idle",
            sourceEvent: event.kind,
            schedulerRuleId: scheduledRun.ruleId,
            governor: "blocked",
          },
        });
        setAgentStatus(state, missionId, transition.agentId, "idle");
        appendLifecycleEvent(state, missionId, {
          agentId: transition.agentId,
          kind: "parked",
          summary:
            scheduledRun.reason ??
            `${agent.name} was parked because governor limits blocked follow-up execution.`,
          createdAtLabel: "just now",
        });
        continue;
      }

      if (scheduledRun?.spawnMode !== "execute" && scheduledRun) {
        continue;
      }

      if (!scheduledRun && transition.agentId !== run.agentId) {
        continue;
      }

      maybeStartAgentExecutionInState({
        state,
        missionId,
        runId: scheduledRun?.runId ?? run.id,
        agentId: transition.agentId,
        triggerSource: "automation",
        executionService: this.executionService,
        roleRegistry: this.getRoleRegistry(),
        callbacks: {
          onSessionStart: (nextMissionId, nextRunId, session) => {
            this.recordTerminalSession(nextMissionId, nextRunId, session);
          },
          onTerminalData: (nextMissionId, nextRunId, chunk) => {
            this.appendTerminalPreview(nextMissionId, nextRunId, chunk);
          },
          onComplete: (result) => {
            this.completeAgentRun(result);
          },
        },
      });
    }
  }

  private completeAgentRun(input: {
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
    executionStats?: RunDetail["executionStats"];
  }) {
    this.flushPendingTerminalPreviews(`${input.missionId}:${input.runId}`);
    const state = this.readState();
    const completed = completeAgentRunInState(state, input, this.getRoleRegistry());
    if (!completed) {
      return;
    }
    this.tryAutoApprove(state, completed.run, completed.agent);
    this.writeState(state);
    this.onStateChange?.("run_completed");
  }

  private tryAutoApprove(
    state: RuntimeState,
    run: RunDetail,
    agent: { role: string },
  ) {
    if (run.status !== "completed") {
      return;
    }
    // Auto-complete mission when builder or verifier finishes
    if (agent.role === "implementation" || agent.role === "verification") {
      updateMissionStatusInState(state, run.missionId, "completed");
    }
  }

  private startAgentExecution(input: {
    missionId: string;
    runId: string;
    agentId: string;
  }) {
    const state = this.readState();
    maybeStartAgentExecutionInState({
      state,
      missionId: input.missionId,
      runId: input.runId,
      agentId: input.agentId,
      triggerSource: "manual",
      executionService: this.executionService,
      roleRegistry: this.getRoleRegistry(),
      callbacks: {
        onSessionStart: (nextMissionId, nextRunId, session) => {
          this.recordTerminalSession(nextMissionId, nextRunId, session);
        },
        onTerminalData: (nextMissionId, nextRunId, chunk) => {
          this.appendTerminalPreview(nextMissionId, nextRunId, chunk);
        },
        onComplete: (result) => {
          this.completeAgentRun(result);
        },
      },
    });
    this.writeState(state);
  }

  private recordTerminalSession(
    missionId: string,
    runId: string,
    session: { sessionId: string; provider: ProviderName; executionAttemptId?: string },
  ) {
    const state = this.readState();
    const updated = recordTerminalSessionInState(state, missionId, runId, session);
    if (!updated) {
      return;
    }
    this.writeState(state);
  }

  private appendTerminalPreview(
    missionId: string,
    runId: string,
    chunk: string,
  ) {
    this.queueTerminalPreview(missionId, runId, chunk);
  }
}
