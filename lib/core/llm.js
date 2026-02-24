const { spawn } = require("child_process");
const { RATE_LIMIT_RE } = require("./constants");

const REASONING_EFFORTS = new Set(["minimal", "low", "medium", "high", "xhigh"]);
const MAX_RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_BASE_DELAY_MS = 5000;

function normalizeCodexModel(model) {
  if (typeof model !== "string") return model;
  const normalized = model.trim().toLowerCase();
  if (!normalized) return null;
  if (REASONING_EFFORTS.has(normalized)) return normalized;
  if (normalized.includes("haiku")) return "low";
  if (normalized.includes("sonnet")) return "medium";
  if (normalized.includes("opus")) return "high";
  return model;
}

const GEMINI_NATIVE_MODELS = new Set(["auto", "pro", "flash", "flash-lite"]);

function normalizeGeminiModel(model) {
  if (typeof model !== "string") return model;
  const normalized = model.trim().toLowerCase();
  if (!normalized) return null;
  // Gemini-native names and full model IDs pass through
  if (GEMINI_NATIVE_MODELS.has(normalized) || normalized.startsWith("gemini-")) return normalized;
  // Map Claude shorthand to Gemini equivalents (capability tiers)
  if (normalized.includes("haiku")) return "flash";
  if (normalized.includes("sonnet")) return "flash";
  if (normalized.includes("opus")) return "pro";
  return model;
}

// 자식 프로세스에 전달할 환경변수 화이트리스트
const ENV_ALLOWED_EXACT = new Set([
  "PATH", "HOME", "USER", "SHELL", "LANG", "TERM", "HOSTNAME", "LOGNAME",
  "EDITOR", "VISUAL", "DISPLAY", "TMPDIR", "TMP", "TEMP",
  "GOPATH", "GOROOT", "CARGO_HOME", "RUSTUP_HOME", "JAVA_HOME", "ANDROID_HOME",
  "VIRTUAL_ENV", "ANTHROPIC_API_KEY", "OPENAI_API_KEY",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY",
]);
const ENV_ALLOWED_PREFIXES = [
  "LC_", "NODE_", "NPM_", "NVM_", "GIT_", "XDG_", "SSH_", "GPG_",
  "UCM_", "CONDA_", "PYENV_", "DBUS_", "GEMINI_", "GOOGLE_",
];

function sanitizeEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (ENV_ALLOWED_EXACT.has(key) || ENV_ALLOWED_PREFIXES.some((p) => key.startsWith(p))) {
      env[key] = value;
    }
  }
  return env;
}

function killPidTree(pid) {
  if (!pid || pid <= 0) return;
  try { process.kill(-pid, "SIGTERM"); } catch (e) { if (e.code !== "ESRCH") console.error(`[killPidTree] SIGTERM pgid ${pid}: ${e.code || e.message}`); }
  try { process.kill(pid, "SIGTERM"); } catch (e) { if (e.code !== "ESRCH") console.error(`[killPidTree] SIGTERM pid ${pid}: ${e.code || e.message}`); }
  const fallback = setTimeout(() => {
    try { process.kill(pid, 0); } catch { return; }
    try { process.kill(-pid, "SIGKILL"); } catch (e) { if (e.code !== "ESRCH") console.error(`[killPidTree] SIGKILL pgid ${pid}: ${e.code || e.message}`); }
    try { process.kill(pid, "SIGKILL"); } catch (e) { if (e.code !== "ESRCH") console.error(`[killPidTree] SIGKILL pid ${pid}: ${e.code || e.message}`); }
  }, 1200);
  fallback.unref();
}

