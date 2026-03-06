import { spawnSync } from "node:child_process";
import type { ReviewFile, ReviewIssue, ReviewPack, ToolResult } from "./types.ts";

const DIFF_LIMIT = 16_000;
const FILE_PATCH_LIMIT = 6_000;
const TEST_OUTPUT_LIMIT = 4_096;

function gitText(args: string[], cwd: string): string {
  const result = spawnSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) {
    return "";
  }
  return result.stdout.toString().trim();
}

function clip(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n... [truncated ${text.length - limit} chars]`;
}

function parseNumstat(text: string, cwd: string, range: string): ReviewFile[] {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  return lines.map((line) => {
    const [additionsRaw, deletionsRaw, ...pathParts] = line.split("\t");
    const filePath = pathParts.join("\t");
    return {
      path: filePath,
      additions: Number.parseInt(additionsRaw, 10) || 0,
      deletions: Number.parseInt(deletionsRaw, 10) || 0,
      patch: clip(gitText(["diff", "--no-color", range, "--", filePath], cwd), FILE_PATCH_LIMIT),
    } satisfies ReviewFile;
  });
}

export interface BuildReviewPackOpts {
  worktreePath: string;
  baseBranch: string;
  branchName: string;
  finalReason: string;
  testOutput?: string;
  iterations: number;
  toolResults: ToolResult[];
}

export function buildReviewPack(opts: BuildReviewPackOpts): ReviewPack {
  const range = `${opts.baseBranch}...HEAD`;
  const changedFiles = gitText(["diff", "--name-only", range], opts.worktreePath)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const commits = gitText(["log", "--oneline", `${opts.baseBranch}..HEAD`], opts.worktreePath)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const diffStat = gitText(["diff", "--stat", range], opts.worktreePath);
  const diff = clip(gitText(["diff", "--no-color", range], opts.worktreePath), DIFF_LIMIT);
  const files = parseNumstat(gitText(["diff", "--numstat", range], opts.worktreePath), opts.worktreePath, range);
  const reviewIssues = collectFinalReviewIssues(opts.toolResults, opts.iterations);

  return {
    baseBranch: opts.baseBranch,
    branchName: opts.branchName,
    changedFiles,
    commits,
    diffStat,
    diff,
    finalReason: opts.finalReason,
    testOutput: clip(opts.testOutput?.trim() || "Not run", TEST_OUTPUT_LIMIT),
    iterations: opts.iterations,
    toolResults: opts.toolResults,
    reviewIssues,
    files,
  };
}

function collectFinalReviewIssues(toolResults: ToolResult[], iteration: number): ReviewIssue[] {
  return toolResults
    .filter((tool) => tool.stage === "review" && tool.iteration === iteration)
    .flatMap((tool) => tool.issues.map((issue) => ({ ...issue, source: issue.source ?? tool.tool })));
}
