import type {
  EngineName,
  HandoffChannel,
  MissionRecord as CoreMissionRecord,
  MissionStatus,
  RunRecord as CoreRunRecord,
  RunStatus,
  WorkspaceRecord as CoreWorkspaceRecord,
} from "./src/records";

export type DesktopMissionStatus = Exclude<MissionStatus, "cancelled">;
export type DesktopRunStatus = Extract<
  RunStatus,
  "queued" | "running" | "blocked" | "needs_review" | "completed"
>;
export type ProviderName = Extract<EngineName, "claude" | "codex">;

export type WorkspaceSummary = Pick<
  CoreWorkspaceRecord,
  "id" | "name" | "rootPath"
> & {
  active: boolean;
};

export type WorkspaceBrowserEntry = {
  name: string;
  path: string;
  isRepositoryRoot: boolean;
};

export type WorkspaceBrowserSnapshot = {
  currentPath: string;
  parentPath: string | null;
  homePath: string;
  directories: WorkspaceBrowserEntry[];
};

export type AgentSnapshot = {
  id: string;
  name: string;
  role: string;
  status: "idle" | "running" | "queued" | "blocked" | "needs_review";
  objective: string;
};

export type AgentLifecycleEvent = {
  id: string;
  missionId: string;
  agentId: string;
  kind: "spawned" | "resumed" | "queued" | "blocked" | "parked" | "reviewing";
  summary: string;
  createdAtLabel: string;
};

export type MissionSnapshot = Pick<
  CoreMissionRecord,
  "id" | "title"
> & {
  status: DesktopMissionStatus;
  goal?: CoreMissionRecord["goal"];
  command?: string;
  lineStatus?: RunDetail["status"];
  latestResult?: string;
  artifactCount?: number;
  attentionRequired?: boolean;
};

export type MissionDetail = Pick<
  CoreMissionRecord,
  "id" | "title" | "goal"
> & {
  status: DesktopMissionStatus;
  command?: string;
  successCriteria: string[];
  constraints: string[];
  risks: string[];
  phases: Array<{
    id: string;
    title: string;
    objective: string;
    status: "todo" | "active" | "done";
  }>;
  agentIds: string[];
};

export type RunTimelineEntry = {
  id: string;
  kind:
    | "started"
    | "context_loaded"
    | "tool_running"
    | "artifact_created"
    | "blocked"
    | "needs_review"
    | "completed";
  summary: string;
  timestampLabel: string;
};

export type RunEvent = {
  id: string;
  runId: string;
  kind:
    | "artifact_created"
    | "blocked"
    | "agent_status_changed"
    | "needs_review"
    | "review_requested"
    | "steering_requested"
    | "steering_submitted"
    | "completed";
  summary: string;
  createdAtLabel: string;
  agentId?: string;
  metadata?: Record<string, string>;
};

export type DecisionRecord = {
  id: string;
  category: "planning" | "technical" | "risk" | "approval" | "orchestration";
  summary: string;
  rationale: string;
};

export type ArtifactRecord = {
  id: string;
  type: "diff" | "report" | "test_result" | "handoff";
  title: string;
  preview: string;
  filePatches?: Array<{
    path: string;
    summary?: string;
    patch: string;
  }>;
};

export type BudgetClass = "light" | "standard" | "heavy";

export type BudgetBucket = {
  className: BudgetClass;
  used: number;
  limit: number;
};

export type ProviderWindowSummary = {
  provider: ProviderName;
  status: "ready" | "busy" | "cooldown" | "unavailable";
  activeRuns: number;
  queuedRuns: number;
  nextAvailableLabel: string;
};

export type WorkspaceExecutionMode = "process" | "workspace" | "git_worktree";

export type SessionTransport =
  | "provider_terminal"
  | "provider_pipe"
  | "local_shell";

export type RunExecutionSession = {
  sessionId: string;
  provider: ProviderName;
  transport: SessionTransport;
  cwd: string;
  workspaceMode: WorkspaceExecutionMode;
  workspaceRootPath?: string;
  worktreePath?: string;
  interactive: boolean;
};

export type ReleaseKind =
  | "release_brief"
  | "review_packet"
  | "merge_handoff"
  | "deployment_note";

export type ReleaseRevisionRecord = {
  id: string;
  revision: number;
  summary: string;
  createdAtLabel: string;
  basedOnArtifactIds: string[];
  status: "active" | "approved" | "superseded";
};

export type ReleaseRecord = {
  id: string;
  kind: ReleaseKind;
  title: string;
  latestRevisionId: string;
  revisions: ReleaseRevisionRecord[];
};

export type HandoffRecord = {
  id: string;
  releaseRevisionId: string;
  channel: HandoffChannel;
  target?: string;
  createdAtLabel: string;
  status: "active" | "approved" | "superseded";
};

