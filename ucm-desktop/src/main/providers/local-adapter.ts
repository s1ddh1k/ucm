import {
  BaseProviderAdapter,
  type ProviderExecutionInput,
} from "../provider-adapter";

export class LocalAdapter extends BaseProviderAdapter {
  readonly name = "local" as const;
  readonly capabilities = {
    supportsTerminalSession: false,
    sessionStrategy: "pipe_only",
    resumeSupport: "none",
  } as const;

  protected buildCommand(input: ProviderExecutionInput) {
    return {
      cmd: "sh",
      args: ["-lc", "cat"],
      cwd: input.cwd,
    };
  }
}
