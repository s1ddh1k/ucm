import {
  BaseProviderAdapter,
  type ProviderExecutionInput,
} from "../provider-adapter";

const REASONING_EFFORTS = new Set(["low", "medium", "high"]);

function normalizeCodexModel(model?: string): string | undefined {
  const trimmed = model?.trim().toLowerCase();
  return trimmed || undefined;
}

export class CodexAdapter extends BaseProviderAdapter {
  readonly name = "codex" as const;

  protected buildCommand(input: ProviderExecutionInput) {
    const args = [
      "exec",
      "--ephemeral",
      "--dangerously-bypass-approvals-and-sandbox",
      "--json",
    ];
    const normalizedModel = normalizeCodexModel(input.model);
    if (normalizedModel && REASONING_EFFORTS.has(normalizedModel)) {
      args.push("-c", `model_reasoning_effort=${normalizedModel}`);
    } else if (normalizedModel) {
      args.push("--model", normalizedModel);
    }
    if (input.cwd) {
      args.push("--cd", input.cwd);
    }
    args.push("-");
    return {
      cmd: "codex",
      args,
      cwd: input.cwd,
    };
  }
}
