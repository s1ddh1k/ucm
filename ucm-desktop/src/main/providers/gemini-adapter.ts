import { spawn } from "node:child_process";
import {
  BaseProviderAdapter,
  type ProviderExecutionInput,
  type ProviderExecutionResult,
} from "../provider-adapter";

export class GeminiAdapter extends BaseProviderAdapter {
  readonly name = "gemini" as const;

  protected buildCommand(input: ProviderExecutionInput) {
    const args: string[] = [];
    if (input.model?.trim()) {
      args.push("-m", input.model.trim());
    }
    return {
      cmd: "gemini",
      args,
      cwd: input.cwd,
    };
  }

  async execute(input: ProviderExecutionInput): Promise<ProviderExecutionResult> {
    const command = this.buildCommand(input);
    const args = [...command.args, "-p", input.prompt, "--output-format", "text"];
    const startedAt = Date.now();

    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      let timedOut = false;

      const child = spawn(command.cmd, args, {
        cwd: command.cwd,
        stdio: ["ignore", "pipe", "pipe"],
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
    });
  }
}
