const PROVIDERS = ["claude", "codex"];

const DEFAULT_MODELS = {
  claude: {
    retrieval: "claude-haiku-4-5-20251001",
    extraction: "claude-sonnet-4-6",
    dedup: "claude-haiku-4-5-20251001",
    consolidation: "claude-sonnet-4-6",
    expansion: "claude-haiku-4-5-20251001",
  },
  codex: {
    retrieval: "low",
    extraction: "medium",
    dedup: "low",
    consolidation: "high",
    expansion: "low",
  },
};

const CLAUDE_MODEL_RE = /^claude-[a-z0-9-]+$/i;
const CODEX_MODEL_RE = /^[a-z0-9][a-z0-9._-]{0,79}$/i;

function normalizeProvider(value) {
  const normalized = String(value || "").toLowerCase();
  return PROVIDERS.includes(normalized) ? normalized : null;
}

function resolveProvider(value) {
  return (
    normalizeProvider(value) ||
    normalizeProvider(process.env.HIVEMIND_LLM_PROVIDER) ||
    normalizeProvider(process.env.LLM_PROVIDER) ||
    "claude"
  );
}

function getDefaultModels(provider) {
  const resolved = resolveProvider(provider);
  return { ...DEFAULT_MODELS[resolved] };
}

function isModelCompatible(provider, model) {
  if (typeof model !== "string" || model.trim() === "") return false;
  const resolved = resolveProvider(provider);

  if (resolved === "claude") {
    return CLAUDE_MODEL_RE.test(model);
  }

  if (/^claude-/i.test(model)) return false;
  return CODEX_MODEL_RE.test(model);
}

function normalizeModelsForProvider(models, provider) {
  const defaults = getDefaultModels(provider);
  const next = { ...defaults, ...(models || {}) };
  const replaced = [];

  for (const slot of Object.keys(defaults)) {
    if (!isModelCompatible(provider, next[slot])) {
      next[slot] = defaults[slot];
      replaced.push(slot);
    }
  }

  return { models: next, replaced };
}

module.exports = {
  PROVIDERS,
  DEFAULT_MODELS,
  normalizeProvider,
  resolveProvider,
  getDefaultModels,
  isModelCompatible,
  normalizeModelsForProvider,
};