// Provider registry: 새 provider 추가 시 여기에 등록
const PROVIDERS = {
  claude: {
    buildArgs({ model, outputFormat, allowTools, skipPermissions, sessionPersistence, cwd }) {
      const args = ["-p"];
      if (skipPermissions) args.push("--dangerously-skip-permissions");
      if (!sessionPersistence) args.push("--no-session-persistence");
      const fmt = outputFormat || "text";
      args.push("--output-format", fmt);
      if (fmt === "stream-json") args.push("--verbose");
      if (model) args.push("--model", model);
      if (allowTools !== undefined) args.push("--allowedTools", allowTools);
      return { cmd: "claude", args, cwd };
    },
  },
  codex: {
    buildArgs({ model, cwd, outputFormat, configOverrides }) {
      const args = ["exec", "--ephemeral", "--dangerously-bypass-approvals-and-sandbox"];
      const fmt = outputFormat || "text";
      if (fmt === "json" || fmt === "stream-json") {
        args.push("--json");
      }
      const normalizedModel = normalizeCodexModel(model);
      const overrides = Array.isArray(configOverrides) ? configOverrides : [];
      for (const override of overrides) {
        if (typeof override === "string" && override.trim()) {
          args.push("-c", override.trim());
        }
      }
      if (normalizedModel && REASONING_EFFORTS.has(normalizedModel)) {
        args.push("-c", `model_reasoning_effort=${normalizedModel}`);
      } else if (normalizedModel) {
        args.push("--model", normalizedModel);
      }
      if (cwd) args.push("--cd", cwd);
      args.push("-");
      return { cmd: "codex", args, cwd };
    },
  },
  gemini: {
    buildArgs({ model, outputFormat, cwd, skipPermissions }) {
      // gemini CLI: stdin 파이프 시 non-TTY 감지 → headless 모드 자동 진입
      // -p 불필요 (stdin으로 프롬프트 전달)
      const args = [];
      if (skipPermissions) args.push("-y");
      const fmt = outputFormat || "text";
      args.push("--output-format", fmt);
      const normalizedModel = normalizeGeminiModel(model);
      if (normalizedModel) args.push("--model", normalizedModel);
      return { cmd: "gemini", args, cwd };
    },
  },
};

function buildCommand(opts) {
  const provider = PROVIDERS[opts.provider || "claude"];
  if (!provider) throw new Error(`unknown provider: ${opts.provider}`);
  return provider.buildArgs(opts);
}

function spawnLlm(prompt, {
  provider = process.env.UCM_PROVIDER || "claude",
  model,
  cwd,
  configOverrides,
  outputFormat = "text",
  allowTools,
  skipPermissions = true,
  sessionPersistence = false,
  timeoutMs,
  idleTimeoutMs,
  hardTimeoutMs,
  extraEnv,
  onData,
  onStderr,
  onSpawn,
} = {}) {
  return new Promise((resolve) => {
    const { cmd, args, cwd: spawnCwd } = buildCommand({
      provider, model, configOverrides, outputFormat, allowTools, skipPermissions, sessionPersistence, cwd,
    });
    const env = { ...sanitizeEnv(), ...extraEnv };
    const child = spawn(cmd, args, {
      cwd: spawnCwd || cwd || undefined,
      stdio: ["pipe", "pipe", "pipe"],
      env,
      detached: true,
    });
    if (onSpawn) onSpawn(child);

    const startTime = Date.now();
    let stdout = "";
    let stderr = "";
    let timeoutKind = null;
    let killed = false;

    let stdoutBuf = "";
    let resultText = "";
    let tokenUsage = { input: 0, output: 0 };

    let singleTimer = null;
    let idleTimer = null;
    let hardTimer = null;

    function killChild(kind) {
      if (killed) return;
      killed = true;
      timeoutKind = kind;
      killPidTree(child.pid);
    }

    if (timeoutMs) {
      singleTimer = setTimeout(() => killChild("single"), timeoutMs);
    }
    if (idleTimeoutMs) {
      idleTimer = setTimeout(() => killChild("idle"), idleTimeoutMs);
    }
    if (hardTimeoutMs) {
      hardTimer = setTimeout(() => killChild("hard"), hardTimeoutMs);
    }

    function clearTimers() {
      if (singleTimer) clearTimeout(singleTimer);
      if (idleTimer) clearTimeout(idleTimer);
      if (hardTimer) clearTimeout(hardTimer);
    }

    function resetIdleTimer() {
      if (idleTimeoutMs && idleTimer && !killed) {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => killChild("idle"), idleTimeoutMs);
      }
    }

    child.stdout.on("data", (d) => {
      const chunk = d.toString();
      stdout += chunk;
      resetIdleTimer();
      if (onData) onData(chunk);

      if (outputFormat === "stream-json") {
        stdoutBuf += chunk;
        let idx;
        while ((idx = stdoutBuf.indexOf("\n")) !== -1) {
          const line = stdoutBuf.slice(0, idx).trim();
          stdoutBuf = stdoutBuf.slice(idx + 1);
          if (!line) continue;
          try {
            const event = JSON.parse(line);
            if (event.type === "assistant" && event.message?.content) {
              for (const block of event.message.content) {
                if (block.type === "text" && block.text) {
                  resultText += block.text;
                }
              }
            } else if (event.type === "result") {
              resultText = event.result || resultText;
              if (event.usage) {
                tokenUsage.input += event.usage.input_tokens || 0;
                tokenUsage.output += event.usage.output_tokens || 0;
              }
            }
          } catch {}
        }
      }
    });

    child.stderr.on("data", (d) => {
      const chunk = d.toString();
      stderr += chunk;
      if (onStderr) onStderr(chunk);
    });

    child.stdin.on("error", (e) => { if (e.code !== "EPIPE" && e.code !== "ERR_STREAM_DESTROYED") console.error(`[llm] stdin error: ${e.code || e.message}`); });
    child.stdout.on("error", (e) => { if (e.code !== "ERR_STREAM_DESTROYED") console.error(`[llm] stdout error: ${e.code || e.message}`); });
    child.stderr.on("error", (e) => { if (e.code !== "ERR_STREAM_DESTROYED") console.error(`[llm] stderr error: ${e.code || e.message}`); });
    child.stdin.end(prompt);

    child.on("close", (code) => {
      clearTimers();
      const durationMs = Date.now() - startTime;
      const output = outputFormat === "stream-json" ? resultText : stdout;

      if (killed) {
        return resolve({ status: "timeout", stdout: output, stderr, exitCode: code, timeoutKind, durationMs, tokenUsage });
      }
      if (code === 0) {
        return resolve({ status: "done", stdout: output, stderr, exitCode: 0, timeoutKind: null, durationMs, tokenUsage });
      }
      if (RATE_LIMIT_RE.test(stderr)) {
        return resolve({ status: "rate_limited", stdout: output, stderr, exitCode: code, timeoutKind: null, durationMs, tokenUsage });
      }
      resolve({ status: "failed", stdout: output, stderr, exitCode: code, timeoutKind: null, durationMs, tokenUsage });
    });

    child.on("error", (e) => {
      clearTimers();
      const durationMs = Date.now() - startTime;
      resolve({ status: "failed", stdout: "", stderr: e.message, exitCode: -1, timeoutKind: null, durationMs });
    });
  });
}

