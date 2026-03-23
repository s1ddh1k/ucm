#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const {
  DOCUMENT_TYPES,
  getDefaultDocsLayout,
  renderTemplate,
  slugify,
  toIsoDate,
} = require("./templates");
const {
  classifyCommit,
  formatCommitInspection,
  getRepoRoot,
  getStagedDiff,
  getStagedFiles,
} = require("./checks");
const {
  generateCommitMessage,
  prepareCommitMessage,
} = require("./commit-message");
const {
  formatCommitFlow,
  runCommitFlow,
} = require("./commit-flow");
const {
  beginSession,
  SESSION_EVENT_TYPES,
  recordSessionEvent,
} = require("./session-state");
const { collectRecallContext } = require("./repo-context");
const { runVerification } = require("./verification");

function printUsage() {
  console.log(`Tacit

Usage:
  tacit init [--root <dir>]
  tacit begin <intent> [--root <dir>]
  tacit record <intent|decision|attempt|verification|constraint> <summary> [--root <dir>] [--path <file>] [--symbol <name>] [--evidence <text>] [--json]
  tacit resume [--root <dir>] [--path <file>] [--symbol <name>] [--json]
  tacit verify [--root <dir>] [--path <file>] [--symbol <name>] [--evidence <text>] -- <command...>
  tacit promote <decision|failed-attempt> <title> [--root <dir>] [--stdout] [--force]
  tacit commit [--root <dir>] [--dry-run] [--interactive] [--json] [--provider <name>] [--model <name>] [--timeout-ms <ms>]
  tacit generate-commit-message [--root <dir>]
  tacit prepare-commit-msg <message-file> [source] [--root <dir>]
  tacit inspect-commit [--root <dir>] [--message <text>] [--json] [--quiet-ok]
`);
}

function parseArgs(argv) {
  const args = [...argv];
  const options = {
    root: ".",
    stdout: false,
    force: false,
    json: false,
    message: "",
    quietOk: false,
    dryRun: false,
    interactive: false,
    provider: "",
    model: "",
    timeoutMs: 0,
    paths: [],
    symbols: [],
    evidence: [],
    commandArgs: [],
  };
  const positionals = [];

  while (args.length > 0) {
    const arg = args.shift();
    if (arg === "--") {
      options.commandArgs.push(...args);
      break;
    }
    if (arg === "--root") {
      options.root = args.shift() || ".";
      continue;
    }
    if (arg === "--stdout") {
      options.stdout = true;
      continue;
    }
    if (arg === "--force") {
      options.force = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--message") {
      options.message = args.shift() || "";
      continue;
    }
    if (arg === "--quiet-ok") {
      options.quietOk = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--interactive") {
      options.interactive = true;
      continue;
    }
    if (arg === "--provider") {
      options.provider = args.shift() || "";
      continue;
    }
    if (arg === "--path") {
      options.paths.push(args.shift() || "");
      continue;
    }
    if (arg === "--symbol") {
      options.symbols.push(args.shift() || "");
      continue;
    }
    if (arg === "--evidence") {
      options.evidence.push(args.shift() || "");
      continue;
    }
    if (arg === "--model") {
      options.model = args.shift() || "";
      continue;
    }
    if (arg === "--timeout-ms") {
      options.timeoutMs = Number(args.shift() || 0) || 0;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    positionals.push(arg);
  }

  return { options, positionals };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeFile(targetPath, content, { force = false } = {}) {
  if (fs.existsSync(targetPath) && !force) {
    throw new Error(`file already exists: ${targetPath}`);
  }
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, content, "utf8");
}

function buildTargetPath(docType, title, root) {
  const layout = getDefaultDocsLayout(root);
  const datePrefix = toIsoDate(new Date()).replace(/-/g, "");
  const slug = slugify(title) || docType;

  if (docType === "decision") {
    return path.resolve(`${layout.decisionsDir}/${datePrefix}-${slug}.md`);
  }
  if (docType === "failed-attempt") {
    return path.resolve(`${layout.failuresDir}/${datePrefix}-${slug}.md`);
  }
  if (docType === "handoff") {
    return path.resolve(layout.activeHandoffPath);
  }
  throw new Error(`unsupported document type: ${docType}`);
}

function cmdInit(root) {
  const layout = getDefaultDocsLayout(path.resolve(root));
  ensureDir(layout.decisionsDir);
  ensureDir(layout.failuresDir);
  ensureDir(layout.handoffsDir);
  console.log(`initialized:
${layout.decisionsDir}
${layout.failuresDir}
${layout.handoffsDir}`);
}

function resolveRepoRoot(root) {
  return getRepoRoot(path.resolve(root));
}

function cmdBegin(intent, options) {
  const repoRoot = resolveRepoRoot(options.root);
  const result = beginSession(repoRoot, { intent: intent.trim() });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${result.filePath}\n`);
}

function cmdRecord(eventType, summary, options) {
  if (!SESSION_EVENT_TYPES.includes(eventType)) {
    throw new Error(`event type must be one of: ${SESSION_EVENT_TYPES.join(", ")}`);
  }
  const repoRoot = resolveRepoRoot(options.root);
  const result = recordSessionEvent(repoRoot, {
    type: eventType,
    summary: summary.trim(),
    paths: options.paths,
    symbols: options.symbols,
    evidence: options.evidence,
  });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${result.filePath}\n`);
}

