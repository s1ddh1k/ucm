import type {
  ReleaseRecord,
  ReleaseStatus,
} from "../../contracts/src/records";

const RELEASE_TRANSITIONS: Record<ReleaseStatus, ReleaseStatus[]> = {
  draft: ["candidate", "superseded"],
  candidate: ["approved", "draft", "superseded"],
  approved: ["shipped", "superseded"],
  shipped: ["superseded"],
  superseded: [],
};

export function canTransitionRelease(
  current: ReleaseStatus,
  next: ReleaseStatus,
): boolean {
  return RELEASE_TRANSITIONS[current].includes(next);
}

export function transitionRelease(
  release: ReleaseRecord,
  next: ReleaseStatus,
  updatedAt: string,
): ReleaseRecord {
  if (!canTransitionRelease(release.status, next)) {
    throw new Error(
      `invalid release transition: ${release.status} -> ${next}`,
    );
  }

  return {
    ...release,
    status: next,
    updatedAt,
  };
}

export function attachArtifactsToRelease(
  release: ReleaseRecord,
  artifactIds: string[],
  updatedAt: string,
): ReleaseRecord {
  const nextArtifactIds = new Set(release.artifactIds);
  for (const artifactId of artifactIds) {
    nextArtifactIds.add(artifactId);
  }

  return {
    ...release,
    artifactIds: [...nextArtifactIds],
    updatedAt,
  };
}

export function createDraftRelease(input: {
  id: string;
  missionId: string;
  runId: string;
  version: string;
  milestone?: string;
  title: string;
  summary: string;
  artifactIds?: string[];
  now: string;
}): ReleaseRecord {
  return {
    id: input.id,
    missionId: input.missionId,
    runId: input.runId,
    version: input.version,
    milestone: input.milestone,
    title: input.title,
    summary: input.summary,
    status: "draft",
    artifactIds: input.artifactIds ?? [],
    createdAt: input.now,
    updatedAt: input.now,
  };
}
