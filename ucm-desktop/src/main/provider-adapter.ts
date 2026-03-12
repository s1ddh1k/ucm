import { spawn } from "node:child_process";

export type ProviderName = "claude" | "codex";

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
  execute(input: ProviderExecutionInput): Promise<ProviderExecutionResult>;
}

type ProviderCommand = {
  cmd: string;
  args: string[];
  cwd?: string;
};

export abstract class BaseProviderAdapter implements ProviderAdapter {
  abstract readonly name: ProviderName;

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
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
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
