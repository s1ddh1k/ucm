const fs = require("node:fs");
const path = require("node:path");
const { normalizeGitPath } = require("./checks");

const SESSION_EVENT_TYPES = Object.freeze([
  "intent",
  "decision",
  "attempt",
  "verification",
  "constraint",
]);

function toIsoTimestamp(now = new Date()) {
  return new Date(now).toISOString();
}

function unique(items) {
  return [...new Set((items || []).filter(Boolean))];
}

function normalizePaths(paths) {
  return unique(
    (Array.isArray(paths) ? paths : [paths])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .map(normalizeGitPath),
  );
}

function normalizeStrings(values) {
  return unique(
    (Array.isArray(values) ? values : [values])
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  );
}

function getSessionLayout(repoRoot) {
  const gitDir = path.join(repoRoot, ".git");
  return {
    dir: path.join(gitDir, "tacit"),
    file: path.join(gitDir, "tacit", "session.json"),
  };
}

function createEmptySessionState(now = new Date()) {
  return {
    version: 1,
    createdAt: "",
    updatedAt: "",
    intent: "",
    events: [],
  };
}

function ensureSessionDir(repoRoot) {
  const layout = getSessionLayout(repoRoot);
  fs.mkdirSync(layout.dir, { recursive: true });
  return layout;
}

function readSessionState(repoRoot) {
  const layout = getSessionLayout(repoRoot);
  try {
    const parsed = JSON.parse(fs.readFileSync(layout.file, "utf8"));
    return {
      ...createEmptySessionState(),
      ...parsed,
      events: Array.isArray(parsed.events) ? parsed.events : [],
      intent: String(parsed.intent || "").trim(),
    };
  } catch {
    return createEmptySessionState();
  }
}

function writeSessionState(repoRoot, state) {
  const layout = ensureSessionDir(repoRoot);
  fs.writeFileSync(layout.file, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return layout.file;
}

function beginSession(repoRoot, { intent = "", now = new Date() } = {}) {
  const session = createEmptySessionState(now);
  const timestamp = toIsoTimestamp(now);
  session.createdAt = timestamp;
  session.updatedAt = timestamp;
  session.intent = String(intent || "").trim();
  const filePath = writeSessionState(repoRoot, session);
  return {
    filePath,
    session,
  };
}

function recordSessionEvent(
  repoRoot,
  {
    type,
    summary,
    paths = [],
    symbols = [],
    evidence = [],
    now = new Date(),
  },
) {
  const normalizedType = String(type || "").trim();
  if (!SESSION_EVENT_TYPES.includes(normalizedType)) {
    throw new Error(`event type must be one of: ${SESSION_EVENT_TYPES.join(", ")}`);
  }

  const normalizedSummary = String(summary || "").trim();
  if (!normalizedSummary) {
    throw new Error("summary is required");
  }

  const session = readSessionState(repoRoot);
  const timestamp = toIsoTimestamp(now);
  const event = {
    id: `${timestamp.replace(/[^\dTZ]/g, "").toLowerCase()}-${session.events.length + 1}`,
    type: normalizedType,
    summary: normalizedSummary,
    paths: normalizePaths(paths),
    symbols: normalizeStrings(symbols),
    evidence: normalizeStrings(evidence),
    createdAt: timestamp,
  };

  if (!session.createdAt) {
    session.createdAt = timestamp;
  }
  session.updatedAt = timestamp;
  if (normalizedType === "intent") {
    session.intent = normalizedSummary;
  }
  session.events.push(event);

  const filePath = writeSessionState(repoRoot, session);
  return {
    filePath,
    session,
    event,
  };
}

function scoreEvent(event, { paths = [], symbols = [] } = {}) {
  const normalizedPaths = normalizePaths(paths);
  const normalizedSymbols = normalizeStrings(symbols);

  let score = 0;
  const eventPaths = normalizePaths(event.paths || []);
  const eventSymbols = normalizeStrings(event.symbols || []);

  if (normalizedPaths.length > 0 && eventPaths.some((item) => normalizedPaths.includes(item))) {
    score += 6;
  }
  if (
    normalizedSymbols.length > 0 &&
    eventSymbols.some((item) => normalizedSymbols.includes(item))
  ) {
    score += 5;
  }
  if (event.type === "intent") {
    score += normalizedPaths.length === 0 && normalizedSymbols.length === 0 ? 4 : 1;
  }
  if (event.type === "verification") score += 1;

  return score;
}

function selectRelevantSessionEvents(
  session,
  { paths = [], symbols = [], maxEvents = 6 } = {},
) {
  const scored = (session.events || [])
    .map((event) => ({
      event,
      score: scoreEvent(event, { paths, symbols }),
    }))
    .filter((item) => item.score > 0 || (paths.length === 0 && symbols.length === 0))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return String(right.event.createdAt).localeCompare(String(left.event.createdAt));
    })
    .slice(0, maxEvents);

  return scored.map((item) => item.event);
}

function readSessionResidue(repoRoot, { paths = [], symbols = [], maxEvents = 6 } = {}) {
  const session = readSessionState(repoRoot);
  const layout = getSessionLayout(repoRoot);
  const hasContent = Boolean(session.intent) || session.events.length > 0;

  return {
    filePath: layout.file,
    exists: hasContent && fs.existsSync(layout.file),
    intent: session.intent,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    events: selectRelevantSessionEvents(session, { paths, symbols, maxEvents }),
  };
}

module.exports = {
  SESSION_EVENT_TYPES,
  beginSession,
  createEmptySessionState,
  getSessionLayout,
  normalizePaths,
  normalizeStrings,
  readSessionResidue,
  readSessionState,
  recordSessionEvent,
  scoreEvent,
  selectRelevantSessionEvents,
  toIsoTimestamp,
  writeSessionState,
};
