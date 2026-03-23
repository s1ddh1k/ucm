const fs = require("node:fs");
const path = require("node:path");
const { buildCommitMessage } = require("./commit-plan");
const { readSessionResidue } = require("./session-state");
const { readFocusedSymbols } = require("./repo-context");
const {
  getRepoRoot,
  getStagedDiff,
  getStagedFiles,
  isHighRiskPath,
  isTestPath,
  isCodePath,
  normalizeGitPath,
} = require("./checks");

function stripComments(text) {
  return String(text || "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n")
    .trim();
}

function readTextIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function readDraftMessage(repoRoot) {
  const draftPath = path.join(repoRoot, ".git", "TACIT_COMMIT_MSG");
  const text = readTextIfExists(draftPath).trim();
  if (!text) {
    return { draftPath, content: "" };
  }
  return { draftPath, content: `${text}\n` };
}

function extractFrontmatterTitle(markdown) {
  const match = String(markdown || "").match(/^---[\s\S]*?^title:\s*(.+)$/m);
  return match ? match[1].trim() : null;
}

function extractSectionLines(markdown, sectionName) {
  const lines = String(markdown || "").split("\n");
  const target = `## ${sectionName}`.toLowerCase();
  const collected = [];
  let active = false;

  for (const line of lines) {
    const normalized = line.trim().toLowerCase();
    if (normalized.startsWith("## ")) {
      if (normalized === target) {
        active = true;
        continue;
      }
      if (active) break;
    }
    if (!active) continue;

    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("- ")) {
      const value = trimmed.slice(2).trim();
      if (value && !value.endsWith(":")) collected.push(value);
      continue;
    }
    if (/^\d+\.\s+/.test(trimmed)) {
      collected.push(trimmed.replace(/^\d+\.\s+/, ""));
      continue;
    }
  }

  return collected;
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function cleanBullet(text) {
  const value = String(text || "").trim();
  if (!value) return "";
  return /[.!?]$/.test(value) ? value : `${value}.`;
}

function inferType(stagedFiles, stagedDiff) {
  const files = stagedFiles.map(normalizeGitPath);
  const docsOnly =
    files.length > 0 &&
    files.every(
      (filePath) =>
        filePath.endsWith(".md") || filePath.startsWith("docs/"),
    );
  const testsOnly = files.length > 0 && files.every((filePath) => isTestPath(filePath));
  const hasCode = files.some((filePath) => isCodePath(filePath));
  const hasTests = files.some((filePath) => isTestPath(filePath));
  const hasHighRisk = files.some((filePath) => isHighRiskPath(filePath));
  const hasHooks = files.some((filePath) => filePath.startsWith(".githooks/"));
  const hasWorkflow = files.some((filePath) =>
    filePath.startsWith(".github/workflows/"),
  );
  const hasBuildConfig = files.some(
    (filePath) =>
      filePath === "package.json" ||
      filePath.endsWith(".lock") ||
      filePath.endsWith("lockfile") ||
      /(^|\/)(vite|webpack|rollup|vitest|jest|playwright|next|nuxt|tailwind)\.config\./i.test(
        filePath,
      ),
  );

  if (docsOnly) return "docs";
  if (testsOnly) return "test";
  if (hasWorkflow) return "ci";
  if (hasBuildConfig || hasHighRisk) return "build";
  if (hasCode && /\nnew file mode /i.test(stagedDiff)) return "feat";
  if (hasCode && hasTests && String(stagedDiff || "").includes("function")) return "feat";
  if (hasCode) return "refactor";
  if (hasHooks) return "chore";
  return "chore";
}

