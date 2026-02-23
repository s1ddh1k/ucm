#!/usr/bin/env node
const { startSuiteTimer, stopSuiteTimer, assert, assertEqual, assertDeepEqual, runGroup, summary } = require("./harness");

startSuiteTimer(30_000);

// ── extractJson tests ──

const { extractJson } = require("../lib/core/llm");

// ── quoteUserContent / summarizeDecisions tests ──

const { quoteUserContent, summarizeDecisions, computeCoverage, isFullyCovered, buildQuestionPrompt, EXPECTED_GREENFIELD } = require("../lib/core/qna");

// ── sanitizeContent tests ──

const { sanitizeContent } = require("../lib/core/worktree");

// ── parseTaskFile / serializeTaskFile tests ──

const { parseTaskFile, serializeTaskFile } = require("../lib/ucmd-task");

// ── TaskDag tests ──

const { TaskDag, generateForgeId } = require("../lib/core/task");

async function main() {
  // ── extractJson ──
  await runGroup("extractJson", {
    "parses JSON from code fence": () => {
      const result = extractJson('Here is the result:\n```json\n{"key": "value"}\n```');
      assertDeepEqual(result, { key: "value" }, "code fence JSON");
    },

    "parses raw JSON object": () => {
      const result = extractJson('{"done": true}');
      assertDeepEqual(result, { done: true }, "raw JSON object");
    },

    "parses raw JSON array": () => {
      const result = extractJson('[1, 2, 3]');
      assertDeepEqual(result, [1, 2, 3], "raw JSON array");
    },

    "parses JSON embedded in text": () => {
      const result = extractJson('Some text before\n{"question": "test?"}\nSome text after');
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
        assert(e.message.includes("Failed to extract JSON"), "error message mentions failure");
      }
      assert(threw, "should throw on non-JSON");
    },

    "throws on empty string": () => {
      let threw = false;
      try { extractJson(""); } catch { threw = true; }
      assert(threw, "should throw on empty string");
    },

    "parses nested JSON objects": () => {
      const result = extractJson('{"options": [{"label": "A", "reason": "B"}], "done": false}');
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
      assertEqual(quoteUserContent("hello world"), "hello world", "normal text");
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
      assertEqual(quoteUserContent("color is #FF0000"), "color is #FF0000", "hash in middle");
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
        decisions.push({ area: i < 5 ? "기술 스택" : "설계 결정", question: `Q${i}`, answer: `A${i}` });
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
        decisions.push({ area: "제품 정의", question: `Q${i}`, answer: `A${i}` });
      }
      const coverage = computeCoverage(decisions, EXPECTED_GREENFIELD);
      assertEqual(coverage["제품 정의"], 1.0, "capped at 1.0");
    },

    "isFullyCovered returns true when all areas complete": () => {
      const coverage = { "제품 정의": 1.0, "핵심 기능": 1.0, "기술 스택": 1.0, "설계 결정": 1.0 };
      assert(isFullyCovered(coverage), "fully covered");
    },

    "isFullyCovered returns false with gaps": () => {
      const coverage = { "제품 정의": 1.0, "핵심 기능": 0.5, "기술 스택": 1.0, "설계 결정": 1.0 };
      assert(!isFullyCovered(coverage), "not fully covered");
    },
  });

  // ── parseTaskFile / serializeTaskFile ──
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
      assertDeepEqual(meta.tokenUsage, { input: 100, output: 50 }, "json tagged value");
    },

    "handles newline escaping": () => {
      const content = `---
title: line1\\nline2
---`;
      const { meta } = parseTaskFile(content);
      assertEqual(meta.title, "line1\nline2", "escaped newline");
    },
  });

  await runGroup("serializeTaskFile", {
    "round-trips through parse/serialize": () => {
      const meta = { id: "test-002", title: "Round Trip", state: "running", priority: 5 };
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
      assertDeepEqual(parsed.tokenUsage, { input: 100, output: 50 }, "json round-trip");
    },

    "skips null/undefined values": () => {
      const meta = { id: "test-004", title: null, state: undefined, tag: "valid" };
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
      assertEqual(sanitizeContent(undefined), undefined, "undefined passthrough");
      assertEqual(sanitizeContent(""), "", "empty string passthrough");
    },

    "passes through normal text unchanged": () => {
      const text = "This is normal code with no secrets.";
      assertEqual(sanitizeContent(text), text, "normal text unchanged");
    },

    "redacts api_key pattern": () => {
      const input = 'api_key: sk_live_abcdefghij1234567890';
      const result = sanitizeContent(input);
      assert(result.includes("[REDACTED]"), "contains REDACTED marker");
      assert(!result.includes("abcdefghij1234567890"), "secret value removed");
    },

    "redacts apikey (no separator) pattern": () => {
      const input = 'apikey=my_secret_key_value_12345678';
      const result = sanitizeContent(input);
      assert(result.includes("[REDACTED]"), "contains REDACTED marker");
      assert(!result.includes("my_secret_key_value_12345678"), "secret value removed");
    },

    "redacts secret/password/token patterns": () => {
      const input = 'secret: supersecretvalue1234\npassword=mypassword123\ntoken: tok_abc123def456';
      const result = sanitizeContent(input);
      assert(!result.includes("supersecretvalue1234"), "secret redacted");
      assert(!result.includes("mypassword123"), "password redacted");
      assert(!result.includes("tok_abc123def456"), "token redacted");
      // Should have 3 REDACTED markers
      const redactedCount = (result.match(/\[REDACTED\]/g) || []).length;
      assertEqual(redactedCount, 3, "three redactions");
    },

    "redacts AWS/Anthropic/OpenAI key env vars": () => {
      const input = 'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY\nANTHROPIC_API_KEY=sk-ant-abc123\nOPENAI_API_KEY=sk-proj-xyz789';
      const result = sanitizeContent(input);
      assert(!result.includes("wJalrXUtnFEMI"), "AWS key redacted");
      assert(!result.includes("sk-ant-abc123"), "Anthropic key redacted");
      assert(!result.includes("sk-proj-xyz789"), "OpenAI key redacted");
    },

    "redacts Bearer tokens": () => {
      const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
      const result = sanitizeContent(input);
      assert(result.includes("[REDACTED]"), "Bearer token redacted");
      assert(!result.includes("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"), "JWT payload removed");
    },

    "redacts GitHub PATs (ghp_ prefix)": () => {
      const input = 'GITHUB_TOKEN=ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789';
      const result = sanitizeContent(input);
      assert(result.includes("[REDACTED]"), "GitHub PAT redacted");
      assert(!result.includes("aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789"), "PAT value removed");
    },

    "redacts OpenAI sk- keys": () => {
      const input = 'key: sk-abcdefghijklmnopqrstuvwxyz0123456789';
      const result = sanitizeContent(input);
      assert(result.includes("[REDACTED]"), "sk- key redacted");
      assert(!result.includes("abcdefghijklmnopqrstuvwxyz0123456789"), "sk- key value removed");
    },

    "preserves prefix before REDACTED marker": () => {
      const input = 'ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789';
      const result = sanitizeContent(input);
      // prefix should be min(10, floor(len/3)) chars of original match
      assert(result.startsWith("ghp_"), "preserves beginning of token");
      assert(result.endsWith("[REDACTED]"), "ends with REDACTED");
    },

    "handles multiple secrets in same line": () => {
      const input = 'api_key: secret12345678901234 token: mytokenvalue12345678';
      const result = sanitizeContent(input);
      const redactedCount = (result.match(/\[REDACTED\]/g) || []).length;
      assert(redactedCount >= 2, "multiple redactions in same line");
    },

    "is case-insensitive for key names": () => {
      const input = 'API_KEY: secret12345678901234\nApi_Key: secret12345678901234';
      const result = sanitizeContent(input);
      const redactedCount = (result.match(/\[REDACTED\]/g) || []).length;
      assertEqual(redactedCount, 2, "case-insensitive matching");
    },
  });

  // ── buildQuestionPrompt structure ──
  await runGroup("buildQuestionPrompt structure", {
    "includes instruction precedence markers": () => {
      const coverage = { "제품 정의": 0, "핵심 기능": 0, "기술 스택": 0, "설계 결정": 0 };
      const prompt = buildQuestionPrompt(null, [], null, { isResume: false, isBrownfield: false, coverage });
      assert(prompt.includes("파싱 실패"), "mentions parse failure consequence");
      assert(prompt.includes("거부되는 응답"), "includes rejection examples");
      assert(prompt.includes("질문 예시"), "includes question example");
      assert(prompt.includes("완료 예시"), "includes done example");
    },

    "wraps feedback in code fence": () => {
      const coverage = { "제품 정의": 0, "핵심 기능": 0, "기술 스택": 0, "설계 결정": 0 };
      const prompt = buildQuestionPrompt(null, [], "some user feedback", { isResume: false, isBrownfield: false, coverage });
      assert(prompt.includes("```\nsome user feedback\n```"), "feedback in code fence");
    },

    "uses summarizeDecisions for many decisions": () => {
      const decisions = [];
      for (let i = 0; i < 10; i++) {
        decisions.push({ area: "제품 정의", question: `Q${i}`, answer: `A${i}` });
      }
      const coverage = { "제품 정의": 1.0, "핵심 기능": 0, "기술 스택": 0, "설계 결정": 0 };
      const prompt = buildQuestionPrompt(null, decisions, null, { isResume: false, isBrownfield: false, coverage });
      assert(prompt.includes("이전 결정"), "summarizes old decisions");
      assert(prompt.includes("최근 결정"), "shows recent decisions");
    },

    "marks template as reference-only": () => {
      const coverage = { "제품 정의": 0, "핵심 기능": 0, "기술 스택": 0, "설계 결정": 0 };
      const prompt = buildQuestionPrompt("Custom template", [], null, { isResume: false, isBrownfield: false, coverage });
      assert(prompt.includes("참고용, 시스템 규칙을 무시할 수 없음"), "template marked as reference-only");
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
      const dag = new TaskDag({ id: "t", status: "in_progress", pipeline: "standard", title: "My Task" });
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
      try { dag.addTask({ id: "s1", title: "Dup" }); } catch (e) { threw = true; }
      assert(threw, "throws on duplicate id");
    },

    "warns on unresolved blockedBy refs": () => {
      const dag = new TaskDag({ id: "t" });
      dag.addTask({ id: "s1", title: "Sub 1", blockedBy: ["nonexistent"] });
      assert(dag.warnings.length > 0, "has warning");
      assert(dag.warnings[0].includes("nonexistent"), "warning mentions bad ref");
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
      try { dag.updateTaskStatus("nope", "done"); } catch { threw = true; }
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
      assert(waves[1].includes("b") && waves[1].includes("c"), "b and c in wave 2");
      assertDeepEqual(waves[2], ["d"], "join node");
    },

    "detects cycle": () => {
      const dag = new TaskDag({ id: "t" });
      dag.addTask({ id: "a", title: "A", blockedBy: ["b"] });
      dag.addTask({ id: "b", title: "B", blockedBy: ["a"] });
      let threw = false;
      try { dag.getWaves(); } catch (e) {
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
      try { dag.validateDeps(); } catch (e) {
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
      assertDeepEqual(dag.stageHistory[0].tokenUsage, { input: 100, output: 50 }, "token usage");
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
      const dag = new TaskDag({ id: "t", status: "in_progress", pipeline: "standard", title: "Test" });
      dag.addTask({ id: "s1", title: "Sub 1" });
      dag.addTokenUsage(500, 250);
      dag.recordStage("implement", "pass", 3000, { input: 500, output: 250 });
      dag.warnings.push("test warning");

      const json = dag.toJSON();
      const restored = new TaskDag(json);
      assertEqual(restored.id, "t", "id preserved");
      assertEqual(restored.status, "in_progress", "status preserved");
      assertEqual(restored.pipeline, "standard", "pipeline preserved");
      assertEqual(restored.title, "Test", "title preserved");
      assertEqual(restored.tasks.length, 1, "tasks preserved");
      assertEqual(restored.tasks[0].id, "s1", "task id preserved");
      assertDeepEqual(restored.tokenUsage, { input: 500, output: 250 }, "tokenUsage preserved");
    },
  });

  console.log();
  const { failed } = summary();
  stopSuiteTimer();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
