import type { AgentSnapshot, RunDetail, RunEvent } from "../shared/contracts";
import { hasApprovedReviewProvenance, hasValidContractArtifact } from "./runtime-artifact-queries";
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

function createFollowupSpec(input: {
  key: string;
  title: string;
  summary: string;
  decisionSummary: string;
  rationale: string;
  revisionSummary: string;
  deliverableKind: FollowupSpec["deliverableKind"];
  status?: FollowupSpec["status"];
}): FollowupSpec {
  return {
    ...input,
    status: input.status ?? "running",
  };
}

export function inferScheduledProviderPreference(
  roleContractId: RunDetail["roleContractId"],
  agentRole: AgentSnapshot["role"],
) {
  if (roleContractId === "builder_agent" || agentRole === "implementation") {
    return "codex" as const;
  }
  if (
    roleContractId === "research_agent" ||
    roleContractId === "ops_agent" ||
    roleContractId === "learning_agent"
  ) {
    return "gemini" as const;
  }
  return "claude" as const;
}

export function describeDeliverableTitle(
  followupTitle: string,
  deliverableKind: RunDetail["deliverables"][number]["kind"],
) {
  if (deliverableKind === "release_brief") {
    return `${followupTitle} release brief`;
  }
  if (deliverableKind === "merge_handoff") {
    return `${followupTitle} merge handoff`;
  }
  if (deliverableKind === "deployment_note") {
    return `${followupTitle} deployment note`;
  }
  return `${followupTitle} review packet`;
}

