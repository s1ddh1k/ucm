const { spawnLlm, extractJson } = require("../llm-spawn");
const { resolveProvider } = require("./provider");

const TIMEOUT_MS = 120_000;

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
  const result = await spawnLlm(prompt, {
    model: callOptions.model,
    provider: callOptions.provider,
    timeoutMs: callOptions.timeoutMs,
    outputFormat: callOptions.outputFormat,
    skipPermissions: callOptions.skipPermissions,
  });
  if (result.status === "timeout") throw new Error("LLM timeout");
  if (result.status !== "done") throw new Error(`LLM exited with code ${result.exitCode}: ${result.stderr?.slice(0, 200)}`);
  return result.stdout;
}

async function callLlmJson(prompt, opts) {
  const text = await callLlm(prompt, opts);
  return extractJson(text);
}

module.exports = { callLlm, callLlmJson, extractJson, buildLlmCallOptions };
