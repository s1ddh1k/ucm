// lib/core/browser-agent.js — Multi-provider + Chrome DevTools MCP 브라우저 에이전트
// AI에게 브라우저 조작을 자연어로 위임하는 프로시저.
// UCM 파이프라인 어디서든 호출 가능.
//
// 사용 예:
//   const { browserAgent } = require("./browser-agent");
//
//   // 단일 지시
//   const result = await browserAgent("http://localhost:3000", "모든 탭을 클릭하면서 깨진 레이아웃이 없는지 확인해줘");
//
//   // 배치 (단일 spawn으로 여러 검증)
//   const results = await browserAgentBatch("http://localhost:3000", [
//     { id: "nav", instruction: "탭 전환이 제대로 되는지 확인" },
//     { id: "form", instruction: "태스크 생성 모달이 열리는지 확인" },
//   ]);
//
//   // 커스텀 시스템 프롬프트
//   const result = await browserAgent(url, instruction, {
//     systemPrompt: "You are a visual QA agent...",
//     hardTimeoutMs: 60000,
//   });

const { execFileSync, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnLlm, extractJson } = require("./llm");

const BROWSER_AGENT_PROVIDERS = new Set(["claude", "codex", "gemini"]);

const DEFAULT_SYSTEM_PROMPT = `You are a browser automation agent.
You have Chrome DevTools MCP tools to control a headless browser.

## Available MCP Tools
- navigate_page: go to a URL
- take_snapshot: get accessibility tree with element uids
- click: click element by uid
- fill: type into input by uid
- evaluate_script: run JS in the page
- take_screenshot: capture current page
- press_key: keyboard input
- wait_for: wait for a condition
- hover: hover over an element
- select_page: switch between browser tabs

## Guidelines
- Use take_snapshot to find element uids before clicking
- Use evaluate_script for DOM state checks and CSS inspection
- Take screenshots for visual evidence
- Be thorough but efficient`;

function normalizeProvider(provider) {
  const selected = String(provider || process.env.UCM_BROWSER_AGENT_PROVIDER || process.env.LLM_PROVIDER || "codex").toLowerCase();
  if (!BROWSER_AGENT_PROVIDERS.has(selected)) {
    throw new Error(`unsupported browser agent provider: ${selected} (supported: claude, codex, gemini)`);
  }
  return selected;
}

function providerCommand(provider) {
  if (provider === "claude") return "claude";
  if (provider === "codex") return "codex";
  return "gemini";
}

function ensureProviderCli(provider) {
  const cmd = providerCommand(provider);
  try {
    execFileSync(cmd, ["--version"], { stdio: "pipe", timeout: 5000 });
  } catch {
    if (provider === "gemini") {
      throw new Error("gemini CLI not found. Install: npm i -g @google/gemini-cli");
    }
    throw new Error(`${provider} CLI not found`);
  }
}

function mcpServerConfig() {
  return {
    mcpServers: {
      "chrome-devtools": {
        command: "npx",
        args: ["chrome-devtools-mcp", "--headless", "--isolated"],
      },
    },
  };
}

function codexMcpOverrides() {
  return [
    'mcp_servers.chrome-devtools.command="npx"',
    'mcp_servers.chrome-devtools.args=["chrome-devtools-mcp","--headless","--isolated"]',
  ];
}

function createWorkDir(provider, systemPrompt) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "ucm-browser-agent-"));
  const mcpConfig = mcpServerConfig();
  fs.writeFileSync(path.join(workDir, ".mcp.json"), JSON.stringify(mcpConfig, null, 2));

  if (provider === "gemini") {
    const geminiDir = path.join(workDir, ".gemini");
    fs.mkdirSync(geminiDir, { recursive: true });
    fs.writeFileSync(path.join(geminiDir, "settings.json"), JSON.stringify(mcpConfig, null, 2));
    fs.writeFileSync(path.join(workDir, "GEMINI.md"), systemPrompt);
  } else if (provider === "claude") {
    const claudeDir = path.join(workDir, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, "settings.json"), JSON.stringify({
      enableAllProjectMcpServers: true,
    }, null, 2));
    fs.writeFileSync(path.join(workDir, "CLAUDE.md"), systemPrompt);
  } else if (provider === "codex") {
    fs.writeFileSync(path.join(workDir, "AGENTS.md"), systemPrompt);
  }

  return workDir;
}

function cleanupWorkDir(workDir) {
  try {
    execSync("pkill -f chrome-devtools-mcp 2>/dev/null || true", { stdio: "ignore", timeout: 3000 });
  } catch (e) { if (e.code !== "ESRCH" && !e.killed) console.error(`[browser-agent] pkill chrome-devtools-mcp: ${e.code || e.message}`); }
  try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (e) { if (e.code !== "ENOENT") console.error(`[browser-agent] rmSync ${workDir}: ${e.code || e.message}`); }
}

function parseProviderResponse(text) {
  try {
    const outer = JSON.parse(text);
    if (outer.error) return { text: JSON.stringify(outer.error), json: null };
    const response = outer.response || text;
    // JSON 추출 시도
    try {
      return { text: response, json: extractJson(response) };
    } catch {
      return { text: response, json: null };
    }
  } catch {
    try {
      return { text, json: extractJson(text) };
    } catch {
      return { text, json: null };
    }
  }
}