function formatResumeContext(context) {
  const lines = ["tacit: resume"];
  if (context.session.intent) {
    lines.push(`intent: ${context.session.intent}`);
  }

  if (context.session.events.length > 0) {
    lines.push("session:");
    for (const event of context.session.events) {
      const suffix = [
        event.paths?.length ? `paths=${event.paths.join(",")}` : "",
        event.symbols?.length ? `symbols=${event.symbols.join(",")}` : "",
      ]
        .filter(Boolean)
        .join(" ");
      lines.push(`- [${event.type}] ${event.summary}${suffix ? ` (${suffix})` : ""}`);
    }
  }

  if (context.pathHistory.length > 0) {
    lines.push("path-history:");
    for (const entry of context.pathHistory) {
      lines.push(`- ${entry.commit} ${entry.subject}`);
    }
  }

  if (context.symbolHistory.length > 0) {
    lines.push("symbol-history:");
    for (const entry of context.symbolHistory) {
      const label = entry.symbol ? ` (${entry.symbol})` : "";
      lines.push(`- ${entry.commit} ${entry.subject}${label}`);
    }
  }

  if (context.docs.length > 0) {
    lines.push("docs:");
    for (const doc of context.docs) {
      lines.push(`- ${doc.path}`);
    }
  }

  if (lines.length === 1) {
    lines.push("no session residue or related history");
  }

  return `${lines.join("\n")}\n`;
}

function cmdResume(options) {
  const repoRoot = resolveRepoRoot(options.root);
  const result = collectRecallContext(repoRoot, {
    paths: options.paths,
    symbols: options.symbols,
  });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(formatResumeContext(result));
}

function cmdNew(docType, title, options) {
  if (!DOCUMENT_TYPES.includes(docType)) {
    throw new Error(`document type must be one of: ${DOCUMENT_TYPES.join(", ")}`);
  }
  if (!title || !title.trim()) {
    throw new Error("title is required");
  }

  const content = renderTemplate(docType, title.trim());
  if (options.stdout) {
    process.stdout.write(content);
    return;
  }

  const targetPath = buildTargetPath(docType, title, options.root);
  writeFile(targetPath, content, { force: options.force });
  console.log(targetPath);
}

function cmdHandoff(title, options) {
  cmdNew("handoff", title, {
    ...options,
    force: true,
  });
}

function cmdPromote(docType, title, options) {
  if (docType !== "decision" && docType !== "failed-attempt") {
    throw new Error("promote type must be decision or failed-attempt");
  }
  cmdNew(docType, title, options);
}

