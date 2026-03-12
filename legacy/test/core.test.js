#!/usr/bin/env node
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const {
  access,
  readFile,
  writeFile,
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  rm,
} = require("node:fs/promises");
const {
  startSuiteTimer,
  stopSuiteTimer,
  assert,
  assertEqual,
  assertDeepEqual,
  runGroup,
  summary,
} = require("./harness");

startSuiteTimer(30_000);

// ── extractJson tests ──

const {
  extractJson,
  buildCommand,
  spawnLlm,
  llmText,
  llmJson,
  sanitizeEnv,
  killPidTree,
  REASONING_EFFORTS,
} = require("../lib/core/llm");

// ── quoteUserContent / summarizeDecisions tests ──

const {
  quoteUserContent,
  summarizeDecisions,
  computeCoverage,
  isFullyCovered,
  buildQuestionPrompt,
  parseDecisionsFile,
  formatDecisions,
  EXPECTED_GREENFIELD,
} = require("../lib/core/qna");

// ── sanitizeContent tests ──

const {
  sanitizeContent,
  createWorktrees,
  loadWorkspace,
  loadWorkspaceSync,
  getWorktreeDiff,
  acquireLock,
  releaseLock,
  cleanupTask,
} = require("../lib/core/worktree");

// ── parseTaskFile / serializeTaskFile tests ──

const {
  parseArgs,
  parseTaskFile,
  serializeTaskFile,
  expandHome,
  normalizeProjects,
} = require("../lib/ucmd-task");

// ── TaskDag tests ──

const { TaskDag, generateForgeId } = require("../lib/core/task");

// ── ucmd pure functions ──

const { mapPipelineToForge, mergeStateStats } = require("../lib/ucmd");
const { enqueueTaskFileOp } = require("../lib/task-file-lock");

// ── forge pipeline tests ──

const {
  ForgePipeline,
  assertResumableDagStatus,
} = require("../lib/forge/index");
const {
  FORGE_PIPELINES,
  STAGE_TIMEOUTS,
  STAGE_ARTIFACTS,
  STAGE_MODELS,
  FORGE_DIR,
  WORKTREES_DIR,
} = require("../lib/core/constants");

