const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyCommit } = require("../src/checks");

test("blocks checkpoint-like commits without a staged handoff", () => {
  const result = classifyCommit({
    repoRoot: "/repo",
    stagedFiles: ["src/a.js"],
    stagedDiff: "+ // TODO: finish later\n",
    commitMessage: "wip: split parser",
  });

  assert.equal(result.status, "blocked");
  assert.ok(result.findings.some((finding) => finding.code === "needs-handoff"));
});

test("warns when high-risk files change without a decision doc", () => {
  const result = classifyCommit({
    repoRoot: "/repo",
    stagedFiles: ["package.json"],
    stagedDiff: "+  \"type\": \"module\"\n",
    commitMessage: "build: enable esm",
  });

  assert.equal(result.status, "review");
  assert.ok(
    result.findings.some((finding) => finding.code === "needs-decision-doc"),
  );
});

test("warns when code changes have no staged tests", () => {
  const result = classifyCommit({
    repoRoot: "/repo",
    stagedFiles: ["src/service.js"],
    stagedDiff: "+function run() {}\n",
    commitMessage: "feat: add service runner",
  });

  assert.equal(result.status, "review");
  assert.ok(
    result.findings.some((finding) => finding.code === "needs-test-evidence"),
  );
});

test("passes self-contained code and test commits", () => {
  const result = classifyCommit({
    repoRoot: "/repo",
    stagedFiles: ["src/service.js", "test/service.test.js"],
    stagedDiff: "+function run() {}\n+test(\"run\", () => {})\n",
    commitMessage: "feat: add service runner",
  });

  assert.equal(result.status, "ok");
  assert.equal(result.findings.length, 0);
});
