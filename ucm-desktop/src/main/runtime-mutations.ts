import type {
  DeliverableRevisionRecord,
  HandoffRecord,
  MissionDetail,
  MissionSnapshot,
  RunDetail,
} from "../shared/contracts";
import type { RuntimeState } from "./runtime-state";
import {
  appendHandoff,
  appendRunEvent,
  captureRunOutputBaseline,
  findRun,
  hydrateRunDetail,
  markSteeringStatus,
} from "./runtime-run-helpers";
import { createArtifactRecord } from "./runtime-artifact-records";
import { buildMissionContextArtifacts } from "./runtime-context-artifacts";
import { timestampLabelFromRevision } from "./runtime-state";

export function createMissionInState(
  state: RuntimeState,
  input: {
    workspaceId: string;
    title: string;
    goal: string;
    command?: string;
  },
): MissionSnapshot {
  const normalizedCommand = input.command?.trim() || "";
  const mission: MissionSnapshot = {
    id: `m-${Date.now()}`,
    title: input.title.trim(),
    goal: input.goal.trim(),
    command: normalizedCommand || undefined,
    status: "queued",
  };

  state.activeWorkspaceId = input.workspaceId;
  state.activeMissionId = mission.id;
  state.missionBudgetById[mission.id] = {
    light: { limit: 3, used: 0 },
    standard: { limit: 2, used: 0 },
    heavy: { limit: 1, used: 0 },
  };
  state.workspaces = state.workspaces.map((workspace) => ({
    ...workspace,
    active: workspace.id === input.workspaceId,
  }));
  state.missions = [mission, ...state.missions];

  const missionDetail: MissionDetail = {
    id: mission.id,
    title: mission.title,
    status: mission.status,
    goal: mission.goal ?? "",
    command: normalizedCommand || undefined,
    successCriteria: [
      "Mission has a clear execution path.",
    ],
    constraints: ["Keep scope tight until the first run succeeds."],
    risks: [],
    phases: [
      {
        id: `p-execute-${mission.id}`,
        title: "Execute",
        objective: `Execute ${mission.title}.`,
        status: "active",
      },
    ],
    agentIds: [
      ...(normalizedCommand ? [] : [`a-planner-${mission.id}`]),
      `a-builder-${mission.id}`,
      `a-verifier-${mission.id}`,
    ],
  };

  state.missionDetailsById[mission.id] = missionDetail;
  state.workspaceIdByMissionId[mission.id] = input.workspaceId;
  state.agentsByMissionId[mission.id] = [
    ...(normalizedCommand
      ? []
      : [
          {
            id: `a-planner-${mission.id}`,
            name: "Planner",
            role: "coordination" as const,
            status: "running" as const,
            objective: `Expand the goal "${mission.goal}" into a concrete spec with scope, acceptance criteria, and constraints.`,
          },
        ]),
    {
      id: `a-builder-${mission.id}`,
      name: "Builder",
      role: "implementation" as const,
      status: normalizedCommand ? "running" as const : "idle" as const,
      objective: normalizedCommand
        ? `Run "${normalizedCommand}" in the selected workspace.`
        : `Execute ${mission.title}.`,
    },
    {
      id: `a-verifier-${mission.id}`,
      name: "Verifier",
      role: "verification" as const,
      status: "idle" as const,
      objective: `Verify the output of ${mission.title}.`,
    },
  ];
  const usePlanner = !normalizedCommand;
  const initialRun: RunDetail = {
    id: `r-${mission.id}`,
    missionId: mission.id,
    agentId: usePlanner
      ? `a-planner-${mission.id}`
      : `a-builder-${mission.id}`,
    roleContractId: usePlanner ? "conductor" : "builder_agent",
    title: usePlanner ? `Plan ${mission.title}` : `Build ${mission.title}`,
    status: "running",
    summary: usePlanner
      ? `Planner is expanding the goal into a concrete spec.`
      : `Builder is executing "${normalizedCommand}" in the selected workspace.`,
    budgetClass: usePlanner ? "light" : "standard",
    providerPreference: normalizedCommand ? undefined : "claude",
    workspaceCommand: normalizedCommand || undefined,
    terminalSessionId: undefined,
    terminalProvider: undefined,
    activeSurface: "artifacts",
    terminalPreview: normalizedCommand
      ? [`$ ${normalizedCommand}`, "Local workspace command is ready to run."]
      : [],
    timeline: [
      {
        id: `tl-start-${mission.id}`,
        kind: "started",
        summary: usePlanner
          ? "Mission bootstrapped and planner started."
          : "Mission bootstrapped and builder execution started.",
        timestampLabel: "just now",
      },
    ],
    decisions: [
      {
        id: `d-plan-${mission.id}`,
        category: "planning",
        summary: usePlanner
          ? "Expand the mission goal into a concrete spec before building."
          : "Execute the workspace command directly.",
        rationale: usePlanner
          ? "A planner pass prevents under-scoping by turning a brief goal into explicit scope and criteria."
          : "A direct workspace command should start immediately.",
      },
    ],
    artifacts: [],
    runEvents: [],
    deliverables: [],
    handoffs: [],
  };
  const contextArtifacts = buildMissionContextArtifacts({
    missionId: mission.id,
    runId: initialRun.id,
    title: mission.title,
    goal: mission.goal ?? "",
    missionDetail,
    decisions: initialRun.decisions,
  });
  initialRun.artifacts = contextArtifacts;
  initialRun.outputBaseline = captureRunOutputBaseline(initialRun);
  state.runsByMissionId[mission.id] = [initialRun];
  state.runEventsByRunId[`r-${mission.id}`] = [];
  state.lifecycleEventsByMissionId[mission.id] = [
    ...(usePlanner
      ? [
          {
            id: `lc-planner-${mission.id}`,
            missionId: mission.id,
            agentId: `a-planner-${mission.id}`,
            kind: "spawned" as const,
            summary: "Planner started to expand the goal into a spec.",
            createdAtLabel: "just now",
          },
          {
            id: `lc-builder-${mission.id}`,
            missionId: mission.id,
            agentId: `a-builder-${mission.id}`,
            kind: "parked" as const,
            summary: "Builder is parked until the planner finishes.",
            createdAtLabel: "just now",
          },
        ]
      : [
          {
            id: `lc-builder-${mission.id}`,
            missionId: mission.id,
            agentId: `a-builder-${mission.id}`,
            kind: "spawned" as const,
            summary: "Builder started for the new mission.",
            createdAtLabel: "just now",
          },
        ]),
    {
      id: `lc-verifier-${mission.id}`,
      missionId: mission.id,
      agentId: `a-verifier-${mission.id}`,
      kind: "parked",
      summary: "Verifier is parked until builder produces output.",
      createdAtLabel: "just now",
    },
  ];
  state.activeRunId = `r-${mission.id}`;

  return mission;
}

