const { spawnLlm, extractJson } = require("../core/llm");
const { resolveProvider } = require("./provider");

const TIMEOUT_MS = 120_000;
const MAX_RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_BASE_DELAY_MS = 5000;
const _RATE_LIMIT_RE = /rate.limit|429|quota|overloaded/i;

function buildLlmCallOptions({ provider, model, timeoutMs = TIMEOUT_MS } = {}) {
  const resolvedProvider = resolveProvider(provider);
  return {
    provider: resolvedProvider,
    model,
    timeoutMs,
    outputFormat: resolvedProvider === "codex" ? "text" : "stream-json",
    skipPermissions: false,
  };
}

async function callLlm(prompt, opts = {}) {
  const callOptions = buildLlmCallOptions(opts);
  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
    const result = await spawnLlm(prompt, {
      model: callOptions.model,
      provider: callOptions.provider,
      timeoutMs: callOptions.timeoutMs,
      outputFormat: callOptions.outputFormat,
      skipPermissions: callOptions.skipPermissions,
    });
    if (result.status === "rate_limited") {
      if (attempt < MAX_RATE_LIMIT_RETRIES) {
        const delay = RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw new Error("RATE_LIMITED");
    }
    if (result.status === "timeout") throw new Error("LLM timeout");
    if (result.status !== "done")
      throw new Error(
        `LLM exited with code ${result.exitCode}: ${result.stderr?.slice(0, 200)}`,
      );
    return result.stdout;
  }
}

async function callLlmJson(prompt, opts) {
  const text = await callLlm(prompt, opts);
  return extractJson(text);
}

module.exports = { callLlm, callLlmJson, extractJson, buildLlmCallOptions };
