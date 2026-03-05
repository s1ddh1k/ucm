import { describe, it, assert } from "./harness.ts";
import { parseArgs } from "../src/cli.ts";
import { DEFAULT_MAX_ITERATIONS } from "../src/constants.ts";
import { resolve } from "node:path";

describe("parseArgs", () => {
  it("defaults", () => {
    const args = parseArgs([]);
    assert.equal(args.projectPath, resolve("."));
    assert.equal(args.provider, "claude");
    assert.equal(args.model, undefined);
    assert.equal(args.maxIterations, DEFAULT_MAX_ITERATIONS);
    assert.equal(args.autoApprove, false);
    assert.equal(args.resume, false);
    assert.equal(args.help, false);
  });

  it("positional project path", () => {
    const args = parseArgs(["/tmp/my-project"]);
    assert.equal(args.projectPath, "/tmp/my-project");
  });

  it("relative project path is resolved", () => {
    const args = parseArgs(["./foo"]);
    assert.equal(args.projectPath, resolve("./foo"));
  });

  it("--help / -h", () => {
    assert.equal(parseArgs(["--help"]).help, true);
    assert.equal(parseArgs(["-h"]).help, true);
  });

  it("--provider", () => {
    assert.equal(parseArgs(["--provider", "codex"]).provider, "codex");
    assert.equal(parseArgs(["--provider", "claude"]).provider, "claude");
  });

  it("invalid provider throws", () => {
    assert.throws(() => parseArgs(["--provider", "gpt"]), "invalid provider");
  });

  it("--model", () => {
    assert.equal(parseArgs(["--model", "opus"]).model, "opus");
  });

  it("--max-iterations", () => {
    assert.equal(parseArgs(["--max-iterations", "5"]).maxIterations, 5);
  });

  it("invalid max-iterations throws", () => {
    assert.throws(() => parseArgs(["--max-iterations", "abc"]));
    assert.throws(() => parseArgs(["--max-iterations", "0"]));
    assert.throws(() => parseArgs(["--max-iterations", "-1"]));
  });

  it("--auto-approve", () => {
    assert.equal(parseArgs(["--auto-approve"]).autoApprove, true);
  });

  it("--resume", () => {
    assert.equal(parseArgs(["--resume"]).resume, true);
  });

  it("--test-command", () => {
    const args = parseArgs(["--test-command", "bun test/harness.ts"]);
    assert.equal(args.testCommand, "bun test/harness.ts");
  });

  it("--test-command without value throws", () => {
    assert.throws(() => parseArgs(["--test-command"]));
  });

  it("--recursive", () => {
    assert.equal(parseArgs(["--recursive"]).recursive, true);
  });

  it("--recursive defaults to false", () => {
    assert.equal(parseArgs([]).recursive, false);
  });

  it("unknown flag throws", () => {
    assert.throws(() => parseArgs(["--unknown"]));
  });

  it("all flags combined", () => {
    const args = parseArgs([
      "/tmp/proj",
      "--provider", "codex",
      "--model", "o3",
      "--max-iterations", "3",
      "--auto-approve",
      "--resume",
      "--test-command", "bun test",
      "--recursive",
    ]);
    assert.equal(args.projectPath, "/tmp/proj");
    assert.equal(args.provider, "codex");
    assert.equal(args.model, "o3");
    assert.equal(args.maxIterations, 3);
    assert.equal(args.autoApprove, true);
    assert.equal(args.resume, true);
    assert.equal(args.testCommand, "bun test");
    assert.equal(args.recursive, true);
  });
});
