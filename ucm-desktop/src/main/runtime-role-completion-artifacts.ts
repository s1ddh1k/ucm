import type {
  ArtifactRecord,
  DecisionRecord,
  RoleContractId,
  RunDetail,
} from "../shared/contracts";
import {
  findApprovedDeliverableRevision,
  findLatestDeliverableRevision,
  listValidContractArtifacts,
} from "./runtime-artifact-queries";
import {
  buildDecisionArtifact,
  createArtifactRecord,
} from "./runtime-artifact-records";
import { deriveEvidencePacks } from "./runtime-evidence";
import {
  deriveReviewQualitySummary,
  latestReviewQualityFromRun,
} from "./runtime-review-quality";

export type RoleCompletionBuildInput = {
  run: RunDetail;
  summary: string;
  source: "provider" | "mock" | "local";
  stdout?: string;
  generatedPatch?: string;
};

export type RoleCompletionBuildResult = {
  artifacts: ArtifactRecord[];
  appendedDecisions: DecisionRecord[];
};

type RoleCompletionBuilder = (
  input: RoleCompletionBuildInput,
) => RoleCompletionBuildResult;

function toRunTracePayload(run: RunDetail) {
  return {
    runId: run.id,
    objective: run.summary,
    checkpoints: run.timeline.map((entry) => ({
      at: entry.timestampLabel,
      summary: entry.summary,
    })),
  };
}

function createRunTraceArtifact(run: RunDetail): ArtifactRecord {
  return createArtifactRecord({
    id: `art-trace-${run.id}-${Date.now()}`,
    type: "report",
    title: "Run trace",
    preview: `${run.timeline.length} checkpoints were captured for this run.`,
    contractKind: "run_trace",
    payload: toRunTracePayload(run),
  });
}

function createEvidenceArtifact(run: RunDetail): ArtifactRecord | null {
  const payload = deriveEvidencePacks(run)[0];
  if (!payload) {
    return null;
  }

  return createArtifactRecord({
    id: `art-evidence-${run.id}-${Date.now()}`,
    type: "report",
    title: "Evidence pack",
    preview: `Evidence decision is ${payload.decision}.`,
    contractKind: "evidence_pack",
    payload: {
      ...payload,
      missionId: run.missionId,
      runId: run.id,
    },
    relatedArtifactIds: payload.artifactIds,
  });
}