/**
 * 단일 브라우저 지시 실행
 * @param {string} url - 대상 URL
 * @param {string} instruction - 자연어 지시
 * @param {object} opts
 * @param {string} opts.systemPrompt - 커스텀 시스템 프롬프트
 * @param {number} opts.hardTimeoutMs - 타임아웃 (기본 120초)
 * @param {string} opts.responseFormat - "text" | "json" (기본 "text")
 * @param {function} opts.onLog - 로그 콜백
 * @returns {{ status, text, json, durationMs }}
 */
async function browserAgent(url, instruction, opts = {}) {
  const {
    provider: requestedProvider,
    model,
    systemPrompt = DEFAULT_SYSTEM_PROMPT,
    hardTimeoutMs = 120_000,
    responseFormat = "text",
    onLog,
  } = opts;

  const provider = normalizeProvider(requestedProvider);
  ensureProviderCli(provider);
  const workDir = createWorkDir(provider, systemPrompt);

  try {
    const jsonSuffix = responseFormat === "json"
      ? "\n\nRespond with JSON only (no markdown fences)."
      : "";

    const prompt = `System Instructions:
${systemPrompt}

Target URL: ${url}

${instruction}${jsonSuffix}`;

    if (onLog) onLog(`[browser-agent] spawning ${provider}...`);

    const outputFormat = provider === "codex" ? "text" : "json";
    const configOverrides = provider === "codex" ? codexMcpOverrides() : undefined;

    const result = await spawnLlm(prompt, {
      provider,
      model,
      cwd: workDir,
      configOverrides,
      outputFormat,
      skipPermissions: true,
      hardTimeoutMs,
      extraEnv: provider === "gemini" ? { GEMINI_CLI_NO_RELAUNCH: "true" } : undefined,
      onStderr: onLog ? (chunk) => onLog(`[browser-agent:stderr] ${chunk.trim()}`) : undefined,
    });

    if (result.status !== "done") {
      return {
        status: result.status,
        text: `${provider} ${result.status}: ${(result.stderr || "").slice(0, 300)}`,
        json: null,
        durationMs: result.durationMs,
      };
    }

    const parsed = parseProviderResponse(result.stdout);
    return {
      status: "done",
      text: parsed.text,
      json: parsed.json,
      durationMs: result.durationMs,
    };
  } finally {
    cleanupWorkDir(workDir);
  }
}

/**
 * 배치 브라우저 지시 실행 (단일 provider spawn)
 * @param {string} url - 대상 URL
 * @param {Array<{id: string, instruction: string}>} tasks - 지시 목록
 * @param {object} opts
 * @param {string} opts.systemPrompt
 * @param {number} opts.perTaskTimeoutMs - 태스크당 타임아웃 (기본 30초)
 * @param {function} opts.onLog
 * @returns {Array<{id, pass, evidence}>}
 */
async function browserAgentBatch(url, tasks, opts = {}) {
  const {
    provider: requestedProvider,
    model,
    systemPrompt = DEFAULT_SYSTEM_PROMPT,
    perTaskTimeoutMs = 30_000,
    startupTimeoutBufferMs,
    onLog,
  } = opts;

  const provider = normalizeProvider(requestedProvider);
  ensureProviderCli(provider);
  const workDir = createWorkDir(provider, systemPrompt);

  try {
    const taskList = tasks.map((t, i) =>
      `### Task ${i + 1}: ${t.id}\n${t.instruction.trim()}`
    ).join("\n\n");

    const prompt = `System Instructions:
${systemPrompt}

Target URL: ${url}

You have ${tasks.length} tasks to execute sequentially.
The browser stays open between tasks.

${taskList}

After ALL tasks, respond with a JSON array (no markdown fences):
[{"id":"...","pass":true,"evidence":"what you observed"}, ...]`;

    const startupBufferMs = Number.isFinite(startupTimeoutBufferMs)
      ? startupTimeoutBufferMs
      : (provider === "codex" ? 90_000 : 20_000);
    const hardTimeoutMs = tasks.length * perTaskTimeoutMs + startupBufferMs;

    if (onLog) onLog(`[browser-agent] batch: ${tasks.length} tasks, timeout ${hardTimeoutMs}ms`);

    const outputFormat = provider === "codex" ? "text" : "json";
    const configOverrides = provider === "codex" ? codexMcpOverrides() : undefined;

    const result = await spawnLlm(prompt, {
      provider,
      model,
      cwd: workDir,
      configOverrides,
      outputFormat,
      skipPermissions: true,
      hardTimeoutMs,
      extraEnv: provider === "gemini" ? { GEMINI_CLI_NO_RELAUNCH: "true" } : undefined,
      onStderr: onLog ? (chunk) => onLog(`[browser-agent:stderr] ${chunk.trim()}`) : undefined,
    });

    if (result.status !== "done") {
      return tasks.map((t) => ({
        id: t.id,
        pass: false,
        evidence: `${provider} ${result.status}: ${(result.stderr || "").slice(0, 200)}`,
      }));
    }

    const parsed = parseProviderResponse(result.stdout);
    if (parsed.json && Array.isArray(parsed.json)) {
      return tasks.map((t, i) => {
        const r = parsed.json.find((x) => x.id === t.id) || parsed.json[i];
        if (!r) return { id: t.id, pass: false, evidence: "no result returned" };
        return { id: t.id, pass: !!r.pass, evidence: r.evidence || "" };
      });
    }

    return tasks.map((t) => ({
      id: t.id,
      pass: false,
      evidence: `Failed to parse batch result: ${(parsed.text || "").slice(0, 200)}`,
    }));
  } finally {
    cleanupWorkDir(workDir);
  }
}

module.exports = { browserAgent, browserAgentBatch, DEFAULT_SYSTEM_PROMPT };