function inferScope(stagedFiles) {
  const stopWords = new Set([
    "src",
    "lib",
    "test",
    "tests",
    "docs",
    "__tests__",
  ]);

  const counts = new Map();
  for (const filePath of stagedFiles.map(normalizeGitPath)) {
    if (filePath.startsWith(".githooks/")) {
      counts.set("hooks", (counts.get("hooks") || 0) + 1);
      continue;
    }
    if (filePath.startsWith(".github/workflows/")) {
      counts.set("ci", (counts.get("ci") || 0) + 1);
      continue;
    }
    const parts = filePath.split("/").filter(Boolean);
    const scope =
      parts.find(
        (part) =>
          !stopWords.has(part) &&
          !part.startsWith(".") &&
          !part.includes("."),
      ) || "repo";
    counts.set(scope, (counts.get(scope) || 0) + 1);
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] || "repo";
}

function humanizeToken(token) {
  return String(token || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim();
}

function inferFocus(stagedFiles, scope) {
  const files = stagedFiles.map(normalizeGitPath);
  const codeFiles = files.filter((filePath) => isCodePath(filePath));

  if (files.some((filePath) => filePath.startsWith(".githooks/"))) {
    return "commit workflow";
  }
  if (files.some((filePath) => filePath.startsWith(".github/workflows/"))) {
    return "CI workflow";
  }
  if (files.some((filePath) => filePath === "package.json")) {
    return "build configuration";
  }
  const decisionDoc = files.find((filePath) => /^docs\/decisions\/.+\.md$/i.test(filePath));
  if (decisionDoc) {
    return humanizeToken(path.basename(decisionDoc));
  }
  if (codeFiles.length === 1) {
    return humanizeToken(path.basename(codeFiles[0]));
  }
  if (files.length === 1) {
    return humanizeToken(path.basename(files[0]));
  }
  return scope === "repo" ? "repo workflow" : `${scope} workflow`;
}

function inferSubject(type, focus) {
  switch (type) {
    case "feat":
      return `add ${focus}`;
    case "fix":
      return `fix ${focus}`;
    case "docs":
      return `document ${focus}`;
    case "test":
      return `cover ${focus}`;
    case "build":
      return `update ${focus}`;
    case "ci":
      return `update ${focus}`;
    case "refactor":
      return `refine ${focus}`;
    case "chore":
    default:
      return `update ${focus}`;
  }
}

function inferGenericWhy(type, focus) {
  switch (type) {
    case "feat":
      return `Add support for ${focus}.`;
    case "docs":
      return `Keep the rationale around ${focus} in the repo history.`;
    case "test":
      return `Capture verification around ${focus} in the commit itself.`;
    case "build":
      return `Keep configuration around ${focus} aligned with the codebase.`;
    case "ci":
      return `Keep automation around ${focus} aligned with the workflow.`;
    case "refactor":
      return `Reshape ${focus} while keeping the change understandable in history.`;
    case "chore":
    default:
      return `Keep ${focus} aligned with the current workflow.`;
  }
}

function groupChangeBullets(stagedFiles) {
  const groups = new Map();
  for (const filePath of stagedFiles.map(normalizeGitPath)) {
    const top = filePath.split("/")[0] || filePath;
    const label =
      top === ".githooks"
        ? "update commit hooks"
        : top === ".github"
          ? "update CI workflow files"
          : top === "docs"
            ? "update repo context docs"
            : `update ${top}`;
    groups.set(label, true);
  }
  return [...groups.keys()].slice(0, 4);
}

function collectContextBullets(repoRoot, stagedFiles, stagedDiff = "") {
  const whyBullets = [];
  const verificationBullets = [];
  const notesBullets = [];
  const refs = [];
  const symbols = readFocusedSymbols(repoRoot, stagedFiles, stagedDiff);
  const session = readSessionResidue(repoRoot, {
    paths: stagedFiles,
    symbols: symbols.flatMap((group) => group.symbols.map((symbol) => symbol.name)),
  });

  for (const filePath of stagedFiles.map(normalizeGitPath)) {
    const absPath = path.resolve(repoRoot, filePath);
    const text = readTextIfExists(absPath);
    if (!text) continue;

    if (/^docs\/decisions\/.+\.md$/i.test(filePath)) {
      const lines = unique([
        ...extractSectionLines(text, "Decision"),
        ...extractSectionLines(text, "Rationale"),
      ]).slice(0, 2);
      whyBullets.push(...lines.map(cleanBullet));
      refs.push(filePath);
      continue;
    }

    if (/^docs\/failures\/.+\.md$/i.test(filePath)) {
      const lines = unique([
        ...extractSectionLines(text, "Why It Failed"),
        ...extractSectionLines(text, "What Must Change Before Retrying"),
      ]).slice(0, 2);
      notesBullets.push(...lines.map(cleanBullet));
      refs.push(filePath);
      continue;
    }
  }

  if (session.intent) {
    whyBullets.push(cleanBullet(session.intent));
  }

  for (const event of session.events || []) {
    const line = cleanBullet(event.summary);
    if (!line) continue;
    if (event.type === "verification") {
      verificationBullets.push(line);
      continue;
    }
    if (event.type === "attempt" || event.type === "constraint") {
      notesBullets.push(line);
      continue;
    }
    whyBullets.push(line);
  }

  return {
    bullets: unique(whyBullets).slice(0, 3),
    whyBullets: unique(whyBullets).slice(0, 3),
    verificationBullets: unique(verificationBullets).slice(0, 3),
    notesBullets: unique(notesBullets).slice(0, 3),
    refs: unique(refs).slice(0, 3),
  };
}

function planCommitMessage({ repoRoot, stagedFiles, stagedDiff }) {
  const files = stagedFiles.map(normalizeGitPath);
  const type = inferType(files, stagedDiff);
  const scope = inferScope(files);
  const focus = inferFocus(files, scope);
  const subject = inferSubject(type, focus);
  const context = collectContextBullets(repoRoot, files, stagedDiff);
  const whyBullets =
    context.whyBullets.length > 0
      ? context.whyBullets
      : [inferGenericWhy(type, focus)];
  const changeBullets = groupChangeBullets(files);
  const testFiles = files.filter((filePath) => isTestPath(filePath));

  return {
    type,
    scope,
    subject,
    whyBullets,
    changeBullets,
    verificationBullets: unique([
      ...context.verificationBullets,
      ...testFiles.map((filePath) => `staged ${filePath}`),
    ]),
    notesBullets: context.notesBullets,
    refs: context.refs,
  };
}

function generateCommitMessage({ repoRoot, stagedFiles, stagedDiff }) {
  return buildCommitMessage(
    planCommitMessage({ repoRoot, stagedFiles, stagedDiff }),
  );
}

function shouldAutofillMessage(messageText, source) {
  const normalized = stripComments(messageText);
  if (normalized) return false;
  if (source === "merge" || source === "squash" || source === "commit") {
    return false;
  }
  return true;
}

function prepareCommitMessage({ root = ".", messageFile, source = "" }) {
  if (!messageFile) {
    throw new Error("message file is required");
  }

  const repoRoot = getRepoRoot(path.resolve(root));
  const currentText = readTextIfExists(messageFile);
  if (!shouldAutofillMessage(currentText, source)) {
    return { written: false, reason: "message already present or source skipped" };
  }

  const stagedFiles = getStagedFiles(repoRoot);
  if (stagedFiles.length === 0) {
    return { written: false, reason: "no staged files" };
  }
  const stagedDiff = getStagedDiff(repoRoot);
  const draft = readDraftMessage(repoRoot);
  const content =
    draft.content ||
    generateCommitMessage({
      repoRoot,
      stagedFiles,
      stagedDiff,
    });
  fs.writeFileSync(messageFile, content, "utf8");
  if (draft.content) {
    fs.rmSync(draft.draftPath, { force: true });
  }
  return {
    written: true,
    content,
    source: draft.content ? "tacit-draft" : "generated",
  };
}

module.exports = {
  buildCommitMessage,
  collectContextBullets,
  generateCommitMessage,
  inferFocus,
  inferGenericWhy,
  inferScope,
  inferSubject,
  inferType,
  planCommitMessage,
  prepareCommitMessage,
  readDraftMessage,
  shouldAutofillMessage,
  stripComments,
};
