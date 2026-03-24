import type {
  ArtifactContractKind,
  ArtifactRecord,
  DecisionRecord,
  MissionDetail,
  RoleContractId,
  RunDetail,
} from "../shared/contracts";
import {
  buildDecisionArtifact,
  createArtifactRecord,
} from "./runtime-artifact-records";

const INPUT_CONTRACT_KINDS: Partial<Record<RoleContractId, ArtifactContractKind[]>> = {
  conductor: ["spec_brief", "acceptance_checks", "decision_record"],
  spec_agent: ["spec_brief", "acceptance_checks", "success_metrics"],
  builder_agent: ["task_backlog", "decision_record", "acceptance_checks"],
  reviewer_agent: ["patch_set", "decision_record", "acceptance_checks"],
  qa_agent: ["patch_set", "acceptance_checks"],
  security_agent: ["patch_set", "evidence_pack"],
  release_agent: ["review_packet", "deliverable_revision", "evidence_pack", "rollback_plan"],
  research_agent: ["spec_brief", "acceptance_checks"],
  architect_agent: ["spec_brief", "research_dossier", "risk_register"],
  ops_agent: ["release_manifest", "handoff_record", "incident_record"],
  learning_agent: ["incident_record", "improvement_proposal"],
};

function toAcceptanceChecksPayload(missionDetail: MissionDetail) {
  return {
    checks: missionDetail.successCriteria.map((criterion, index) => ({
      id: `ac-${index + 1}`,
      description: criterion,
      blocking: true,
      verificationMethod: criterion.toLowerCase().includes("review") ? "review" : "test",
      severity: "must" as const,
    })),
  };
}

function toTaskBacklogPayload(missionDetail: MissionDetail) {
  return {
    tasks: missionDetail.phases.map((phase) => ({
      id: phase.id,
      title: phase.title,
      objective: phase.objective,
      ownerRole:
        phase.status === "active"
          ? "builder_agent"
          : phase.objective.toLowerCase().includes("verify") ||
              phase.objective.toLowerCase().includes("review")
            ? "qa_agent"
            : "builder_agent",
    })),
  };
}

function toSuccessMetricsPayload(missionDetail: MissionDetail) {
  return {
    metrics: missionDetail.successCriteria.map((criterion, index) => ({
      id: `metric-${index + 1}`,
      description: criterion,
      target: "Satisfied before promotion",
      measurement: criterion.toLowerCase().includes("test") ? "test evidence" : "review evidence",
    })),
  };
}

function toSpecBriefPayload(input: {
  title: string;
  goal: string;
  missionDetail: MissionDetail;
}) {
  return {
    title: input.title,
    problem: input.goal,
    targetUsers: [],
    jobsToBeDone: [],
    goals: [input.goal],
    nonGoals: [],
    constraints: input.missionDetail.constraints,
    openQuestions: input.missionDetail.risks,
  };
}

export function buildMissionContextArtifacts(input: {
  missionId: string;
  runId: string;
  title: string;
  goal: string;
  missionDetail: MissionDetail;
  decisions: DecisionRecord[];
}): ArtifactRecord[] {
  const artifacts: ArtifactRecord[] = [];

  artifacts.push(
    createArtifactRecord({
      id: `art-spec-${input.runId}`,
      type: "report",
      title: "Spec brief",
      preview: input.goal,
      contractKind: "spec_brief",
      payload: toSpecBriefPayload(input),
    }),
  );

  if (input.missionDetail.successCriteria.length > 0) {
    artifacts.push(
      createArtifactRecord({
        id: `art-acceptance-${input.runId}`,
        type: "report",
        title: "Acceptance checks",
        preview: `${input.missionDetail.successCriteria.length} acceptance checks are attached.`,
        contractKind: "acceptance_checks",
        payload: toAcceptanceChecksPayload(input.missionDetail),
      }),
      createArtifactRecord({
        id: `art-success-metrics-${input.runId}`,
        type: "report",
        title: "Success metrics",
        preview: `${input.missionDetail.successCriteria.length} success metrics are attached.`,
        contractKind: "success_metrics",
        payload: toSuccessMetricsPayload(input.missionDetail),
      }),
    );
  }

  if (input.missionDetail.phases.length > 0) {
    artifacts.push(
      createArtifactRecord({
        id: `art-backlog-${input.runId}`,
        type: "report",
        title: "Task backlog",
        preview: `${input.missionDetail.phases.length} tasks are ready for execution.`,
        contractKind: "task_backlog",
        payload: toTaskBacklogPayload(input.missionDetail),
      }),
    );
  }

  const latestDecision = input.decisions.at(-1);
  if (latestDecision) {
    artifacts.push(buildDecisionArtifact(input.runId, latestDecision, input.decisions.length - 1));
  }

  return artifacts;
}

function cloneArtifactForRun(
  runId: string,
  artifact: ArtifactRecord,
  suffix: string,
): ArtifactRecord {
  return {
    ...artifact,
    id: `art-${suffix}-${runId}-${artifact.id}`,
    relatedArtifactIds: [...(artifact.relatedArtifactIds ?? []), artifact.id],
  };
}

export function buildFollowupInputArtifacts(input: {
  runId: string;
  roleContractId: RoleContractId;
  sourceRun: RunDetail;
  missionDetail: MissionDetail | null;
  missionTitle: string;
  missionGoal: string;
}): ArtifactRecord[] {
  const inheritedKinds = new Set(INPUT_CONTRACT_KINDS[input.roleContractId] ?? []);
  const artifacts: ArtifactRecord[] = [];

  for (const artifact of input.sourceRun.artifacts) {
    if (!artifact.contractKind || !inheritedKinds.has(artifact.contractKind)) {
      continue;
    }
    artifacts.push(cloneArtifactForRun(input.runId, artifact, "inherit"));
  }

  if (
    inheritedKinds.has("patch_set") &&
    !artifacts.some((artifact) => artifact.contractKind === "patch_set")
  ) {
    const latestDiff = [...input.sourceRun.artifacts]
      .reverse()
      .find((artifact) => artifact.type === "diff");
    if (latestDiff) {
      const clonedDiff = cloneArtifactForRun(input.runId, latestDiff, "patch");
      artifacts.push(
        createArtifactRecord({
          id: clonedDiff.id,
          type: "diff",
          title: clonedDiff.title,
          preview: clonedDiff.preview,
          contractKind: "patch_set",
          payload: latestDiff.payload ?? {
            inheritedFromRunId: input.sourceRun.id,
            summary: latestDiff.preview,
          },
          relatedArtifactIds: clonedDiff.relatedArtifactIds,
          filePatches: clonedDiff.filePatches,
        }),
      );
    }
  }

  if (!input.missionDetail) {
    return artifacts;
  }

  const bootstrapArtifacts = buildMissionContextArtifacts({
    missionId: input.sourceRun.missionId,
    runId: input.runId,
    title: input.missionTitle,
    goal: input.missionGoal,
    missionDetail: input.missionDetail,
    decisions: input.sourceRun.decisions,
  });

  for (const artifact of bootstrapArtifacts) {
    if (!artifact.contractKind || !inheritedKinds.has(artifact.contractKind)) {
      continue;
    }
    if (artifacts.some((existing) => existing.contractKind === artifact.contractKind)) {
      continue;
    }
    artifacts.push(artifact);
  }

  return artifacts;
}