function cmdInspectCommit(options) {
  const repoRoot = getRepoRoot(path.resolve(options.root));
  const stagedFiles = getStagedFiles(repoRoot);
  const stagedDiff = getStagedDiff(repoRoot);
  const result = classifyCommit({
    repoRoot,
    stagedFiles,
    stagedDiff,
    commitMessage: options.message,
  });

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    const text = formatCommitInspection(result);
    if (result.status === "ok") {
      if (options.quietOk) return;
      process.stdout.write(`${text}\n`);
    } else {
      process.stderr.write(`${text}\n`);
    }
  }

  if (result.status === "blocked") {
    process.exitCode = 1;
  }
}

function cmdGenerateCommitMessage(options) {
  const repoRoot = getRepoRoot(path.resolve(options.root));
  const stagedFiles = getStagedFiles(repoRoot);
  const stagedDiff = getStagedDiff(repoRoot);
  const content = generateCommitMessage({
    repoRoot,
    stagedFiles,
    stagedDiff,
  });
  process.stdout.write(content);
}

function cmdPrepareCommitMsg(messageFile, source, options) {
  const result = prepareCommitMessage({
    root: options.root,
    messageFile: path.resolve(messageFile),
    source,
  });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
}

async function cmdCommit(options) {
  const result = await runCommitFlow({
    root: options.root,
    dryRun: options.dryRun,
    noPrompt: !options.interactive,
    provider: options.provider || undefined,
    model: options.model || undefined,
    timeoutMs: options.timeoutMs || undefined,
  });

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(formatCommitFlow(result));
}

function cmdVerify(commandArgs, options) {
  const repoRoot = resolveRepoRoot(options.root);
  const result = runVerification(repoRoot, {
    commandArgs,
    paths: options.paths,
    symbols: options.symbols,
    evidence: options.evidence,
  });

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`tacit: verification ${result.status}\n`);
  }

  if (result.exitCode !== 0) {
    process.exitCode = result.exitCode || 1;
  }
}

async function main() {
  const { options, positionals } = parseArgs(process.argv.slice(2));

  if (options.help || positionals.length === 0) {
    printUsage();
    process.exit(0);
  }

  const command = positionals[0];
  if (command === "init") {
    cmdInit(options.root);
    return;
  }

  if (command === "begin") {
    const intent = positionals.slice(1).join(" ");
    if (!intent.trim()) {
      throw new Error("intent is required");
    }
    cmdBegin(intent, options);
    return;
  }

  if (command === "record") {
    const eventType = positionals[1];
    const summary = positionals.slice(2).join(" ");
    if (!summary.trim()) {
      throw new Error("summary is required");
    }
    cmdRecord(eventType, summary, options);
    return;
  }

  if (command === "resume") {
    cmdResume(options);
    return;
  }

  if (command === "new") {
    process.stderr.write("tacit: `new` is legacy; prefer `tacit promote`.\n");
    const docType = positionals[1];
    const title = positionals.slice(2).join(" ");
    cmdNew(docType, title, options);
    return;
  }

  if (command === "promote") {
    const docType = positionals[1];
    const title = positionals.slice(2).join(" ");
    cmdPromote(docType, title, options);
    return;
  }

  if (command === "handoff") {
    process.stderr.write("tacit: `handoff` is legacy; prefer session scratchpad commands.\n");
    const title = positionals.slice(1).join(" ");
    cmdHandoff(title, options);
    return;
  }

  if (command === "verify") {
    const commandArgs = options.commandArgs.length > 0 ? options.commandArgs : positionals.slice(1);
    cmdVerify(commandArgs, options);
    return;
  }

  if (command === "commit") {
    await cmdCommit(options);
    return;
  }

  if (command === "generate-commit-message") {
    cmdGenerateCommitMessage(options);
    return;
  }

  if (command === "prepare-commit-msg") {
    const messageFile = positionals[1];
    const source = positionals[2] || "";
    if (!messageFile) {
      throw new Error("message file is required");
    }
    cmdPrepareCommitMsg(messageFile, source, options);
    return;
  }

  if (command === "inspect-commit") {
    cmdInspectCommit(options);
    return;
  }

  throw new Error(`unknown command: ${command}`);
}

main().catch((error) => {
  console.error(`tacit: ${error.message}`);
  process.exit(1);
});