function extractPrimaryPatchPath(patch: string): string {
  const match = patch.match(/^diff --git a\/(.+?) b\//m);
  return match?.[1] ?? "workspace.diff";
}

function createBuilderPatchArtifact(input: RoleCompletionBuildInput): ArtifactRecord | null {
  if (input.run.roleContractId !== "builder_agent" || !input.generatedPatch?.trim()) {
    return null;
  }

  return createArtifactRecord({
    id: `art-patch-${input.run.id}-${Date.now()}`,
    type: "diff",
    title: input.source === "local" ? "Local workspace diff" : "Builder patch set",
    preview: "Workspace changes were captured from git diff.",
    contractKind: "patch_set",
    payload: {
      runId: input.run.id,
      summary: input.summary,
      patchLength: input.generatedPatch.length,
    },
    filePatches: [
      {
        path: extractPrimaryPatchPath(input.generatedPatch),
        summary: "Generated implementation patch surface",
        patch: input.generatedPatch,
      },
    ],
  });
}

function buildSpecCompletionArtifacts(input: RoleCompletionBuildInput): RoleCompletionBuildResult {
  const { run } = input;
  return {
    artifacts: [
      createArtifactRecord({
        id: `art-spec-output-${run.id}-${Date.now()}`,
        type: "report",
        title: "Refined spec brief",
        preview: input.summary,
        contractKind: "spec_brief",
        payload: {
          title: run.title,
          problem: input.summary,
          targetUsers: [],
          jobsToBeDone: [],
          goals: [input.summary],
          nonGoals: [],
          constraints: [],
          openQuestions: [],
        },
      }),
      createArtifactRecord({
        id: `art-spec-acceptance-${run.id}-${Date.now()}`,
        type: "report",
        title: "Refined acceptance checks",
        preview: "Spec run defined explicit checks.",
        contractKind: "acceptance_checks",
        payload: {
          checks: [
            {
              id: `ac-${run.id}-1`,
              description: input.summary,
              blocking: true,
              verificationMethod: "review",
              severity: "must",
            },
          ],
        },
      }),
      createArtifactRecord({
        id: `art-spec-metrics-${run.id}-${Date.now()}`,
        type: "report",
        title: "Success metrics",
        preview: "Spec run attached measurable success criteria.",
        contractKind: "success_metrics",
        payload: {
          metrics: [
            {
              id: `metric-${run.id}-1`,
              description: input.summary,
              target: "Review-ready scope",
              measurement: "review evidence",
            },
          ],
        },
      }),
    ],
    appendedDecisions: [],
  };
}

function buildQaCompletionArtifacts(input: RoleCompletionBuildInput): RoleCompletionBuildResult {
  return {
    artifacts: [
      createArtifactRecord({
        id: `art-test-${input.run.id}-${Date.now()}`,
        type: "test_result",
        title: "Verification result",
        preview: input.stdout || input.summary,
        contractKind: "test_result",
        payload: {
          runId: input.run.id,
          summary: input.summary,
          output: input.stdout || input.summary,
        },
      }),
    ],
    appendedDecisions: [],
  };
}

function buildReviewerCompletionArtifacts(input: RoleCompletionBuildInput): RoleCompletionBuildResult {
  const reviewDecision: DecisionRecord = {
    id: `d-review-${Date.now()}`,
    category: "approval",
    summary: `Reviewer packaged a review decision for ${input.run.title}.`,
    rationale: input.summary,
  };

  return {
    artifacts: [
      buildDecisionArtifact(input.run.id, reviewDecision, input.run.decisions.length),
    ],
    appendedDecisions: [reviewDecision],
  };
}

function buildResearchCompletionArtifacts(input: RoleCompletionBuildInput): RoleCompletionBuildResult {
  const { run } = input;
  return {
    artifacts: [
      createArtifactRecord({
        id: `art-research-${run.id}-${Date.now()}`,
        type: "report",
        title: "Research dossier",
        preview: input.summary,
        contractKind: "research_dossier",
        payload: {
          question: run.title,
          findings: [input.summary],
          sourceIds: [],
          confidence: "observed",
          updatedAt: "just now",
        },
      }),
      createArtifactRecord({
        id: `art-evidence-log-${run.id}-${Date.now()}`,
        type: "report",
        title: "Evidence log",
        preview: "Observed evidence was captured for the research run.",
        contractKind: "evidence_log",
        payload: {
          entries: [
            {
              id: `entry-${run.id}`,
              claim: input.summary,
              source: input.source,
              capturedAt: "just now",
              confidence: "observed",
            },
          ],
        },
      }),
      createArtifactRecord({
        id: `art-risk-register-${run.id}-${Date.now()}`,
        type: "report",
        title: "Risk register",
        preview: "Research run attached an explicit risk summary.",
        contractKind: "risk_register",
        payload: {
          risks: [
            {
              id: `risk-${run.id}`,
              summary: input.summary,
              severity: "medium",
            },
          ],
        },
      }),
    ],
    appendedDecisions: [],
  };
}

function buildArchitectCompletionArtifacts(input: RoleCompletionBuildInput): RoleCompletionBuildResult {
  const { run } = input;
  const architectureDecision: DecisionRecord = {
    id: `d-arch-${Date.now()}`,
    category: "technical",
    summary: `Architecture decision recorded for ${run.title}.`,
    rationale: input.summary,
  };

  return {
    artifacts: [
      createArtifactRecord({
        id: `art-alts-${run.id}-${Date.now()}`,
        type: "report",
        title: "Alternative set",
        preview: "Two alternatives were compared for the current architecture step.",
        contractKind: "alternative_set",
        payload: {
          options: [
            {
              id: "preferred",
              title: "Proceed with the current architecture",
              summary: input.summary,
              pros: ["Keeps momentum in the active mission."],
              cons: ["May need another review pass."],
            },
            {
              id: "fallback",
              title: "Escalate for steering",
              summary: "Pause implementation and ask for another design review.",
              pros: ["Reduces ambiguity before execution."],
              cons: ["Slows the current loop."],
            },
          ],
          rejectedOptionIds: ["fallback"],
        },
      }),
      buildDecisionArtifact(run.id, architectureDecision, run.decisions.length),
      createArtifactRecord({
        id: `art-architecture-${run.id}-${Date.now()}`,
        type: "report",
        title: "Architecture record",
        preview: input.summary,
        contractKind: "architecture_record",
        payload: {
          systemContext: run.title,
          majorComponents: [run.title],
          criticalFlows: [input.summary],
          constraints: [],
        },
      }),
      createArtifactRecord({
        id: `art-adr-${run.id}-${Date.now()}`,
        type: "report",
        title: "ADR record",
        preview: "Architecture decision record was captured.",
        contractKind: "adr_record",
        payload: {
          title: run.title,
          status: "accepted",
          context: run.summary,
          decision: input.summary,
          consequences: ["The current mission should continue with the recorded architecture."],
        },
      }),
      createArtifactRecord({
        id: `art-backlog-output-${run.id}-${Date.now()}`,
        type: "report",
        title: "Updated task backlog",
        preview: "Architecture output produced an executable backlog slice.",
        contractKind: "task_backlog",
        payload: {
          tasks: [
            {
              id: `task-${run.id}-1`,
              title: run.title,
              objective: input.summary,
              ownerRole: "builder_agent",
            },
          ],
        },
      }),
      createArtifactRecord({
        id: `art-rollback-${run.id}-${Date.now()}`,
        type: "report",
        title: "Rollback plan",
        preview: "Architecture output captured a rollback path.",
        contractKind: "rollback_plan",
        payload: {
          summary: `Rollback plan for ${run.title}`,
          triggerConditions: ["New architecture causes regressions during rollout."],
          rollbackSteps: ["Revert to the previously approved implementation path."],
          verificationSteps: ["Re-run the previously green acceptance checks."],
        },
      }),
    ],
    appendedDecisions: [architectureDecision],
  };
}

function buildSecurityCompletionArtifacts(input: RoleCompletionBuildInput): RoleCompletionBuildResult {
  return {
    artifacts: [
      createArtifactRecord({
        id: `art-security-${input.run.id}-${Date.now()}`,
        type: "report",
        title: "Security report",
        preview: input.summary,
        contractKind: "security_report",
        payload: {
          summary: input.summary,
          status: "warn",
          findings: [
            {
              id: `finding-${input.run.id}-1`,
              severity: "medium",
              status: "warn",
              summary: input.summary,
            },
          ],
          affectedArtifactIds: input.run.artifacts.map((artifact) => artifact.id),
          requestedAction: "review",
        },
      }),
    ],
    appendedDecisions: [],
  };
}

function buildReleaseCompletionArtifacts(input: RoleCompletionBuildInput): RoleCompletionBuildResult {
  const approvedRevision =
    findApprovedDeliverableRevision(input.run, "review_packet") ??
    findLatestDeliverableRevision(input.run, "review_packet") ??
    findLatestDeliverableRevision(input.run) ??
    null;
  const evidenceIds = listValidContractArtifacts(input.run, "evidence_pack").map(
    (artifact) => artifact.id,
  );
  const quality = latestReviewQualityFromRun(input.run);

  return {
    artifacts: [
      createArtifactRecord({
        id: `art-release-manifest-${input.run.id}-${Date.now()}`,
        type: "report",
        title: "Release manifest",
        preview: input.summary,
        contractKind: "release_manifest",
        payload: {
          summary: input.summary,
          approvedRevisionId: approvedRevision?.id ?? `rev-${input.run.id}`,
          artifactIds: input.run.artifacts.map((artifact) => artifact.id),
          evidencePackIds: evidenceIds.length > 0 ? evidenceIds : [`evp-${input.run.id}-latest`],
          qualityGates: {
            functionalStatus: quality.functionalStatus,
            visualStatus: quality.visualStatus,
            bugRiskStatus: quality.bugRiskStatus,
            smokeStatus: quality.smokeStatus,
            knownIssues: quality.knownIssues,
          },
          releaseChecklist: [
            "Approved revision is attached.",
            "Rollback plan is attached.",
            "Evidence pack is attached.",
            `Functional gate: ${quality.functionalStatus}.`,
            `Visual gate: ${quality.visualStatus}.`,
            `Bug risk gate: ${quality.bugRiskStatus}.`,
            `Smoke gate: ${quality.smokeStatus}.`,
          ],
        },
      }),
      createArtifactRecord({
        id: `art-release-handoff-${input.run.id}-${Date.now()}`,
        type: "handoff",
        title: "Release handoff record",
        preview: "Release package was handed off for approval.",
        contractKind: "handoff_record",
        payload: {
          deliverableRevisionId: approvedRevision?.id ?? `rev-${input.run.id}`,
          channel: "inbox",
          target: "human reviewer",
          status: "active",
          relatedArtifactIds: input.run.artifacts.map((artifact) => artifact.id),
        },
      }),
    ],
    appendedDecisions: [],
  };
}

function buildOpsCompletionArtifacts(input: RoleCompletionBuildInput): RoleCompletionBuildResult {
  return {
    artifacts: [
      createArtifactRecord({
        id: `art-incident-${input.run.id}-${Date.now()}`,
        type: "report",
        title: "Incident record",
        preview: input.summary,
        contractKind: "incident_record",
        payload: {
          summary: input.summary,
          severity: "medium",
          affectedMissionId: input.run.missionId,
          affectedRunId: input.run.id,
          symptoms: [input.summary],
          nextActions: ["Open a follow-up run if user impact is confirmed."],
        },
      }),
      createArtifactRecord({
        id: `art-ops-improvement-${input.run.id}-${Date.now()}`,
        type: "report",
        title: "Ops improvement proposal",
        preview: "Operational follow-up was proposed from the latest signal.",
        contractKind: "improvement_proposal",
        payload: {
          title: `Operational follow-up for ${input.run.title}`,
          summary: input.summary,
          hypothesis: "Classifying runtime signals earlier reduces response time.",
          expectedImpact: "Faster routing of incidents and clearer follow-up ownership.",
          requiredEvals: ["Replay the incident against the improved routing rule."],
          relatedArtifactIds: input.run.artifacts.map((artifact) => artifact.id),
        },
      }),
    ],
    appendedDecisions: [],
  };
}

function buildLearningCompletionArtifacts(input: RoleCompletionBuildInput): RoleCompletionBuildResult {
  return {
    artifacts: [
      createArtifactRecord({
        id: `art-learning-improvement-${input.run.id}-${Date.now()}`,
        type: "report",
        title: "Learning proposal",
        preview: input.summary,
        contractKind: "improvement_proposal",
        payload: {
          title: `Learning proposal for ${input.run.title}`,
          summary: input.summary,
          hypothesis: "Codifying the latest reflection reduces repeated failure modes.",
          expectedImpact: "More reliable planning and fewer repeated mistakes.",
          requiredEvals: ["Replay a historical run with the new heuristic enabled."],
          relatedArtifactIds: input.run.artifacts.map((artifact) => artifact.id),
        },
      }),
    ],
    appendedDecisions: [],
  };
}

const ROLE_COMPLETION_BUILDERS: Partial<Record<RoleContractId, RoleCompletionBuilder>> = {
  spec_agent: buildSpecCompletionArtifacts,
  qa_agent: buildQaCompletionArtifacts,
  reviewer_agent: buildReviewerCompletionArtifacts,
  research_agent: buildResearchCompletionArtifacts,
  architect_agent: buildArchitectCompletionArtifacts,
  security_agent: buildSecurityCompletionArtifacts,
  release_agent: buildReleaseCompletionArtifacts,
  ops_agent: buildOpsCompletionArtifacts,
  learning_agent: buildLearningCompletionArtifacts,
};

function buildReviewerPacketArtifact(input: {
  run: RunDetail;
  summary: string;
  previewRun: RunDetail;
}): ArtifactRecord {
  const evidenceIds = input.previewRun.artifacts
    .filter((artifact) => artifact.contractKind === "evidence_pack")
    .map((artifact) => artifact.id);
  const quality = deriveReviewQualitySummary(input.previewRun);

  return createArtifactRecord({
    id: `art-review-${input.run.id}-${Date.now()}`,
    type: "report",
    title: "Review packet",
    preview: input.summary,
    contractKind: "review_packet",
    payload: {
      summary: input.summary,
      selectedApproach: input.previewRun.decisions.at(-1)?.summary ?? input.run.title,
      artifactIds: input.previewRun.artifacts.map((artifact) => artifact.id),
      evidencePackIds: evidenceIds.length > 0 ? evidenceIds : [`evp-${input.run.id}-latest`],
      functionalStatus: quality.functionalStatus,
      visualStatus: quality.visualStatus,
      bugRiskStatus: quality.bugRiskStatus,
      smokeStatus: quality.smokeStatus,
      surfacesReviewed: quality.surfacesReviewed,
      knownIssues: quality.knownIssues,
      openRisks: deriveEvidencePacks(input.previewRun)[0]?.checks
        .filter((check) => check.status !== "pass")
        .map((check) => check.summary) ?? [],
      requestedAction: "review",
    },
  });
}

export function buildRoleCompletionArtifacts(
  input: RoleCompletionBuildInput,
): RoleCompletionBuildResult {
  const artifacts: ArtifactRecord[] = [];
  const appendedDecisions: DecisionRecord[] = [];
  const { run } = input;

  const builderPatch = createBuilderPatchArtifact(input);
  if (builderPatch) {
    artifacts.push(builderPatch);
  }

  const roleBuilder = run.roleContractId
    ? ROLE_COMPLETION_BUILDERS[run.roleContractId]
    : undefined;
  if (roleBuilder) {
    const roleCompletion = roleBuilder(input);
    artifacts.push(...roleCompletion.artifacts);
    appendedDecisions.push(...roleCompletion.appendedDecisions);
  }

  artifacts.push(createRunTraceArtifact(run));

  const previewRun: RunDetail = {
    ...run,
    decisions: [...run.decisions, ...appendedDecisions],
    artifacts: [...run.artifacts, ...artifacts],
  };

  if (run.roleContractId === "qa_agent" || run.roleContractId === "reviewer_agent") {
    const evidenceArtifact = createEvidenceArtifact(previewRun);
    if (evidenceArtifact) {
      artifacts.push(evidenceArtifact);
      previewRun.artifacts = [...previewRun.artifacts, evidenceArtifact];
    }
  }

  if (run.roleContractId === "reviewer_agent") {
    artifacts.push(
      buildReviewerPacketArtifact({
        run,
        summary: input.summary,
        previewRun,
      }),
    );
  }

  return { artifacts, appendedDecisions };
}
