const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  beginSession,
  getSessionLayout,
  readSessionResidue,
  recordSessionEvent,
} = require("../src/session-state");

async function withTempRepo(callback) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tacit-session-"));
  try {
    execFileSync("git", ["init"], { cwd: repoRoot, stdio: "ignore" });
    await callback(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

test("stores session residue in .git/tacit/session.json", async () => {
  await withTempRepo(async (repoRoot) => {
    const started = beginSession(repoRoot, {
      intent: "Compile session context into commit history",
    });
    assert.equal(started.session.intent, "Compile session context into commit history");
    assert.equal(fs.existsSync(getSessionLayout(repoRoot).file), true);

    recordSessionEvent(repoRoot, {
      type: "decision",
      summary: "Use .git/tacit/session.json as hot state.",
      paths: ["tacit/src/commit-flow.js"],
      symbols: ["runCommitFlow"],
    });
    recordSessionEvent(repoRoot, {
      type: "verification",
      summary: "Ran tacit test suite after refactor.",
      paths: ["tacit/src/commit-flow.js"],
    });
    recordSessionEvent(repoRoot, {
      type: "attempt",
      summary: "Branch-based retrieval was discarded.",
      paths: ["tacit/src/repo-context.js"],
    });

    const residue = readSessionResidue(repoRoot, {
      paths: ["tacit/src/commit-flow.js"],
      symbols: ["runCommitFlow"],
    });

    assert.equal(residue.intent, "Compile session context into commit history");
    assert.equal(residue.events.length, 2);
    assert.equal(residue.events[0].type, "decision");
    assert.equal(residue.events[0].symbols[0], "runCommitFlow");
    assert.ok(
      residue.events.some((event) => event.type === "verification"),
    );
  });
});
