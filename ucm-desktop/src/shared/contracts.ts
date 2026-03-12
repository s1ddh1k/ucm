export type AppScreen =
  | "home"
  | "monitor"
  | "plan"
  | "execute"
  | "review"
  | "settings";

export type NavigationItem = {
  id: AppScreen;
  label: string;
  description: string;
};

export type WorkspaceSummary = {
  id: string;
  name: string;
  rootPath: string;
  active: boolean;
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

export type MissionSnapshot = {
  id: string;
  title: string;
  status: "running" | "queued" | "review" | "blocked" | "completed";
  goal?: string;
};

export type MissionDetail = {
  id: string;
  title: string;
  status: "running" | "queued" | "review" | "blocked" | "completed";
  goal: string;
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
  provider: "claude" | "codex";
  status: "ready" | "busy" | "cooldown" | "unavailable";
  activeRuns: number;
  queuedRuns: number;
  nextAvailableLabel: string;
};

export type DeliverableKind =
  | "release_brief"
  | "review_packet"
  | "merge_handoff"
  | "deployment_note";

export type DeliverableRevisionRecord = {
  id: string;
  revision: number;
  summary: string;
  createdAtLabel: string;
  basedOnArtifactIds: string[];
  status: "active" | "approved" | "superseded";
};

export type DeliverableRecord = {
  id: string;
  kind: DeliverableKind;
  title: string;
  latestRevisionId: string;
  revisions: DeliverableRevisionRecord[];
};

export type HandoffRecord = {
  id: string;
  deliverableRevisionId: string;
  channel: "inbox" | "export" | "share";
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

export type RunDetail = {
  id: string;
  missionId: string;
  agentId: string;
  title: string;
  status: "queued" | "running" | "blocked" | "needs_review" | "completed";
  summary: string;
  budgetClass?: BudgetClass;
  providerPreference?: "claude" | "codex";
  terminalSessionId?: string;
  terminalProvider?: "claude" | "codex";
  activeSurface: "terminal" | "diff" | "tests" | "artifacts";
  terminalPreview: string[];
  origin?: RunOrigin;
  timeline: RunTimelineEntry[];
  decisions: DecisionRecord[];
  artifacts: ArtifactRecord[];
  runEvents: RunEvent[];
  deliverables: DeliverableRecord[];
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
  navigation: {
    listScreens: () => Promise<NavigationItem[]>;
  };
  workspace: {
    list: () => Promise<WorkspaceSummary[]>;
  };
  mission: {
    list: () => Promise<MissionSnapshot[]>;
    getActive: () => Promise<MissionDetail | null>;
    create: (input: {
      workspaceId: string;
      title: string;
      goal: string;
    }) => Promise<MissionSnapshot>;
  };
  run: {
    getActive: () => Promise<RunDetail | null>;
    listForActiveMission: () => Promise<RunDetail[]>;
    setActive: (input: { runId: string }) => Promise<RunDetail | null>;
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
  deliverable: {
    generate: (input: {
      runId: string;
      deliverableId: string;
      summary: string;
    }) => Promise<RunDetail | null>;
    handoff: (input: {
      runId: string;
      deliverableRevisionId: string;
      channel: HandoffRecord["channel"];
      target?: string;
    }) => Promise<RunDetail | null>;
    approve: (input: {
      runId: string;
      deliverableRevisionId: string;
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
