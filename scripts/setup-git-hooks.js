#!/usr/bin/env node

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const gitDir = path.join(repoRoot, ".git");
const hooksDir = path.join(repoRoot, ".githooks");

if (!fs.existsSync(gitDir)) {
  process.exit(0);
}

if (!fs.existsSync(hooksDir)) {
  fs.mkdirSync(hooksDir, { recursive: true });
}

try {
  execFileSync("git", ["config", "core.hooksPath", ".githooks"], {
    cwd: repoRoot,
    stdio: "ignore",
  });
} catch (error) {
  console.error("failed to configure git hooks path");
  process.exit(1);
}
