import {
  BaseProviderAdapter,
  type ProviderExecutionInput,
} from "../provider-adapter";

export class ClaudeAdapter extends BaseProviderAdapter {
  readonly name = "claude" as const;

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
    args.push("--allowedTools", "");
    return {
      cmd: "claude",
      args,
      cwd: input.cwd,
    };
  }
}
