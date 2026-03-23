const { spawnSync } = require("node:child_process");
const { recordSessionEvent } = require("./session-state");

function summarizeCommand(commandArgs) {
  return (commandArgs || []).map((part) => String(part)).join(" ").trim();
}

function tailLines(text, maxLines = 4) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-maxLines);
}

function buildVerificationSummary(commandText, status, exitCode) {
  if (status === "passed") {
    return `${commandText} passed`;
  }
  if (status === "failed") {
    return `${commandText} failed with exit ${exitCode}`;
  }
  return `${commandText} exited with status ${status}`;
}

function runVerification(
  repoRoot,
  {
    commandArgs = [],
    paths = [],
    symbols = [],
    evidence = [],
  } = {},
) {
  if (!Array.isArray(commandArgs) || commandArgs.length === 0) {
    throw new Error("verification command is required");
  }

  const [command, ...args] = commandArgs;
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  const commandText = summarizeCommand(commandArgs);
  const status = result.status === 0 ? "passed" : "failed";
  const event = recordSessionEvent(repoRoot, {
    type: "verification",
    summary: buildVerificationSummary(commandText, status, result.status),
    paths,
    symbols,
    evidence: [
      ...evidence,
      `command: ${commandText}`,
      `exit: ${result.status}`,
      ...tailLines(result.stdout),
      ...tailLines(result.stderr),
    ],
  });

  return {
    command: commandText,
    status,
    exitCode: result.status,
    signal: result.signal,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    event,
  };
}

module.exports = {
  buildVerificationSummary,
  runVerification,
  summarizeCommand,
  tailLines,
};
