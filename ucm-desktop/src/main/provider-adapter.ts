import { spawn } from "node:child_process";
import type { RuntimeProvider } from "../shared/contracts";

export type ProviderName = RuntimeProvider | "local";
export type ProviderSessionStrategy =
  | "pipe_only"
  | "live_terminal"
  | "persistent_terminal";
export type ProviderResumeSupport =
  | "none"
  | "live_terminal"
  | "persistent_terminal";
export type ProviderCapabilities = {
  defaultModel?: string;
  supportsTerminalSession: boolean;
  sessionStrategy: ProviderSessionStrategy;
  resumeSupport: ProviderResumeSupport;
};

export type ProviderExecutionInput = {
  prompt: string;
  cwd?: string;
  model?: string;
  timeoutMs?: number;
};

export type ProviderExecutionResult = {
  status: "done" | "failed" | "timeout";
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
};

export interface ProviderAdapter {
  readonly name: ProviderName;
  readonly capabilities: ProviderCapabilities;
  execute(input: ProviderExecutionInput): Promise<ProviderExecutionResult>;
}

type ProviderCommand = {
  cmd: string;
  args: string[];
  cwd?: string;
};

const MAX_PROVIDER_STDOUT_CHARS = 24_000;
const MAX_PROVIDER_STDERR_CHARS = 12_000;

export abstract class BaseProviderAdapter implements ProviderAdapter {
  abstract readonly name: ProviderName;
  abstract readonly capabilities: ProviderCapabilities;

  protected abstract buildCommand(input: ProviderExecutionInput): ProviderCommand;

  createCommand(input: ProviderExecutionInput): ProviderCommand {
    return this.buildCommand(input);
  }

  async execute(input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
    const command = this.buildCommand(input);
    const startedAt = Date.now();

    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      let timedOut = false;

      const child = spawn(command.cmd, command.args, {
        cwd: command.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: this.buildEnv(),
      });

      const timeout = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        child.kill("SIGTERM");
      }, input.timeoutMs ?? 45000);

      const finish = (
        status: ProviderExecutionResult["status"],
        exitCode: number | null,
      ) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve({
          status,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode,
          durationMs: Date.now() - startedAt,
        });
      };

      child.stdout.on("data", (chunk) => {
        stdout = appendProviderOutputChunk(
          stdout,
          chunk.toString(),
          MAX_PROVIDER_STDOUT_CHARS,
        );
      });

      child.stderr.on("data", (chunk) => {
        stderr = appendProviderOutputChunk(
          stderr,
          chunk.toString(),
          MAX_PROVIDER_STDERR_CHARS,
        );
      });

      child.on("error", (error) => {
        stderr = error.message;
        finish("failed", null);
      });

      child.on("close", (code) => {
        if (timedOut) {
          finish("timeout", code);
          return;
        }
        finish(code === 0 ? "done" : "failed", code);
      });

      child.stdin.on("error", () => {});
      child.stdin.end(input.prompt);
    });
  }

  protected buildEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    return env;
  }
}

export const PROVIDER_CAPABILITIES: Record<RuntimeProvider, ProviderCapabilities> = {
  claude: {
    defaultModel: "sonnet",
    supportsTerminalSession: true,
    sessionStrategy: "live_terminal",
    resumeSupport: "live_terminal",
  },
  codex: {
    defaultModel: "medium",
    supportsTerminalSession: true,
    sessionStrategy: "live_terminal",
    resumeSupport: "live_terminal",
  },
  gemini: {
    supportsTerminalSession: false,
    sessionStrategy: "pipe_only",
    resumeSupport: "none",
  },
};

export function appendProviderOutputChunk(
  current: string,
  chunk: string,
  maxChars: number,
): string {
  return clampProviderOutput(`${current}${chunk}`, maxChars);
}

function clampProviderOutput(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  const separator = "\n...[truncated provider output]...\n";
  const headLength = Math.max(0, Math.floor((maxChars - separator.length) * 0.4));
  const tailLength = Math.max(0, maxChars - separator.length - headLength);
  return `${value.slice(0, headLength)}${separator}${value.slice(-tailLength)}`;
}
