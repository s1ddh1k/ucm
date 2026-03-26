import type {
  ArtifactContractKind,
  DeliverableRevisionRecord,
  RunDetail,
} from "../shared/contracts";

export function listValidContractArtifacts(
  run: Pick<RunDetail, "artifacts">,
  contractKind: ArtifactContractKind | string,
) {
  return run.artifacts.filter(
    (artifact) =>
      artifact.contractKind === contractKind &&
      artifact.payloadValidation?.valid !== false,
  );
}

export function hasValidContractArtifact(
  run: Pick<RunDetail, "artifacts">,
  contractKind: ArtifactContractKind | string,
): boolean {
  return listValidContractArtifacts(run, contractKind).length > 0;
}

export function latestValidArtifactPayload<T>(
  run: Pick<RunDetail, "artifacts">,
  contractKind: ArtifactContractKind | string,
): T | null {
  const artifact = listValidContractArtifacts(run, contractKind).at(-1);
  return (artifact?.payload as T | undefined) ?? null;
}

export function listDeliverableRevisions(
  run: Pick<RunDetail, "deliverables">,
  deliverableKind?: RunDetail["deliverables"][number]["kind"],
) {
  return (run.deliverables ?? []).flatMap((deliverable) => {
    if (deliverableKind && deliverable.kind !== deliverableKind) {
      return [];
    }
    return deliverable.revisions.map((revision) => ({
      deliverableKind: deliverable.kind,
      revision,
    }));
  });
}

export function findLatestDeliverableRevision(
  run: Pick<RunDetail, "deliverables">,
  deliverableKind?: RunDetail["deliverables"][number]["kind"],
): DeliverableRevisionRecord | null {
  return listDeliverableRevisions(run, deliverableKind).at(-1)?.revision ?? null;
}

export function findApprovedDeliverableRevision(
  run: Pick<RunDetail, "deliverables">,
  deliverableKind?: RunDetail["deliverables"][number]["kind"],
): DeliverableRevisionRecord | null {
  return (
    listDeliverableRevisions(run, deliverableKind).find(
      (entry) => entry.revision.status === "approved",
    )?.revision ?? null
  );
}

export function listDeliverableRevisionArtifacts(
  run: RunDetail,
  status?: "active" | "approved" | "superseded",
  deliverableKind?: RunDetail["deliverables"][number]["kind"],
) {
  return listValidContractArtifacts(run, "deliverable_revision").filter((artifact) => {
    const payload = artifact.payload as
      | { status?: string; deliverableKind?: string }
      | undefined;
    if (status && payload?.status !== status) {
      return false;
    }
    if (deliverableKind && payload?.deliverableKind !== deliverableKind) {
      return false;
    }
    return true;
  });
}

export function hasApprovedReviewProvenance(run: RunDetail): boolean {
  if (findApprovedDeliverableRevision(run, "review_packet")) {
    return true;
  }

  return listDeliverableRevisionArtifacts(run, "approved", "review_packet").length > 0;
}
