import type {
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
      title: "Mission brief",
      preview: input.goal,
    }),
  );

  const latestDecision = input.decisions.at(-1);
  if (latestDecision) {
    artifacts.push(buildDecisionArtifact(input.runId, latestDecision, input.decisions.length - 1));
  }

  return artifacts;
}

export function buildFollowupInputArtifacts(input: {
  runId: string;
  roleContractId: RoleContractId;
  sourceRun: RunDetail;
  missionDetail: MissionDetail | null;
  missionTitle: string;
  missionGoal: string;
}): ArtifactRecord[] {
  const artifacts: ArtifactRecord[] = [];

  // For verification runs, inherit diff artifacts from the source builder run
  if (input.roleContractId === "qa_agent") {
    const latestDiff = [...input.sourceRun.artifacts]
      .reverse()
      .find((artifact) => artifact.type === "diff");
    if (latestDiff) {
      artifacts.push({
        ...latestDiff,
        id: `art-inherit-${input.runId}-${latestDiff.id}`,
        relatedArtifactIds: [...(latestDiff.relatedArtifactIds ?? []), latestDiff.id],
      });
    }
  }

  return artifacts;
}
