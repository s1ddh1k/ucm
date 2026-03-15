import {
  activateMissionSelection,
  activateRunSelection,
  activateWorkspaceSelection,
  findNextAutopilotTarget,
} from "../../../packages/application/runtime-core.js";
import type {
  BudgetBucket,
  RunExecutionSession,
  MissionDetail,
  RunAutopilotBurstResult,
  MissionSnapshot,
  ProviderWindowSummary,
  RunAutopilotResult,
  RunDetail,
  RunEvent,
  ShellSnapshot,
  WorkspaceSummary,
} from "../shared/contracts";
import {
  type RuntimeStoreLike,
  RuntimeStore,
  type RuntimeStateChangeReason,
} from "./runtime-store";
import {
  type RuntimeState,
  createEmptyRuntimeState,
} from "./runtime-state";
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
  findRun,
  hydrateRunDetail,
  setAgentStatus,
} from "./runtime-run-helpers";
import {
  approveReleaseRevisionInState,
  createMissionInState,
  generateReleaseRevisionInState,
  handoffReleaseInState,
  submitSteeringInState,
} from "./runtime-mutations";
import {
  advanceMissionStatusInState,
  appendTerminalPreviewInState,
  completeAgentRunInState,
  maybeStartAgentExecutionInState,
  recordTerminalSessionInState,
  updateMissionStatusInState,
} from "./runtime-execution";
import type { ExecutionController } from "./execution-types";
import { scheduleFollowupRunInState } from "./runtime-scheduler";
import { normalizeRuntimeState } from "./runtime-state-normalizer";
import {
  buildShellSnapshot,
  getActiveMissionDetail,
  getActiveRunDetail,
  listMissionSnapshots,
  listRunsForActiveMission,
} from "./runtime-views";
import { addWorkspaceInState } from "./runtime-workspace-service";
import {
  browseWorkspaceDirectories as browseWorkspaceDirectoriesFromFs,
  createWorkspaceDirectory as createWorkspaceDirectoryOnFs,
} from "./workspace-browser-service";
import { projectRuntimeState } from "./runtime-state-index";
import path from "node:path";

function normalizePersistedState(
  parsed: Partial<RuntimeState>,
  seed: RuntimeState,
): RuntimeState {
  return {
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
  };
}

function createDefaultStore(
  onStateChange?: (reason: RuntimeStateChangeReason) => void,
): RuntimeStoreLike<RuntimeState> {
  const electron = require("electron") as typeof import("electron");
  const userDataPath = electron.app.getPath("userData");

  return new RuntimeStore(
    path.join(userDataPath, "runtime-state.db"),
    createEmptyRuntimeState,
    normalizePersistedState,
    onStateChange,
    {
      legacyJsonPath: path.join(userDataPath, "runtime-state.json"),
      projectState: projectRuntimeState,
    },
  );
}

function createDefaultExecutionService(): ExecutionController {
  const module = require("./execution-service") as typeof import("./execution-service");
  return new module.ExecutionService();
}

export class RuntimeService {
  private store: RuntimeStoreLike<RuntimeState>;
  private executionService: ExecutionController | null;
  private onStateChange?: (
    reason: RuntimeStateChangeReason,
  ) => void;

  constructor(options?: {
    onStateChange?: (reason: RuntimeStateChangeReason) => void;
    executionService?: ExecutionController;
    store?: RuntimeStoreLike<RuntimeState>;
  }) {
    this.executionService = options?.executionService ?? null;
    this.onStateChange = options?.onStateChange;
    this.store = options?.store ?? createDefaultStore(this.onStateChange);

    const normalizedState = this.normalizeState(this.store.read());
    this.store.write(normalizedState);
  }

  private getExecutionService(): ExecutionController {
    this.executionService ??= createDefaultExecutionService();
    return this.executionService;
  }

  private readState(): RuntimeState {
    return this.normalizeState(this.store.read());
  }

  private writeState(state: RuntimeState) {
    this.store.write(this.normalizeState(state));
  }

  listWorkspaces(): WorkspaceSummary[] {
    return this.readState().workspaces;
  }

  addWorkspace(input: { rootPath: string }): WorkspaceSummary[] {
    const state = this.readState();
    addWorkspaceInState(state, input);
    this.writeState(state);
    return this.readState().workspaces;
  }

  browseWorkspaceDirectories(input?: { rootPath?: string }) {
    return browseWorkspaceDirectoriesFromFs(input);
  }

  createWorkspaceDirectory(input: {
    parentPath: string;
    directoryName: string;
  }) {
    return createWorkspaceDirectoryOnFs(input);
  }

  listMissions(): MissionSnapshot[] {
    return listMissionSnapshots(this.readState());
  }

  setActiveWorkspace(input: { workspaceId: string }): WorkspaceSummary[] {
    const state = this.readState();
    if (!activateWorkspaceSelection(state, input.workspaceId)) {
      return state.workspaces;
    }
    this.writeState(state);
    return state.workspaces;
  }

  getActiveMission(): MissionDetail | null {
    return getActiveMissionDetail(this.readState());
  }

