const fs = require("node:fs");
const path = require("node:path");
const {
  classifyCommit,
  getRepoRoot,
  getStagedDiff,
  getStagedFiles,
} = require("./checks");
const {
  buildCommitMessage,
  collectContextBullets,
  planCommitMessage,
} = require("./commit-message");
const { applyAnswersToPlan } = require("./commit-plan");
const {
  askQuestions,
  buildFallbackQuestions,
  hasAnswers,
} = require("./commit-questions");
const {
  analyzeCommitWithLlm,
  finalizeCommitWithLlm,
  resolveProvider,
} = require("./llm-analysis");
const buildClarifyingQuestions = buildFallbackQuestions;

function appendBulletsToSection(message, heading, bullets) {
  if (!bullets.length) return message;
  const lines = message.trimEnd().split("\n");
  const headingLine = `${heading}:`;
  const headingIndex = lines.findIndex((line) => line.trim() === headingLine);

  if (headingIndex === -1) {
    return `${message.trimEnd()}\n\n${headingLine}\n${bullets
      .map((bullet) => `- ${bullet}`)
      .join("\n")}\n`;
  }

  let insertIndex = headingIndex + 1;
  while (insertIndex < lines.length && lines[insertIndex].trim() !== "") {
    insertIndex++;
  }
  lines.splice(insertIndex, 0, ...bullets.map((bullet) => `- ${bullet}`));
  return `${lines.join("\n").trimEnd()}\n`;
}

function enrichCommitMessage(message, questions, answers) {
  let nextMessage = message;
  for (const question of questions) {
    const answer = String(answers[question.id] || "").trim();
    if (!answer) continue;

    if (question.kind === "why") {
      nextMessage = appendBulletsToSection(nextMessage, "Why", [answer]);
      continue;
    }
    if (question.kind === "verification") {
      nextMessage = appendBulletsToSection(nextMessage, "Verification", [answer]);
      continue;
    }
    nextMessage = appendBulletsToSection(nextMessage, "Notes", [answer]);
  }
  return nextMessage;
}

function buildDraftPath(repoRoot) {
  return path.join(repoRoot, ".git", "TACIT_COMMIT_MSG");
}

async function analyzeCommitFlow({
  root = ".",
  llm = true,
  provider,
  model,
  timeoutMs,
  analyzeCommitImpl = analyzeCommitWithLlm,
}) {
  const repoRoot = getRepoRoot(path.resolve(root));
  const stagedFiles = getStagedFiles(repoRoot);
  if (stagedFiles.length === 0) {
    throw new Error("no staged files");
  }
  const stagedDiff = getStagedDiff(repoRoot);
  const inspection = classifyCommit({
    repoRoot,
    stagedFiles,
    stagedDiff,
  });
  const context = collectContextBullets(repoRoot, stagedFiles, stagedDiff);
  const fallbackQuestions = buildFallbackQuestions({
    stagedFiles,
    stagedDiff,
    inspection,
    context,
  });
  const fallbackPlan = planCommitMessage({
    repoRoot,
    stagedFiles,
    stagedDiff,
  });
  let plan = fallbackPlan;
  let questions = llm ? [] : fallbackQuestions;
  let analysisSource = "heuristic";
  const llmState = {
    enabled: llm,
    attempted: false,
    used: false,
    provider: llm ? resolveProvider(provider) : null,
    model: model || "",
    error: null,
    finalized: false,
    finalError: null,
  };

  if (llm) {
    llmState.attempted = true;
    try {
      const result = await analyzeCommitImpl({
        repoRoot,
        stagedFiles,
        stagedDiff,
        fallbackPlan,
        provider: llmState.provider,
        model,
        timeoutMs,
      });
      plan = result.plan;
      questions = result.plan.questions;
      analysisSource = "llm";
      llmState.used = true;
      llmState.provider = result.provider || llmState.provider;
    } catch (error) {
      llmState.error = error.message;
      questions = fallbackQuestions;
    }
  }

  return {
    repoRoot,
    stagedFiles,
    stagedDiff,
    inspection,
    context,
    questions,
    draft: buildCommitMessage(plan),
    draftPath: buildDraftPath(repoRoot),
    plan,
    fallbackPlan,
    analysisSource,
    llm: llmState,
  };
}

async function runCommitFlow({
  root = ".",
  dryRun = false,
  noPrompt = true,
  llm = true,
  provider,
  model,
  timeoutMs,
  answers: providedAnswers,
  analyzeCommitImpl = analyzeCommitWithLlm,
  finalizeCommitImpl = finalizeCommitWithLlm,
}) {
  const analysis = await analyzeCommitFlow({
    root,
    llm,
    provider,
    model,
    timeoutMs,
    analyzeCommitImpl,
  });
  const answers = providedAnswers || (noPrompt ? {} : await askQuestions(analysis.questions));
  let message = analysis.draft;

  if (analysis.llm.used && hasAnswers(answers)) {
    try {
      const finalized = await finalizeCommitImpl({
        repoRoot: analysis.repoRoot,
        stagedFiles: analysis.stagedFiles,
        stagedDiff: analysis.stagedDiff,
        fallbackPlan: analysis.plan,
        answers,
        provider: analysis.llm.provider,
        model,
        timeoutMs,
      });
      message = buildCommitMessage(finalized.plan);
      analysis.plan = finalized.plan;
      analysis.llm.finalized = true;
      analysis.llm.provider = finalized.provider || analysis.llm.provider;
    } catch (error) {
      analysis.llm.finalError = error.message;
      analysis.plan = applyAnswersToPlan(analysis.plan, analysis.questions, answers);
      message = buildCommitMessage(analysis.plan);
    }
  } else if (hasAnswers(answers)) {
    analysis.plan = applyAnswersToPlan(analysis.plan, analysis.questions, answers);
    message = buildCommitMessage(analysis.plan);
  }

  if (!dryRun) {
    fs.writeFileSync(analysis.draftPath, message, "utf8");
  }

  return {
    ...analysis,
    answers,
    interactive: !noPrompt,
    message,
    written: !dryRun,
  };
}

function formatCommitFlow(result) {
  const lines = [];
  lines.push(`tacit: draft ${result.written ? "written" : "previewed"}`);
  lines.push(`draft: ${result.draftPath}`);
  lines.push(
    `analysis: ${result.analysisSource}${
      result.llm?.provider ? ` (${result.llm.provider})` : ""
    }`,
  );

  if (result.llm?.error) {
    lines.push(`fallback: ${result.llm.error}`);
  }
  if (result.llm?.finalError) {
    lines.push(`finalize fallback: ${result.llm.finalError}`);
  }

  if (result.inspection.status !== "ok" && result.analysisSource !== "llm") {
    lines.push(`status: ${result.inspection.status}`);
  }

  const unansweredQuestions = result.questions.filter(
    (question) => !String(result.answers?.[question.id] || "").trim(),
  );

  if (result.interactive && unansweredQuestions.length > 0) {
    lines.push("questions:");
    for (const question of unansweredQuestions) {
      lines.push(`- ${question.question}`);
    }
  }

  lines.push("", result.message.trimEnd());

  if (result.written) {
    lines.push("", "next: run `git commit` to open the generated draft.");
  } else {
    lines.push("", "next: rerun without `--dry-run` to write the draft.");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

module.exports = {
  analyzeCommitFlow,
  appendBulletsToSection,
  buildClarifyingQuestions,
  buildDraftPath,
  enrichCommitMessage,
  formatCommitFlow,
  runCommitFlow,
};
