const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPrompt, getProviderProfile } = require("../src/llm-analysis");

test("returns provider-specific profiles", () => {
  const codex = getProviderProfile("codex");
  const claude = getProviderProfile("claude");
  const gemini = getProviderProfile("gemini");

  assert.equal(codex.provider, "codex");
  assert.equal(claude.provider, "claude");
  assert.equal(gemini.provider, "gemini");
  assert.notEqual(codex.voice, claude.voice);
});

test("builds prompts with provider contract and context sections", () => {
  const prompt = buildPrompt({
    provider: "gemini",
    mode: "analysis",
    stagedFiles: ["src/cart.js"],
    stagedDiff: "+const prices = items.map(Number)\n",
    repoContext: {
      diffStat: " src/cart.js | 2 +-\n",
      docs: [{ path: "README.md", content: "Cart utilities." }],
      symbols: [
        {
          path: "src/cart.js",
          symbols: [
            {
              name: "computeTotal",
              kind: "function",
              start: 1,
              end: 4,
              snippet: "1 | export function computeTotal(items) {",
            },
          ],
        },
      ],
      relatedReferences: [
        {
          symbol: "computeTotal",
          path: "test/cart.test.js",
          kind: "test",
          start: 1,
          end: 4,
          snippet: "1 | import { computeTotal } from \"../src/cart.js\";",
        },
      ],
      snippets: [],
      recentCommits: "abc123 feat: seed cart",
    },
    answers: {},
  });

  assert.match(prompt, /Provider profile: gemini/);
  assert.match(prompt, /Response contract:/);
  assert.match(prompt, /Provider-specific analysis instructions:/);
  assert.match(prompt, /Focused changed symbols:/);
  assert.match(prompt, /Related symbol references:/);
});
