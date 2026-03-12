export interface ProviderCommand {
  cmd: string;
  args: string[];
}

export function buildCommand(
  provider: "claude" | "codex",
  opts: { model?: string; cwd?: string } = {},
): ProviderCommand {
  if (provider === "claude") return buildClaude(opts);
  return buildCodex(opts);
}

function buildClaude(opts: { model?: string }): ProviderCommand {
  const args = [
    "-p",
    "--dangerously-skip-permissions",
    "--no-session-persistence",
    "--output-format", "stream-json",
    "--verbose",
  ];
  if (opts.model) {
    args.push("--model", opts.model);
  }
  return { cmd: "claude", args };
}

function buildCodex(opts: { model?: string; cwd?: string }): ProviderCommand {
  const args = ["exec", "--ephemeral", "--dangerously-bypass-approvals-and-sandbox", "--json"];

  if (opts.model) {
    const { model, reasoning } = parseCodexModel(opts.model);
    args.push("--model", model);
    if (reasoning) {
      args.push("-c", `model_reasoning_effort=${reasoning}`);
    }
  }

  if (opts.cwd) {
    args.push("--cd", opts.cwd);
  }

  args.push("-"); // stdin, 항상 마지막
  return { cmd: "codex", args };
}

const REASONING_LEVELS = new Set(["minimal", "low", "medium", "high", "xhigh"]);

function parseCodexModel(raw: string): { model: string; reasoning?: string } {
  const lastDash = raw.lastIndexOf("-");
  if (lastDash === -1) return { model: raw };
  const suffix = raw.slice(lastDash + 1);
  if (REASONING_LEVELS.has(suffix)) {
    return { model: raw.slice(0, lastDash), reasoning: suffix };
  }
  return { model: raw };
}