export function deriveFollowupSpec(
  sourceRun: RunDetail,
  sourceEvent: RunEvent,
  agent: AgentSnapshot,
): { rule: FollowupRule; spec: FollowupSpec } | null {
  const matchingRule = SORTED_FOLLOWUP_RULES.find(
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
    id: "spec_from_conductor_bootstrap",
    priority: 95,
    role: "design",
    roleContractId: "spec_agent",
    reuseExistingRun: true,
    spawnMode: "execute",
    maxOpenRuns: 1,
    exclusiveWith: [],
    budgetClass: "light",
    eventKinds: ["artifact_created"],
    matches: ({ sourceRun }) =>
      sourceRun.roleContractId === "conductor" &&
      hasValidContractArtifact(sourceRun, "spec_brief") &&
      hasValidContractArtifact(sourceRun, "acceptance_checks"),
    buildSpec: ({ sourceRun, agent }) =>
      createFollowupSpec({
        key: "spec",
        title: `Spec ${sourceRun.title}`,
        summary: `${agent.name} is refining the mission boundary into an executable spec pass.`,
        decisionSummary:
          "Create a dedicated spec run from the mission bootstrap artifacts.",
        rationale:
          "Bootstrap artifacts should be turned into an explicit bounded spec before downstream execution begins.",
        revisionSummary:
          "Spec follow-up run initialized from the bootstrap brief, acceptance checks, and success metrics.",
        deliverableKind: "review_packet",
      }),
  },
  {
    id: "release_from_approved_revision",
    priority: 92,
    role: "verification",
    roleContractId: "release_agent",
    reuseExistingRun: true,
    spawnMode: "execute",
    maxOpenRuns: 1,
    exclusiveWith: [],
    budgetClass: "light",
    eventKinds: ["completed"],
    matches: ({ sourceRun, sourceEvent }) =>
      sourceEvent.metadata?.source === "approval" &&
      hasApprovedReviewProvenance(sourceRun) &&
      hasValidContractArtifact(sourceRun, "evidence_pack") &&
      hasValidContractArtifact(sourceRun, "rollback_plan"),
    buildSpec: ({ sourceRun, agent }) =>
      createFollowupSpec({
        key: "release",
        title: `Release ${sourceRun.title}`,
        summary: `${agent.name} is packaging the approved revision into a release-ready handoff.`,
        decisionSummary:
          "Create a dedicated release packaging run from the approved review packet.",
        rationale:
          "Approval should hand off into a separate release lane so manifests, rollback, and traceable handoff records are prepared without mutating the approved run.",
        revisionSummary:
          "Release follow-up run initialized from approved review provenance, rollback plan, and evidence pack.",
        deliverableKind: "release_brief",
      }),
  },
  {
    id: "review_from_review_ready_event",
    priority: 90,
    role: "verification",
    roleContractId: "reviewer_agent",
    reuseExistingRun: true,
    spawnMode: "queue_only",
    maxOpenRuns: 1,
    exclusiveWith: ["verification_from_diff_artifact"],
    budgetClass: "light",
    eventKinds: ["needs_review", "review_requested"],
    matches: () => true,
    buildSpec: ({ sourceRun, agent }) =>
      createFollowupSpec({
        key: "review",
        title: `Review ${sourceRun.title}`,
        summary: `${agent.name} opened a dedicated review follow-up run for the latest packet.`,
        decisionSummary:
          "Create a dedicated review run for the latest review-ready packet.",
        rationale:
          "Review should exist as its own run so approval work can be inspected separately from execution work.",
        revisionSummary:
          "Review follow-up run initialized from the latest review-ready packet.",
        deliverableKind: "review_packet",
        status: "needs_review",
      }),
  },
  {
    id: "architecture_from_research_completion",
    priority: 85,
    role: "design",
    roleContractId: "architect_agent",
    reuseExistingRun: true,
    spawnMode: "execute",
    maxOpenRuns: 1,
    exclusiveWith: [],
    budgetClass: "heavy",
    eventKinds: ["completed"],
    matches: ({ sourceRun }) =>
      sourceRun.roleContractId === "research_agent" &&
      hasValidContractArtifact(sourceRun, "research_dossier") &&
      hasValidContractArtifact(sourceRun, "risk_register"),
    buildSpec: ({ sourceRun, agent }) =>
      createFollowupSpec({
        key: "architecture",
        title: `Design ${sourceRun.title}`,
        summary: `${agent.name} is translating the latest research into an architecture decision.`,
        decisionSummary:
          "Create a dedicated architecture run from the completed research packet.",
        rationale:
          "Research should branch into architecture so tradeoffs and backlog decisions are captured explicitly before implementation resumes.",
        revisionSummary:
          "Architecture follow-up run initialized from the latest research dossier and risk register.",
        deliverableKind: "review_packet",
      }),
  },
  {
    id: "security_from_verification_completion",
    priority: 83,
    role: "verification",
    roleContractId: "security_agent",
    reuseExistingRun: true,
    spawnMode: "execute",
    maxOpenRuns: 1,
    exclusiveWith: [],
    budgetClass: "light",
    eventKinds: ["completed"],
    matches: ({ sourceRun }) =>
      sourceRun.roleContractId === "qa_agent" &&
      hasValidContractArtifact(sourceRun, "patch_set") &&
      hasValidContractArtifact(sourceRun, "evidence_pack"),
    buildSpec: ({ sourceRun, agent }) =>
      createFollowupSpec({
        key: "security",
        title: `Secure ${sourceRun.title}`,
        summary: `${agent.name} is reviewing the verified patch for secret, sandbox, and supply-chain risk.`,
        decisionSummary:
          "Create a dedicated security pass from the latest verified patch and evidence pack.",
        rationale:
          "Security review should run after verification evidence exists so it can focus on bounded risk inspection instead of raw patch triage.",
        revisionSummary:
          "Security follow-up run initialized from the latest patch set and evidence pack.",
        deliverableKind: "review_packet",
      }),
  },
  {
    id: "ops_from_release_completion",
    priority: 81,
    role: "research",
    roleContractId: "ops_agent",
    reuseExistingRun: true,
    spawnMode: "execute",
    maxOpenRuns: 1,
    exclusiveWith: [],
    budgetClass: "light",
    eventKinds: ["completed"],
    matches: ({ sourceRun }) =>
      sourceRun.roleContractId === "release_agent" &&
      hasValidContractArtifact(sourceRun, "release_manifest") &&
      hasValidContractArtifact(sourceRun, "handoff_record"),
    buildSpec: ({ sourceRun, agent }) =>
      createFollowupSpec({
        key: "ops",
        title: `Operate ${sourceRun.title}`,
        summary: `${agent.name} is capturing operational follow-up from the latest release packet.`,
        decisionSummary:
          "Create a dedicated ops pass from the release manifest and handoff record.",
        rationale:
          "Operational review should classify release signals and likely incidents without overloading the release packaging lane.",
        revisionSummary:
          "Ops follow-up run initialized from the latest release manifest and handoff trace.",
        deliverableKind: "deployment_note",
      }),
  },
  {
    id: "research_from_blocker_context",
    priority: 80,
    role: "research",
    roleContractId: "research_agent",
    reuseExistingRun: true,
    spawnMode: "execute",
    maxOpenRuns: 1,
    exclusiveWith: [],
    budgetClass: "light",
    eventKinds: ["blocked"],
    matches: ({ sourceEvent }) =>
      sourceEvent.metadata?.requestedInput === "fixture_path" ||
      sourceEvent.metadata?.requestedInput === "external_context",
    buildSpec: ({ sourceRun, agent }) =>
      createFollowupSpec({
        key: "research",
        title: `Research ${sourceRun.title}`,
        summary: `${agent.name} is collecting context to unblock ${sourceRun.title}.`,
        decisionSummary:
          "Create a dedicated research run to resolve the current blocker.",
        rationale:
          "Research should branch into its own run so missing context can be gathered without overloading the implementation run.",
        revisionSummary:
          "Research follow-up run initialized from the blocker context and latest artifacts.",
        deliverableKind: "review_packet",
      }),
  },
  {
    id: "learning_from_ops_completion",
    priority: 79,
    role: "research",
    roleContractId: "learning_agent",
    reuseExistingRun: true,
    spawnMode: "execute",
    maxOpenRuns: 1,
    exclusiveWith: [],
    budgetClass: "light",
    eventKinds: ["completed"],
    matches: ({ sourceRun }) =>
      sourceRun.roleContractId === "ops_agent" &&
      (hasValidContractArtifact(sourceRun, "incident_record") ||
        hasValidContractArtifact(sourceRun, "improvement_proposal")),
    buildSpec: ({ sourceRun, agent }) =>
      createFollowupSpec({
        key: "learning",
        title: `Learn ${sourceRun.title}`,
        summary: `${agent.name} is codifying the latest operational signal into an improvement proposal.`,
        decisionSummary:
          "Create a dedicated learning pass from the completed ops output.",
        rationale:
          "Operational findings should be converted into explicit heuristics and replayable improvement proposals instead of staying as passive incident notes.",
        revisionSummary:
          "Learning follow-up run initialized from the latest incident and improvement artifacts.",
        deliverableKind: "deployment_note",
      }),
  },
  {
    id: "builder_from_planning_completion",
    priority: 88,
    role: "implementation",
    roleContractId: "builder_agent",
    reuseExistingRun: false,
    spawnMode: "execute",
    maxOpenRuns: 1,
    exclusiveWith: [],
    budgetClass: "standard",
    eventKinds: ["artifact_created", "completed"],
    matches: ({ sourceRun }) =>
      sourceRun.roleContractId === "conductor" ||
      sourceRun.roleContractId === "spec_agent",
    buildSpec: ({ sourceRun, agent }) =>
      createFollowupSpec({
        key: "build",
        title: `Build ${sourceRun.title.replace(/^(Plan|Spec) /, "")}`,
        summary: `${agent.name} is starting implementation based on the planning output.`,
        decisionSummary:
          "Create a dedicated builder run from the completed planning pass.",
        rationale:
          "Planning output should transition into a focused implementation run so code changes are isolated and verifiable.",
        revisionSummary:
          "Builder follow-up run initialized from the latest planning artifacts.",
        deliverableKind: "merge_handoff",
      }),
  },
  {
    id: "verification_from_diff_artifact",
    priority: 70,
    role: "verification",
    roleContractId: "qa_agent",
    reuseExistingRun: true,
    spawnMode: "execute",
    maxOpenRuns: 1,
    exclusiveWith: ["review_from_review_ready_event"],
    budgetClass: "standard",
    eventKinds: ["artifact_created"],
    matches: ({ sourceRun }) => findLatestActionableArtifact(sourceRun)?.type === "diff",
    buildSpec: ({ sourceRun, agent }) =>
      createFollowupSpec({
        key: "verify",
        title: `Verify ${sourceRun.title}`,
        summary: `${agent.name} is preparing a dedicated verification follow-up run.`,
        decisionSummary:
          "Create a dedicated verification run for the latest implementation diff.",
        rationale:
          "Verification should run in its own follow-up run so the mission can branch cleanly after implementation artifacts appear.",
        revisionSummary:
          "Verification follow-up run initialized from the latest implementation artifact.",
        deliverableKind: "review_packet",
      }),
  },
];

const SORTED_FOLLOWUP_RULES = [...FOLLOWUP_RULES].sort(
  (left, right) => right.priority - left.priority,
);
