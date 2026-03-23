const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { beginSession, readSessionResidue } = require("../src/session-state");
const { runVerification } = require("../src/verification");

async function withTempRepo(callback) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tacit-verify-"));
  try {
    execFileSync("git", ["init"], { cwd: repoRoot, stdio: "ignore" });
    await callback(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

test("records successful verification commands into session residue", async () => {
  await withTempRepo(async (repoRoot) => {
    beginSession(repoRoot, {
      intent: "Capture verification automatically",
    });

    const result = runVerification(repoRoot, {
      commandArgs: ["node", "-e", "console.log('verify ok')"],
      paths: ["tacit/src/verification.js"],
      symbols: ["runVerification"],
    });

    assert.equal(result.status, "passed");
    assert.equal(result.exitCode, 0);

    const residue = readSessionResidue(repoRoot, {
      paths: ["tacit/src/verification.js"],
      symbols: ["runVerification"],
    });

    assert.ok(
      residue.events.some(
        (event) =>
          event.type === "verification" &&
          event.summary === "node -e console.log('verify ok') passed",
      ),
    );
  });
});
