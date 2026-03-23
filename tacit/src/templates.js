const DOCUMENT_TYPES = Object.freeze([
  "decision",
  "failed-attempt",
  "handoff",
]);

function toIsoDate(now = new Date()) {
  const year = String(now.getFullYear()).padStart(4, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function buildFrontmatter({ title, docType, now = new Date() }) {
  return [
    "---",
    `title: ${title}`,
    `type: ${docType}`,
    `date: ${toIsoDate(now)}`,
    "status: draft",
    "---",
    "",
  ].join("\n");
}

function buildDecisionTemplate(title, options = {}) {
  const frontmatter = buildFrontmatter({
    title,
    docType: "decision",
    now: options.now,
  });

  return `${frontmatter}# ${title}

## Context

- What problem or change forced this decision?

## Decision

- What was chosen?

## Rationale

- Why is this better than the alternatives here?

## Alternatives Considered

- Option A:
- Option B:

## Evidence

- Code:
- Tests:
- Logs:
- Artifacts:

## Consequences

- What becomes easier?
- What becomes harder or constrained?
`;
}

function buildFailedAttemptTemplate(title, options = {}) {
  const frontmatter = buildFrontmatter({
    title,
    docType: "failed-attempt",
    now: options.now,
  });

  return `${frontmatter}# ${title}

## Goal

- What were you trying to achieve?

## Attempted Approach

- What did you try?

## Failure Signal

- What concrete signal showed failure?

## Why It Failed

- What is the current best explanation?

## What Must Change Before Retrying

- Preconditions:
- Missing information:
- Safer alternative:

## Evidence

- Code:
- Tests:
- Logs:
- Artifacts:
`;
}

function buildHandoffTemplate(title, options = {}) {
  const frontmatter = buildFrontmatter({
    title,
    docType: "handoff",
    now: options.now,
  });

  return `${frontmatter}# ${title}

## Current State

- What is done?
- What is still in progress?

## Next Actions

1. 
2. 

## Open Blockers

- 

## Relevant Refs

- Code:
- Task:
- Artifacts:
- Commits:

## Expiration

- Remove or replace this file when the work is completed.
`;
}

function renderTemplate(docType, title, options = {}) {
  switch (docType) {
    case "decision":
      return buildDecisionTemplate(title, options);
    case "failed-attempt":
      return buildFailedAttemptTemplate(title, options);
    case "handoff":
      return buildHandoffTemplate(title, options);
    default:
      throw new Error(`unsupported document type: ${docType}`);
  }
}

function getDefaultDocsLayout(rootDir = ".") {
  return {
    decisionsDir: `${rootDir}/docs/decisions`,
    failuresDir: `${rootDir}/docs/failures`,
    handoffsDir: `${rootDir}/docs/handoffs`,
    activeHandoffPath: `${rootDir}/docs/handoffs/ACTIVE.md`,
  };
}

module.exports = {
  DOCUMENT_TYPES,
  buildDecisionTemplate,
  buildFailedAttemptTemplate,
  buildHandoffTemplate,
  getDefaultDocsLayout,
  renderTemplate,
  slugify,
  toIsoDate,
};
