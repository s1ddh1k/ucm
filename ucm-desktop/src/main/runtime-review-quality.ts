import type { RunDetail } from "../shared/contracts";
import { listValidContractArtifacts } from "./runtime-artifact-queries";
import { deriveEvidencePacks } from "./runtime-evidence";
import {
  normalizeReviewQualitySummary,
  type FunctionalQualityStatus,
  type ReviewQualitySummary,
  type VisualQualityStatus,
} from "./runtime-review-quality-core";

function isUiSurfacePath(filePath: string) {
  const normalized = filePath.toLowerCase();
  return (
    normalized.endsWith(".tsx") ||
    normalized.endsWith(".jsx") ||
    normalized.endsWith(".css") ||
    normalized.endsWith(".scss") ||
    normalized.endsWith(".html") ||
    normalized.includes("/renderer/") ||
    normalized.includes("/web/") ||
    normalized.includes("/components/") ||
    normalized.includes("/pages/")
  );
}

function inferUiSurfaceLabels(run: RunDetail) {
  const surfaces = new Set<string>();
  for (const artifact of run.artifacts) {
    for (const patch of artifact.filePatches ?? []) {
      if (!isUiSurfacePath(patch.path)) {
        continue;
      }
      const fileName = patch.path.split("/").at(-1) ?? patch.path;
      surfaces.add(fileName.replace(/\.[^.]+$/, ""));
    }
  }
  return [...surfaces];
}

export function deriveReviewQualitySummary(run: RunDetail): ReviewQualitySummary {
  const evidencePack = deriveEvidencePacks(run)[0] ?? null;
  const verificationCheck = evidencePack?.checks.find(
    (check) => check.name === "verification_signal_present",
  );
  const reviewCheck = evidencePack?.checks.find(
    (check) => check.name === "review_packet_present",
  );
  const hasTests = listValidContractArtifacts(run, "test_result").length > 0;
  const uiSurfaces = inferUiSurfaceLabels(run);
  const hasUiSurface = uiSurfaces.length > 0;
  const knownIssues = [
    ...(evidencePack?.checks
      .filter((check) => check.status !== "pass")
      .map((check) => check.summary) ?? []),
  ];

  const functionalStatus: FunctionalQualityStatus =
    verificationCheck?.status === "pass"
      ? "pass"
      : verificationCheck?.status === "warn"
        ? "warn"
        : "fail";
  const smokeStatus: VisualQualityStatus = hasTests
    ? "pass"
    : listValidContractArtifacts(run, "patch_set").length > 0
      ? "warn"
      : "not_applicable";
  const visualStatus: VisualQualityStatus = !hasUiSurface
    ? "not_applicable"
    : reviewCheck?.status === "fail"
      ? "fail"
      : hasUiSurface
        ? "pass"
        : "warn";
  const bugRiskStatus: FunctionalQualityStatus =
    knownIssues.length === 0 && functionalStatus === "pass"
      ? "pass"
      : knownIssues.some((issue) => /fail|missing|blocked/i.test(issue))
        ? "fail"
        : "warn";

  return {
    functionalStatus,
    visualStatus,
    bugRiskStatus,
    smokeStatus,
    surfacesReviewed: uiSurfaces,
    knownIssues,
  };
}

export function latestReviewQualityFromRun(run: RunDetail): ReviewQualitySummary {
  const reviewPacket = listValidContractArtifacts(run, "review_packet").at(-1);
  return reviewPacket
    ? normalizeReviewQualitySummary(
        reviewPacket.payload as Partial<ReviewQualitySummary> | undefined,
      )
    : deriveReviewQualitySummary(run);
}