export function generateDeliverableRevisionInState(
  state: RuntimeState,
  input: {
    runId: string;
    deliverableId: string;
    summary: string;
  },
): RunDetail | null {
  const summary = input.summary.trim();
  if (!summary) {
    const active = findRun(state, state.activeRunId);
    return active ? hydrateRunDetail(state, active.run) : null;
  }

  const located = findRun(state, input.runId);
  if (!located) {
    return null;
  }

  const deliverable = located.run.deliverables.find(
    (item) => item.id === input.deliverableId,
  );
  if (!deliverable) {
    return hydrateRunDetail(state, located.run);
  }

  const nextRevisionNumber =
    Math.max(0, ...deliverable.revisions.map((revision) => revision.revision)) + 1;
  const revisionId = `${deliverable.id}-r${nextRevisionNumber}`;
  const nextRevision: DeliverableRevisionRecord = {
    id: revisionId,
    revision: nextRevisionNumber,
    summary,
    createdAtLabel: timestampLabelFromRevision(nextRevisionNumber),
    basedOnArtifactIds: located.run.artifacts.map((artifact) => artifact.id),
    status: "active",
  };

  deliverable.revisions = deliverable.revisions.map((revision) => ({
    ...revision,
    status: revision.status === "approved" ? "approved" : "superseded",
  }));
  deliverable.revisions = [...deliverable.revisions, nextRevision];
  deliverable.latestRevisionId = nextRevision.id;
  located.run.timeline = [
    ...located.run.timeline,
    {
      id: `tl-deliverable-${Date.now()}`,
      kind: "artifact_created",
      summary: `Generated ${deliverable.title} revision v${nextRevision.revision}.`,
      timestampLabel: "just now",
    },
  ];
  located.run.decisions = [
    ...located.run.decisions,
    {
      id: `d-deliverable-${Date.now()}`,
      category: "approval",
      summary: `Prepared ${deliverable.title} revision v${nextRevision.revision}.`,
      rationale: "Deliverables evolve append-only so reviewers can compare revisions over time.",
    },
  ];
  appendRunEvent(state, located.run.id, {
    kind: "artifact_created",
    agentId: located.run.agentId,
    summary: `Manual revision v${nextRevision.revision} was generated for ${deliverable.title}.`,
    createdAtLabel: "just now",
  });

  return hydrateRunDetail(state, located.run);
}

