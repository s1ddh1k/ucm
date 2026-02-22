#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

function printUsage() {
  console.log(`Usage: scripts/extract-agent-messages.js [options]

Extract only agent messages from Codex auto-improve run logs.

Options:
  -l, --log-dir <dir>   Log directory (default: .codex-auto-improve-logs)
  -f, --file <name>     Specific log file path or filename inside log dir
  -o, --out <path>      Save output to file
  -h, --help            Show help
`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = {
    logDir: ".codex-auto-improve-logs",
    file: null,
    out: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      printUsage();
      process.exit(0);
    } else if (arg === "-l" || arg === "--log-dir") {
      const value = argv[++i];
      if (!value) fail(`${arg} requires a value`);
      opts.logDir = value;
    } else if (arg === "-f" || arg === "--file") {
      const value = argv[++i];
      if (!value) fail(`${arg} requires a value`);
      opts.file = value;
    } else if (arg === "-o" || arg === "--out") {
      const value = argv[++i];
      if (!value) fail(`${arg} requires a value`);
      opts.out = value;
    } else {
      fail(`Unknown option: ${arg}`);
    }
  }

  return opts;
}

function isRunLog(name) {
  return /^run-\d{8}-\d{6}\.log$/.test(name);
}

function pickLatestRunLog(logDir) {
  let names;
  try {
    names = fs.readdirSync(logDir).filter(isRunLog);
  } catch (e) {
    fail(`Failed to read log dir: ${logDir}\n${e.message}`);
  }

  if (names.length === 0) {
    fail(`No run logs found in: ${logDir}`);
  }

  const withMtime = names.map((name) => {
    const full = path.join(logDir, name);
    const st = fs.statSync(full);
    return { name, full, mtimeMs: st.mtimeMs };
  });
  withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return withMtime[0].full;
}

function resolveLogPath(opts) {
  if (!opts.file) return pickLatestRunLog(opts.logDir);
  if (path.isAbsolute(opts.file)) return opts.file;
  const candidate = path.join(opts.logDir, opts.file);
  if (fs.existsSync(candidate)) return candidate;
  return opts.file;
}

function extractAgentMessages(logPath) {
  let text;
  try {
    text = fs.readFileSync(logPath, "utf8");
  } catch (e) {
    fail(`Failed to read log file: ${logPath}\n${e.message}`);
  }

  const messages = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj?.type !== "item.completed") continue;
    if (obj?.item?.type !== "agent_message") continue;
    if (typeof obj?.item?.text !== "string") continue;
    messages.push(obj.item.text);
  }
  return messages;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const logPath = resolveLogPath(opts);
  const messages = extractAgentMessages(logPath);

  const lines = [];
  lines.push(`SOURCE=${logPath}`);
  lines.push(`TOTAL=${messages.length}`);
  lines.push("");
  messages.forEach((message, idx) => {
    lines.push(`[${idx + 1}] ${message}`);
    lines.push("");
  });

  const output = lines.join("\n").trimEnd() + "\n";
  process.stdout.write(output);

  if (opts.out) {
    fs.writeFileSync(opts.out, output, "utf8");
  }
}

main();
