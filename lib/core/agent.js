const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { buildCommand, killPidTree, sanitizeEnv } = require("./llm");
const { RATE_LIMIT_RE, LOGS_DIR } = require("./constants");
const { sanitizeContent } = require("./worktree");

function spawnAgent(prompt, {
  cwd,
  provider = process.env.UCM_PROVIDER || "claude",
  model,
  idleTimeoutMs,
  hardTimeoutMs,
  taskId,
  stage,
  logDir,
  onLog,
  onToolUse,
  onChild,
}) {
  return new Promise((resolve) => {
    const outputFormat = provider === "codex" ? "json" : "stream-json";
    const { cmd, args, cwd: spawnCwd } = buildCommand({
      provider, model, cwd, outputFormat,
      skipPermissions: true,
      sessionPersistence: false,
    });
    const effectiveCwd = spawnCwd || cwd;
    const child = spawn(cmd, args, {
      cwd: effectiveCwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: sanitizeEnv(),
      detached: true,
    });
    if (onChild) onChild(child);

    const startTime = Date.now();
    const MAX_OUTPUT_BYTES = 50 * 1024 * 1024; // 50MB
    let stdout = "";
    let stderr = "";
    let killed = false;
    let timeoutKind = null;

    const effectiveLogDir = logDir || LOGS_DIR;
    const taskLogPath = path.join(effectiveLogDir, `${taskId}.log`);

    // stage별 개별 로그 파일
    const stageLogDir = path.join(effectiveLogDir, taskId);
    const stageLogPath = path.join(stageLogDir, `${stage}.log`);

    let taskLogStream;
    let stageLogStream;
    try {
      fs.mkdirSync(effectiveLogDir, { recursive: true });
      taskLogStream = fs.createWriteStream(taskLogPath, { flags: "a" });
      taskLogStream.on("error", () => {
        try { taskLogStream.end(); } catch {}
        taskLogStream = null;
      });
    } catch {
      taskLogStream = null;
    }
    try {
      fs.mkdirSync(stageLogDir, { recursive: true });
      stageLogStream = fs.createWriteStream(stageLogPath, { flags: "a" });
      stageLogStream.on("error", () => {
        try { stageLogStream.end(); } catch {}
        stageLogStream = null;
      });
    } catch {
      stageLogStream = null;
    }

    function writeLog(line) {
      if (taskLogStream) taskLogStream.write(line + "\n");
      if (stageLogStream) stageLogStream.write(line + "\n");
    }

    const spawnInfoLine = `[agent:spawn] ${JSON.stringify({
      taskId,
      stage,
      provider,
      model: model || null,
      outputFormat,
      cwd: effectiveCwd,
      cmd,
      args,
    })}`;
    writeLog(spawnInfoLine);
    if (onLog) onLog(spawnInfoLine);

    const stageStartLine = `--- ${stage} started at ${new Date().toISOString()} (cwd: ${effectiveCwd}) ---`;
    writeLog(`\n${stageStartLine}`);
    if (onLog) onLog(stageStartLine);

    let idleTimer = null;
    let hardTimer = null;

    let resolved = false;

    function closeStreams() {
      if (taskLogStream) { try { taskLogStream.end(); } catch {} taskLogStream = null; }
      if (stageLogStream) { try { stageLogStream.end(); } catch {} stageLogStream = null; }
    }

    function killChild(kind) {
      if (killed) return;
      killed = true;
      timeoutKind = kind;
      killPidTree(child.pid);

      // safety net: if child doesn't exit within 3s, force resolve
      const safetyTimer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          clearTimers();
          closeStreams();
          resolve({
            status: "timeout",
            stdout: resultText || stdout,
            stderr,
            exitCode: null,
            timeoutKind: kind + "_forced",
            durationMs: Date.now() - startTime,
            tokenUsage,
          });
        }
      }, 3000);
      safetyTimer.unref();
    }

    if (idleTimeoutMs) {
      idleTimer = setTimeout(() => killChild("idle"), idleTimeoutMs);
    }
    if (hardTimeoutMs) {
      hardTimer = setTimeout(() => killChild("hard"), hardTimeoutMs);
    }

    function clearTimers() {
      if (idleTimer) clearTimeout(idleTimer);
      if (hardTimer) clearTimeout(hardTimer);
    }

    function resetIdleTimer() {
      if (idleTimeoutMs && idleTimer && !killed) {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => killChild("idle"), idleTimeoutMs);
      }
    }

    let stdoutBuf = "";
    let textBuf = "";
    let resultText = "";
    let tokenUsage = { input: 0, output: 0 };

    // Loop detection: kill agent if same tool call repeats consecutively
    const MAX_REPEAT_TOOL_CALLS = 3;
    let lastToolSig = "";
    let repeatCount = 0;

    child.stdout.on("data", (d) => {
      const chunk = d.toString();
      stdout += chunk;
      if (stdout.length > MAX_OUTPUT_BYTES) {
        stdout = stdout.slice(-MAX_OUTPUT_BYTES);
      }
      resetIdleTimer();

      if (outputFormat === "stream-json") {
        stdoutBuf += chunk;
        let newlineIdx;
        while ((newlineIdx = stdoutBuf.indexOf("\n")) !== -1) {
          const jsonLine = stdoutBuf.slice(0, newlineIdx).trim();
          stdoutBuf = stdoutBuf.slice(newlineIdx + 1);
          if (!jsonLine) continue;
          try {
            const event = JSON.parse(jsonLine);
            if (event.type === "assistant" && event.message?.content) {
              for (const block of event.message.content) {
                if (block.type === "text" && block.text) {
                  const line = sanitizeContent(block.text.slice(0, 200));
                  writeLog(line);
                  if (onLog) onLog(line);
                } else if (block.type === "tool_use") {
                  const input = block.input || {};
                  let detail = "";
                  if (block.name === "Read") detail = input.file_path || "";
                  else if (block.name === "Write") detail = input.file_path || "";
                  else if (block.name === "Edit") detail = input.file_path || "";
                  else if (block.name === "Glob") detail = input.pattern || "";
                  else if (block.name === "Grep") detail = input.pattern || "";
                  else if (block.name === "Bash") detail = (input.command || "").slice(0, 120);
                  else if (block.name === "Task") detail = input.description || "";
                  else {
                    const first = Object.values(input)[0];
                    if (typeof first === "string") detail = first.slice(0, 80);
                  }
                  const line = sanitizeContent(`[tool] ${block.name}${detail ? " — " + detail : ""}`);
                  writeLog(line);
                  if (onLog) onLog(line);
                  if (onToolUse) onToolUse({ name: block.name, detail });

                  // Loop detection
                  const toolSig = `${block.name}:${JSON.stringify(block.input || {}).slice(0, 500)}`;
                  if (toolSig === lastToolSig) {
                    repeatCount++;
                    if (repeatCount >= MAX_REPEAT_TOOL_CALLS) {
                      const loopMsg = `[loop-detected] ${block.name} repeated ${repeatCount + 1}x — killing agent`;
                      writeLog(loopMsg);
                      if (onLog) onLog(loopMsg);
                      killChild("loop");
                    }
                  } else {
                    lastToolSig = toolSig;
                    repeatCount = 1;
                  }
                }
              }
            } else if (event.type === "result") {
              resultText = event.result || "";
              if (event.usage) {
                tokenUsage.input += event.usage.input_tokens || 0;
                tokenUsage.output += event.usage.output_tokens || 0;
              }
            }
          } catch {}
        }
      } else if (outputFormat === "json") {
        stdoutBuf += chunk;
        let newlineIdx;
        while ((newlineIdx = stdoutBuf.indexOf("\n")) !== -1) {
          const jsonLine = stdoutBuf.slice(0, newlineIdx).trim();
          stdoutBuf = stdoutBuf.slice(newlineIdx + 1);
          if (!jsonLine) continue;
          try {
            const event = JSON.parse(jsonLine);
            if (event.type === "turn.completed" && event.usage) {
              tokenUsage.input += event.usage.input_tokens || 0;
              tokenUsage.output += event.usage.output_tokens || 0;
              continue;
            }

            const item = event.item;
            if (!item) continue;

            if (item.type === "agent_message" && typeof item.text === "string") {
              const lines = item.text.replace(/\r/g, "\n").split("\n");
              for (const raw of lines) {
                const line = sanitizeContent(raw.trimEnd().slice(0, 400));
                if (!line.trim()) continue;
                writeLog(line);
                if (onLog) onLog(line);
              }
              resultText = resultText ? `${resultText}\n${item.text}` : item.text;
              continue;
            }

            if (item.type === "reasoning" && typeof item.text === "string") {
              const line = sanitizeContent(`[thinking] ${item.text.trim().slice(0, 300)}`);
              if (line.trim()) {
                writeLog(line);
                if (onLog) onLog(line);
              }
              continue;
            }

            if (item.type === "command_execution") {
              const command = typeof item.command === "string" ? item.command : "";
              const detail = command.slice(0, 120);
              if (event.type === "item.started" || event.type === "item.completed") {
                const line = sanitizeContent(`[tool] Bash${detail ? " — " + detail : ""}`);
                writeLog(line);
                if (onLog) onLog(line);
                if (onToolUse) onToolUse({ name: "Bash", detail });
              }

              if (event.type === "item.completed" && typeof item.aggregated_output === "string") {
                const outLines = item.aggregated_output.replace(/\r/g, "\n").split("\n");
                for (const raw of outLines.slice(0, 20)) {
                  const outLine = sanitizeContent(raw.trimEnd().slice(0, 400));
                  if (!outLine.trim()) continue;
                  writeLog(outLine);
                  if (onLog) onLog(outLine);
                }
              }
            }
          } catch {}
        }
      } else {
        textBuf += chunk.replace(/\r/g, "\n");
        let newlineIdx;
        while ((newlineIdx = textBuf.indexOf("\n")) !== -1) {
          const rawLine = textBuf.slice(0, newlineIdx);
          textBuf = textBuf.slice(newlineIdx + 1);
          const line = sanitizeContent(rawLine.trimEnd().slice(0, 400));
          if (!line.trim()) continue;
          writeLog(line);
          if (onLog) onLog(line);
        }
      }
    });

    child.stderr.on("data", (d) => {
      stderr += d.toString();
      if (stderr.length > MAX_OUTPUT_BYTES) {
        stderr = stderr.slice(-MAX_OUTPUT_BYTES);
      }
    });

    child.stdin.on("error", () => {});
    child.stdout.on("error", () => {});
    child.stderr.on("error", () => {});
    child.stdin.end(prompt);

    child.on("close", (code) => {
      if (resolved) return;
      resolved = true;
      clearTimers();
      const durationMs = Date.now() - startTime;
      if (outputFormat === "text") {
        const tailLine = sanitizeContent(textBuf.trim().slice(0, 400));
        if (tailLine) {
          writeLog(tailLine);
          if (onLog) onLog(tailLine);
        }
      }
      const stageEndLine = `--- ${stage} ended (code=${code}, ${durationMs}ms) ---`;
      writeLog(`\n${stageEndLine}`);
      closeStreams();
      if (onLog) onLog(stageEndLine);

      const output = resultText || stdout;
      if (killed) return resolve({ status: "timeout", stdout: output, stderr, exitCode: code, timeoutKind, durationMs, tokenUsage });
      if (code === 0) return resolve({ status: "done", stdout: output, stderr, exitCode: 0, timeoutKind: null, durationMs, tokenUsage });
      if (RATE_LIMIT_RE.test(stderr)) return resolve({ status: "rate_limited", stdout: output, stderr, exitCode: code, timeoutKind: null, durationMs, tokenUsage });
      resolve({ status: "failed", stdout: output, stderr, exitCode: code, timeoutKind: null, durationMs, tokenUsage });
    });

    child.on("error", (e) => {
      if (resolved) return;
      resolved = true;
      clearTimers();
      const durationMs = Date.now() - startTime;
      const spawnErrorLine = `--- ${stage} spawn error: ${e.message} ---`;
      writeLog(`\n${spawnErrorLine}`);
      closeStreams();
      if (onLog) onLog(spawnErrorLine);
      resolve({ status: "failed", stdout, stderr: e.message, exitCode: -1, timeoutKind: null, durationMs, tokenUsage });
    });
  });
}

module.exports = { spawnAgent };
