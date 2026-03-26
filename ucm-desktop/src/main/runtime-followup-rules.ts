import type { AgentSnapshot, RunDetail, RunEvent } from "../shared/contracts";
import { findLatestActionableArtifact } from "./runtime-run-helpers";

export type FollowupSpec = {
  key: string;
  title: string;
  status: RunDetail["status"];
  summary: string;
  decisionSummary: string;
  rationale: string;
  revisionSummary: string;
  deliverableKind: RunDetail["deliverables"][number]["kind"];
};

export type FollowupRule = {
  id: string;
  priority: number;
  role: AgentSnapshot["role"];
  roleContractId: RunDetail["roleContractId"];
  reuseExistingRun: boolean;
  spawnMode: "execute" | "queue_only";
  maxOpenRuns: number;
  exclusiveWith: string[];
  budgetClass: "light" | "standard" | "heavy";
  eventKinds: RunEvent["kind"][];
  matches: (input: {
    sourceRun: RunDetail;
    sourceEvent: RunEvent;
    agent: AgentSnapshot;
  }) => boolean;
  buildSpec: (input: {
    sourceRun: RunDetail;
    sourceEvent: RunEvent;
    agent: AgentSnapshot;
  }) => FollowupSpec;
};

export function inferScheduledProviderPreference(
  _roleContractId: RunDetail["roleContractId"],
  _agentRole: AgentSnapshot["role"],
) {
  return "claude" as const;
}

export function describeDeliverableTitle(
  followupTitle: string,
  _deliverableKind: RunDetail["deliverables"][number]["kind"],
) {
  return `${followupTitle} review packet`;
}

export function deriveFollowupSpec(
  sourceRun: RunDetail,
  sourceEvent: RunEvent,
  agent: AgentSnapshot,
): { rule: FollowupRule; spec: FollowupSpec } | null {
  const matchingRule = FOLLOWUP_RULES.find(
    (rule) =>
      rule.role === agent.role &&
      rule.eventKinds.includes(sourceEvent.kind) &&
      rule.matches({ sourceRun, sourceEvent, agent }),
  );

  return matchingRule
    ? {
        rule: matchingRule,
        spec: matchingRule.buildSpec({ sourceRun, sourceEvent, agent }),
      }
    : null;
}

export const FOLLOWUP_RULES: FollowupRule[] = [
  {
    id: "builder_from_planner_completion",
    priority: 90,
    role: "implementation",
    roleContractId: "builder_agent",
    reuseExistingRun: false,
    spawnMode: "execute",
    maxOpenRuns: 1,
    exclusiveWith: [],
    budgetClass: "standard",
    eventKinds: ["completed"],
    matches: ({ sourceRun }) =>
      sourceRun.roleContractId === "conductor",
    buildSpec: ({ sourceRun, agent }) => ({
      key: "build",
      title: `Build ${sourceRun.title.replace(/^Plan /, "")}`,
      status: "running",
      summary: `${agent.name} is building based on the planner spec.`,
      decisionSummary:
        "Create a builder run from the planner output.",
      rationale:
        "The planner produced a concrete spec; the builder executes it.",
      revisionSummary:
        "Builder run initialized from the planner spec.",
      deliverableKind: "review_packet",
    }),
  },
  {
    id: "verification_from_builder_completion",
    priority: 70,
    role: "verification",
    roleContractId: "qa_agent",
    reuseExistingRun: true,
    spawnMode: "execute",
    maxOpenRuns: 1,
    exclusiveWith: [],
    budgetClass: "standard",
    eventKinds: ["artifact_created", "completed"],
    matches: ({ sourceRun }) =>
      sourceRun.roleContractId === "builder_agent" &&
      findLatestActionableArtifact(sourceRun)?.type === "diff",
    buildSpec: ({ sourceRun, agent }) => ({
      key: "verify",
      title: `Verify ${sourceRun.title}`,
      status: "running",
      summary: `${agent.name} is verifying the builder output.`,
      decisionSummary:
        "Create a verification run for the builder diff.",
      rationale:
        "Verification should run separately so the builder output can be independently checked.",
      revisionSummary:
        "Verification run initialized from the builder diff.",
      deliverableKind: "review_packet",
    }),
  },
];
