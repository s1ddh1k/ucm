const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { getDefaultDocsLayout } = require("./templates");

const TEST_PATH_PATTERNS = [
  /(^|\/)__tests__(\/|$)/,
  /(^|\/)tests?(\/|$)/,
  /(^|\/)specs?(\/|$)/,
  /\.test\.[^.]+$/,
  /\.spec\.[^.]+$/,
];

const CODE_PATH_PATTERN =
  /\.(c|cc|cpp|cxx|cs|go|java|js|jsx|mjs|cjs|ts|tsx|py|rb|rs|php|swift|kt|scala)$/i;

const HIGH_RISK_PATH_PATTERNS = [
  /^package\.json$/,
  /^pnpm-workspace\.yaml$/,
  /^Dockerfile$/,
  /^docker-compose[^/]*\.ya?ml$/i,
  /^\.github\/workflows\//,
  /^\.githooks\//,
  /(^|\/)(migrations?|schema|prisma)(\/|$)/,
  /(^|\/)(tsconfig|jsconfig)\.[^.]+$/i,
  /(^|\/)(vite|webpack|rollup|vitest|jest|playwright|next|nuxt|tailwind)\.config\.[^.]+$/i,
  /(^|\/)openapi\//,
];

const CHECKPOINT_MESSAGE_PATTERN =
  /\b(wip|checkpoint|savepoint|partial|temp|tmp)\b/i;
const TEMPORARY_MARKER_PATTERN = /\b(TODO|FIXME|XXX|TBD|WIP|TEMP|HACK)\b/;

function runGit(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function normalizeGitPath(filePath) {
  return String(filePath || "").replaceAll(path.sep, "/");
}

function getRepoRoot(cwd) {
  return runGit(["rev-parse", "--show-toplevel"], cwd);
}

function getStagedFiles(cwd) {
  const output = runGit(
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
    cwd,
  );
  if (!output) return [];
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map(normalizeGitPath);
}

function getStagedDiff(cwd) {
  return runGit(
    ["diff", "--cached", "--unified=0", "--no-color", "--no-ext-diff"],
    cwd,
  );
}

function isDecisionDocPath(filePath) {
  return /^docs\/decisions\/.+\.md$/i.test(filePath);
}

function isHandoffPath(filePath, activeHandoffPath) {
  return normalizeGitPath(filePath) === normalizeGitPath(activeHandoffPath);
}

function isTestPath(filePath) {
  return TEST_PATH_PATTERNS.some((pattern) => pattern.test(filePath));
}

function isCodePath(filePath) {
  return CODE_PATH_PATTERN.test(filePath) && !isTestPath(filePath);
}

function isHighRiskPath(filePath) {
  return HIGH_RISK_PATH_PATTERNS.some((pattern) => pattern.test(filePath));
}

function getAddedLines(diffText) {
  return String(diffText || "")
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"));
}

function collectTemporaryMarkers(diffText) {
  return getAddedLines(diffText).filter((line) => TEMPORARY_MARKER_PATTERN.test(line));
}

function classifyCommit({
  repoRoot,
  stagedFiles,
  stagedDiff,
  commitMessage = "",
}) {
  const layout = getDefaultDocsLayout(repoRoot);
  const activeHandoffPath = normalizeGitPath(
    path.relative(repoRoot, path.resolve(layout.activeHandoffPath)),
  );
  const normalizedFiles = stagedFiles.map(normalizeGitPath);
  const codeFiles = normalizedFiles.filter((filePath) => isCodePath(filePath));
  const testFiles = normalizedFiles.filter((filePath) => isTestPath(filePath));
  const highRiskFiles = normalizedFiles.filter((filePath) => isHighRiskPath(filePath));
  const hasDecisionDoc = normalizedFiles.some((filePath) =>
    isDecisionDocPath(filePath),
  );
  const hasHandoff = normalizedFiles.some((filePath) =>
    isHandoffPath(filePath, activeHandoffPath),
  );
  const temporaryMarkers = collectTemporaryMarkers(stagedDiff);
  const checkpointMessage = CHECKPOINT_MESSAGE_PATTERN.test(commitMessage);

  const findings = [];

  if ((checkpointMessage || temporaryMarkers.length > 0) && !hasHandoff) {
    findings.push({
      code: "needs-handoff",
      severity: "block",
      title: "Commit looks like a checkpoint",
      detail:
        checkpointMessage && temporaryMarkers.length > 0
          ? "The commit message looks temporary and the staged diff adds temporary markers."
          : checkpointMessage
            ? "The commit message looks temporary or checkpoint-like."
            : "The staged diff adds temporary markers such as TODO, FIXME, or HACK.",
      evidence: [
        ...(checkpointMessage ? [`message: ${commitMessage}`] : []),
        ...temporaryMarkers.slice(0, 5),
      ],
      remediation: `Write and stage ${activeHandoffPath} before committing.`,
    });
  }

  if (highRiskFiles.length > 0 && !hasDecisionDoc) {
    findings.push({
      code: "needs-decision-doc",
      severity: "warn",
      title: "High-risk change may need a decision record",
      detail:
        "The staged commit changes config, schema, workflow, or other high-risk files without a decision doc.",
      evidence: highRiskFiles.slice(0, 8),
      remediation: "Consider adding a doc under docs/decisions/ if the rationale will matter later.",
    });
  }

  if (codeFiles.length > 0 && testFiles.length === 0) {
    findings.push({
      code: "needs-test-evidence",
      severity: "warn",
      title: "Code changes have no staged test evidence",
      detail:
        "The staged commit changes code files but no test files were staged with it.",
      evidence: codeFiles.slice(0, 8),
      remediation:
        "Stage tests, add explicit verification evidence elsewhere, or accept the warning if the change is truly non-behavioral.",
    });
  }

  const blockingFindings = findings.filter(
    (finding) => finding.severity === "block",
  );
  const warningFindings = findings.filter(
    (finding) => finding.severity === "warn",
  );

  return {
    status:
      blockingFindings.length > 0
        ? "blocked"
        : warningFindings.length > 0
          ? "review"
          : "ok",
    activeHandoffPath,
    stagedFiles: normalizedFiles,
    findings,
  };
}

function formatCommitInspection(result) {
  if (result.status === "ok") {
    return "tacit: commit looks self-contained.";
  }

  const lines = [`tacit: commit status = ${result.status}`, ""];
  for (const finding of result.findings) {
    lines.push(`[${finding.severity}] ${finding.code}: ${finding.title}`);
    lines.push(finding.detail);
    if (finding.evidence.length > 0) {
      lines.push("evidence:");
      for (const item of finding.evidence) {
        lines.push(`- ${item}`);
      }
    }
    lines.push(`next: ${finding.remediation}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

module.exports = {
  classifyCommit,
  formatCommitInspection,
  getRepoRoot,
  getStagedDiff,
  getStagedFiles,
  isCodePath,
  isDecisionDocPath,
  isHighRiskPath,
  isTestPath,
  normalizeGitPath,
};
