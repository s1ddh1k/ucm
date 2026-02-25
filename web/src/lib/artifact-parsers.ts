import type { PolishSummary, UxReviewReport, VerifyReport } from "@/api/types";

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function parseVerifyReport(raw: unknown): VerifyReport | null {
  if (!isJsonRecord(raw)) return null;

  const rawIssues = Array.isArray(raw.issues) ? raw.issues : [];
  const issues = rawIssues
    .filter(isJsonRecord)
    .map((issue) => ({
      severity: asString(issue.severity, "minor"),
      description: asString(issue.description),
      file: typeof issue.file === "string" ? issue.file : undefined,
    }))
    .filter((issue) => issue.description.length > 0);

  return {
    passed: asBoolean(raw.passed),
    testsPassed: asBoolean(raw.testsPassed),
    reviewPassed: asBoolean(raw.reviewPassed),
    testFailures: asStringArray(raw.testFailures),
    issues,
    summary: asString(raw.summary),
  };
}

export function parsePolishSummary(raw: unknown): PolishSummary | null {
  if (!isJsonRecord(raw)) return null;

  const rawLenses = Array.isArray(raw.lenses) ? raw.lenses : [];
  const lenses = rawLenses
    .filter(isJsonRecord)
    .map((lens) => ({
      lens: asString(lens.lens),
      rounds: asNumber(lens.rounds),
      issuesFound: asNumber(lens.issuesFound),
      converged: asBoolean(lens.converged),
    }))
    .filter((lens) => lens.lens.length > 0);

  return {
    lenses,
    totalRounds: asNumber(raw.totalRounds),
    totalIssuesFound: asNumber(raw.totalIssuesFound),
  };
}

export function parseUxReviewReport(raw: unknown): UxReviewReport | null {
  if (!isJsonRecord(raw)) return null;

  const canUserAccomplishGoal = isJsonRecord(raw.canUserAccomplishGoal)
    ? {
        goal: asString(raw.canUserAccomplishGoal.goal),
        result: asString(raw.canUserAccomplishGoal.result),
        blockers: asStringArray(raw.canUserAccomplishGoal.blockers),
      }
    : { goal: "", result: "", blockers: [] };

  const rawUsabilityIssues = Array.isArray(raw.usabilityIssues)
    ? raw.usabilityIssues
    : [];
  const usabilityIssues = rawUsabilityIssues
    .filter(isJsonRecord)
    .map((issue) => ({
      severity: asString(issue.severity, "minor"),
      description: asString(issue.description),
      where: typeof issue.where === "string" ? issue.where : undefined,
      fix: typeof issue.fix === "string" ? issue.fix : undefined,
    }))
    .filter((issue) => issue.description.length > 0);

  const mobile = isJsonRecord(raw.mobile)
    ? {
        usable: asBoolean(raw.mobile.usable, true),
        issues: asStringArray(raw.mobile.issues),
      }
    : { usable: true, issues: [] };

  return {
    score: asNumber(raw.score),
    summary: asString(raw.summary),
    canUserAccomplishGoal,
    usabilityIssues,
    confusingElements: asStringArray(raw.confusingElements),
    positives: asStringArray(raw.positives),
    mobile,
  };
}
