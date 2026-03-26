import type {
  ArtifactContractKind,
  ArtifactRecord,
  DecisionRecord,
} from "../shared/contracts";

export function createArtifactRecord(input: {
  id: string;
  type: ArtifactRecord["type"];
  title: string;
  preview: string;
  contractKind?: ArtifactContractKind;
  payload?: unknown;
  relatedArtifactIds?: string[];
  filePatches?: ArtifactRecord["filePatches"];
}): ArtifactRecord {
  return {
    id: input.id,
    type: input.type,
    title: input.title,
    preview: input.preview,
    contractKind: input.contractKind,
    payload: input.payload,
    relatedArtifactIds: input.relatedArtifactIds,
    filePatches: input.filePatches,
  };
}

export function buildDecisionArtifact(
  runId: string,
  decision: DecisionRecord,
  index: number,
): ArtifactRecord {
  return createArtifactRecord({
    id: `art-decision-${runId}-${index}`,
    type: "report",
    title: `Decision ${index + 1}`,
    preview: decision.summary,
    contractKind: "decision_record",
    payload: decision,
  });
}