function gitExec(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

async function initGitRepo(repoPath) {
  await mkdir(repoPath, { recursive: true });
  gitExec(["init"], repoPath);
  await writeFile(path.join(repoPath, "README.md"), "# test\n", "utf-8");
  gitExec(["add", "README.md"], repoPath);
  gitExec(
    [
      "-c",
      "user.email=ucm-test@example.com",
      "-c",
      "user.name=UCM Test",
      "commit",
      "-m",
      "init",
    ],
    repoPath,
  );
}

async function main() {
  // ── extractJson ──
  await runGroup("extractJson", {
    "parses JSON from code fence": () => {
      const result = extractJson(
        'Here is the result:\n```json\n{"key": "value"}\n```',
      );
      assertDeepEqual(result, { key: "value" }, "code fence JSON");
    },

    "parses raw JSON object": () => {
      const result = extractJson('{"done": true}');
      assertDeepEqual(result, { done: true }, "raw JSON object");
    },

    "parses raw JSON array": () => {
      const result = extractJson("[1, 2, 3]");
      assertDeepEqual(result, [1, 2, 3], "raw JSON array");
    },

    "parses JSON embedded in text": () => {
      const result = extractJson(
        'Some text before\n{"question": "test?"}\nSome text after',
      );
      assertDeepEqual(result, { question: "test?" }, "embedded JSON");
    },

    "parses JSON object with leading text": () => {
      const result = extractJson('Sure! Here is the answer: {"pass": true}');
      assertDeepEqual(result, { pass: true }, "leading text JSON object");
    },

    "throws on non-JSON text": () => {
      let threw = false;
      try {
        extractJson("This is not JSON at all");
      } catch (e) {
        threw = true;
        assert(
          e.message.includes("Failed to extract JSON"),
          "error message mentions failure",
        );
      }
      assert(threw, "should throw on non-JSON");
    },

    "throws on empty string": () => {
      let threw = false;
      try {
        extractJson("");
      } catch {
        threw = true;
      }
      assert(threw, "should throw on empty string");
    },

    "parses nested JSON objects": () => {
      const result = extractJson(
        '{"options": [{"label": "A", "reason": "B"}], "done": false}',
      );
      assertEqual(result.options.length, 1, "nested array length");
      assertEqual(result.options[0].label, "A", "nested label");
    },

    "handles code fence without json tag": () => {
      const result = extractJson('```\n{"result": 42}\n```');
      assertDeepEqual(result, { result: 42 }, "code fence without tag");
    },
  });

  // ── quoteUserContent ──
  await runGroup("quoteUserContent", {
    "passes through normal text": () => {
      assertEqual(
        quoteUserContent("hello world"),
        "hello world",
        "normal text",
      );
    },

    "escapes markdown headings": () => {
      const result = quoteUserContent("# This is a heading");
      assertEqual(result, "\\# This is a heading", "heading escape");
    },

    "escapes multiple heading levels": () => {
      const result = quoteUserContent("## Sub heading\n### Deep heading");
      assert(result.includes("\\## Sub heading"), "h2 escaped");
      assert(result.includes("\\### Deep heading"), "h3 escaped");
    },

    "handles null input": () => {
      assertEqual(quoteUserContent(null), "", "null returns empty");
    },

    "handles undefined input": () => {
      assertEqual(quoteUserContent(undefined), "", "undefined returns empty");
    },

    "handles number input": () => {
      assertEqual(quoteUserContent(42), "42", "number coerced to string");
    },

    "does not escape hash in middle of line": () => {
      assertEqual(
        quoteUserContent("color is #FF0000"),
        "color is #FF0000",
        "hash in middle",
      );
    },
  });

  // ── summarizeDecisions ──
  await runGroup("summarizeDecisions", {
    "returns all decisions when count <= 7": () => {
      const decisions = [
        { area: "기술 스택", question: "언어?", answer: "TypeScript" },
        { area: "설계 결정", question: "패턴?", answer: "MVC" },
      ];
      const result = summarizeDecisions(decisions);
      assert(result.includes("TypeScript"), "contains answer");
      assert(result.includes("기술 스택"), "contains area");
      assert(!result.includes("이전 결정"), "no summary section");
    },

    "summarizes old decisions when count > 7": () => {
      const decisions = [];
      for (let i = 0; i < 10; i++) {
        decisions.push({
          area: i < 5 ? "기술 스택" : "설계 결정",
          question: `Q${i}`,
          answer: `A${i}`,
        });
      }
      const result = summarizeDecisions(decisions);
      assert(result.includes("이전 결정 3개 요약"), "has summary header");
      assert(result.includes("최근 결정"), "has recent section");
      // Last 7 should be inline
      assert(result.includes("A3"), "recent decision A3 present");
      assert(result.includes("A9"), "recent decision A9 present");
    },

    "handles empty array": () => {
      const result = summarizeDecisions([]);
      assertEqual(result, "", "empty array returns empty string");
    },
  });

  // ── computeCoverage ──
  await runGroup("computeCoverage", {
    "returns 0% for empty decisions": () => {
      const coverage = computeCoverage([], EXPECTED_GREENFIELD);
      assertEqual(coverage["제품 정의"], 0, "zero coverage");
    },

    "caps coverage at 100%": () => {
      const decisions = [];
      for (let i = 0; i < 10; i++) {
        decisions.push({
          area: "제품 정의",
          question: `Q${i}`,
          answer: `A${i}`,
        });
      }
      const coverage = computeCoverage(decisions, EXPECTED_GREENFIELD);
      assertEqual(coverage["제품 정의"], 1.0, "capped at 1.0");
    },

    "isFullyCovered returns true when all areas complete": () => {
      const coverage = {
        "제품 정의": 1.0,
        "핵심 기능": 1.0,
        "기술 스택": 1.0,
        "설계 결정": 1.0,
      };
      assert(isFullyCovered(coverage), "fully covered");
    },

    "isFullyCovered returns false with gaps": () => {
      const coverage = {
        "제품 정의": 1.0,
        "핵심 기능": 0.5,
        "기술 스택": 1.0,
        "설계 결정": 1.0,
      };
      assert(!isFullyCovered(coverage), "not fully covered");
    },
  });

  // ── parseTaskFile / serializeTaskFile ──
  await runGroup("parseArgs", {
    "returns foreground/dev flags and positional command": () => {
      const opts = parseArgs([
        "node",
        "ucmd",
        "--foreground",
        "--dev",
        "daemon",
      ]);
      assertEqual(opts.foreground, true, "foreground flag set");
      assertEqual(opts.dev, true, "dev flag set");
      assertEqual(opts.command, "daemon", "positional command parsed");
    },

    "exits with status 0 for --help": () => {
      const originalExit = process.exit;
      const originalLog = console.log;
      let exitCode = null;
      let logCalled = false;

      process.exit = (code) => {
        exitCode = code;
        throw new Error("PARSE_ARGS_EXIT");
      };
      console.log = () => {
        logCalled = true;
      };

      let threw = false;
      try {
        parseArgs(["node", "ucmd", "--help"]);
      } catch (e) {
        threw = true;
        assertEqual(e.message, "PARSE_ARGS_EXIT", "help triggers exit path");
      } finally {
        process.exit = originalExit;
        console.log = originalLog;
      }

      assert(threw, "parseArgs help exits");
      assertEqual(exitCode, 0, "help exits with code 0");
      assert(logCalled, "help logs usage");
    },

    "exits with status 1 for unknown option": () => {
      const originalExit = process.exit;
      const originalError = console.error;
      let exitCode = null;
      const errors = [];

      process.exit = (code) => {
        exitCode = code;
        throw new Error("PARSE_ARGS_EXIT");
      };
      console.error = (...args) => {
        errors.push(args.join(" "));
      };

      let threw = false;
      try {
        parseArgs(["node", "ucmd", "--bogus-option"]);
      } catch (e) {
        threw = true;
        assertEqual(e.message, "PARSE_ARGS_EXIT", "unknown option exits");
      } finally {
        process.exit = originalExit;
        console.error = originalError;
      }

      assert(threw, "parseArgs unknown option exits");
      assertEqual(exitCode, 1, "unknown option exits with code 1");
      assert(
        errors.some((line) => line.includes("알 수 없는 옵션")),
        "unknown option error message logged",
      );
      assert(
        errors.some((line) => line.includes("도움말: ucmd --help")),
        "help hint logged",
      );
    },
  });

  await runGroup("parseTaskFile", {
    "parses YAML frontmatter": () => {
      const content = `---
id: test-001
title: Test Task
state: pending
---
This is the body.`;
      const { meta, body } = parseTaskFile(content);
      assertEqual(meta.id, "test-001", "id");
      assertEqual(meta.title, "Test Task", "title");
      assertEqual(meta.state, "pending", "state");
      assertEqual(body, "This is the body.", "body");
    },

    "handles missing frontmatter": () => {
      const { meta, body } = parseTaskFile("Just a body");
      assertDeepEqual(meta, {}, "empty meta");
      assertEqual(body, "Just a body", "body as-is");
    },

    "parses boolean values": () => {
      const content = `---
suspended: true
active: false
---`;
      const { meta } = parseTaskFile(content);
      assertEqual(meta.suspended, true, "true boolean");
      assertEqual(meta.active, false, "false boolean");
    },

    "parses inline arrays": () => {
      const content = `---
tags: [bug, urgent, backend]
---`;
      const { meta } = parseTaskFile(content);
      assertDeepEqual(meta.tags, ["bug", "urgent", "backend"], "inline array");
    },

    "parses !!json tagged values": () => {
      const content = `---
tokenUsage: !!json {"input":100,"output":50}
---`;
      const { meta } = parseTaskFile(content);
      assertDeepEqual(
        meta.tokenUsage,
        { input: 100, output: 50 },
        "json tagged value",
      );
    },

    "falls back to null for malformed !!json payload": () => {
      const content = `---
tokenUsage: !!json {"input":100,
---`;
      const { meta } = parseTaskFile(content);
      assertEqual(meta.tokenUsage, null, "invalid !!json becomes null");
    },

    "handles newline escaping": () => {
      const content = `---
title: line1\\nline2
---`;
      const { meta } = parseTaskFile(content);
      assertEqual(meta.title, "line1\nline2", "escaped newline");
    },

    "keeps id and dedupHash as strings even when numeric-like": () => {
      const content = `---
id: 12345
dedupHash: 9007199254740993
priority: 7
---`;
      const { meta } = parseTaskFile(content);
      assertEqual(meta.id, "12345", "id stays string");
      assertEqual(
        meta.dedupHash,
        "9007199254740993",
        "dedupHash stays string",
      );
      assertEqual(meta.priority, 7, "other numeric fields still parse numbers");
    },

    "returns original body when frontmatter end marker is missing": () => {
      const content = `---
id: broken
title: missing end marker`;
      const { meta, body } = parseTaskFile(content);
      assertDeepEqual(meta, {}, "invalid frontmatter yields empty meta");
      assertEqual(body, content, "original content preserved as body");
    },
  });

  await runGroup("serializeTaskFile", {
    "round-trips through parse/serialize": () => {
      const meta = {
        id: "test-002",
        title: "Round Trip",
        state: "running",
        priority: 5,
      };
      const body = "Task body content here.";
      const serialized = serializeTaskFile(meta, body);
      const { meta: parsed, body: parsedBody } = parseTaskFile(serialized);
      assertEqual(parsed.id, "test-002", "round-trip id");
      assertEqual(parsed.title, "Round Trip", "round-trip title");
      assertEqual(parsed.state, "running", "round-trip state");
      assertEqual(parsed.priority, 5, "round-trip number");
      assertEqual(parsedBody, body, "round-trip body");
    },

    "serializes !!json for objects": () => {
      const meta = { id: "test-003", tokenUsage: { input: 100, output: 50 } };
      const serialized = serializeTaskFile(meta, "");
      assert(serialized.includes("!!json"), "contains !!json tag");
      const { meta: parsed } = parseTaskFile(serialized);
      assertDeepEqual(
        parsed.tokenUsage,
        { input: 100, output: 50 },
        "json round-trip",
      );
    },

    "skips null/undefined values": () => {
      const meta = {
        id: "test-004",
        title: null,
        state: undefined,
        tag: "valid",
      };
      const serialized = serializeTaskFile(meta, "");
      assert(!serialized.includes("title:"), "null skipped");
      assert(!serialized.includes("state:"), "undefined skipped");
      assert(serialized.includes("tag: valid"), "valid included");
    },
  });

  // ── sanitizeContent ──
  await runGroup("sanitizeContent", {
    "returns non-string inputs as-is": () => {
      assertEqual(sanitizeContent(null), null, "null passthrough");
      assertEqual(
        sanitizeContent(undefined),
        undefined,
        "undefined passthrough",
      );
      assertEqual(sanitizeContent(""), "", "empty string passthrough");
    },

    "passes through normal text unchanged": () => {
      const text = "This is normal code with no secrets.";
      assertEqual(sanitizeContent(text), text, "normal text unchanged");
    },

    "redacts api_key pattern": () => {
      const input = "api_key: sk_live_abcdefghij1234567890";
      const result = sanitizeContent(input);
      assert(result.includes("[REDACTED]"), "contains REDACTED marker");
      assert(!result.includes("abcdefghij1234567890"), "secret value removed");
    },

    "redacts apikey (no separator) pattern": () => {
      const input = "apikey=my_secret_key_value_12345678";
      const result = sanitizeContent(input);
      assert(result.includes("[REDACTED]"), "contains REDACTED marker");
      assert(
        !result.includes("my_secret_key_value_12345678"),
        "secret value removed",
      );
    },

    "redacts secret/password/token patterns": () => {
      const input =
        "secret: supersecretvalue1234\npassword=mypassword123\ntoken: tok_abc123def456";
      const result = sanitizeContent(input);
      assert(!result.includes("supersecretvalue1234"), "secret redacted");
      assert(!result.includes("mypassword123"), "password redacted");
      assert(!result.includes("tok_abc123def456"), "token redacted");
      // Should have 3 REDACTED markers
      const redactedCount = (result.match(/\[REDACTED\]/g) || []).length;
      assertEqual(redactedCount, 3, "three redactions");
    },

    "redacts AWS/Anthropic/OpenAI key env vars": () => {
      const input =
        "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\nANTHROPIC_API_KEY=sk-ant-abc123\nOPENAI_API_KEY=sk-proj-xyz789";
      const result = sanitizeContent(input);
      assert(!result.includes("wJalrXUtnFEMI"), "AWS key redacted");
      assert(!result.includes("sk-ant-abc123"), "Anthropic key redacted");
      assert(!result.includes("sk-proj-xyz789"), "OpenAI key redacted");
    },

    "redacts Bearer tokens": () => {
      const input =
        "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
      const result = sanitizeContent(input);
      assert(result.includes("[REDACTED]"), "Bearer token redacted");
      assert(
        !result.includes("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"),
        "JWT payload removed",
      );
    },

    "redacts GitHub PATs (ghp_ prefix)": () => {
      const input = "GITHUB_TOKEN=ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789";
      const result = sanitizeContent(input);
      assert(result.includes("[REDACTED]"), "GitHub PAT redacted");
      assert(
        !result.includes("aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789"),
        "PAT value removed",
      );
    },

    "redacts OpenAI sk- keys": () => {
      const input = "key: sk-abcdefghijklmnopqrstuvwxyz0123456789";
      const result = sanitizeContent(input);
      assert(result.includes("[REDACTED]"), "sk- key redacted");
      assert(
        !result.includes("abcdefghijklmnopqrstuvwxyz0123456789"),
        "sk- key value removed",
      );
    },

    "preserves prefix before REDACTED marker": () => {
      const input = "ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789";
      const result = sanitizeContent(input);
      // prefix should be min(10, floor(len/3)) chars of original match
      assert(result.startsWith("ghp_"), "preserves beginning of token");
      assert(result.endsWith("[REDACTED]"), "ends with REDACTED");
    },

    "handles multiple secrets in same line": () => {
      const input = "api_key: secret12345678901234 token: mytokenvalue12345678";
      const result = sanitizeContent(input);
      const redactedCount = (result.match(/\[REDACTED\]/g) || []).length;
      assert(redactedCount >= 2, "multiple redactions in same line");
    },

    "is case-insensitive for key names": () => {
      const input =
        "API_KEY: secret12345678901234\nApi_Key: secret12345678901234";
      const result = sanitizeContent(input);
      const redactedCount = (result.match(/\[REDACTED\]/g) || []).length;
      assertEqual(redactedCount, 2, "case-insensitive matching");
    },
  });

  // ── worktree lock & rollback ──
  await runGroup("worktree reliability", {
    "acquireLock returns retryable ELOCKED with context": async () => {
      const taskId = `forge-lock-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const first = await acquireLock(taskId);
      let err = null;
      try {
        await acquireLock(taskId);
      } catch (e) {
        err = e;
      } finally {
        await releaseLock(first);
      }

      assert(!!err, "second lock acquire should fail");
      assertEqual(err.code, "ELOCKED", "lock contention code");
      assertEqual(err.retryable, true, "lock contention should be retryable");
      assertEqual(err.taskId, taskId, "taskId context");
      assertEqual(err.stage, "worktree-lock", "stage context");
      assert(
        String(err.filePath || "").endsWith(`${taskId}.lock`),
        "filePath context",
      );
    },

    "createWorktrees rolls back partial setup when a later project fails": async () => {
      const uniq = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const taskId = `forge-wt-${uniq}`;
      const baseTmp = await mkdtemp(path.join(os.tmpdir(), "ucm-worktree-"));
      const repoOk = path.join(baseTmp, "repo-ok");
      const repoBad = path.join(baseTmp, "repo-bad-missing");
      const worktreeTaskDir = path.join(WORKTREES_DIR, taskId);
      const branchName = `ucm/${taskId}`;

      await initGitRepo(repoOk);

      let err = null;
      try {
        await createWorktrees(taskId, [
          { name: "ok", path: repoOk, role: "primary" },
          { name: "bad", path: repoBad, role: "secondary" },
        ]);
      } catch (e) {
        err = e;
      }

      assert(!!err, "createWorktrees should fail");
      assertEqual(err.taskId, taskId, "taskId context");
      assertEqual(err.stage, "worktree-setup", "stage context");
      assert(
        String(err.filePath || "").endsWith(path.join(taskId, "workspace.json")),
        "filePath context",
      );

      let worktreeDirExists = true;
      try {
        await access(worktreeTaskDir);
      } catch (e) {
        if (e.code === "ENOENT") worktreeDirExists = false;
      }
      assert(!worktreeDirExists, "partial worktree directory rolled back");

      const branchOutput = gitExec(["branch", "--list", branchName], repoOk);
      assertEqual(branchOutput, "", "rollback removed temporary branch");

      await cleanupTask(taskId);
      await rm(baseTmp, { recursive: true, force: true });
    },
  });

  await runGroup("worktree metadata failure paths", {
    "loadWorkspace returns null and logs when workspace.json is malformed": async () => {
      const taskId = `forge-workspace-async-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const taskDir = path.join(WORKTREES_DIR, taskId);
      const workspacePath = path.join(taskDir, "workspace.json");
      const originalConsoleError = console.error;
      const logs = [];

      await mkdir(taskDir, { recursive: true });
      await writeFile(workspacePath, "{broken json", "utf-8");
      console.error = (...args) => logs.push(args.join(" "));

      try {
        const loaded = await loadWorkspace(taskId);
        assertEqual(loaded, null, "invalid workspace should return null");
        assert(
          logs.some((line) =>
            line.includes(
              `[loadWorkspace] failed to load workspace for ${taskId}`,
            ),
          ),
          "parse failure should be logged with task id",
        );
      } finally {
        console.error = originalConsoleError;
        await rm(taskDir, { recursive: true, force: true });
      }
    },

    "loadWorkspaceSync returns null and logs when workspace.json is malformed": async () => {
      const taskId = `forge-workspace-sync-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const taskDir = path.join(WORKTREES_DIR, taskId);
      const workspacePath = path.join(taskDir, "workspace.json");
      const originalConsoleError = console.error;
      const logs = [];

      await mkdir(taskDir, { recursive: true });
      await writeFile(workspacePath, "{broken json", "utf-8");
      console.error = (...args) => logs.push(args.join(" "));

      try {
        const loaded = loadWorkspaceSync(taskId);
        assertEqual(loaded, null, "invalid workspace should return null");
        assert(
          logs.some((line) =>
            line.includes(
              `[loadWorkspaceSync] failed to load workspace for ${taskId}`,
            ),
          ),
          "sync parse failure should be logged with task id",
        );
      } finally {
        console.error = originalConsoleError;
        await rm(taskDir, { recursive: true, force: true });
      }
    },

    "getWorktreeDiff returns workspace-unavailable message when workspace metadata is missing": async () => {
      const taskId = `forge-diff-nospace-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const diffs = await getWorktreeDiff(taskId, [{ name: "app" }]);
      assertEqual(diffs.length, 1, "single project diff result");
      assertEqual(diffs[0].project, "app", "project name preserved");
      assertEqual(
        diffs[0].diff,
        "(worktree metadata unavailable: task workspace not found)",
        "missing workspace message",
      );
    },

    "getWorktreeDiff returns worktree-missing message when workspace exists but directory is absent": async () => {
      const taskId = `forge-diff-missing-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const taskDir = path.join(WORKTREES_DIR, taskId);
      const workspacePath = path.join(taskDir, "workspace.json");

      await mkdir(taskDir, { recursive: true });
      await writeFile(
        workspacePath,
        `${JSON.stringify(
          {
            taskId,
            projects: [{ name: "app", baseCommit: "abc123" }],
          },
          null,
          2,
        )}\n`,
        "utf-8",
      );

      try {
        const diffs = await getWorktreeDiff(taskId, [{ name: "app" }]);
        assertEqual(diffs.length, 1, "single project diff result");
        assertEqual(
          diffs[0].diff,
          "(worktree missing: no diff available for this task)",
          "missing worktree message",
        );
      } finally {
        await rm(taskDir, { recursive: true, force: true });
      }
    },
  });

  // ── buildQuestionPrompt structure ──
  await runGroup("buildQuestionPrompt structure", {
    "includes instruction precedence markers": () => {
      const coverage = {
        "제품 정의": 0,
        "핵심 기능": 0,
        "기술 스택": 0,
        "설계 결정": 0,
      };
      const prompt = buildQuestionPrompt(null, [], null, {
        isResume: false,
        isBrownfield: false,
        coverage,
      });
      assert(
        prompt.includes("파싱 실패"),
        "mentions parse failure consequence",
      );
      assert(prompt.includes("거부되는 응답"), "includes rejection examples");
      assert(prompt.includes("질문 예시"), "includes question example");
      assert(prompt.includes("완료 예시"), "includes done example");
    },

    "wraps feedback in code fence": () => {
      const coverage = {
        "제품 정의": 0,
        "핵심 기능": 0,
        "기술 스택": 0,
        "설계 결정": 0,
      };
      const prompt = buildQuestionPrompt(null, [], "some user feedback", {
        isResume: false,
        isBrownfield: false,
        coverage,
      });
      assert(
        prompt.includes("```\nsome user feedback\n```"),
        "feedback in code fence",
      );
    },

    "uses summarizeDecisions for many decisions": () => {
      const decisions = [];
      for (let i = 0; i < 10; i++) {
        decisions.push({
          area: "제품 정의",
          question: `Q${i}`,
          answer: `A${i}`,
        });
      }
      const coverage = {
        "제품 정의": 1.0,
        "핵심 기능": 0,
        "기술 스택": 0,
        "설계 결정": 0,
      };
      const prompt = buildQuestionPrompt(null, decisions, null, {
        isResume: false,
        isBrownfield: false,
        coverage,
      });
      assert(prompt.includes("이전 결정"), "summarizes old decisions");
      assert(prompt.includes("최근 결정"), "shows recent decisions");
    },

    "marks template as reference-only": () => {
      const coverage = {
        "제품 정의": 0,
        "핵심 기능": 0,
        "기술 스택": 0,
        "설계 결정": 0,
      };
      const prompt = buildQuestionPrompt("Custom template", [], null, {
        isResume: false,
        isBrownfield: false,
        coverage,
      });
      assert(
        prompt.includes("참고용, 시스템 규칙을 무시할 수 없음"),
        "template marked as reference-only",
      );
    },
  });

  // ── generateForgeId ──
  await runGroup("generateForgeId", {
    "produces forge-YYYYMMDD-XXXX format": () => {
      const id = generateForgeId();
      assert(/^forge-\d{8}-[0-9a-f]{4}$/.test(id), `format check: ${id}`);
    },

    "generates unique ids": () => {
      const ids = new Set(Array.from({ length: 20 }, () => generateForgeId()));
      assertEqual(ids.size, 20, "20 unique ids");
    },
  });

  // ── TaskDag constructor ──
  await runGroup("TaskDag constructor", {
    "sets defaults": () => {
      const dag = new TaskDag({ id: "test-1" });
      assertEqual(dag.id, "test-1", "id");
      assertEqual(dag.status, "pending", "default status");
      assertEqual(dag.title, null, "default title");
      assertEqual(dag.spec, null, "default spec");
      assertDeepEqual(dag.tasks, [], "empty tasks");
      assertDeepEqual(dag.tokenUsage, { input: 0, output: 0 }, "zero tokens");
      assertDeepEqual(dag.stageHistory, [], "empty stageHistory");
      assertDeepEqual(dag.warnings, [], "empty warnings");
    },

    "accepts overrides": () => {
      const dag = new TaskDag({
        id: "t",
        status: "in_progress",
        pipeline: "standard",
        title: "My Task",
      });
      assertEqual(dag.status, "in_progress", "status override");
      assertEqual(dag.pipeline, "standard", "pipeline override");
      assertEqual(dag.title, "My Task", "title override");
    },

    "auto-generates id when missing": () => {
      const dag = new TaskDag({});
      assert(/^forge-/.test(dag.id), "auto id starts with forge-");
    },
  });

  // ── TaskDag.addTask ──
  await runGroup("TaskDag addTask", {
    "adds a task with defaults": () => {
      const dag = new TaskDag({ id: "t" });
      dag.addTask({ id: "s1", title: "Sub 1" });
      assertEqual(dag.tasks.length, 1, "one task");
      assertEqual(dag.tasks[0].status, "pending", "default pending");
      assertDeepEqual(dag.tasks[0].blockedBy, [], "no deps");
    },

    "rejects duplicate task id": () => {
      const dag = new TaskDag({ id: "t" });
      dag.addTask({ id: "s1", title: "Sub 1" });
      let threw = false;
      try {
        dag.addTask({ id: "s1", title: "Dup" });
      } catch (_e) {
        threw = true;
      }
      assert(threw, "throws on duplicate id");
    },

    "warns on unresolved blockedBy refs": () => {
      const dag = new TaskDag({ id: "t" });
      dag.addTask({ id: "s1", title: "Sub 1", blockedBy: ["nonexistent"] });
      assert(dag.warnings.length > 0, "has warning");
      assert(
        dag.warnings[0].includes("nonexistent"),
        "warning mentions bad ref",
      );
    },

    "accepts valid blockedBy": () => {
      const dag = new TaskDag({ id: "t" });
      dag.addTask({ id: "s1", title: "Sub 1" });
      dag.addTask({ id: "s2", title: "Sub 2", blockedBy: ["s1"] });
      assertEqual(dag.warnings.length, 0, "no warnings");
      assertDeepEqual(dag.tasks[1].blockedBy, ["s1"], "blockedBy preserved");
    },
  });

  // ── TaskDag.updateTaskStatus ──
  await runGroup("TaskDag updateTaskStatus", {
    "updates status": () => {
      const dag = new TaskDag({ id: "t" });
      dag.addTask({ id: "s1", title: "Sub 1" });
      dag.updateTaskStatus("s1", "in_progress");
      assertEqual(dag.tasks[0].status, "in_progress", "status updated");
    },

    "sets startedAt on in_progress": () => {
      const dag = new TaskDag({ id: "t" });
      dag.addTask({ id: "s1", title: "Sub 1" });
      assertEqual(dag.tasks[0].startedAt, null, "no startedAt initially");
      dag.updateTaskStatus("s1", "in_progress");
      assert(dag.tasks[0].startedAt !== null, "startedAt set");
    },

    "does not overwrite startedAt on second in_progress": () => {
      const dag = new TaskDag({ id: "t" });
      dag.addTask({ id: "s1", title: "Sub 1" });
      dag.updateTaskStatus("s1", "in_progress");
      const first = dag.tasks[0].startedAt;
      dag.updateTaskStatus("s1", "pending");
      dag.updateTaskStatus("s1", "in_progress");
      assertEqual(dag.tasks[0].startedAt, first, "startedAt preserved");
    },

    "sets completedAt on done": () => {
      const dag = new TaskDag({ id: "t" });
      dag.addTask({ id: "s1", title: "Sub 1" });
      dag.updateTaskStatus("s1", "done");
      assert(dag.tasks[0].completedAt !== null, "completedAt set");
    },

    "sets completedAt on failed": () => {
      const dag = new TaskDag({ id: "t" });
      dag.addTask({ id: "s1", title: "Sub 1" });
      dag.updateTaskStatus("s1", "failed");
      assert(dag.tasks[0].completedAt !== null, "completedAt set on failure");
    },

    "throws for unknown task id": () => {
      const dag = new TaskDag({ id: "t" });
      let threw = false;
      try {
        dag.updateTaskStatus("nope", "done");
      } catch {
        threw = true;
      }
      assert(threw, "throws on unknown id");
    },
  });

  // ── TaskDag.getReadyTasks ──
  await runGroup("TaskDag getReadyTasks", {
    "returns all tasks when no deps": () => {
      const dag = new TaskDag({ id: "t" });
      dag.addTask({ id: "s1", title: "A" });
      dag.addTask({ id: "s2", title: "B" });
      assertEqual(dag.getReadyTasks().length, 2, "both ready");
    },

    "blocks tasks with unmet deps": () => {
      const dag = new TaskDag({ id: "t" });
      dag.addTask({ id: "s1", title: "A" });
      dag.addTask({ id: "s2", title: "B", blockedBy: ["s1"] });
      const ready = dag.getReadyTasks();
      assertEqual(ready.length, 1, "one ready");
      assertEqual(ready[0].id, "s1", "s1 is ready");
    },

    "unblocks when dep is done": () => {
      const dag = new TaskDag({ id: "t" });
      dag.addTask({ id: "s1", title: "A" });
      dag.addTask({ id: "s2", title: "B", blockedBy: ["s1"] });
      dag.updateTaskStatus("s1", "done");
      const ready = dag.getReadyTasks();
      assertEqual(ready.length, 1, "s2 now ready");
      assertEqual(ready[0].id, "s2", "s2 is the ready one");
    },

    "excludes non-pending tasks": () => {
      const dag = new TaskDag({ id: "t" });
      dag.addTask({ id: "s1", title: "A" });
      dag.updateTaskStatus("s1", "in_progress");
      assertEqual(dag.getReadyTasks().length, 0, "in_progress not ready");
    },
  });

  // ── TaskDag.getWaves ──
  await runGroup("TaskDag getWaves", {
    "returns empty for no tasks": () => {
      const dag = new TaskDag({ id: "t" });
      assertDeepEqual(dag.getWaves(), [], "no waves");
    },

    "single wave when no deps": () => {
      const dag = new TaskDag({ id: "t" });
      dag.addTask({ id: "a", title: "A" });
      dag.addTask({ id: "b", title: "B" });
      const waves = dag.getWaves();
      assertEqual(waves.length, 1, "one wave");
      assertEqual(waves[0].length, 2, "both in first wave");
    },

    "linear chain produces sequential waves": () => {
      const dag = new TaskDag({ id: "t" });
      dag.addTask({ id: "a", title: "A" });
      dag.addTask({ id: "b", title: "B", blockedBy: ["a"] });
      dag.addTask({ id: "c", title: "C", blockedBy: ["b"] });
      const waves = dag.getWaves();
      assertEqual(waves.length, 3, "three waves");
      assertDeepEqual(waves[0], ["a"], "wave 1");
      assertDeepEqual(waves[1], ["b"], "wave 2");
      assertDeepEqual(waves[2], ["c"], "wave 3");
    },

    "diamond pattern": () => {
      const dag = new TaskDag({ id: "t" });
      dag.addTask({ id: "a", title: "A" });
      dag.addTask({ id: "b", title: "B", blockedBy: ["a"] });
      dag.addTask({ id: "c", title: "C", blockedBy: ["a"] });
      dag.addTask({ id: "d", title: "D", blockedBy: ["b", "c"] });
      const waves = dag.getWaves();
      assertEqual(waves.length, 3, "three waves in diamond");
      assertDeepEqual(waves[0], ["a"], "root");
      assertEqual(waves[1].length, 2, "parallel middle");
      assert(
        waves[1].includes("b") && waves[1].includes("c"),
        "b and c in wave 2",
      );
      assertDeepEqual(waves[2], ["d"], "join node");
    },

    "detects cycle": () => {
      const dag = new TaskDag({ id: "t" });
      dag.addTask({ id: "a", title: "A", blockedBy: ["b"] });
      dag.addTask({ id: "b", title: "B", blockedBy: ["a"] });
      let threw = false;
      try {
        dag.getWaves();
      } catch (e) {
        threw = true;
        assert(e.message.includes("cycle"), "error mentions cycle");
      }
      assert(threw, "throws on cycle");
    },
  });

  // ── TaskDag.validateDeps ──
  await runGroup("TaskDag validateDeps", {
    "passes with valid deps": () => {
      const dag = new TaskDag({ id: "t" });
      dag.addTask({ id: "a", title: "A" });
      dag.addTask({ id: "b", title: "B", blockedBy: ["a"] });
      dag.validateDeps(); // should not throw
      assert(true, "valid deps pass");
    },

    "throws on dangling references": () => {
      const dag = new TaskDag({ id: "t" });
      dag.addTask({ id: "a", title: "A" });
      // Manually add a dangling ref to bypass addTask warning
      dag.tasks[0].blockedBy = ["ghost"];
      let threw = false;
      try {
        dag.validateDeps();
      } catch (e) {
        threw = true;
        assert(e.message.includes("dangling"), "error mentions dangling");
      }
      assert(threw, "throws on dangling dep");
    },
  });

  // ── TaskDag allDone / anyFailed ──
  await runGroup("TaskDag allDone and anyFailed", {
    "allDone true when all done": () => {
      const dag = new TaskDag({ id: "t" });
      dag.addTask({ id: "a", title: "A" });
      dag.addTask({ id: "b", title: "B" });
      dag.updateTaskStatus("a", "done");
      dag.updateTaskStatus("b", "done");
      assert(dag.allDone(), "all done");
    },

    "allDone false when some pending": () => {
      const dag = new TaskDag({ id: "t" });
      dag.addTask({ id: "a", title: "A" });
      dag.updateTaskStatus("a", "done");
      dag.addTask({ id: "b", title: "B" });
      assert(!dag.allDone(), "not all done");
    },

    "allDone true when no tasks": () => {
      const dag = new TaskDag({ id: "t" });
      assert(dag.allDone(), "vacuously true");
    },

    "anyFailed detects failure": () => {
      const dag = new TaskDag({ id: "t" });
      dag.addTask({ id: "a", title: "A" });
      assert(!dag.anyFailed(), "no failures initially");
      dag.updateTaskStatus("a", "failed");
      assert(dag.anyFailed(), "failure detected");
    },
  });

  // ── TaskDag token tracking ──
  await runGroup("TaskDag token tracking", {
    "addTokenUsage accumulates": () => {
      const dag = new TaskDag({ id: "t" });
      dag.addTokenUsage(100, 50);
      dag.addTokenUsage(200, 100);
      assertEqual(dag.tokenUsage.input, 300, "input accumulated");
      assertEqual(dag.tokenUsage.output, 150, "output accumulated");
    },

    "totalTokens sums input and output": () => {
      const dag = new TaskDag({ id: "t" });
      dag.addTokenUsage(100, 50);
      assertEqual(dag.totalTokens(), 150, "total tokens");
    },

    "isOverBudget checks correctly": () => {
      const dag = new TaskDag({ id: "t" });
      dag.addTokenUsage(100, 50);
      assert(!dag.isOverBudget(200), "under budget");
      assert(dag.isOverBudget(100), "over budget");
      assert(!dag.isOverBudget(0), "zero budget = no limit");
      assert(!dag.isOverBudget(-1), "negative budget = no limit");
    },

    "handles null/undefined in addTokenUsage": () => {
      const dag = new TaskDag({ id: "t" });
      dag.addTokenUsage(null, undefined);
      assertEqual(dag.totalTokens(), 0, "null/undefined treated as 0");
    },
  });

  // ── TaskDag recordStage ──
  await runGroup("TaskDag recordStage", {
    "records stage history": () => {
      const dag = new TaskDag({ id: "t" });
      dag.recordStage("implement", "pass", 5000, { input: 100, output: 50 });
      assertEqual(dag.stageHistory.length, 1, "one entry");
      assertEqual(dag.stageHistory[0].stage, "implement", "stage name");
      assertEqual(dag.stageHistory[0].status, "pass", "stage status");
      assertEqual(dag.stageHistory[0].durationMs, 5000, "duration");
      assertDeepEqual(
        dag.stageHistory[0].tokenUsage,
        { input: 100, output: 50 },
        "token usage",
      );
    },

    "appends multiple stages": () => {
      const dag = new TaskDag({ id: "t" });
      dag.recordStage("design", "pass", 1000, null);
      dag.recordStage("implement", "pass", 2000, null);
      dag.recordStage("verify", "fail", 3000, null);
      assertEqual(dag.stageHistory.length, 3, "three entries");
      assertEqual(dag.stageHistory[2].status, "fail", "last stage failed");
    },

    "updates updatedAt": () => {
      const dag = new TaskDag({ id: "t" });
      const before = dag.updatedAt;
      dag.recordStage("test", "pass", 100, null);
      assert(dag.updatedAt >= before, "updatedAt advanced");
    },
  });

  // ── TaskDag toJSON ──
  await runGroup("TaskDag toJSON", {
    "round-trips through JSON": () => {
      const dag = new TaskDag({
        id: "t",
        status: "in_progress",
        pipeline: "standard",
        title: "Test",
      });
      dag.addTask({ id: "s1", title: "Sub 1" });
      dag.addTokenUsage(500, 250);
      dag.recordStage("implement", "pass", 3000, { input: 500, output: 250 });
      dag.warnings.push("test warning");
      dag.currentStage = "verify";

      const json = dag.toJSON();
      const restored = new TaskDag(json);
      assertEqual(restored.id, "t", "id preserved");
      assertEqual(restored.status, "in_progress", "status preserved");
      assertEqual(restored.pipeline, "standard", "pipeline preserved");
      assertEqual(restored.title, "Test", "title preserved");
      assertEqual(restored.tasks.length, 1, "tasks preserved");
      assertEqual(restored.tasks[0].id, "s1", "task id preserved");
      assertDeepEqual(
        restored.tokenUsage,
        { input: 500, output: 250 },
        "tokenUsage preserved",
      );
      assertEqual(restored.currentStage, "verify", "currentStage preserved");
      assertEqual(restored.stageHistory.length, 1, "stageHistory preserved");
      assertEqual(
        restored.stageHistory[0].stage,
        "implement",
        "stageHistory entry stage",
      );
      assertEqual(
        restored.stageHistory[0].status,
        "pass",
        "stageHistory entry status",
      );
      assertEqual(restored.warnings.length, 1, "warnings preserved");
      assertEqual(
        restored.warnings[0],
        "test warning",
        "warning content preserved",
      );
    },
  });

  // ── TaskDag.save ──
  await runGroup("TaskDag.save", {
    "allows concurrent saves for separate instances with same task id": async () => {
      const id = `forge-save-race-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const dir = path.join(FORGE_DIR, id);
      const filePath = path.join(dir, "task.json");
      const dagA = new TaskDag({ id, title: "alpha" });
      const dagB = new TaskDag({ id, title: "beta" });

      try {
        await Promise.all([dagA.save(), dagB.save()]);
        const parsed = JSON.parse(await readFile(filePath, "utf-8"));
        assertEqual(parsed.id, id, "saved task id");
        assert(
          parsed.title === "alpha" || parsed.title === "beta",
          "last writer wins without write corruption",
        );
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },

    "wraps save errors with taskId and filePath context": async () => {
      const id = `forge-save-error-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const dir = path.join(FORGE_DIR, id);
      const filePath = path.join(dir, "task.json");
      const dag = new TaskDag({ id, title: "context test" });

      await mkdir(filePath, { recursive: true });
      let err;
      try {
        await dag.save();
      } catch (e) {
        err = e;
      }

      assert(!!err, "save should throw when destination is a directory");
      assert(
        err.message.includes(`task save failed: ${id}`),
        "error contains task id",
      );
      assert(
        err.message.includes(filePath),
        "error contains destination file path",
      );
      assertEqual(err.taskId, id, "error.taskId");
      assertEqual(err.filePath, filePath, "error.filePath");
      const dirEntries = await readdir(dir);
      assert(
        !dirEntries.some((entry) => entry.endsWith(".tmp")),
        "save failure cleanup removed temp files",
      );
      await rm(dir, { recursive: true, force: true });
    },
  });

  // ── TaskDag.load ──
  await runGroup("TaskDag.load", {
    "throws task not found when task.json is missing": async () => {
      const id = `forge-missing-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      let threw = false;
      try {
        await TaskDag.load(id);
      } catch (e) {
        threw = true;
        assertEqual(e.message, `task not found: ${id}`, "missing task message");
      }
      assert(threw, "throws when task does not exist");
    },

    "wraps malformed task.json with task load failed message": async () => {
      const id = `forge-invalid-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const dir = path.join(FORGE_DIR, id);
      const file = path.join(dir, "task.json");
      await mkdir(dir, { recursive: true });
      await writeFile(file, "{invalid json", "utf-8");

      let threw = false;
      try {
        await TaskDag.load(id);
      } catch (e) {
        threw = true;
        assert(
          e.message.includes(`task load failed: ${id}`),
          "includes wrapped load failure",
        );
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
      assert(threw, "throws on malformed task.json");
    },
  });

  // ── buildCommand ──
  await runGroup("buildCommand", {
    "claude: basic args with -p": () => {
      const result = buildCommand({ provider: "claude" });
      assertEqual(result.cmd, "claude", "cmd is claude");
      assert(result.args.includes("-p"), "has -p flag");
      assert(
        !result.args.includes("--dangerously-skip-permissions"),
        "no skip permissions by default",
      );
      assert(result.args.includes("--output-format"), "has output format");
    },

    "claude: skipPermissions adds flag": () => {
      const result = buildCommand({
        provider: "claude",
        skipPermissions: true,
      });
      assert(
        result.args.includes("--dangerously-skip-permissions"),
        "has skip permissions",
      );
    },

    "claude: includes model when specified": () => {
      const result = buildCommand({ provider: "claude", model: "opus" });
      const modelIdx = result.args.indexOf("--model");
      assert(modelIdx !== -1, "has --model flag");
      assertEqual(result.args[modelIdx + 1], "opus", "model value is opus");
    },

    "claude: stream-json adds --verbose": () => {
      const result = buildCommand({
        provider: "claude",
        outputFormat: "stream-json",
      });
      assert(
        result.args.includes("--verbose"),
        "has --verbose for stream-json",
      );
      const fmtIdx = result.args.indexOf("--output-format");
      assertEqual(
        result.args[fmtIdx + 1],
        "stream-json",
        "format is stream-json",
      );
    },

    "claude: allowTools passed through": () => {
      const result = buildCommand({
        provider: "claude",
        allowTools: "Read,Write",
      });
      const idx = result.args.indexOf("--allowedTools");
      assert(idx !== -1, "has --allowedTools");
      assertEqual(result.args[idx + 1], "Read,Write", "tools value");
    },

    "claude: sessionPersistence=true omits --no-session-persistence": () => {
      const result = buildCommand({
        provider: "claude",
        sessionPersistence: true,
      });
      assert(
        !result.args.includes("--no-session-persistence"),
        "no session persistence flag omitted",
      );
    },

    "codex: basic args": () => {
      const result = buildCommand({ provider: "codex" });
      assertEqual(result.cmd, "codex", "cmd is codex");
      assert(result.args.includes("exec"), "has exec subcommand");
      assert(result.args.includes("--ephemeral"), "has ephemeral");
      assert(result.args.includes("-"), "has stdin marker");
    },

    "codex: maps haiku to low reasoning effort": () => {
      const result = buildCommand({ provider: "codex", model: "haiku" });
      const idx = result.args.indexOf("-c");
      assert(idx !== -1, "has -c flag");
      assertEqual(
        result.args[idx + 1],
        "model_reasoning_effort=low",
        "haiku maps to low",
      );
    },

    "codex: maps sonnet to medium reasoning effort": () => {
      const result = buildCommand({ provider: "codex", model: "sonnet" });
      const configArgs = result.args.filter(
        (_a, i) => i > 0 && result.args[i - 1] === "-c",
      );
      assert(
        configArgs.some((a) => a === "model_reasoning_effort=medium"),
        "sonnet maps to medium",
      );
    },

    "codex: maps opus to high reasoning effort": () => {
      const result = buildCommand({ provider: "codex", model: "opus" });
      const configArgs = result.args.filter(
        (_a, i) => i > 0 && result.args[i - 1] === "-c",
      );
      assert(
        configArgs.some((a) => a === "model_reasoning_effort=high"),
        "opus maps to high",
      );
    },

    "codex: passes through reasoning effort directly": () => {
      const result = buildCommand({ provider: "codex", model: "xhigh" });
      const configArgs = result.args.filter(
        (_a, i) => i > 0 && result.args[i - 1] === "-c",
      );
      assert(
        configArgs.some((a) => a === "model_reasoning_effort=xhigh"),
        "xhigh passed through",
      );
    },

    "codex: non-reasoning model uses --model": () => {
      const result = buildCommand({ provider: "codex", model: "gpt-4o" });
      const modelIdx = result.args.indexOf("--model");
      assert(modelIdx !== -1, "has --model flag");
      assertEqual(result.args[modelIdx + 1], "gpt-4o", "model value preserved");
    },

    "codex: configOverrides added as -c flags": () => {
      const result = buildCommand({
        provider: "codex",
        configOverrides: ["key=val1", "key2=val2"],
      });
      const configArgs = result.args.filter(
        (_a, i) => i > 0 && result.args[i - 1] === "-c",
      );
      assert(configArgs.includes("key=val1"), "first override");
      assert(configArgs.includes("key2=val2"), "second override");
    },

    "codex: json output adds --json": () => {
      const result = buildCommand({ provider: "codex", outputFormat: "json" });
      assert(result.args.includes("--json"), "has --json for json format");
    },

    "gemini: basic args": () => {
      const result = buildCommand({ provider: "gemini" });
      assertEqual(result.cmd, "gemini", "cmd is gemini");
      assert(result.args.includes("--output-format"), "has output format");
    },

    "gemini: maps opus to pro": () => {
      const result = buildCommand({ provider: "gemini", model: "opus" });
      const modelIdx = result.args.indexOf("--model");
      assert(modelIdx !== -1, "has --model flag");
      assertEqual(result.args[modelIdx + 1], "pro", "opus maps to pro");
    },

    "gemini: maps haiku to flash": () => {
      const result = buildCommand({ provider: "gemini", model: "haiku" });
      const modelIdx = result.args.indexOf("--model");
      assertEqual(result.args[modelIdx + 1], "flash", "haiku maps to flash");
    },

    "gemini: maps sonnet to flash": () => {
      const result = buildCommand({ provider: "gemini", model: "sonnet" });
      const modelIdx = result.args.indexOf("--model");
      assertEqual(result.args[modelIdx + 1], "flash", "sonnet maps to flash");
    },

    "gemini: native model names pass through": () => {
      const result = buildCommand({
        provider: "gemini",
        model: "gemini-2.5-pro",
      });
      const modelIdx = result.args.indexOf("--model");
      assertEqual(
        result.args[modelIdx + 1],
        "gemini-2.5-pro",
        "native model preserved",
      );
    },

    "gemini: skipPermissions adds -y": () => {
      const result = buildCommand({
        provider: "gemini",
        skipPermissions: true,
      });
      assert(result.args.includes("-y"), "has -y flag");
    },

    "unknown provider throws": () => {
      let threw = false;
      try {
        buildCommand({ provider: "unknown" });
      } catch (e) {
        threw = true;
        assert(
          e.message.includes("unknown provider"),
          "error mentions unknown provider",
        );
      }
      assert(threw, "throws on unknown provider");
    },
  });

  // ── spawnLlm ──
  await runGroup("spawnLlm", {
    "stream-json 응답을 파싱해 final result와 tokenUsage를 누적한다": async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "ucm-spawn-stream-"));
      const codexPath = path.join(tempDir, "codex");
      const originalPath = process.env.PATH || "";
      const chunks = [];
      try {
        await writeFile(
          codexPath,
          `#!/bin/sh
cat >/dev/null
printf '%s\\n' '{"type":"assistant","message":{"content":[{"type":"text","text":"part1 "},{"type":"tool_use"}]}}'
printf '%s\\n' 'this-is-not-json'
printf '%s\\n' '{"type":"assistant","message":{"content":[{"type":"text","text":"part2"}]}}'
printf '%s\\n' '{"type":"result","result":"","usage":{"input_tokens":2,"output_tokens":3}}'
printf '%s\\n' '{"type":"result","result":"FINAL","usage":{"input_tokens":5,"output_tokens":7}}'
exit 0
`,
          "utf-8",
        );
        await chmod(codexPath, 0o755);
        process.env.PATH = `${tempDir}${path.delimiter}${originalPath}`;

        const result = await spawnLlm("test prompt", {
          provider: "codex",
          outputFormat: "stream-json",
          onData: (chunk) => chunks.push(chunk),
        });

        assertEqual(result.status, "done", "status is done");
        assertEqual(result.stdout, "FINAL", "final result used as stdout");
        assertDeepEqual(
          result.tokenUsage,
          { input: 7, output: 10 },
          "token usage accumulated across result events",
        );
        assert(chunks.length > 0, "onData callback received output");
      } finally {
        process.env.PATH = originalPath;
        await rm(tempDir, { recursive: true, force: true });
      }
    },

    "실행 파일이 없으면 failed 상태와 -1 exitCode를 반환한다": async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "ucm-spawn-miss-"));
      const originalPath = process.env.PATH || "";
      try {
        process.env.PATH = tempDir;
        const result = await spawnLlm("test prompt", {
          provider: "codex",
          outputFormat: "text",
        });
        assertEqual(result.status, "failed", "missing binary returns failed");
        assertEqual(result.exitCode, -1, "spawn error sets exitCode to -1");
        assert(result.stderr.includes("codex"), "stderr mentions codex");
      } finally {
        process.env.PATH = originalPath;
        await rm(tempDir, { recursive: true, force: true });
      }
    },

    "stderr가 rate-limit 패턴이면 rate_limited 상태를 반환한다": async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "ucm-spawn-rate-"));
      const codexPath = path.join(tempDir, "codex");
      const originalPath = process.env.PATH || "";
      try {
        await writeFile(
          codexPath,
          `#!/bin/sh
cat >/dev/null
echo "429 quota exceeded" 1>&2
exit 1
`,
          "utf-8",
        );
        await chmod(codexPath, 0o755);
        process.env.PATH = `${tempDir}${path.delimiter}${originalPath}`;

        const result = await spawnLlm("test prompt", {
          provider: "codex",
          outputFormat: "text",
        });
        assertEqual(result.status, "rate_limited", "rate-limit status");
        assertEqual(result.exitCode, 1, "exitCode preserved");
        assert(
          result.stderr.includes("quota exceeded"),
          "stderr context preserved",
        );
      } finally {
        process.env.PATH = originalPath;
        await rm(tempDir, { recursive: true, force: true });
      }
    },

    "timeoutMs 초과 시 timeout 상태와 single timeoutKind를 반환한다": async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "ucm-spawn-timeout-"));
      const codexPath = path.join(tempDir, "codex");
      const originalPath = process.env.PATH || "";
      try {
        await writeFile(
          codexPath,
          `#!/bin/sh
cat >/dev/null
echo "partial output"
sleep 2
echo "late output"
`,
          "utf-8",
        );
        await chmod(codexPath, 0o755);
        process.env.PATH = `${tempDir}${path.delimiter}${originalPath}`;

        const result = await spawnLlm("test prompt", {
          provider: "codex",
          outputFormat: "text",
          timeoutMs: 100,
        });

        assertEqual(result.status, "timeout", "timeout status returned");
        assertEqual(result.timeoutKind, "single", "single timeout kind");
        assert(
          !result.stdout.includes("late output"),
          "late stdout is not emitted after timeout",
        );
      } finally {
        process.env.PATH = originalPath;
        await rm(tempDir, { recursive: true, force: true });
      }
    },

    "idleTimeoutMs 초과 시 timeout 상태와 idle timeoutKind를 반환한다": async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "ucm-spawn-idle-"));
      const codexPath = path.join(tempDir, "codex");
      const originalPath = process.env.PATH || "";
      try {
        await writeFile(
          codexPath,
          `#!/bin/sh
cat >/dev/null
echo "first output"
sleep 2
echo "late output"
`,
          "utf-8",
        );
        await chmod(codexPath, 0o755);
        process.env.PATH = `${tempDir}${path.delimiter}${originalPath}`;

        const result = await spawnLlm("test prompt", {
          provider: "codex",
          outputFormat: "text",
          idleTimeoutMs: 120,
        });

        assertEqual(result.status, "timeout", "idle timeout status returned");
        assertEqual(result.timeoutKind, "idle", "idle timeout kind");
        assert(
          !result.stdout.includes("late output"),
          "late stdout is not emitted after idle timeout",
        );
      } finally {
        process.env.PATH = originalPath;
        await rm(tempDir, { recursive: true, force: true });
      }
    },

    "hardTimeoutMs 초과 시 timeout 상태와 hard timeoutKind를 반환한다": async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "ucm-spawn-hard-"));
      const codexPath = path.join(tempDir, "codex");
      const originalPath = process.env.PATH || "";
      try {
        await writeFile(
          codexPath,
          `#!/bin/sh
cat >/dev/null
sleep 2
echo "late output"
`,
          "utf-8",
        );
        await chmod(codexPath, 0o755);
        process.env.PATH = `${tempDir}${path.delimiter}${originalPath}`;

        const result = await spawnLlm("test prompt", {
          provider: "codex",
          outputFormat: "text",
          hardTimeoutMs: 120,
        });

        assertEqual(result.status, "timeout", "hard timeout status returned");
        assertEqual(result.timeoutKind, "hard", "hard timeout kind");
        assert(
          !result.stdout.includes("late output"),
          "late stdout is not emitted after hard timeout",
        );
      } finally {
        process.env.PATH = originalPath;
        await rm(tempDir, { recursive: true, force: true });
      }
    },
  });

  // ── llmText ──
  await runGroup("llmText", {
    "rate-limit 이후 재시도 중 성공하면 텍스트를 반환한다": async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "ucm-llm-retry-"));
      const codexPath = path.join(tempDir, "codex");
      const counterPath = path.join(tempDir, "attempt-count.txt");
      const originalPath = process.env.PATH || "";
      const originalSetTimeout = global.setTimeout;
      const delays = [];
      try {
        await writeFile(
          codexPath,
          `#!/bin/sh
count=0
if [ -f "${counterPath}" ]; then
  count=$(cat "${counterPath}")
fi
count=$((count + 1))
echo "$count" > "${counterPath}"
if [ "$count" -lt 3 ]; then
  echo "429 quota exceeded" 1>&2
  exit 1
fi
echo "  success text  "
exit 0
`,
          "utf-8",
        );
        await chmod(codexPath, 0o755);
        process.env.PATH = `${tempDir}${path.delimiter}${originalPath}`;
        global.setTimeout = (fn, delay, ...args) => {
          delays.push(delay);
          fn(...args);
          return { unref() {}, ref() {} };
        };

        const result = await llmText("test prompt", { provider: "codex" });
        const attempts = parseInt(
          (await readFile(counterPath, "utf-8")).trim(),
          10,
        );
        assertEqual(result.text, "success text", "trimmed success text");
        assertDeepEqual(
          result.tokenUsage,
          { input: 0, output: 0 },
          "text mode keeps zero token usage",
        );
        assertEqual(attempts, 3, "succeeds on third attempt");
        assertDeepEqual(delays, [5000, 10000], "backoff delays before success");
      } finally {
        process.env.PATH = originalPath;
        global.setTimeout = originalSetTimeout;
        await rm(tempDir, { recursive: true, force: true });
      }
    },

    "retries on rate limit and throws RATE_LIMITED after max retries": async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "ucm-llm-rate-"));
      const codexPath = path.join(tempDir, "codex");
      const counterPath = path.join(tempDir, "attempt-count.txt");
      const originalPath = process.env.PATH || "";
      const originalSetTimeout = global.setTimeout;
      const delays = [];
      try {
        await writeFile(
          codexPath,
          `#!/bin/sh
count=0
if [ -f "${counterPath}" ]; then
  count=$(cat "${counterPath}")
fi
count=$((count + 1))
echo "$count" > "${counterPath}"
echo "429 quota exceeded" 1>&2
exit 1
`,
          "utf-8",
        );
        await chmod(codexPath, 0o755);
        process.env.PATH = `${tempDir}${path.delimiter}${originalPath}`;
        global.setTimeout = (fn, delay, ...args) => {
          delays.push(delay);
          fn(...args);
          return { unref() {}, ref() {} };
        };

        let threw = false;
        try {
          await llmText("test prompt", { provider: "codex" });
        } catch (e) {
          threw = true;
          assertEqual(e.message, "RATE_LIMITED", "rate-limit terminal error");
        } finally {
          process.env.PATH = originalPath;
          global.setTimeout = originalSetTimeout;
        }

        const attempts = parseInt(
          (await readFile(counterPath, "utf-8")).trim(),
          10,
        );
        assertEqual(attempts, 4, "attempted initial run plus 3 retries");
        assertDeepEqual(
          delays,
          [5000, 10000, 20000],
          "exponential backoff delays",
        );
        assert(threw, "throws after retry budget exhausted");
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    },

    "throws failed status with stderr context for non-rate-limit errors": async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "ucm-llm-fail-"));
      const codexPath = path.join(tempDir, "codex");
      const originalPath = process.env.PATH || "";
      try {
        await writeFile(
          codexPath,
          `#!/bin/sh
echo "fatal: simulated llm failure" 1>&2
exit 1
`,
          "utf-8",
        );
        await chmod(codexPath, 0o755);
        process.env.PATH = `${tempDir}${path.delimiter}${originalPath}`;

        let threw = false;
        try {
          await llmText("test prompt", { provider: "codex" });
        } catch (e) {
          threw = true;
          assert(e.message.includes("LLM failed"), "failed status included");
          assert(
            e.message.includes("simulated llm failure"),
            "stderr context included",
          );
        } finally {
          process.env.PATH = originalPath;
        }

        assert(threw, "throws on non-rate-limit failure");
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    },
  });

  // ── llmJson ──
  await runGroup("llmJson", {
    "응답이 JSON이 아니면 extractJson 에러를 그대로 던진다": async () => {
      const tempDir = await mkdtemp(path.join(os.tmpdir(), "ucm-llm-json-"));
      const codexPath = path.join(tempDir, "codex");
      const originalPath = process.env.PATH || "";
      try {
        await writeFile(
          codexPath,
          `#!/bin/sh
echo "not a json response"
exit 0
`,
          "utf-8",
        );
        await chmod(codexPath, 0o755);
        process.env.PATH = `${tempDir}${path.delimiter}${originalPath}`;

        let threw = false;
        try {
          await llmJson("test prompt", { provider: "codex" });
        } catch (e) {
          threw = true;
          assert(
            e.message.includes("Failed to extract JSON"),
            "extractJson failure message is preserved",
          );
        }
        assert(threw, "llmJson throws on non-JSON text");
      } finally {
        process.env.PATH = originalPath;
        await rm(tempDir, { recursive: true, force: true });
      }
    },
  });

  // ── sanitizeEnv ──
  await runGroup("sanitizeEnv", {
    "passes through allowed exact keys": () => {
      const original = { ...process.env };
      process.env.PATH = "/usr/bin";
      process.env.HOME = "/home/test";
      const env = sanitizeEnv();
      assert(env.PATH !== undefined, "PATH included");
      assert(env.HOME !== undefined, "HOME included");
      // restore
      Object.assign(process.env, original);
    },

    "passes through allowed prefix keys": () => {
      const key = "NODE_TEST_SANITIZE_CHECK";
      process.env[key] = "yes";
      const env = sanitizeEnv();
      assertEqual(env[key], "yes", "NODE_ prefix included");
      delete process.env[key];
    },

    "filters out unknown keys": () => {
      const key = "ZZUNKNOWN_TEST_KEY_12345";
      process.env[key] = "secret";
      const env = sanitizeEnv();
      assertEqual(env[key], undefined, "unknown key filtered");
      delete process.env[key];
    },

    "includes API keys that are allowlisted": () => {
      const origAnthropic = process.env.ANTHROPIC_API_KEY;
      const origOpenai = process.env.OPENAI_API_KEY;
      process.env.ANTHROPIC_API_KEY = "test-key";
      process.env.OPENAI_API_KEY = "test-key";
      const env = sanitizeEnv();
      assertEqual(
        env.ANTHROPIC_API_KEY,
        "test-key",
        "ANTHROPIC_API_KEY included",
      );
      assertEqual(env.OPENAI_API_KEY, "test-key", "OPENAI_API_KEY included");
      if (origAnthropic !== undefined)
        process.env.ANTHROPIC_API_KEY = origAnthropic;
      else delete process.env.ANTHROPIC_API_KEY;
      if (origOpenai !== undefined) process.env.OPENAI_API_KEY = origOpenai;
      else delete process.env.OPENAI_API_KEY;
    },

    "passes through GIT_ prefix keys": () => {
      process.env.GIT_AUTHOR_NAME = "test";
      const env = sanitizeEnv();
      assertEqual(env.GIT_AUTHOR_NAME, "test", "GIT_ prefix included");
      delete process.env.GIT_AUTHOR_NAME;
    },
  });

  // ── killPidTree ──
  await runGroup("killPidTree", {
    "returns early for invalid pid values without signaling": () => {
      const originalKill = process.kill;
      const calls = [];
      process.kill = (...args) => {
        calls.push(args);
      };

      try {
        killPidTree(null);
        killPidTree(0);
        killPidTree(-1);
        assertEqual(calls.length, 0, "no kill calls for invalid pids");
      } finally {
        process.kill = originalKill;
      }
    },

    "sends SIGTERM to pgid and pid, and schedules fallback timer": () => {
      const originalKill = process.kill;
      const originalSetTimeout = global.setTimeout;
      const calls = [];
      let delayMs = null;
      let unrefCalled = false;

      process.kill = (...args) => {
        calls.push(args);
      };
      global.setTimeout = (_fn, delay) => {
        delayMs = delay;
        return {
          unref: () => {
            unrefCalled = true;
          },
        };
      };

      try {
        killPidTree(1234);
        assertDeepEqual(
          calls,
          [
            [-1234, "SIGTERM"],
            [1234, "SIGTERM"],
          ],
          "SIGTERM issued to process group and process",
        );
        assertEqual(delayMs, 1200, "fallback delay is 1200ms");
        assert(unrefCalled, "fallback timer is unref-ed");
      } finally {
        process.kill = originalKill;
        global.setTimeout = originalSetTimeout;
      }
    },

    "ignores ESRCH during SIGTERM without noisy logs": () => {
      const originalKill = process.kill;
      const originalSetTimeout = global.setTimeout;
      const originalConsoleError = console.error;
      const logs = [];
      let scheduled = false;

      process.kill = () => {
        const err = new Error("no such process");
        err.code = "ESRCH";
        throw err;
      };
      global.setTimeout = () => {
        scheduled = true;
        return { unref: () => {} };
      };
      console.error = (...args) => {
        logs.push(args.join(" "));
      };

      try {
        killPidTree(4321);
        assertEqual(logs.length, 0, "ESRCH errors are suppressed");
        assert(scheduled, "fallback timer still scheduled");
      } finally {
        process.kill = originalKill;
        global.setTimeout = originalSetTimeout;
        console.error = originalConsoleError;
      }
    },

    "logs non-ESRCH errors and suppresses ESRCH on fallback SIGKILL": () => {
      const originalKill = process.kill;
      const originalSetTimeout = global.setTimeout;
      const originalConsoleError = console.error;
      const logs = [];
      let fallbackFn = null;

      process.kill = (pid, signal) => {
        if (signal === "SIGTERM") {
          const err = new Error("operation not permitted");
          err.code = "EPERM";
          throw err;
        }
        if (signal === 0) return;
        if (signal === "SIGKILL" && pid < 0) {
          const err = new Error("operation not permitted");
          err.code = "EPERM";
          throw err;
        }
        if (signal === "SIGKILL" && pid > 0) {
          const err = new Error("no such process");
          err.code = "ESRCH";
          throw err;
        }
      };
      global.setTimeout = (fn) => {
        fallbackFn = fn;
        return { unref: () => {} };
      };
      console.error = (...args) => {
        logs.push(args.join(" "));
      };

      try {
        killPidTree(777);
        assert(
          logs.some((line) => line.includes("SIGTERM pgid 777: EPERM")),
          "logs SIGTERM pgid non-ESRCH error",
        );
        assert(
          logs.some((line) => line.includes("SIGTERM pid 777: EPERM")),
          "logs SIGTERM pid non-ESRCH error",
        );

        assertEqual(
          typeof fallbackFn,
          "function",
          "captures fallback callback",
        );
        fallbackFn();

        assert(
          logs.some((line) => line.includes("SIGKILL pgid 777: EPERM")),
          "logs SIGKILL pgid non-ESRCH error",
        );
        assert(
          !logs.some((line) => line.includes("SIGKILL pid 777")),
          "suppresses SIGKILL pid ESRCH log",
        );
      } finally {
        process.kill = originalKill;
        global.setTimeout = originalSetTimeout;
        console.error = originalConsoleError;
      }
    },
  });

  // ── mapPipelineToForge ──
  await runGroup("mapPipelineToForge", {
    "maps quick to small": () => {
      assertEqual(mapPipelineToForge("quick"), "small", "quick → small");
    },

    "maps thorough to large": () => {
      assertEqual(mapPipelineToForge("thorough"), "large", "thorough → large");
    },

    "maps research to medium": () => {
      assertEqual(
        mapPipelineToForge("research"),
        "medium",
        "research → medium",
      );
    },

    "identity mappings for forge names": () => {
      assertEqual(mapPipelineToForge("small"), "small", "small identity");
      assertEqual(mapPipelineToForge("medium"), "medium", "medium identity");
      assertEqual(mapPipelineToForge("large"), "large", "large identity");
      assertEqual(mapPipelineToForge("trivial"), "trivial", "trivial identity");
    },

    "returns null for auto": () => {
      assertEqual(mapPipelineToForge("auto"), null, "auto → null");
    },

    "returns null for null/undefined": () => {
      assertEqual(mapPipelineToForge(null), null, "null → null");
      assertEqual(mapPipelineToForge(undefined), null, "undefined → null");
    },

    "returns null for unknown pipeline": () => {
      assertEqual(mapPipelineToForge("nonexistent"), null, "unknown → null");
    },
  });

  // ── mergeStateStats ──
  await runGroup("mergeStateStats", {
    "fills missing stats with defaults": () => {
      const result = mergeStateStats({});
      assertEqual(
        typeof result.tasksCompleted,
        "number",
        "tasksCompleted is number",
      );
      assertEqual(typeof result.tasksFailed, "number", "tasksFailed is number");
      assertEqual(result.tasksCompleted, 0, "default tasksCompleted is 0");
      assertEqual(result.tasksFailed, 0, "default tasksFailed is 0");
    },

    "preserves existing valid stats": () => {
      const result = mergeStateStats({
        stats: { tasksCompleted: 5, tasksFailed: 2 },
      });
      assertEqual(result.tasksCompleted, 5, "preserves tasksCompleted");
      assertEqual(result.tasksFailed, 2, "preserves tasksFailed");
    },

    "fixes NaN values with defaults": () => {
      const result = mergeStateStats({
        stats: { tasksCompleted: NaN, tasksFailed: 3 },
      });
      assertEqual(result.tasksCompleted, 0, "NaN replaced with default");
      assertEqual(result.tasksFailed, 3, "valid value preserved");
    },

    "handles null state": () => {
      const result = mergeStateStats(null);
      assertEqual(typeof result.tasksCompleted, "number", "handles null state");
    },

    "handles state with null stats": () => {
      const result = mergeStateStats({ stats: null });
      assertEqual(typeof result.tasksCompleted, "number", "handles null stats");
    },
  });

  // ── ForgePipeline constructor ──
  await runGroup("ForgePipeline constructor", {
    "throws on empty input (no input, no resumeFrom, no taskId)": () => {
      let threw = false;
      try {
        new ForgePipeline({});
      } catch (e) {
        threw = true;
        assert(
          e.message.includes("input required"),
          "error mentions input required",
        );
      }
      assert(threw, "should throw on empty options");
    },

    "throws on whitespace-only input": () => {
      let threw = false;
      try {
        new ForgePipeline({ input: "   " });
      } catch (_e) {
        threw = true;
      }
      assert(threw, "should throw on whitespace input");
    },

    "throws on empty string input": () => {
      let threw = false;
      try {
        new ForgePipeline({ input: "" });
      } catch (_e) {
        threw = true;
      }
      assert(threw, "should throw on empty string");
    },

    "accepts valid string input": () => {
      const p = new ForgePipeline({ input: "build a feature" });
      assertEqual(p.input, "build a feature", "input preserved");
      assert(p.taskId.startsWith("forge-"), "auto-generated taskId");
    },

    "generates unique taskId when not provided": () => {
      const p1 = new ForgePipeline({ input: "a" });
      const p2 = new ForgePipeline({ input: "b" });
      assert(p1.taskId !== p2.taskId, "unique ids");
    },

    "preserves provided taskId": () => {
      const p = new ForgePipeline({ input: "x", taskId: "my-task-123" });
      assertEqual(p.taskId, "my-task-123", "taskId preserved");
    },

    "allows resumeFrom without input": () => {
      const p = new ForgePipeline({ taskId: "t", resumeFrom: "implement" });
      assertEqual(p.resumeFrom, "implement", "resumeFrom set");
      assertEqual(p.input, undefined, "input is undefined");
    },

    "allows taskId without input": () => {
      const p = new ForgePipeline({ taskId: "my-task" });
      assertEqual(p.taskId, "my-task", "taskId preserved without input");
    },

    "sets default values": () => {
      const p = new ForgePipeline({ input: "test" });
      assertEqual(p.autoApprove, false, "default autoApprove false");
      assertEqual(p.onQuestion, null, "default onQuestion null");
      assertEqual(p.resumeFrom, null, "default resumeFrom null");
      assertEqual(p.tokenBudget, 0, "default tokenBudget 0");
      assertDeepEqual(p.stageApproval, {}, "default stageApproval empty");
      assertEqual(p.aborted, false, "default aborted false");
      assertEqual(p.dag, null, "default dag null");
      assertDeepEqual(p.stages, [], "default stages empty");
      assertEqual(p.worktreeCwd, null, "default worktreeCwd null");
    },

    "accepts non-string input (array)": () => {
      const p = new ForgePipeline({ input: ["task1", "task2"] });
      assertDeepEqual(p.input, ["task1", "task2"], "array input accepted");
    },
  });

  // ── assertResumableDagStatus ──
  await runGroup("assertResumableDagStatus", {
    "allows failed status": () => {
      assertResumableDagStatus({ status: "failed" }); // should not throw
      assert(true, "failed is resumable");
    },

    "allows rejected status": () => {
      assertResumableDagStatus({ status: "rejected" });
      assert(true, "rejected is resumable");
    },

    "allows aborted status": () => {
      assertResumableDagStatus({ status: "aborted" });
      assert(true, "aborted is resumable");
    },

    "allows in_progress status": () => {
      assertResumableDagStatus({ status: "in_progress" });
      assert(true, "in_progress is resumable");
    },

    "throws on done status": () => {
      let threw = false;
      try {
        assertResumableDagStatus({ status: "done" });
      } catch (e) {
        threw = true;
        assert(
          e.message.includes("cannot resume"),
          "error mentions cannot resume",
        );
      }
      assert(threw, "done is not resumable");
    },

    "throws on pending status": () => {
      let threw = false;
      try {
        assertResumableDagStatus({ status: "pending" });
      } catch (_e) {
        threw = true;
      }
      assert(threw, "pending is not resumable");
    },

    "throws on review status": () => {
      let threw = false;
      try {
        assertResumableDagStatus({ status: "review" });
      } catch (_e) {
        threw = true;
      }
      assert(threw, "review is not resumable");
    },

    "throws on null dag": () => {
      let threw = false;
      try {
        assertResumableDagStatus(null);
      } catch (e) {
        threw = true;
        assert(
          e.message.includes("invalid task state"),
          "error mentions invalid state",
        );
      }
      assert(threw, "null dag throws");
    },

    "throws on dag without status": () => {
      let threw = false;
      try {
        assertResumableDagStatus({});
      } catch (_e) {
        threw = true;
      }
      assert(threw, "missing status throws");
    },

    "throws on dag with numeric status": () => {
      let threw = false;
      try {
        assertResumableDagStatus({ status: 42 });
      } catch (_e) {
        threw = true;
      }
      assert(threw, "numeric status throws");
    },
  });

  // ── STAGE_MODELS ──
  await runGroup("STAGE_MODELS", {
    "returns default string models": () => {
      // Save and clear any overrides
      const saved = {};
      for (const stage of [
        "intake",
        "clarify",
        "design",
        "implement",
        "verify",
        "deliver",
      ]) {
        const key = `UCM_MODEL_${stage.toUpperCase()}`;
        saved[key] = process.env[key];
        delete process.env[key];
      }
      // Clear proxy cache
      const { _modelCache } = require("../lib/core/constants");
      if (_modelCache) _modelCache.clear();

      assertEqual(STAGE_MODELS.intake, "sonnet", "intake default");
      assertEqual(STAGE_MODELS.clarify, "sonnet", "clarify default");
      assertEqual(STAGE_MODELS.design, "opus", "design default");
      assertEqual(STAGE_MODELS.implement, "opus", "implement default");
      assertDeepEqual(STAGE_MODELS.verify, { test: "sonnet", review: "sonnet" }, "verify default");
      assertEqual(STAGE_MODELS.deliver, "sonnet", "deliver default");

      // Restore
      for (const [k, v] of Object.entries(saved)) {
        if (v !== undefined) process.env[k] = v;
        else delete process.env[k];
      }
    },

    "overrides string model via env var": () => {
      const orig = process.env.UCM_MODEL_IMPLEMENT;
      process.env.UCM_MODEL_IMPLEMENT = "haiku";
      assertEqual(STAGE_MODELS.implement, "haiku", "env override works");
      if (orig !== undefined) process.env.UCM_MODEL_IMPLEMENT = orig;
      else delete process.env.UCM_MODEL_IMPLEMENT;
    },

    "returns object models for specify": () => {
      const origW = process.env.UCM_MODEL_SPECIFY_WORKER;
      const origC = process.env.UCM_MODEL_SPECIFY_CONVERGE;
      delete process.env.UCM_MODEL_SPECIFY_WORKER;
      delete process.env.UCM_MODEL_SPECIFY_CONVERGE;
      const { _modelCache } = require("../lib/core/constants");
      if (_modelCache) _modelCache.clear();

      const specifyModels = STAGE_MODELS.specify;
      assertEqual(typeof specifyModels, "object", "specify returns object");
      assertEqual(specifyModels.worker, "sonnet", "specify.worker default");
      assertEqual(specifyModels.converge, "opus", "specify.converge default");

      if (origW !== undefined) process.env.UCM_MODEL_SPECIFY_WORKER = origW;
      else delete process.env.UCM_MODEL_SPECIFY_WORKER;
      if (origC !== undefined) process.env.UCM_MODEL_SPECIFY_CONVERGE = origC;
      else delete process.env.UCM_MODEL_SPECIFY_CONVERGE;
    },

    "overrides object sub-keys via env var": () => {
      const origW = process.env.UCM_MODEL_SPECIFY_WORKER;
      process.env.UCM_MODEL_SPECIFY_WORKER = "haiku";
      const { _modelCache } = require("../lib/core/constants");
      if (_modelCache) _modelCache.clear();

      const specifyModels = STAGE_MODELS.specify;
      assertEqual(specifyModels.worker, "haiku", "sub-key override works");
      assertEqual(
        specifyModels.converge,
        "opus",
        "non-overridden sub-key preserved",
      );

      if (origW !== undefined) process.env.UCM_MODEL_SPECIFY_WORKER = origW;
      else delete process.env.UCM_MODEL_SPECIFY_WORKER;
      if (_modelCache) _modelCache.clear();
    },

    "returns undefined for unknown stages": () => {
      assertEqual(
        STAGE_MODELS.nonexistent,
        undefined,
        "unknown stage returns undefined",
      );
    },
  });

  // ── Pipeline/Artifact/Timeout Consistency ──
  await runGroup("pipeline config consistency", {
    "every pipeline stage has a timeout defined": () => {
      for (const [pipeline, stages] of Object.entries(FORGE_PIPELINES)) {
        for (const stage of stages) {
          assert(
            STAGE_TIMEOUTS[stage] !== undefined,
            `${pipeline}/${stage} has timeout`,
          );
          assert(
            typeof STAGE_TIMEOUTS[stage].idle === "number",
            `${pipeline}/${stage} timeout.idle is number`,
          );
          assert(
            typeof STAGE_TIMEOUTS[stage].hard === "number",
            `${pipeline}/${stage} timeout.hard is number`,
          );
          assert(
            STAGE_TIMEOUTS[stage].hard > STAGE_TIMEOUTS[stage].idle,
            `${pipeline}/${stage} hard > idle`,
          );
        }
      }
    },

    "every pipeline stage has artifacts defined": () => {
      for (const [pipeline, stages] of Object.entries(FORGE_PIPELINES)) {
        for (const stage of stages) {
          assert(
            STAGE_ARTIFACTS[stage] !== undefined,
            `${pipeline}/${stage} has artifacts`,
          );
          assert(
            Array.isArray(STAGE_ARTIFACTS[stage].requires),
            `${pipeline}/${stage} artifacts.requires is array`,
          );
          assert(
            Array.isArray(STAGE_ARTIFACTS[stage].produces),
            `${pipeline}/${stage} artifacts.produces is array`,
          );
        }
      }
    },

    "all pipelines end with deliver": () => {
      for (const [name, stages] of Object.entries(FORGE_PIPELINES)) {
        assertEqual(
          stages[stages.length - 1],
          "deliver",
          `${name} ends with deliver`,
        );
      }
    },

    "no duplicate stages in any pipeline": () => {
      for (const [name, stages] of Object.entries(FORGE_PIPELINES)) {
        const unique = new Set(stages);
        assertEqual(unique.size, stages.length, `${name} has no duplicates`);
      }
    },

    "all expected pipelines exist": () => {
      assert(FORGE_PIPELINES.trivial !== undefined, "trivial pipeline exists");
      assert(FORGE_PIPELINES.small !== undefined, "small pipeline exists");
      assert(FORGE_PIPELINES.medium !== undefined, "medium pipeline exists");
      assert(FORGE_PIPELINES.large !== undefined, "large pipeline exists");
    },

    "trivial is subset of small": () => {
      const _trivialSet = new Set(FORGE_PIPELINES.trivial);
      for (const stage of FORGE_PIPELINES.trivial) {
        assert(
          new Set(FORGE_PIPELINES.small).has(stage),
          `trivial stage ${stage} in small`,
        );
      }
      assert(
        FORGE_PIPELINES.small.length >= FORGE_PIPELINES.trivial.length,
        "small >= trivial length",
      );
    },

    "idle timeout is at least 2 minutes for all stages": () => {
      for (const [stage, t] of Object.entries(STAGE_TIMEOUTS)) {
        assert(t.idle >= 2 * 60_000, `${stage} idle >= 2m`);
      }
    },
  });

  // ── isFullyCovered ──
  await runGroup("isFullyCovered", {
    "returns true when all areas >= 1.0": () => {
      assert(
        isFullyCovered({
          "제품 정의": 1.0,
          "핵심 기능": 1.0,
          "기술 스택": 1.0,
        }),
        "all 1.0",
      );
    },

    "returns true when areas exceed 1.0": () => {
      assert(
        isFullyCovered({ "제품 정의": 1.5, "핵심 기능": 1.0 }),
        "above 1.0",
      );
    },

    "returns false when any area < 1.0": () => {
      assert(
        !isFullyCovered({ "제품 정의": 1.0, "핵심 기능": 0.5 }),
        "one below",
      );
    },

    "returns false when area is 0": () => {
      assert(!isFullyCovered({ "제품 정의": 0, "핵심 기능": 1.0 }), "one zero");
    },

    "returns true for empty coverage object": () => {
      assert(isFullyCovered({}), "empty object");
    },
  });

  // ── parseDecisionsFile ──
  await runGroup("parseDecisionsFile", {
    "parses single decision": () => {
      const content = `### 작업 목표\n- **Q:** 무엇을 만들까?\n  - **A:** 웹 앱\n  - **이유:** 접근성`;
      const decisions = parseDecisionsFile(content);
      assertEqual(decisions.length, 1, "one decision");
      assertEqual(decisions[0].area, "작업 목표", "area");
      assertEqual(decisions[0].question, "무엇을 만들까?", "question");
      assertEqual(decisions[0].answer, "웹 앱", "answer");
      assertEqual(decisions[0].reason, "접근성", "reason");
    },

    "parses multiple decisions across areas": () => {
      const content = [
        "### 제품 정의",
        "- **Q:** Q1",
        "  - **A:** A1",
        "### 기술 스택",
        "- **Q:** Q2",
        "  - **A:** A2",
        "  - **이유:** R2",
      ].join("\n");
      const decisions = parseDecisionsFile(content);
      assertEqual(decisions.length, 2, "two decisions");
      assertEqual(decisions[0].area, "제품 정의", "first area");
      assertEqual(decisions[1].area, "기술 스택", "second area");
      assertEqual(decisions[1].reason, "R2", "second reason");
    },

    "handles decision without reason": () => {
      const content = `### Area\n- **Q:** Question\n  - **A:** Answer`;
      const decisions = parseDecisionsFile(content);
      assertEqual(decisions.length, 1, "one decision");
      assertEqual(decisions[0].reason, "", "empty reason");
    },

    "returns empty array for non-decision content": () => {
      const decisions = parseDecisionsFile(
        "Just some text\nNo decisions here\n",
      );
      assertEqual(decisions.length, 0, "no decisions");
    },

    "returns empty array for empty string": () => {
      const decisions = parseDecisionsFile("");
      assertEqual(decisions.length, 0, "empty string");
    },

    "handles multiple decisions in same area": () => {
      const content = [
        "### 설계 결정",
        "- **Q:** Q1",
        "  - **A:** A1",
        "- **Q:** Q2",
        "  - **A:** A2",
      ].join("\n");
      const decisions = parseDecisionsFile(content);
      assertEqual(decisions.length, 2, "two decisions");
      assertEqual(decisions[0].area, "설계 결정", "same area first");
      assertEqual(decisions[1].area, "설계 결정", "same area second");
    },
  });

  // ── formatDecisions ──
  await runGroup("formatDecisions", {
    "formats decisions with coverage": () => {
      const decisions = [
        { area: "작업 목표", question: "Q?", answer: "A", reason: "R" },
      ];
      const coverage = { "작업 목표": 0.5 };
      const md = formatDecisions(decisions, coverage);
      assert(md.includes("# 설계 결정"), "has title");
      assert(md.includes("## 커버리지"), "has coverage section");
      assert(md.includes("50%"), "has percentage");
      assert(md.includes("**Q:** Q?"), "has question");
      assert(md.includes("**A:** A"), "has answer");
      assert(md.includes("**이유:** R"), "has reason");
    },

    "formats decisions without coverage": () => {
      const decisions = [{ area: "A", question: "Q", answer: "A", reason: "" }];
      const md = formatDecisions(decisions, null);
      assert(!md.includes("## 커버리지"), "no coverage section");
      assert(md.includes("**Q:** Q"), "has question");
    },

    "omits reason when empty": () => {
      const decisions = [{ area: "A", question: "Q", answer: "A", reason: "" }];
      const md = formatDecisions(decisions, null);
      assert(!md.includes("**이유:**"), "no reason line");
    },
  });

  // ── expandHome ──
  await runGroup("expandHome", {
    "expands tilde prefix": () => {
      const result = expandHome("~/projects");
      assert(!result.startsWith("~"), "tilde expanded");
      assert(result.endsWith("/projects"), "path preserved");
    },

    "expands bare tilde": () => {
      const result = expandHome("~");
      assert(!result.startsWith("~"), "bare tilde expanded");
      assert(result.length > 1, "has home dir content");
    },

    "passes through absolute path": () => {
      assertEqual(expandHome("/usr/local"), "/usr/local", "absolute unchanged");
    },

    "passes through relative path": () => {
      assertEqual(
        expandHome("relative/path"),
        "relative/path",
        "relative unchanged",
      );
    },
  });

  // ── normalizeProjects ──
  await runGroup("normalizeProjects", {
    "normalizes string project array": () => {
      const result = normalizeProjects({
        projects: ["/tmp/proj1", "/tmp/proj2"],
      });
      assertEqual(result.length, 2, "two projects");
      assertEqual(result[0].path, "/tmp/proj1", "first path");
      assertEqual(result[0].role, "primary", "first is primary");
      assertEqual(result[1].role, "secondary", "second is secondary");
    },

    "normalizes object project array": () => {
      const result = normalizeProjects({
        projects: [{ path: "/tmp/a", name: "myname", role: "primary" }],
      });
      assertEqual(result.length, 1, "one project");
      assertEqual(result[0].name, "myname", "custom name");
      assertEqual(result[0].role, "primary", "explicit role");
    },

    "sanitizes custom name to block path traversal": () => {
      const result = normalizeProjects({
        projects: [{ path: "/tmp/a", name: "../../escape-dir" }],
      });
      assertEqual(result.length, 1, "one project");
      assertEqual(result[0].name, "escape-dir", "uses safe basename only");
    },

    "falls back to path basename when custom name is dot segment": () => {
      const result = normalizeProjects({
        projects: [{ path: "/tmp/fallback-name", name: ".." }],
      });
      assertEqual(result.length, 1, "one project");
      assertEqual(
        result[0].name,
        "fallback-name",
        "dot segment falls back to path basename",
      );
    },

    "sanitizes windows-style traversal in custom name": () => {
      const result = normalizeProjects({
        projects: [{ path: "/tmp/a", name: "..\\..\\escape-win" }],
      });
      assertEqual(result.length, 1, "one project");
      assertEqual(result[0].name, "escape-win", "windows separators sanitized");
    },

    "strips control characters from custom name and falls back when empty": () => {
      const cleaned = normalizeProjects({
        projects: [{ path: "/tmp/control-clean", name: "\u0000safe\u001f" }],
      });
      assertEqual(cleaned.length, 1, "cleaned one project");
      assertEqual(cleaned[0].name, "safe", "control chars stripped");

      const fallback = normalizeProjects({
        projects: [{ path: "/tmp/control-fallback", name: "\u0000\u001f" }],
      });
      assertEqual(fallback.length, 1, "fallback one project");
      assertEqual(
        fallback[0].name,
        "control-fallback",
        "empty sanitized name falls back to basename",
      );
    },

    "deduplicates projects by resolved path": () => {
      const result = normalizeProjects({
        projects: ["/tmp/proj", "/tmp/proj"],
      });
      assertEqual(result.length, 1, "deduplicated");
    },

    "falls back to meta.project when projects array empty": () => {
      const result = normalizeProjects({
        projects: [],
        project: "/tmp/fallback",
      });
      assertEqual(result.length, 1, "one project from fallback");
      assertEqual(result[0].path, "/tmp/fallback", "fallback path");
      assertEqual(result[0].role, "primary", "fallback is primary");
    },

    "falls back to meta.project when no projects key": () => {
      const result = normalizeProjects({ project: "/tmp/single" });
      assertEqual(result.length, 1, "one project");
      assertEqual(result[0].path, "/tmp/single", "single path");
    },

    "returns empty array when no project info": () => {
      const result = normalizeProjects({});
      assertEqual(result.length, 0, "empty");
    },

    "filters null and invalid entries": () => {
      const result = normalizeProjects({
        projects: [null, "", "undefined", "/tmp/valid"],
      });
      assertEqual(result.length, 1, "only valid entry");
      assertEqual(result[0].path, "/tmp/valid", "valid path");
    },

    "forces primary when no explicit primary in array": () => {
      const result = normalizeProjects({
        projects: [
          { path: "/tmp/a", role: "secondary" },
          { path: "/tmp/b", role: "secondary" },
        ],
      });
      assertEqual(result[0].role, "primary", "first forced to primary");
    },

    "preserves origin and baseCommit": () => {
      const result = normalizeProjects({
        projects: [
          { path: "/tmp/a", origin: "/tmp/origin", baseCommit: "abc123" },
        ],
      });
      assertEqual(result[0].origin, "/tmp/origin", "origin resolved");
      assertEqual(result[0].baseCommit, "abc123", "baseCommit preserved");
    },

    "assigns basename as default name": () => {
      const result = normalizeProjects({ projects: ["/tmp/my-project"] });
      assertEqual(result[0].name, "my-project", "basename as name");
    },
  });

  // ── enqueueTaskFileOp ──
  await runGroup("enqueueTaskFileOp", {
    "taskId가 비어 있으면 즉시 에러를 던진다": () => {
      let threw = false;
      try {
        enqueueTaskFileOp("   ", () => {});
      } catch (e) {
        threw = true;
        assert(e.message.includes("taskId required"), "taskId validation error");
      }
      assert(threw, "throws on blank taskId");
    },

    "operation이 함수가 아니면 즉시 에러를 던진다": () => {
      let threw = false;
      try {
        enqueueTaskFileOp("task-lock-invalid-op", null);
      } catch (e) {
        threw = true;
        assert(
          e.message.includes("operation must be a function"),
          "operation validation error",
        );
      }
      assert(threw, "throws on non-function operation");
    },

    "serializes operations for same task id": async () => {
      const events = [];
      let releaseFirst;
      const firstGate = new Promise((resolve) => {
        releaseFirst = resolve;
      });

      const first = enqueueTaskFileOp("task-lock-1", async () => {
        events.push("first:start");
        await firstGate;
        events.push("first:end");
      });
      const second = enqueueTaskFileOp("task-lock-1", async () => {
        events.push("second:start");
      });

      await new Promise((resolve) => setTimeout(resolve, 20));
      assertDeepEqual(
        events,
        ["first:start"],
        "second operation waits for first to finish",
      );

      releaseFirst();
      await Promise.all([first, second]);
      assertDeepEqual(
        events,
        ["first:start", "first:end", "second:start"],
        "same task operations run in order",
      );
    },

    "allows parallel start for different task ids": async () => {
      const started = [];
      let releaseBoth;
      const gate = new Promise((resolve) => {
        releaseBoth = resolve;
      });

      const first = enqueueTaskFileOp("task-lock-a", async () => {
        started.push("a");
        await gate;
      });
      const second = enqueueTaskFileOp("task-lock-b", async () => {
        started.push("b");
        await gate;
      });

      await new Promise((resolve) => setTimeout(resolve, 20));
      assert(started.includes("a"), "task a started");
      assert(started.includes("b"), "task b started");

      releaseBoth();
      await Promise.all([first, second]);
    },

    "continues queue after prior failure": async () => {
      const events = [];
      await enqueueTaskFileOp("task-lock-fail", async () => {
        events.push("first");
        throw new Error("intentional");
      }).catch(() => {});

      await enqueueTaskFileOp("task-lock-fail", async () => {
        events.push("second");
      });

      assertDeepEqual(events, ["first", "second"], "queue recovered");
    },

    "does not report operation failures as lock cleanup errors": async () => {
      const logs = [];
      await enqueueTaskFileOp(
        "task-lock-no-cleanup-false-positive",
        async () => {
          throw new Error("intentional operation failure");
        },
        {
          label: "write-meta",
          log: (line) => logs.push(line),
        },
      ).catch(() => {});

      assert(
        !logs.some((line) => line.includes("lock cleanup error")),
        "operation failure should not emit lock cleanup error log",
      );
    },

    "이전 작업 실패 로그에 taskId와 label을 포함한다": async () => {
      const logs = [];
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });

      const first = enqueueTaskFileOp("task-lock-log", async () => {
        await gate;
        throw new Error("boom");
      });

      const second = enqueueTaskFileOp(
        "task-lock-log",
        async () => {},
        {
          label: "write-meta",
          log: (line) => logs.push(line),
        },
      );

      release();
      await Promise.all([first.catch(() => {}), second]);

      assert(
        logs.some((line) =>
          line.includes(
            "[task-lock-log] write-meta: prior operation failed (continuing): boom",
          ),
        ),
        "prior failure log includes task id, label, and message",
      );
    },
  });

  console.log();
  const { failed } = summary();
  stopSuiteTimer();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