async function llmText(prompt, opts) {
  const provider = opts?.provider || process.env.UCM_PROVIDER || "claude";
  const outputFormat = provider === "codex" ? "text" : "stream-json";
  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
    const result = await spawnLlm(prompt, { ...opts, provider, outputFormat });
    if (result.status === "rate_limited") {
      if (attempt < MAX_RATE_LIMIT_RETRIES) {
        const delay = RATE_LIMIT_BASE_DELAY_MS * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw new Error("RATE_LIMITED");
    }
    if (result.status !== "done") throw new Error(`LLM ${result.status}: ${result.stderr?.slice(0, 200)}`);
    return { text: result.stdout.trim(), tokenUsage: result.tokenUsage };
  }
}

async function llmJson(prompt, opts) {
  const { text, tokenUsage } = await llmText(prompt, opts);
  return { data: extractJson(text), tokenUsage };
}

function extractJson(text) {
  const codeBlock = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (codeBlock) {
    try { return JSON.parse(codeBlock[1]); } catch {}
  }
  const trimmed = text.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try { return JSON.parse(trimmed); } catch {}
  }
  const arrayStart = text.indexOf("[");
  const arrayEnd = text.lastIndexOf("]");
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    try { return JSON.parse(text.slice(arrayStart, arrayEnd + 1)); } catch {}
  }
  const objStart = text.indexOf("{");
  const objEnd = text.lastIndexOf("}");
  if (objStart !== -1 && objEnd > objStart) {
    try { return JSON.parse(text.slice(objStart, objEnd + 1)); } catch {}
  }
  const preview = text.length > 300 ? text.slice(0, 300) + "..." : text;
  throw new Error(`Failed to extract JSON from LLM response: ${preview}`);
}

module.exports = {
  buildCommand,
  spawnLlm,
  llmText,
  llmJson,
  extractJson,
  killPidTree,
  sanitizeEnv,
  REASONING_EFFORTS,
};
