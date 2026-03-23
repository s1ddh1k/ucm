const { execFileSync } = require("node:child_process");
const {
  extractJson,
  spawnLlm,
} = require("../../legacy/lib/core/llm");
const { normalizeCommitPlan } = require("./commit-plan");
const { getPromptContract, getProviderProfile } = require("./provider-profiles");
const { collectRepoContext, trimContext } = require("./repo-context");
const DEFAULT_TIMEOUT_MS = 45_000;
const MAX_DIFF_CHARS = 18_000;

function commandExists(command) {
  try {
    execFileSync("which", [command], { stdio: ["ignore", "ignore", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

function getAvailableProviders() {
  return ["codex", "claude", "gemini"].filter(commandExists);
}

function resolveProvider(explicitProvider) {
  if (explicitProvider && explicitProvider !== "auto") return explicitProvider;

  const envProvider =
    process.env.TACIT_LLM_PROVIDER ||
    process.env.UCM_PROVIDER ||
    process.env.LLM_PROVIDER;
  if (envProvider) return envProvider;

  return getAvailableProviders()[0] || null;
}

function formatDocs(docs) {
  if (!docs.length) return "(none)";
  return docs
    .map(
      (doc) =>
        `FILE: ${doc.path}\n---\n${doc.content}\n---`,
    )
    .join("\n\n");
}

function formatSession(session) {
  if (!session || (!session.intent && (!session.events || session.events.length === 0))) {
    return "(none)";
  }

  const lines = [];
  if (session.intent) {
    lines.push(`INTENT: ${session.intent}`);
  }
  for (const event of session.events || []) {
    const suffix = [
      event.paths?.length ? `paths=${event.paths.join(",")}` : "",
      event.symbols?.length ? `symbols=${event.symbols.join(",")}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    lines.push(
      `- [${event.type}] ${event.summary}${suffix ? ` (${suffix})` : ""}`,
    );
  }
  return lines.join("\n");
}

function formatHistory(entries) {
  if (!entries || entries.length === 0) return "(none)";
  return entries
    .map((entry) => {
      const suffix = [entry.path, entry.symbol ? `symbol=${entry.symbol}` : ""]
        .filter(Boolean)
        .join(" ");
      return `${entry.commit} ${entry.subject}${suffix ? ` (${suffix})` : ""}`;
    })
    .join("\n");
}

function formatSymbols(symbols) {
  if (!symbols.length) return "(none)";
  return symbols
    .map((item) =>
      [
        `FILE: ${item.path}`,
        ...item.symbols.map(
          (symbol) =>
            `SYMBOL ${symbol.name} (${symbol.kind}) LINES ${symbol.start}-${symbol.end}\n${symbol.snippet}`,
        ),
      ].join("\n\n"),
    )
    .join("\n\n---\n\n");
}

function formatRelatedReferences(references) {
  if (!references.length) return "(none)";
  return references
    .map(
      (reference) =>
        [
          `SYMBOL ${reference.symbol} -> ${reference.path} (${reference.kind}) LINES ${reference.start}-${reference.end}`,
          reference.snippet,
        ].join("\n"),
    )
    .join("\n\n---\n\n");
}

function formatSnippets(snippets) {
  if (!snippets.length) return "(none)";
  return snippets
    .map((item) =>
      [
        `FILE: ${item.path}`,
        ...item.windows.map(
          (window) =>
            `LINES ${window.start}-${window.end}\n${window.snippet}`,
        ),
      ].join("\n\n"),
    )
    .join("\n\n---\n\n");
}

function buildPrompt({
  provider,
  mode,
  stagedFiles,
  stagedDiff,
  repoContext,
  answers,
}) {
  const profile = getProviderProfile(provider);
  const contract = getPromptContract(provider);
  const responseShape = `{
  "type": "feat|fix|refactor|docs|test|build|ci|chore",
  "scope": "scope-token",
  "subject": "short conventional commit subject without scope",
  "whyBullets": ["short bullet"],
  "changeBullets": ["short bullet"],
  "verificationBullets": ["short bullet"],
  "notesBullets": ["short bullet"],
  "refs": ["path-or-doc"],
  "questions": [{"id": "question_id", "kind": "why|verification|notes", "question": "Korean question"}],
  "confidence": "low|medium|high"
}`;

  const sections = [
    "You are Tacit, an assistant that turns staged git changes into strong commit messages.",
    "Return JSON only.",
    "Use English for commit message fields and bullets.",
    "Use Korean for clarification questions.",
    "Ask at most 4 questions, and only if the answer cannot be recovered from the diff or repo docs.",
    "Never invent tests, rationale, or decisions that are not supported by the context.",
    "If code changed without obvious verification evidence, ask about verification instead of inventing it.",
    "If a high-impact decision is visible but the rationale is unclear, ask one question about the decision.",
    "",
    `Provider profile: ${profile.provider} (${profile.voice})`,
    "",
    `Mode: ${mode}`,
    "",
    "Response contract:",
    ...contract.baseRules.map((rule) => `- ${rule}`),
    "",
    mode === "final" ? "Provider-specific final instructions:" : "Provider-specific analysis instructions:",
    ...(mode === "final"
      ? contract.finalInstructions
      : contract.analysisInstructions
    ).map((rule) => `- ${rule}`),
    "",
    "Expected JSON schema:",
    responseShape,
    "",
    "Staged files:",
    stagedFiles.map((filePath) => `- ${filePath}`).join("\n") || "(none)",
    "",
    "Diff stat:",
    repoContext.diffStat || "(none)",
    "",
    "Relevant repo docs:",
    formatDocs(repoContext.docs),
    "",
    "Active session residue:",
    formatSession(repoContext.session),
    "",
    "Focused changed symbols:",
    formatSymbols(repoContext.symbols || []),
    "",
    "Related symbol references:",
    formatRelatedReferences(repoContext.relatedReferences || []),
    "",
    "Focused staged file snippets:",
    formatSnippets(repoContext.snippets || []),
    "",
    "Recent path history:",
    formatHistory(repoContext.pathHistory || []),
    "",
    "Recent symbol history:",
    formatHistory(repoContext.symbolHistory || []),
    "",
    "Staged diff (possibly truncated):",
    trimContext(stagedDiff, MAX_DIFF_CHARS) || "(none)",
  ];

  if (mode === "final") {
    sections.push(
      "",
      "User answers to clarification questions:",
      JSON.stringify(answers || {}, null, 2),
      "",
      "In final mode, incorporate those answers into the commit plan and keep questions empty unless something is still ambiguous.",
    );
  }

  return sections.join("\n");
}

async function runLlmPlan(prompt, { provider, model, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const resolvedProvider = resolveProvider(provider);
  if (!resolvedProvider) {
    throw new Error("no LLM provider available");
  }

  const outputFormat = resolvedProvider === "claude" ? "stream-json" : "text";
  const result = await spawnLlm(prompt, {
    provider: resolvedProvider,
    model,
    timeoutMs,
    outputFormat,
    skipPermissions: false,
  });

  if (result.status !== "done") {
    throw new Error(
      `LLM ${result.status}: ${String(result.stderr || result.stdout || "").slice(0, 200)}`,
    );
  }

  return {
    provider: resolvedProvider,
    data: extractJson(result.stdout),
  };
}

async function analyzeCommitWithLlm({
  repoRoot,
  stagedFiles,
  stagedDiff,
  fallbackPlan,
  provider,
  model,
  timeoutMs,
}) {
  const repoContext = collectRepoContext(repoRoot, stagedFiles, { stagedDiff });
  const prompt = buildPrompt({
    provider,
    mode: "analysis",
    stagedFiles,
    stagedDiff,
    repoContext,
  });
  const response = await runLlmPlan(prompt, { provider, model, timeoutMs });

  return {
    repoContext,
    provider: response.provider,
    plan: normalizeCommitPlan(response.data, fallbackPlan),
  };
}

async function finalizeCommitWithLlm({
  repoRoot,
  stagedFiles,
  stagedDiff,
  fallbackPlan,
  answers,
  provider,
  model,
  timeoutMs,
}) {
  const repoContext = collectRepoContext(repoRoot, stagedFiles, { stagedDiff });
  const prompt = buildPrompt({
    provider,
    mode: "final",
    stagedFiles,
    stagedDiff,
    repoContext,
    answers,
  });
  const response = await runLlmPlan(prompt, { provider, model, timeoutMs });

  return {
    repoContext,
    provider: response.provider,
    plan: normalizeCommitPlan(response.data, fallbackPlan),
  };
}

module.exports = {
  analyzeCommitWithLlm,
  buildPrompt,
  finalizeCommitWithLlm,
  getAvailableProviders,
  getPromptContract,
  getProviderProfile,
  resolveProvider,
};
