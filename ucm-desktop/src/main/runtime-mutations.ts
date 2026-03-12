import type {
  DeliverableRevisionRecord,
  HandoffRecord,
  MissionDetail,
  MissionSnapshot,
  RunDetail,
} from "../shared/contracts";
import type { RuntimeState } from "./runtime-state";
import {
  appendRunEvent,
  findRun,
  hydrateRunDetail,
  markSteeringStatus,
} from "./runtime-run-helpers";
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
      "Team has enough context to begin.",
    ],
    constraints: ["Keep scope tight until the first run succeeds."],
    risks: ["Mission needs a richer plan before large changes begin."],
    phases: [
      {
        id: `p-discover-${mission.id}`,
        title: "Discover and scope",
        objective: `Understand the boundary of ${mission.title}.`,
        status: "done",
      },
      {
        id: `p-execute-${mission.id}`,
        title: "Execute first pass",
        objective: `Prepare the first execution pass for ${mission.title}.`,
        status: "active",
      },
    ],
    agentIds: [
      `a-conductor-${mission.id}`,
      `a-builder-${mission.id}`,
      `a-verifier-${mission.id}`,
    ],
  };

  state.missionDetailsById[mission.id] = missionDetail;
  state.workspaceIdByMissionId[mission.id] = input.workspaceId;
  state.agentsByMissionId[mission.id] = [
    {
      id: `a-conductor-${mission.id}`,
      name: "Conductor",
      role: "coordination",
      status: normalizedCommand ? "idle" : "running",
      objective: normalizedCommand
        ? `Coordinate local workspace command for ${mission.title}.`
        : `Shape execution plan for ${mission.title}.`,
    },
    {
      id: `a-builder-${mission.id}`,
      name: "Builder",
      role: "implementation",
      status: normalizedCommand ? "running" : "idle",
      objective: normalizedCommand
        ? `Run "${normalizedCommand}" in the selected workspace.`
        : `Prepare implementation path for ${mission.title}.`,
    },
    {
      id: `a-verifier-${mission.id}`,
      name: "Verifier",
      role: "verification",
      status: "idle",
      objective: `Prepare verification checklist for ${mission.title}.`,
    },
  ];
  state.runsByMissionId[mission.id] = [
    {
      id: `r-${mission.id}`,
      missionId: mission.id,
      agentId: `a-conductor-${mission.id}`,
      title: `Plan ${mission.title}`,
      status: "running",
      summary: "Conductor is shaping the first execution plan for the new mission.",
      budgetClass: "standard",
      providerPreference: normalizedCommand ? undefined : "claude",
      workspaceCommand: normalizedCommand || undefined,
      terminalSessionId: undefined,
      terminalProvider: undefined,
      activeSurface: "artifacts",
      terminalPreview: [
        normalizedCommand ? `$ ${normalizedCommand}` : "$ collect-context",
        normalizedCommand
          ? "Local workspace command is ready to run."
          : "Reviewing workspace history and recent mission notes...",
      ],
      timeline: [
        {
          id: `tl-start-${mission.id}`,
          kind: "started",
          summary: "Mission bootstrapped and conductor run started.",
          timestampLabel: "just now",
        },
      ],
      decisions: [
        {
          id: `d-plan-${mission.id}`,
          category: "planning",
          summary: "Begin with a conductor-led discovery pass.",
          rationale: "New missions should tighten scope before implementation begins.",
        },
      ],
      artifacts: [
        {
          id: `art-plan-${mission.id}`,
          type: "report",
          title: "Bootstrap planning note",
          preview: "Mission created and awaiting richer planning detail.",
        },
      ],
      runEvents: [],
      deliverables: [
        {
          id: `del-${mission.id}`,
          kind: "review_packet",
          title: `${mission.title} review packet`,
          latestRevisionId: `del-${mission.id}-r1`,
          revisions: [
            {
              id: `del-${mission.id}-r1`,
              revision: 1,
              summary:
                "Initial review packet created from mission bootstrap artifacts.",
              createdAtLabel: "just now",
              basedOnArtifactIds: [`art-plan-${mission.id}`],
              status: "active",
            },
          ],
        },
      ],
      handoffs: [
        {
          id: `handoff-${mission.id}-r1`,
          deliverableRevisionId: `del-${mission.id}-r1`,
          channel: "inbox",
          createdAtLabel: "just now",
          status: "active",
        },
      ],
    },
  ];
  state.runEventsByRunId[`r-${mission.id}`] = [
    {
      id: `ev-start-${mission.id}`,
      runId: `r-${mission.id}`,
      agentId: `a-conductor-${mission.id}`,
      kind: "artifact_created",
          summary: "Mission bootstrap artifacts are ready for the first conductor pass.",
      createdAtLabel: "just now",
    },
  ];
  state.lifecycleEventsByMissionId[mission.id] = [
    {
      id: `lc-conductor-${mission.id}`,
      missionId: mission.id,
      agentId: `a-conductor-${mission.id}`,
      kind: normalizedCommand ? "parked" : "spawned",
      summary: normalizedCommand
        ? "Conductor is parked while the first local workspace command runs."
        : "Conductor started automatically to scope the new mission.",
      createdAtLabel: "just now",
    },
    {
      id: `lc-builder-${mission.id}`,
      missionId: mission.id,
      agentId: `a-builder-${mission.id}`,
      kind: normalizedCommand ? "spawned" : "parked",
      summary: normalizedCommand
        ? "Builder started immediately with the supplied workspace command."
        : "Builder is parked until the first executable plan is ready.",
      createdAtLabel: "just now",
    },
    {
      id: `lc-verifier-${mission.id}`,
      missionId: mission.id,
      agentId: `a-verifier-${mission.id}`,
      kind: "parked",
      summary: "Verifier is parked until a diff or review packet appears.",
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

  located.run.handoffs = [
    ...located.run.handoffs.map((handoff) => ({
      ...handoff,
      status:
        handoff.status === "approved"
          ? ("approved" as const)
          : ("superseded" as const),
    })),
    {
      id: `handoff-${Date.now()}`,
      deliverableRevisionId: revision.id,
      channel: input.channel,
      target: input.target?.trim() || "human reviewer",
      createdAtLabel: "just now",
      status: "active" as const,
    },
  ];
  located.run.timeline = [
    ...located.run.timeline,
    {
      id: `tl-handoff-${Date.now()}`,
      kind: "completed",
      summary: `Delivered revision ${revision.id} to ${input.target?.trim() || "human reviewer"}.`,
      timestampLabel: "just now",
    },
  ];
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
