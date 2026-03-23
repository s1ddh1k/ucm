const DEFAULT_PROVIDER = "codex";

const BASE_CONTRACT = [
  "Return a single JSON object and nothing else.",
  "The `subject` must not include `type(scope):` and must stay under 58 characters.",
  "Keep `whyBullets` to at most 3 items, `changeBullets` to at most 4 items, `verificationBullets` to at most 3 items, `notesBullets` to at most 2 items, and `refs` to at most 4 items.",
  "Do not repeat the same fact across `Why`, `Changes`, and `Notes`.",
  "If verification is unknown, ask a verification question instead of inventing a command.",
  "Use repo-relative paths in `refs` when you cite files.",
];

const PROVIDER_PROFILES = {
  codex: {
    provider: "codex",
    voice: "implementation-first, terse, concrete",
    analysisInstructions: [
      "Favor changed symbol names and concrete implementation details over generic summaries.",
      "When code changed, explain the behavioral or data-shape impact directly.",
      "Prefer exact function or module names in `changeBullets` when available.",
    ],
    finalInstructions: [
      "Fold user answers directly into `whyBullets`, `verificationBullets`, or `notesBullets` without repeating the question.",
      "Prefer one strong `Why` over multiple vague bullets.",
    ],
  },
  claude: {
    provider: "claude",
    voice: "concise, complete, rationale-aware",
    analysisInstructions: [
      "Use repo docs and ADR context before asking rationale questions.",
      "Surface architectural consequences when they are visible in the staged change.",
      "Prefer compact but complete bullets instead of telegraphic fragments.",
    ],
    finalInstructions: [
      "Use `Notes` only for material nuance that does not belong in `Why` or `Verification`.",
      "If the staged change is clearly a draft or scaffold, say so plainly in one note.",
    ],
  },
  gemini: {
    provider: "gemini",
    voice: "short, direct, non-redundant",
    analysisInstructions: [
      "Prefer shorter bullets and avoid repeating the subject in `Why`.",
      "Ask direct Korean questions that are easy to answer in one sentence.",
      "If the change is small, keep the plan minimal instead of padding it.",
    ],
    finalInstructions: [
      "Keep `Notes` sparse and avoid paraphrasing code that is already obvious from `Changes`.",
      "Prefer the shortest accurate subject that still conveys the changed symbol or area.",
    ],
  },
};

function getProviderProfile(provider = DEFAULT_PROVIDER) {
  return PROVIDER_PROFILES[provider] || PROVIDER_PROFILES[DEFAULT_PROVIDER];
}

function getPromptContract(provider) {
  const profile = getProviderProfile(provider);
  return {
    provider: profile.provider,
    voice: profile.voice,
    baseRules: [...BASE_CONTRACT],
    analysisInstructions: [...profile.analysisInstructions],
    finalInstructions: [...profile.finalInstructions],
  };
}

module.exports = {
  DEFAULT_PROVIDER,
  getPromptContract,
  getProviderProfile,
  PROVIDER_PROFILES,
};