export type RunOrigin = {
  parentRunId: string;
  sourceEventId: string;
  sourceEventKind: RunEvent["kind"];
  schedulerRuleId: string;
  spawnMode: "execute" | "queue_only";
  budgetClass: BudgetClass;
};

export type RunDetail = Pick<
  CoreRunRecord,
  "id" | "missionId" | "title" | "summary"
> & {
  agentId: string;
  status: DesktopRunStatus;
  budgetClass?: BudgetClass;
  providerPreference?: ProviderName;
  workspaceCommand?: string;
  terminalSessionId?: string;
  terminalProvider?: ProviderName;
  session?: RunExecutionSession;
  activeSurface: "terminal" | "diff" | "tests" | "artifacts";
  terminalPreview: string[];
  origin?: RunOrigin;
  timeline: RunTimelineEntry[];
  decisions: DecisionRecord[];
  artifacts: ArtifactRecord[];
  runEvents: RunEvent[];
  releases: ReleaseRecord[];
  handoffs: HandoffRecord[];
};

export type RunAutopilotResult = {
  run: RunDetail | null;
  eventKind:
    | "none"
    | "artifact_created"
    | "blocked"
    | "agent_status_changed"
    | "needs_review"
    | "review_requested"
    | "steering_requested"
    | "completed";
  decision:
    | "observe"
    | "prepare_revision"
    | "prepare_revision_and_request_review"
    | "prepare_revision_and_request_steering";
  summary: string;
};

export type RunAutopilotBurstResult = {
  steps: RunAutopilotResult[];
  appliedCount: number;
  lastResult: RunAutopilotResult;
};

export type ShellSnapshot = {
  workspaceName: string;
  missionName: string;
  budgetLabel: string;
  budgetBuckets: BudgetBucket[];
  providerWindows: ProviderWindowSummary[];
  activeAgents: number;
  blockedAgents: number;
  reviewCount: number;
  agents: AgentSnapshot[];
  lifecycleEvents: AgentLifecycleEvent[];
  missions: MissionSnapshot[];
};

export type RuntimeUpdateEvent = {
  reason:
    | "state_changed"
    | "autopilot_applied"
    | "terminal_updated"
    | "run_completed";
};

export type UcmDesktopApi = {
  app: {
    getVersion: () => Promise<string>;
  };
  workspace: {
    list: () => Promise<WorkspaceSummary[]>;
    setActive: (input: { workspaceId: string }) => Promise<WorkspaceSummary[]>;
    add: (input: { rootPath: string }) => Promise<WorkspaceSummary[]>;
    browse: (input?: { rootPath?: string }) => Promise<WorkspaceBrowserSnapshot>;
    createDirectory: (input: {
      parentPath: string;
      directoryName: string;
    }) => Promise<WorkspaceBrowserSnapshot>;
  };
  mission: {
    list: () => Promise<MissionSnapshot[]>;
    getActive: () => Promise<MissionDetail | null>;
    setActive: (input: { missionId: string }) => Promise<MissionDetail | null>;
    create: (input: {
      workspaceId: string;
      title: string;
      goal: string;
      command?: string;
    }) => Promise<MissionSnapshot>;
  };
  run: {
    getActive: () => Promise<RunDetail | null>;
    listForActiveMission: () => Promise<RunDetail[]>;
    setActive: (input: { runId: string }) => Promise<RunDetail | null>;
    retry: (input: { runId: string }) => Promise<RunDetail | null>;
    autopilotStep: () => Promise<RunAutopilotResult>;
    autopilotBurst: (input?: { maxSteps?: number }) => Promise<RunAutopilotBurstResult>;
    steeringSubmit: (input: { runId: string; text: string }) => Promise<RunDetail | null>;
    terminalWrite: (input: { sessionId: string; data: string }) => Promise<boolean>;
    terminalResize: (input: {
      sessionId: string;
      cols: number;
      rows: number;
    }) => Promise<boolean>;
    terminalKill: (input: { sessionId: string }) => Promise<boolean>;
  };
  release: {
    generate: (input: {
      runId: string;
      releaseId: string;
      summary: string;
    }) => Promise<RunDetail | null>;
    handoff: (input: {
      runId: string;
      releaseRevisionId: string;
      channel: HandoffRecord["channel"];
      target?: string;
    }) => Promise<RunDetail | null>;
    approve: (input: {
      runId: string;
      releaseRevisionId: string;
    }) => Promise<RunDetail | null>;
  };
  shell: {
    getSnapshot: () => Promise<ShellSnapshot>;
  };
  events: {
    onRuntimeUpdate: (
      listener: (event: RuntimeUpdateEvent) => void,
    ) => () => void;
  };
};
