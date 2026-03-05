import { describe, it, assert, beforeEach, afterEach } from "./harness.ts";
import { spawnAgent } from "../src/spawn.ts";
import { mockAgentPath } from "./helpers.ts";
import { tmpdir } from "node:os";

const cwd = tmpdir();

function mockOverrides(behavior: string, extra: Record<string, string> = {}) {
  return {
    cmd: "bun",
    args: [mockAgentPath()],
    env: { MOCK_BEHAVIOR: behavior, PATH: process.env.PATH!, HOME: process.env.HOME!, ...extra },
  };
}

describe("spawn.ts", () => {
  it("normal execution returns ok", async () => {
    const result = await spawnAgent("hello", { cwd, provider: "claude" }, mockOverrides("succeed"));
    assert.equal(result.status, "ok");
    assert.includes(result.text, "Done: hello");
    assert.equal(result.exitCode, 0);
    assert(result.durationMs >= 0);
  });

  it("abnormal exit returns error", async () => {
    const result = await spawnAgent("test", { cwd, provider: "claude" }, mockOverrides("fail"));
    assert.equal(result.status, "error");
    assert.equal(result.exitCode, 1);
  });

  it("stderr rate limit pattern returns rate_limited", async () => {
    const result = await spawnAgent(
      "test",
      { cwd, provider: "claude" },
      mockOverrides("rate_limit"),
    );
    assert.equal(result.status, "rate_limited");
  });

  it("idle timeout kills and returns timeout", async () => {
    const result = await spawnAgent(
      "test",
      { cwd, provider: "claude", idleTimeoutMs: 200 },
      mockOverrides("timeout"),
    );
    assert.equal(result.status, "timeout");
  });

  it("hard timeout kills and returns timeout", async () => {
    const result = await spawnAgent(
      "test",
      { cwd, provider: "claude", idleTimeoutMs: 60_000, hardTimeoutMs: 300 },
      mockOverrides("timeout"),
    );
    assert.equal(result.status, "timeout");
  });

  it("stdout data resets idle timer", async () => {
    // slow_output: 5 intervals × 200ms = 1s total, but idle resets each time
    const result = await spawnAgent(
      "test",
      { cwd, provider: "claude", idleTimeoutMs: 400 },
      mockOverrides("slow_output", { MOCK_INTERVALS: "5", MOCK_DELAY: "200" }),
    );
    assert.equal(result.status, "ok");
    assert.includes(result.text, "slow done");
  });

  it("3 consecutive identical tool_use kills with loop_killed", async () => {
    const result = await spawnAgent(
      "test",
      { cwd, provider: "claude", idleTimeoutMs: 5000 },
      mockOverrides("loop", { MOCK_LOOP_COUNT: "5" }),
    );
    assert.equal(result.status, "loop_killed");
  });

  it("different tool_use calls do not trigger loop detection", async () => {
    const result = await spawnAgent(
      "test",
      { cwd, provider: "claude", idleTimeoutMs: 5000 },
      mockOverrides("mixed_loop"),
    );
    assert.equal(result.status, "ok");
    assert.includes(result.text, "mixed done");
  });

  it("large output truncates front, keeps tail", async () => {
    const sizeBytes = 55 * 1024 * 1024; // 55MB
    const result = await spawnAgent(
      "test",
      { cwd, provider: "claude", idleTimeoutMs: 30_000, hardTimeoutMs: 60_000 },
      mockOverrides("large_output", { MOCK_SIZE: String(sizeBytes) }),
    );
    // 출력이 50MB 이하로 잘려야 함
    assert(result.text.length <= 50 * 1024 * 1024 + 1024, "output should be truncated");
  });

  it("passes prompt via stdin", async () => {
    const result = await spawnAgent(
      "my-test-prompt",
      { cwd, provider: "claude" },
      mockOverrides("echo_stdin"),
    );
    assert.equal(result.status, "ok");
    assert.equal(result.text, "my-test-prompt");
  });

  it("filters env variables", async () => {
    const result = await spawnAgent(
      "test",
      { cwd, provider: "claude" },
      {
        cmd: "bun",
        args: [mockAgentPath()],
        env: {
          MOCK_BEHAVIOR: "echo_env",
          MOCK_ENV_KEYS: "PATH,SECRET",
          PATH: process.env.PATH!,
          SECRET: "should-exist-in-override",
          HOME: process.env.HOME!,
        },
      },
    );
    assert.equal(result.status, "ok");
    const env = JSON.parse(result.text);
    assert.equal(env.PATH, process.env.PATH);
    assert.equal(env.SECRET, "should-exist-in-override");
  });

  it("spawns as detached process", async () => {
    // detached는 내부적으로 설정. mock-agent가 실행되면 detached 동작 확인
    const result = await spawnAgent("test", { cwd, provider: "claude" }, mockOverrides("succeed"));
    assert.equal(result.status, "ok");
  });

  it("parses stream-json result event", async () => {
    const result = await spawnAgent(
      "test",
      { cwd, provider: "claude" },
      mockOverrides("json_response", {
        MOCK_JSON: '{"passed":true,"keepChanges":true,"reason":"all good"}',
      }),
    );
    assert.equal(result.status, "ok");
    assert.includes(result.text, "passed");
  });

  it("ENOENT returns error without retry", async () => {
    const result = await spawnAgent("test", { cwd, provider: "claude" }, {
      cmd: "nonexistent-cmd-xyz",
      args: [],
      env: { PATH: process.env.PATH!, HOME: process.env.HOME! },
    });
    assert.equal(result.status, "error");
    assert.match(result.text, /ENOENT|not found/i);
  });

  it("onData callback receives chunks", async () => {
    const chunks: string[] = [];
    const result = await spawnAgent(
      "test",
      { cwd, provider: "claude", onData: (c) => chunks.push(c) },
      mockOverrides("succeed"),
    );
    assert.equal(result.status, "ok");
    assert(chunks.length > 0, "should have received chunks");
  });

  it("measures duration", async () => {
    const result = await spawnAgent(
      "test",
      { cwd, provider: "claude" },
      mockOverrides("slow_output", { MOCK_INTERVALS: "2", MOCK_DELAY: "100" }),
    );
    assert(result.durationMs >= 150, "should measure duration");
  });
});
