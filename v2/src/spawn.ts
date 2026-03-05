import { spawn as nodeSpawn } from "node:child_process";
import type { SpawnAgent, SpawnOpts, SpawnResult } from "./types.ts";
import { buildCommand } from "./providers.ts";
import { filterEnv } from "./env.ts";
import { killProcess } from "./kill.ts";
import {
  RATE_LIMIT_RE,
  MAX_OUTPUT_BYTES,
  LOOP_DETECT_THRESHOLD,
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_HARD_TIMEOUT_MS,
} from "./constants.ts";

export interface SpawnOverrides {
  cmd?: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * 에이전트를 스폰하고 모든 안전장치를 적용한다.
 */
export async function spawnAgent(
  prompt: string,
  opts: SpawnOpts,
  overrides?: SpawnOverrides,
): Promise<SpawnResult> {
  const start = Date.now();
  const idleTimeout = opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const hardTimeout = opts.hardTimeoutMs ?? DEFAULT_HARD_TIMEOUT_MS;

  // 커맨드 빌드
  const provider = buildCommand(opts.provider, { model: opts.model, cwd: opts.cwd });
  const cmd = overrides?.cmd ?? provider.cmd;
  const args = overrides?.args ?? provider.args;
  const env = overrides?.env ?? filterEnv(process.env as Record<string, string>);

  // 스폰
  let child;
  try {
    child = nodeSpawn(cmd, args, {
      cwd: opts.provider === "codex" ? undefined : opts.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env,
      detached: true,
    });
  } catch (e: unknown) {
    return {
      status: "error",
      text: e instanceof Error ? e.message : String(e),
      exitCode: null,
      durationMs: Date.now() - start,
    };
  }

  // ENOENT 등 스폰 에러 처리
  const spawnError = await new Promise<Error | null>((resolve) => {
    child.on("error", (err) => resolve(err));
    // 스폰 성공 시 pid가 있음
    if (child.pid) {
      resolve(null);
    } else {
      // pid가 없으면 에러 이벤트를 기다림
      setTimeout(() => resolve(null), 100);
    }
  });

  if (spawnError) {
    return {
      status: "error",
      text: spawnError.message,
      exitCode: null,
      durationMs: Date.now() - start,
    };
  }

  // stdin으로 프롬프트 전달
  child.stdin.end(prompt);

  // 상태 추적
  let outputBuf = Buffer.alloc(0);
  let stderrBuf = "";
  let killed = false;
  let killReason: SpawnResult["status"] = "error";

  // 루프 감지
  const recentToolCalls: string[] = [];

  // idle timer
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      killed = true;
      killReason = "timeout";
      killProcess(child.pid!);
    }, idleTimeout);
  };
  resetIdle();

  // hard timer
  const hardTimer = setTimeout(() => {
    killed = true;
    killReason = "timeout";
    killProcess(child.pid!);
  }, hardTimeout);

  // stdout 수집
  child.stdout.on("data", (chunk: Buffer) => {
    resetIdle();

    // 출력 크기 제한
    outputBuf = Buffer.concat([outputBuf, chunk]);
    if (outputBuf.length > MAX_OUTPUT_BYTES) {
      // 앞부분 버림
      outputBuf = outputBuf.subarray(outputBuf.length - MAX_OUTPUT_BYTES);
    }

    opts.onData?.(chunk.toString());

    // 루프 감지: stream-json 라인별 파싱
    const lines = chunk.toString().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event?.type === "assistant" && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === "tool_use") {
              const sig = JSON.stringify({ name: block.name, input: block.input });
              recentToolCalls.push(sig);
              if (recentToolCalls.length > LOOP_DETECT_THRESHOLD) {
                recentToolCalls.shift();
              }
              if (
                recentToolCalls.length === LOOP_DETECT_THRESHOLD &&
                recentToolCalls.every((c) => c === recentToolCalls[0])
              ) {
                killed = true;
                killReason = "loop_killed";
                killProcess(child.pid!);
              }
            }
          }
        }
      } catch {
        // JSON 파싱 실패: 비 JSON 라인 무시
      }
    }
  });

  // stderr 수집
  child.stderr.on("data", (chunk: Buffer) => {
    stderrBuf += chunk.toString();
  });

  // 종료 대기
  const exitCode = await new Promise<number | null>((resolve) => {
    child.on("exit", (code) => resolve(code));
    child.on("error", () => resolve(null));
  });

  // 타이머 정리
  if (idleTimer) clearTimeout(idleTimer);
  clearTimeout(hardTimer);

  const durationMs = Date.now() - start;
  const text = parseResultText(outputBuf.toString());

  // 상태 결정
  if (killed) {
    return { status: killReason, text, exitCode, durationMs };
  }

  if (exitCode !== 0 && RATE_LIMIT_RE.test(stderrBuf)) {
    return { status: "rate_limited", text: stderrBuf, exitCode, durationMs };
  }

  if (exitCode !== 0) {
    return { status: "error", text: stderrBuf || text, exitCode, durationMs };
  }

  return { status: "ok", text, exitCode, durationMs };
}

/**
 * SpawnOverrides가 바인딩된 SpawnAgent를 생성한다.
 * E2E 테스트에서 mock-agent.ts로 대체할 때 사용.
 */
export function createSpawnAgent(overrides: SpawnOverrides): SpawnAgent {
  return (prompt, opts) => spawnAgent(prompt, opts, overrides);
}

/**
 * 호출마다 다른 overrides를 적용하는 SpawnAgent를 생성한다.
 * resolver는 프롬프트와 옵션을 보고 해당 호출에 적용할 overrides를 반환한다.
 */
export function createDynamicSpawnAgent(
  resolver: (prompt: string, opts: SpawnOpts) => SpawnOverrides,
): SpawnAgent {
  return (prompt, opts) => spawnAgent(prompt, opts, resolver(prompt, opts));
}

/**
 * stream-json 포맷에서 result 이벤트의 텍스트를 추출.
 * result 이벤트가 없으면 전체 출력을 반환.
 */
function parseResultText(raw: string): string {
  const lines = raw.split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const event = JSON.parse(lines[i]);
      if (event?.type === "result" && typeof event.result === "string") {
        return event.result;
      }
    } catch {
      // 비 JSON 라인 무시
    }
  }
  return raw;
}
