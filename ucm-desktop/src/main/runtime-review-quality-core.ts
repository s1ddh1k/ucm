export type FunctionalQualityStatus = "pass" | "warn" | "fail";
export type VisualQualityStatus = "pass" | "warn" | "fail" | "not_applicable";

export type ReviewQualitySummary = {
  functionalStatus: FunctionalQualityStatus;
  visualStatus: VisualQualityStatus;
  bugRiskStatus: FunctionalQualityStatus;
  smokeStatus: VisualQualityStatus;
  surfacesReviewed: string[];
  knownIssues: string[];
};

function asRecord(payload: unknown): Record<string, unknown> {
  return typeof payload === "object" && payload !== null
    ? (payload as Record<string, unknown>)
    : {};
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function normalizeReviewQualitySummary(
  payload?: unknown,
): ReviewQualitySummary {
  const record = asRecord(payload);
  const functionalStatus = record.functionalStatus;
  const visualStatus = record.visualStatus;
  const bugRiskStatus = record.bugRiskStatus;
  const smokeStatus = record.smokeStatus;

  return {
    functionalStatus:
      functionalStatus === "warn" || functionalStatus === "fail"
        ? functionalStatus
        : "pass",
    visualStatus:
      visualStatus === "warn" ||
      visualStatus === "fail" ||
      visualStatus === "not_applicable"
        ? visualStatus
        : "not_applicable",
    bugRiskStatus:
      bugRiskStatus === "warn" || bugRiskStatus === "fail"
        ? bugRiskStatus
        : "pass",
    smokeStatus:
      smokeStatus === "warn" ||
      smokeStatus === "fail" ||
      smokeStatus === "not_applicable"
        ? smokeStatus
        : "not_applicable",
    surfacesReviewed: readStringArray(record.surfacesReviewed),
    knownIssues: readStringArray(record.knownIssues),
  };
}

export function isReleaseQualityReady(quality: ReviewQualitySummary): boolean {
  return (
    quality.functionalStatus === "pass" &&
    quality.bugRiskStatus === "pass" &&
    (quality.visualStatus === "pass" || quality.visualStatus === "not_applicable") &&
    (quality.smokeStatus === "pass" || quality.smokeStatus === "not_applicable") &&
    quality.knownIssues.length === 0
  );
}

export function listReleaseQualityIssues(quality: ReviewQualitySummary): string[] {
  const issues: string[] = [];
  if (quality.functionalStatus !== "pass") {
    issues.push("Release manifest functional quality gate is not pass.");
  }
  if (quality.bugRiskStatus !== "pass") {
    issues.push("Release manifest bug-risk quality gate is not pass.");
  }
  if (quality.visualStatus !== "pass" && quality.visualStatus !== "not_applicable") {
    issues.push("Release manifest visual quality gate is not ready.");
  }
  if (quality.smokeStatus !== "pass" && quality.smokeStatus !== "not_applicable") {
    issues.push("Release manifest smoke quality gate is not ready.");
  }
  if (quality.knownIssues.length > 0) {
    issues.push("Release manifest still lists known issues.");
  }
  return issues;
}
