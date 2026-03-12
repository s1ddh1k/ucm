import { describe, it, assert } from "./harness.ts";
import { buildCommand } from "../src/providers.ts";

describe("providers.ts", () => {
  it("builds claude command with defaults", () => {
    const { cmd, args } = buildCommand("claude");
    assert.equal(cmd, "claude");
    assert(args.includes("-p"), "should have -p flag");
    assert(args.includes("--dangerously-skip-permissions"), "should have skip permissions");
    assert(args.includes("--no-session-persistence"), "should have no session persistence");
    assert(args.includes("--output-format"), "should have output-format");
    assert(args.includes("stream-json"), "should have stream-json");
    assert(args.includes("--verbose"), "should have verbose");
  });

  it("builds claude command with model", () => {
    const { args } = buildCommand("claude", { model: "opus" });
    assert(args.includes("--model"), "should have --model");
    assert(args.includes("opus"), "should have model name");
  });

  it("builds codex command with defaults", () => {
    const { cmd, args } = buildCommand("codex");
    assert.equal(cmd, "codex");
    assert(args.includes("exec"), "should have exec subcommand");
    assert(args.includes("--ephemeral"), "should have ephemeral");
    assert(args.includes("--dangerously-bypass-approvals-and-sandbox"), "should have bypass");
    assert(args.includes("--json"), "should have json");
    assert.equal(args[args.length - 1], "-", "stdin flag should be last");
  });

  it("builds codex command with cwd", () => {
    const { args } = buildCommand("codex", { cwd: "/tmp/work" });
    assert(args.includes("--cd"), "should have --cd");
    assert(args.includes("/tmp/work"), "should have cwd path");
    assert.equal(args[args.length - 1], "-", "stdin flag still last");
  });

  it("builds codex command with model", () => {
    const { args } = buildCommand("codex", { model: "o3" });
    assert(args.includes("--model"), "should have --model");
    assert(args.includes("o3"), "should have model name");
  });

  it("parses codex model with reasoning effort", () => {
    const { args } = buildCommand("codex", { model: "o3-high" });
    assert(args.includes("--model"), "should have --model");
    assert(args.includes("o3"), "model without suffix");
    assert(args.includes("-c"), "should have -c flag");
    assert(args.includes("model_reasoning_effort=high"), "should have reasoning effort");
  });

  it("parses codex model with various reasoning levels", () => {
    for (const level of ["minimal", "low", "medium", "high", "xhigh"]) {
      const { args } = buildCommand("codex", { model: `o3-mini-${level}` });
      assert(args.includes("o3-mini"), `model for ${level}`);
      assert(args.includes(`model_reasoning_effort=${level}`), `effort for ${level}`);
    }
  });

  it("does not parse non-reasoning suffix", () => {
    const { args } = buildCommand("codex", { model: "gpt-4o-2024" });
    assert(args.includes("gpt-4o-2024"), "full model name preserved");
    assert(!args.includes("-c"), "no -c flag");
  });
});
