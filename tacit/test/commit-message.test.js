const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  generateCommitMessage,
  shouldAutofillMessage,
  stripComments,
} = require("../src/commit-message");
const { beginSession, recordSessionEvent } = require("../src/session-state");

function withTempRepo(callback) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tacit-commit-"));
  try {
    callback(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("strips git comments when checking whether to autofill", () => {
  const text = "# Please enter the commit message\n# On branch main\n";
  assert.equal(stripComments(text), "");
  assert.equal(shouldAutofillMessage(text, ""), true);
  assert.equal(shouldAutofillMessage("feat: keep existing\n", ""), false);
});

test("generates a conventional subject and verification section", () => {
  const message = generateCommitMessage({
    repoRoot: "/repo",
    stagedFiles: ["tacit/src/cli.js", "tacit/test/checks.test.js"],
    stagedDiff: "+function main() {}\n+test(\"main\", () => {})\n",
  });

  assert.match(message, /^feat\(tacit\): /);
  assert.match(message, /\nVerification:\n- staged tacit\/test\/checks\.test\.js\n/);
});

test("does not use filenames as commit scope when only generic dirs exist", () => {
  const message = generateCommitMessage({
    repoRoot: "/repo",
    stagedFiles: ["src/main.js", "test/main.test.js"],
    stagedDiff: "+function main() {}\n+test(\"main\", () => {})\n",
  });

  assert.match(message, /^feat\(repo\): add main/);
});

test("uses staged decision docs as commit context", () => {
  withTempRepo((repoRoot) => {
    const decisionDir = path.join(repoRoot, "docs", "decisions");
    fs.mkdirSync(decisionDir, { recursive: true });
    fs.writeFileSync(
      path.join(decisionDir, "20260324-switch-tacit.md"),
      `---
title: switch tacit
type: decision
---
# switch tacit

## Decision

- Shift Tacit toward automatic commit authoring.

## Rationale

- Put rationale into commit history instead of hidden state.
`,
      "utf8",
    );

    const message = generateCommitMessage({
      repoRoot,
      stagedFiles: [
        "tacit/src/cli.js",
        "docs/decisions/20260324-switch-tacit.md",
      ],
      stagedDiff: "+console.log('hi')\n",
    });

    assert.match(message, /Why:\n- Shift Tacit toward automatic commit authoring\./);
    assert.match(message, /Refs:\n- docs\/decisions\/20260324-switch-tacit\.md/);
  });
});

test("uses session residue as commit context", () => {
  withTempRepo((repoRoot) => {
    execFileSync("git", ["init"], { cwd: repoRoot, stdio: "ignore" });
    const srcDir = path.join(repoRoot, "src");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "cart.js"), "export function computeTotal() {}\n", "utf8");

    beginSession(repoRoot, {
      intent: "Compile session intent into commit history",
    });
    recordSessionEvent(repoRoot, {
      type: "verification",
      summary: "Ran node --test tacit suite.",
      paths: ["src/cart.js"],
    });
    recordSessionEvent(repoRoot, {
      type: "attempt",
      summary: "Dropped branch-based retrieval keys.",
      paths: ["src/cart.js"],
    });

    const message = generateCommitMessage({
      repoRoot,
      stagedFiles: ["src/cart.js"],
      stagedDiff: "+export function computeTotal() { return 1; }\n",
    });

    assert.match(message, /Why:\n- Compile session intent into commit history\./);
    assert.match(message, /Verification:\n- Ran node --test tacit suite\./);
    assert.match(message, /Notes:\n- Dropped branch-based retrieval keys\./);
  });
});