export function handoffDeliverableInState(
  state: RuntimeState,
  input: {
    runId: string;
    deliverableRevisionId: string;
    channel: HandoffRecord["channel"];
    target?: string;
  },
): RunDetail | null {
  const located = findRun(state, input.runId);
  if (!located) {
    return null;
  }

  const revision = located.run.deliverables
    .flatMap((deliverable) => deliverable.revisions)
    .find((item) => item.id === input.deliverableRevisionId);
  if (!revision) {
    return hydrateRunDetail(state, located.run);
  }

  appendHandoff(located.run, {
    deliverableRevisionId: revision.id,
    channel: input.channel,
    target: input.target?.trim() || "human reviewer",
    createdAtLabel: "just now",
    status: "active",
  });
  appendRunEvent(state, located.run.id, {
    kind: "review_requested",
    agentId: located.run.agentId,
    summary: `Latest deliverable revision was handed off to ${input.target?.trim() || "human reviewer"}.`,
    createdAtLabel: "just now",
  });

  return hydrateRunDetail(state, located.run);
}

export function approveDeliverableRevisionInState(
  state: RuntimeState,
  input: {
    runId: string;
    deliverableRevisionId: string;
  },
): { missionId: string; run: RunDetail } | null {
  const located = findRun(state, input.runId);
  if (!located) {
    return null;
  }

  let approvedRevisionId: string | null = null;
  for (const deliverable of located.run.deliverables) {
    deliverable.revisions = deliverable.revisions.map((revision) => {
      if (revision.id === input.deliverableRevisionId) {
        approvedRevisionId = revision.id;
        return { ...revision, status: "approved" };
      }
      return {
        ...revision,
        status: revision.status === "approved" ? "superseded" : revision.status,
      };
    });
  }
  if (!approvedRevisionId) {
    return { missionId: located.missionId, run: hydrateRunDetail(state, located.run) };
  }

  located.run.handoffs = located.run.handoffs.map((handoff) => {
    if (handoff.deliverableRevisionId === approvedRevisionId) {
      return { ...handoff, status: "approved" };
    }
    return {
      ...handoff,
      status: handoff.status === "approved" ? "superseded" : handoff.status,
    };
  });
  located.run.status = "completed";
  const approvedRevision = located.run.deliverables
    .flatMap((deliverable) =>
      deliverable.revisions.map((revision) => ({ deliverable, revision })),
    )
    .find(({ revision }) => revision.id === approvedRevisionId);
  if (approvedRevision) {
    located.run.artifacts = [
      ...located.run.artifacts,
      createArtifactRecord({
        id: `art-approved-${approvedRevision.revision.id}`,
        type: "report",
        title: `${approvedRevision.deliverable.title} revision approved`,
        preview: approvedRevision.revision.summary,
        contractKind: "deliverable_revision",
        payload: {
          deliverableId: approvedRevision.deliverable.id,
          deliverableKind: approvedRevision.deliverable.kind,
          revisionId: approvedRevision.revision.id,
          revisionNumber: approvedRevision.revision.revision,
          summary: approvedRevision.revision.summary,
          basedOnArtifactIds: approvedRevision.revision.basedOnArtifactIds,
          status: "approved",
        },
        relatedArtifactIds: approvedRevision.revision.basedOnArtifactIds,
      }),
    ];
  }
  located.run.timeline = [
    ...located.run.timeline,
    {
      id: `tl-approve-${Date.now()}`,
      kind: "completed",
      summary: `Human observer approved revision ${approvedRevisionId}.`,
      timestampLabel: "just now",
    },
  ];
  located.run.decisions = [
    ...located.run.decisions,
    {
      id: `d-approve-${Date.now()}`,
      category: "approval",
      summary: `Approved ${approvedRevisionId}.`,
      rationale: "The latest review packet was accepted and the run can conclude.",
    },
  ];
  appendRunEvent(state, located.run.id, {
    kind: "completed",
    agentId: located.run.agentId,
    summary: `Human observer approved ${approvedRevisionId}.`,
    createdAtLabel: "just now",
    metadata: {
      source: "approval",
    },
  });

  return { missionId: located.missionId, run: hydrateRunDetail(state, located.run) };
}

export function submitSteeringInState(
  state: RuntimeState,
  input: { runId: string; text: string },
): RunDetail | null {
  const text = input.text.trim();
  if (!text) {
    const active = findRun(state, state.activeRunId);
    return active ? hydrateRunDetail(state, active.run) : null;
  }

  const located = findRun(state, input.runId);
  if (!located) {
    return null;
  }

  markSteeringStatus(state, located.run.id, "active", "superseded");

  located.run.decisions = [
    ...located.run.decisions,
    {
      id: `d-steering-${Date.now()}`,
      category: "planning",
      summary: "Human observer submitted brief steering.",
      rationale: text,
    },
  ];
  located.run.timeline = [
    ...located.run.timeline,
    {
      id: `tl-steering-${Date.now()}`,
      kind: "context_loaded",
      summary: `Brief steering received: ${text}`,
      timestampLabel: "just now",
    },
  ];
  appendRunEvent(state, located.run.id, {
    kind: "steering_submitted",
    agentId: located.run.agentId,
    summary: `Human observer submitted steering: ${text}`,
    createdAtLabel: "just now",
    metadata: {
      steering: text,
      status: "active",
    },
  });

  return hydrateRunDetail(state, located.run);
}