  setActiveMission(input: { missionId: string }): MissionDetail | null {
    const state = this.readState();
    if (!activateMissionSelection(state, input.missionId)) {
      return this.getActiveMission();
    }
    this.writeState(state);
    return state.missionDetailsById[input.missionId] ?? null;
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
    const builderId = `a-builder-${mission.id}`;
    const runId = `r-${mission.id}`;
    if (input.command?.trim()) {
      this.startAgentExecution({
        missionId: mission.id,
        runId,
        agentId: builderId,
      });
    }
    return mission;
  }

  getActiveRun(): RunDetail | null {
    return getActiveRunDetail(this.readState());
  }

  listRunsForActiveMission(): RunDetail[] {
    return listRunsForActiveMission(this.readState());
  }

  setActiveRun(input: { runId: string }): RunDetail | null {
    const state = this.readState();
    const located = activateRunSelection(state, input.runId);
    if (!located) {
      return this.getActiveRun();
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
      releases: [],
      handoffs: [],
    };

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

  generateReleaseRevision(input: {
    runId: string;
    releaseId: string;
    summary: string;
  }): RunDetail | null {
    const state = this.readState();
    const nextRun = generateReleaseRevisionInState(state, input);
    this.writeState(state);
    return nextRun;
  }

  handoffRelease(input: {
    runId: string;
    releaseRevisionId: string;
    channel: "inbox" | "share" | "export";
    target?: string;
  }): RunDetail | null {
    const state = this.readState();
    const nextRun = handoffReleaseInState(state, input);
    this.writeState(state);
    return nextRun;
  }

  approveReleaseRevision(input: {
    runId: string;
    releaseRevisionId: string;
  }): RunDetail | null {
    const state = this.readState();
    const approved = approveReleaseRevisionInState(state, input);
    if (!approved) {
      return null;
    }
    updateMissionStatusInState(state, approved.missionId, "completed");
    this.writeState(state);
    return approved.run;
  }

  autopilotStep(): RunAutopilotResult {
    const state = this.readState();
    const located = findNextAutopilotTarget(state);
    if (!located) {
      return {
        run: this.getActiveRun(),
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
      latestArtifactType: located.run.artifacts.at(-1)?.type,
      hasRelease: located.run.releases.length > 0,
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
    state.autopilotHandledEventIdsByRunId[located.run.id] = [
      ...handledIds,
      latestEvent.id,
    ];
    this.writeState(state);
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

  tickAutopilot(): RunAutopilotResult {
    const state = this.readState();
    if (this.resumeQueuedRuns(state)) {
      this.writeState(state);
      this.onStateChange?.("autopilot_applied");
    }
    const burst = this.autopilotBurst();
    if (burst.appliedCount > 0) {
      this.onStateChange?.("autopilot_applied");
    }
    return burst.lastResult;
  }

  autopilotBurst(input?: { maxSteps?: number }): RunAutopilotBurstResult {
    const maxSteps = Math.max(1, Math.min(16, input?.maxSteps ?? 6));
    const steps: RunAutopilotResult[] = [];

    for (let index = 0; index < maxSteps; index += 1) {
      const next = this.autopilotStep();
      steps.push(next);
      if (next.eventKind === "none") {
        break;
      }
    }

    const actionableSteps = steps.filter((step) => step.eventKind !== "none");
    const lastResult =
      steps.at(-1) ??
      ({
        run: this.getActiveRun(),
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
    return buildShellSnapshot(this.readState());
  }

  private normalizeState(state: RuntimeState): RuntimeState {
    return normalizeRuntimeState(state);
  }

  private resumeQueuedRuns(state: RuntimeState): boolean {
    const runs = Object.values(state.runsByMissionId).flat();
    const runningProviders = new Set(
      runs
        .filter((run) => run.status === "running" && run.providerPreference)
        .map((run) => run.providerPreference as "claude" | "codex"),
    );

    const queuedRun = runs.find(
      (run) =>
        run.status === "queued" &&
        run.providerPreference &&
        !runningProviders.has(run.providerPreference),
    );
    if (!queuedRun) {
      return false;
    }
    const provider = queuedRun.providerPreference;
    if (!provider) {
      return false;
    }

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
        executionService: this.getExecutionService(),
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
    return this.getExecutionService().writeTerminalSession(
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
    return this.getExecutionService().resizeTerminalSession(
      input.sessionId,
      cols,
      rows,
    );
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

    this.getExecutionService().killTerminalSession(input.sessionId);
    run.status = "blocked";
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

      if (transition.status !== "running") {
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
        executionService: this.getExecutionService(),
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
    summary: string;
    source: "provider" | "mock" | "local";
    outcome: "completed" | "blocked" | "needs_review";
    stderr?: string;
    stdout?: string;
    generatedPatch?: string;
    session?: RunExecutionSession;
  }) {
    const state = this.readState();
    const completed = completeAgentRunInState(state, input);
    if (!completed) {
      return;
    }
    this.writeState(state);
    this.onStateChange?.("run_completed");
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
      executionService: this.getExecutionService(),
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
    session: RunExecutionSession,
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
    const state = this.readState();
    const updated = appendTerminalPreviewInState(state, missionId, runId, chunk);
    if (!updated) {
      return;
    }
    this.writeState(state);
    this.onStateChange?.("terminal_updated");
  }
}
