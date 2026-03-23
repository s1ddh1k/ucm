const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  buildClarifyingQuestions,
  enrichCommitMessage,
  runCommitFlow,
} = require("../src/commit-flow");
const { prepareCommitMessage } = require("../src/commit-message");

async function withTempRepo(callback) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tacit-flow-"));
  try {
    execFileSync("git", ["init"], { cwd: repoRoot, stdio: "ignore" });
    await callback(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

test("asks about missing tests and unclear intent for code-only changes", () => {
  const questions = buildClarifyingQuestions({
    repoRoot: "/repo",
    stagedFiles: ["src/service.js"],
    stagedDiff: "+function run() {}\n",
    inspection: {
      status: "review",
      findings: [
        {
          code: "needs-test-evidence",
          severity: "warn",
        },
      ],
    },
    context: { bullets: [], refs: [] },
  });

  const ids = questions.map((question) => question.id);
  assert.ok(ids.includes("test_gap"));
  assert.ok(ids.includes("main_intent"));
  assert.ok(ids.includes("alternatives"));
});

test("enriches the generated message with answer-specific bullets", () => {
  const message = `feat(tacit): add commit flow

Why:
- Add commit drafting.

Changes:
- update tacit

Verification:
- staged tacit/test/commit-flow.test.js
`;
  const next = enrichCommitMessage(
    message,
    [
      { id: "decision_rationale", kind: "why" },
      { id: "test_gap", kind: "verification" },
      { id: "mixed_scope", kind: "notes" },
    ],
    {
      decision_rationale: "Keep ambiguous rationale in commit history.",
      test_gap: "Reviewed manually because this only reshapes CLI output.",
      mixed_scope: "The hook and CLI need to move together for this draft flow.",
    },
  );

  assert.match(next, /Why:\n- Add commit drafting\.\n- Keep ambiguous rationale in commit history\./);
  assert.match(next, /Verification:\n- staged tacit\/test\/commit-flow\.test\.js\n- Reviewed manually because this only reshapes CLI output\./);
  assert.match(next, /\nNotes:\n- The hook and CLI need to move together for this draft flow\.\n/);
});

test("writes a tacit draft that prepare-commit-msg can consume", async () => {
  await withTempRepo(async (repoRoot) => {
    const srcDir = path.join(repoRoot, "src");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "main.js"), "export function main() {}\n", "utf8");
    execFileSync("git", ["add", "src/main.js"], { cwd: repoRoot, stdio: "ignore" });

    const flow = await runCommitFlow({
      root: repoRoot,
      noPrompt: true,
      llm: false,
    });

    assert.equal(flow.written, true);
    assert.equal(fs.existsSync(flow.draftPath), true);

    const commitMessagePath = path.join(repoRoot, ".git", "COMMIT_EDITMSG");
    const prepared = prepareCommitMessage({
      root: repoRoot,
      messageFile: commitMessagePath,
    });

    assert.equal(prepared.source, "tacit-draft");
    assert.equal(fs.readFileSync(commitMessagePath, "utf8"), flow.message);
    assert.equal(fs.existsSync(flow.draftPath), false);
  });
});

test("defaults commit flow to silent-first mode", async () => {
  await withTempRepo(async (repoRoot) => {
    const srcDir = path.join(repoRoot, "src");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "main.js"), "export function main() {}\n", "utf8");
    execFileSync("git", ["add", "src/main.js"], { cwd: repoRoot, stdio: "ignore" });

    const flow = await runCommitFlow({
      root: repoRoot,
      dryRun: true,
      llm: false,
    });

    assert.equal(flow.interactive, false);
    assert.equal(flow.answers.test_gap, undefined);
  });
});

test("uses the llm plan and finalizes it with user answers", async () => {
  await withTempRepo(async (repoRoot) => {
    const srcDir = path.join(repoRoot, "src");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "service.js"), "export function run() {}\n", "utf8");
    execFileSync("git", ["add", "src/service.js"], { cwd: repoRoot, stdio: "ignore" });

    const flow = await runCommitFlow({
      root: repoRoot,
      dryRun: true,
      answers: {
        test_gap: "Manual smoke test only because this is scaffolding.",
      },
      analyzeCommitImpl: async () => ({
        provider: "gemini",
        plan: {
          type: "feat",
          scope: "tacit",
          subject: "draft commit context",
          whyBullets: ["Capture commit intent before the message is written."],
          changeBullets: ["Add the interactive commit flow."],
          verificationBullets: [],
          notesBullets: [],
          refs: ["tacit/README.md"],
          questions: [
            {
              id: "test_gap",
              kind: "verification",
              question: "이 변경을 어떻게 검증했나요?",
            },
          ],
          confidence: "medium",
        },
      }),
      finalizeCommitImpl: async () => ({
        provider: "gemini",
        plan: {
          type: "feat",
          scope: "tacit",
          subject: "draft commit context",
          whyBullets: ["Capture commit intent before the message is written."],
          changeBullets: ["Add the interactive commit flow."],
          verificationBullets: ["Manual smoke test only because this is scaffolding."],
          notesBullets: ["LLM-generated clarification was folded into the draft."],
          refs: ["tacit/README.md"],
          questions: [],
          confidence: "high",
        },
      }),
    });

    assert.equal(flow.analysisSource, "llm");
    assert.equal(flow.llm.used, true);
    assert.equal(flow.llm.finalized, true);
    assert.equal(flow.llm.provider, "gemini");
    assert.match(flow.message, /^feat\(tacit\): draft commit context/);
    assert.match(flow.message, /Verification:\n- Manual smoke test only because this is scaffolding\./);
    assert.match(flow.message, /Notes:\n- LLM-generated clarification was folded into the draft\./);
  });
});
