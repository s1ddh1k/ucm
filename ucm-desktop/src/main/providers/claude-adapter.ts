import {
  BaseProviderAdapter,
  type ProviderExecutionInput,
} from "../provider-adapter";

export class ClaudeAdapter extends BaseProviderAdapter {
  readonly name = "claude" as const;
  readonly capabilities = {
    defaultModel: "sonnet",
    supportsTerminalSession: true,
    sessionStrategy: "live_terminal",
    resumeSupport: "live_terminal",
  } as const;

  protected buildCommand(input: ProviderExecutionInput) {
    const args = [
      "-p",
      "--dangerously-skip-permissions",
      "--no-session-persistence",
      "--output-format",
      "text",
    ];
    if (input.model?.trim()) {
      args.push("--model", input.model.trim());
    }
    return {
      cmd: "claude",
      args,
      cwd: input.cwd,
    };
  }
}
