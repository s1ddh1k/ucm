#!/usr/bin/env node

const fs = require("node:fs");

const messageFile = process.argv[2];

if (!messageFile) {
  console.error("commit message file is required");
  process.exit(1);
}

const message = fs.readFileSync(messageFile, "utf8").trim();
const firstLine = message.split("\n")[0];

const allowedTypes = [
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
];

const conventionalCommitPattern = new RegExp(
  `^(${allowedTypes.join("|")})(\\([a-z0-9._/-]+\\))?!?: .+`,
);

const ignoredPatterns = [/^Merge\b/, /^Revert\b/];

if (
  conventionalCommitPattern.test(firstLine) ||
  ignoredPatterns.some((pattern) => pattern.test(firstLine))
) {
  process.exit(0);
}

console.error("invalid commit message");
console.error("expected: type(scope): summary");
console.error(`allowed types: ${allowedTypes.join(", ")}`);
console.error(`received: ${firstLine}`);
process.exit(1);
