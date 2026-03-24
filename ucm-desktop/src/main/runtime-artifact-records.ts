import type {
  ArtifactContractKind,
  ArtifactPayloadValidation,
  ArtifactRecord,
  DecisionRecord,
} from "../shared/contracts";
import { validateArtifactPayload, type ArtifactSchemaId } from "./runtime-schema-loader";

export const SCHEMA_ID_BY_CONTRACT_KIND: Partial<Record<ArtifactContractKind, ArtifactSchemaId>> = {
  adr_record: "adr_record",
  acceptance_checks: "acceptance_checks",
  alternative_set: "alternative_set",
  architecture_record: "architecture_record",
  decision_record: "decision_record",
  deliverable_revision: "deliverable_revision",
  evidence_log: "evidence_log",
  evidence_pack: "evidence_pack",
  handoff_record: "handoff_record",
  improvement_proposal: "improvement_proposal",
  incident_record: "incident_record",
  patch_set: "patch_set",
  research_dossier: "research_dossier",
  release_manifest: "release_manifest",
  review_packet: "review_packet",
  rollback_plan: "rollback_plan",
  risk_register: "risk_register",
  run_trace: "run_trace",
  security_report: "security_report",
  spec_brief: "spec_brief",
  success_metrics: "success_metrics",
  task_backlog: "task_backlog",
  test_result: "test_result",
};

function validatePayload(
  contractKind: ArtifactContractKind | undefined,
  payload: unknown,
): ArtifactPayloadValidation | undefined {
  if (!contractKind || payload === undefined) {
    return undefined;
  }
  const schemaId = SCHEMA_ID_BY_CONTRACT_KIND[contractKind];
  if (!schemaId) {
    return undefined;
  }

  const result = validateArtifactPayload(schemaId, payload);
  return {
    enforced: result.enforced,
    valid: result.valid,
    errors: result.errors,
  };
}

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
  const payloadValidation = validatePayload(input.contractKind, input.payload);
  return {
    id: input.id,
    type: input.type,
    title: input.title,
    preview: input.preview,
    contractKind: input.contractKind,
    schemaId: input.contractKind ? SCHEMA_ID_BY_CONTRACT_KIND[input.contractKind] : undefined,
    payload: input.payload,
    payloadValidation,
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
