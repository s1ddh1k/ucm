#!/usr/bin/env bun
/**
 * 실제 CLI를 모킹하는 독립 스크립트.
 * MOCK_BEHAVIOR 환경변수로 동작 제어.
 */
export {};

const behavior = process.env.MOCK_BEHAVIOR ?? "succeed";
const stdin = await Bun.stdin.text();

switch (behavior) {
  case "succeed": {
    const result = process.env.MOCK_RESPONSE ?? `Done: ${stdin.slice(0, 50)}`;
    // stream-json 포맷 시뮬레이션
    write({ type: "assistant", message: { content: [{ type: "text", text: result }] } });
    write({ type: "result", result: result, duration_ms: 100 });
    process.exit(0);
    break;
  }

  case "fail": {
    process.stderr.write("Error: agent failed\n");
    process.exit(1);
    break;
  }

  case "rate_limit": {
    process.stderr.write("Error: 429 rate limit exceeded\n");
    process.exit(1);
    break;
  }

  case "timeout": {
    // stdout 없이 무한 대기
    await new Promise(() => {});
    break;
  }

  case "slow_output": {
    const intervals = parseInt(process.env.MOCK_INTERVALS ?? "5", 10);
    const delayMs = parseInt(process.env.MOCK_DELAY ?? "200", 10);
    for (let i = 0; i < intervals; i++) {
      write({ type: "assistant", message: { content: [{ type: "text", text: `chunk ${i}` }] } });
      await Bun.sleep(delayMs);
    }
    write({ type: "result", result: "slow done", duration_ms: intervals * delayMs });
    process.exit(0);
    break;
  }

  case "loop": {
    const count = parseInt(process.env.MOCK_LOOP_COUNT ?? "5", 10);
    const toolName = process.env.MOCK_TOOL_NAME ?? "Read";
    const toolInput = process.env.MOCK_TOOL_INPUT ?? '{"file_path":"/tmp/test"}';
    for (let i = 0; i < count; i++) {
      write({
        type: "assistant",
        message: {
          content: [{
            type: "tool_use",
            id: `tool_${i}`,
            name: toolName,
            input: JSON.parse(toolInput),
          }],
        },
      });
      await Bun.sleep(50);
    }
    // 루프 감지로 kill 되지 않으면 정상 종료
    write({ type: "result", result: "loop done", duration_ms: 500 });
    process.exit(0);
    break;
  }

  case "large_output": {
    const sizeBytes = parseInt(process.env.MOCK_SIZE ?? String(55 * 1024 * 1024), 10);
    const chunkSize = 64 * 1024;
    let written = 0;
    const chunk = "x".repeat(chunkSize) + "\n";
    while (written < sizeBytes) {
      process.stdout.write(chunk);
      written += chunk.length;
    }
    process.exit(0);
    break;
  }

  case "json_response": {
    const json = process.env.MOCK_JSON ?? '{"passed":true,"keepChanges":true,"reason":"ok"}';
    const text = "```json\n" + json + "\n```";
    write({ type: "result", result: text, duration_ms: 100 });
    process.exit(0);
    break;
  }

  case "sequence": {
    // MOCK_SEQUENCE: JSON 배열 "[{\"output\":\"...\",\"delay\":100},...]"
    const steps = JSON.parse(process.env.MOCK_SEQUENCE ?? "[]") as {
      output: string;
      delay?: number;
      exit?: number;
    }[];
    for (const step of steps) {
      if (step.delay) await Bun.sleep(step.delay);
      write({ type: "assistant", message: { content: [{ type: "text", text: step.output }] } });
      if (step.exit !== undefined) process.exit(step.exit);
    }
    write({ type: "result", result: steps[steps.length - 1]?.output ?? "", duration_ms: 100 });
    process.exit(0);
    break;
  }

  case "implement": {
    // 실제로 cwd에 파일 생성 + git commit
    const filename = process.env.MOCK_FILENAME ?? "feature.txt";
    const baseContent = process.env.MOCK_CONTENT ?? "implemented\n";
    const content = baseContent + `timestamp: ${Date.now()}\n`;
    const cwd = process.cwd();
    await Bun.write(`${cwd}/${filename}`, content);
    const p1 = Bun.spawnSync(["git", "add", "."], { cwd });
    if (p1.exitCode !== 0) {
      process.stderr.write(`git add failed: ${p1.stderr.toString()}\n`);
      process.exit(1);
    }
    const p2 = Bun.spawnSync(["git", "commit", "-m", `add ${filename}`], { cwd });
    if (p2.exitCode !== 0) {
      process.stderr.write(`git commit failed: ${p2.stderr.toString()}\n`);
      process.exit(1);
    }
    write({ type: "result", result: `Implemented: created ${filename}`, duration_ms: 100 });
    process.exit(0);
    break;
  }

  case "enoent": {
    // 이 케이스는 실제로 도달하지 않음 (존재하지 않는 커맨드 테스트용)
    process.exit(127);
    break;
  }

  case "echo_env": {
    // 전달받은 환경변수 출력
    const keys = (process.env.MOCK_ENV_KEYS ?? "").split(",").filter(Boolean);
    const env: Record<string, string | undefined> = {};
    for (const k of keys) env[k] = process.env[k];
    write({ type: "result", result: JSON.stringify(env), duration_ms: 10 });
    process.exit(0);
    break;
  }

  case "echo_stdin": {
    write({ type: "result", result: stdin, duration_ms: 10 });
    process.exit(0);
    break;
  }

  case "mixed_loop": {
    // 서로 다른 tool_use를 번갈아 호출 (false positive 방지 테스트)
    const tools = ["Read", "Write", "Bash"];
    for (let i = 0; i < 6; i++) {
      write({
        type: "assistant",
        message: {
          content: [{
            type: "tool_use",
            id: `tool_${i}`,
            name: tools[i % tools.length],
            input: { path: `/tmp/file${i}` },
          }],
        },
      });
      await Bun.sleep(30);
    }
    write({ type: "result", result: "mixed done", duration_ms: 300 });
    process.exit(0);
    break;
  }

  default:
    process.stderr.write(`Unknown behavior: ${behavior}\n`);
    process.exit(1);
}

function write(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj) + "\n");
}
