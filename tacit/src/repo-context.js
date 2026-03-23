const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { isCodePath, isTestPath, normalizeGitPath } = require("./checks");
const { readSessionResidue, normalizeStrings } = require("./session-state");
const {
  findEnclosingSymbols,
  isJsLikePath,
  scanJsSymbols,
  selectChangedSymbols,
} = require("./symbol-context");

const ROOT_CONTEXT_FILES = ["AGENTS.md", "README.md", "CONTRIBUTING.md", "package.json"];
const NEAREST_CONTEXT_FILES = ["README.md", "package.json"];
const DEFAULT_MAX_DOCS = 8;
const DEFAULT_MAX_DOC_CHARS = 2200;
const DEFAULT_MAX_COMMITS = 5;
const DEFAULT_MAX_SYMBOL_FILES = 4;
const DEFAULT_MAX_SYMBOLS_PER_FILE = 2;
const DEFAULT_MAX_RELATED_REFS = 6;
const DEFAULT_SNIPPET_CONTEXT_LINES = 6;
const DEFAULT_MAX_SNIPPET_FILES = 4;
const DEFAULT_MAX_SNIPPET_WINDOWS = 2;
const DEFAULT_MAX_SNIPPET_CHARS = 2200;

function readTextIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function trimContext(text, maxChars = DEFAULT_MAX_DOC_CHARS) {
  const value = String(text || "").trim();
  if (!value || value.length <= maxChars) return value;

  const half = Math.max(200, Math.floor((maxChars - 64) / 2));
  return `${value.slice(0, half)}\n...\n${value.slice(-half)}`;
}

function fileExists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function addContextPath(paths, filePath) {
  if (!filePath || !fileExists(filePath)) return;
  paths.add(path.resolve(filePath));
}

function collectNearestContextPaths(repoRoot, stagedFiles) {
  const paths = new Set();

  for (const fileName of ROOT_CONTEXT_FILES) {
    addContextPath(paths, path.join(repoRoot, fileName));
  }

  for (const filePath of stagedFiles.map(normalizeGitPath)) {
    if (/^docs\/(decisions|failures)\/.+\.md$/i.test(filePath)) {
      addContextPath(paths, path.join(repoRoot, filePath));
    }

    let currentDir = path.dirname(path.join(repoRoot, filePath));
    const stopDir = path.resolve(repoRoot);
    const seenNames = new Set();

    while (currentDir.startsWith(stopDir)) {
      for (const candidate of NEAREST_CONTEXT_FILES) {
        if (seenNames.has(candidate)) continue;
        const candidatePath = path.join(currentDir, candidate);
        if (fileExists(candidatePath)) {
          paths.add(path.resolve(candidatePath));
          seenNames.add(candidate);
        }
      }

      if (currentDir === stopDir) break;
      currentDir = path.dirname(currentDir);
    }
  }

  return [...paths].slice(0, DEFAULT_MAX_DOCS);
}

function readContextDocs(repoRoot, stagedFiles, options = {}) {
  const maxChars = options.maxDocChars || DEFAULT_MAX_DOC_CHARS;
  return collectNearestContextPaths(repoRoot, stagedFiles)
    .map((filePath) => {
      const content = trimContext(readTextIfExists(filePath), maxChars);
      if (!content) return null;
      return {
        path: normalizeGitPath(path.relative(repoRoot, filePath)),
        content,
      };
    })
    .filter(Boolean);
}

function runGit(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function runGitRaw(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runSearch(args, cwd) {
  try {
    return execFileSync("rg", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    if (error.status === 1) return "";
    throw error;
  }
}

function parseStagedHunks(stagedDiff) {
  const fileRanges = new Map();
  let currentFile = "";

  for (const line of String(stagedDiff || "").split("\n")) {
    const fileMatch = line.match(/^\+\+\+ b\/(.+)$/);
    if (fileMatch) {
      currentFile = normalizeGitPath(fileMatch[1]);
      continue;
    }

    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (!hunkMatch || !currentFile) continue;

    const start = Number(hunkMatch[1]);
    const count = hunkMatch[2] ? Number(hunkMatch[2]) : 1;
    const end = count > 0 ? start + count - 1 : start;
    const ranges = fileRanges.get(currentFile) || [];
    ranges.push({ start, end });
    fileRanges.set(currentFile, ranges);
  }

  return fileRanges;
}

function mergeRanges(ranges, contextLines = DEFAULT_SNIPPET_CONTEXT_LINES) {
  const expanded = ranges
    .map((range) => ({
      start: Math.max(1, range.start - contextLines),
      end: Math.max(range.start, range.end + contextLines),
    }))
    .sort((a, b) => a.start - b.start);

  const merged = [];
  for (const range of expanded) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end + 1) {
      last.end = Math.max(last.end, range.end);
      continue;
    }
    merged.push({ ...range });
  }
  return merged;
}

function shouldIncludeSnippet(filePath) {
  return /\.(c|cc|cpp|cxx|cs|go|java|js|jsx|mjs|cjs|ts|tsx|py|rb|rs|php|swift|kt|scala|json|md|ya?ml)$/i.test(
    filePath,
  );
}

function readStagedBlob(repoRoot, filePath) {
  try {
    const content = runGitRaw(["show", `:${filePath}`], repoRoot);
    if (content.includes("\u0000")) return "";
    return content;
  } catch {
    return readTextIfExists(path.join(repoRoot, filePath));
  }
}

function formatSnippet(text, range) {
  const lines = String(text || "").split("\n");
  const start = Math.max(1, Math.min(range.start, lines.length || 1));
  const end = Math.max(start, Math.min(range.end, lines.length || start));
  const width = String(end).length;
  const snippet = lines
    .slice(start - 1, end)
    .map((line, index) => `${String(start + index).padStart(width, " ")} | ${line}`)
    .join("\n");

  return {
    start,
    end,
    snippet: trimContext(snippet, DEFAULT_MAX_SNIPPET_CHARS),
  };
}

function readFocusedSnippets(repoRoot, stagedFiles, stagedDiff, options = {}) {
  const contextLines = options.contextLines || DEFAULT_SNIPPET_CONTEXT_LINES;
  const maxFiles = options.maxSnippetFiles || DEFAULT_MAX_SNIPPET_FILES;
  const maxWindows = options.maxSnippetWindows || DEFAULT_MAX_SNIPPET_WINDOWS;
  const hunksByFile = parseStagedHunks(stagedDiff);
  const snippets = [];

  for (const filePath of stagedFiles.map(normalizeGitPath)) {
    if (!shouldIncludeSnippet(filePath)) continue;
    const ranges = hunksByFile.get(filePath) || [];
    if (!ranges.length) continue;

    const content = readStagedBlob(repoRoot, filePath);
    if (!content) continue;

    const windows = mergeRanges(ranges, contextLines)
      .slice(0, maxWindows)
      .map((range) => formatSnippet(content, range))
      .filter((item) => item.snippet);

    if (!windows.length) continue;

    snippets.push({
      path: filePath,
      windows,
    });

    if (snippets.length >= maxFiles) break;
  }

  return snippets;
}

function readFocusedSymbols(repoRoot, stagedFiles, stagedDiff, options = {}) {
  const maxFiles = options.maxSymbolFiles || DEFAULT_MAX_SYMBOL_FILES;
  const maxSymbolsPerFile = options.maxSymbolsPerFile || DEFAULT_MAX_SYMBOLS_PER_FILE;
  const maxChars = options.maxSnippetChars || DEFAULT_MAX_SNIPPET_CHARS;
  const hunksByFile = parseStagedHunks(stagedDiff);
  const results = [];

  for (const filePath of stagedFiles.map(normalizeGitPath)) {
    if (!isJsLikePath(filePath)) continue;
    const ranges = hunksByFile.get(filePath) || [];
    if (!ranges.length) continue;

    const content = readStagedBlob(repoRoot, filePath);
    if (!content) continue;

    const symbols = selectChangedSymbols(content, ranges)
      .slice(0, maxSymbolsPerFile)
      .map((symbol) => ({
        name: symbol.name,
        kind: symbol.kind,
        start: symbol.start,
        end: symbol.end,
        snippet: trimContext(symbol.snippet, maxChars),
      }))
      .filter((symbol) => symbol.snippet);

    if (!symbols.length) continue;

    results.push({
      path: filePath,
      symbols,
    });

    if (results.length >= maxFiles) break;
  }

  return results;
}

function extractReferenceSnippet(content, lineNumber, options = {}) {
  const maxChars = options.maxSnippetChars || DEFAULT_MAX_SNIPPET_CHARS;
  if (isJsLikePath(options.filePath)) {
    const symbols = scanJsSymbols(content);
    const enclosing = findEnclosingSymbols(symbols, lineNumber)[0];
    if (enclosing) {
      return {
        start: enclosing.start,
        end: enclosing.end,
        snippet: trimContext(enclosing.snippet, maxChars),
      };
    }
  }

  return formatSnippet(content, {
    start: Math.max(1, lineNumber - DEFAULT_SNIPPET_CONTEXT_LINES),
    end: lineNumber + DEFAULT_SNIPPET_CONTEXT_LINES,
  });
}

function parseSearchMatches(output, repoRoot) {
  return String(output || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([^:]+):(\d+):(.*)$/);
      if (!match) return null;
      return {
        path: normalizeGitPath(match[1]).replace(/^\.\//, ""),
        line: Number(match[2]),
        preview: match[3].trim(),
      };
    })
    .filter(Boolean)
    .filter((item) => !item.path.startsWith("node_modules/"))
    .filter((item) => fileExists(path.join(repoRoot, item.path)));
}

function searchSymbolReferences(repoRoot, symbolName, kind) {
  const globs =
    kind === "test"
      ? [
          "--glob",
          "test/**",
          "--glob",
          "tests/**",
          "--glob",
          "**/__tests__/**",
          "--glob",
          "**/*.test.*",
          "--glob",
          "**/*.spec.*",
        ]
      : [
          "--glob",
          "*.js",
          "--glob",
          "*.ts",
          "--glob",
          "*.jsx",
          "--glob",
          "*.tsx",
          "--glob",
          "**/*.js",
          "--glob",
          "**/*.ts",
          "--glob",
          "**/*.jsx",
          "--glob",
          "**/*.tsx",
        ];
  const output = runSearch(
    [
      "--no-heading",
      "--color",
      "never",
      "--line-number",
      "--fixed-strings",
      ...globs,
      symbolName,
      ".",
    ],
    repoRoot,
  );
  return parseSearchMatches(output, repoRoot);
}

function dedupeReferenceMatches(matches) {
  const seen = new Set();
  const results = [];

  for (const match of matches) {
    const key = `${match.path}:${match.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(match);
  }

  return results;
}

function readRelatedReferences(repoRoot, symbolGroups, options = {}) {
  const maxRefs = options.maxRelatedRefs || DEFAULT_MAX_RELATED_REFS;
  const references = [];
  const seen = new Set();

  for (const group of symbolGroups) {
    for (const symbol of group.symbols) {
      const matches = [
        ...searchSymbolReferences(repoRoot, symbol.name, "test").map((item) => ({
          ...item,
          kind: "test",
        })),
        ...searchSymbolReferences(repoRoot, symbol.name, "caller").map((item) => ({
          ...item,
          kind: isTestPath(item.path) ? "test" : "caller",
        })),
      ];

      for (const match of dedupeReferenceMatches(matches)) {
        if (match.path === group.path) continue;
        if (match.kind === "caller" && !isCodePath(match.path)) continue;

        const key = `${symbol.name}:${match.path}:${match.line}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const content = readTextIfExists(path.join(repoRoot, match.path));
        if (!content) continue;

        const snippet = extractReferenceSnippet(content, match.line, {
          filePath: match.path,
          maxSnippetChars: options.maxSnippetChars,
        });

        references.push({
          symbol: symbol.name,
          sourcePath: group.path,
          path: match.path,
          kind: match.kind,
          start: snippet.start,
          end: snippet.end,
          snippet: snippet.snippet,
        });

        if (references.length >= maxRefs) {
          return references;
        }
      }
    }
  }

  return references;
}

function readRecentCommits(repoRoot, stagedFiles, options = {}) {
  if (!stagedFiles.length) return "";
  const maxCommits = options.maxCommits || DEFAULT_MAX_COMMITS;
  try {
    return runGit(
      ["log", "--oneline", `-n${maxCommits}`, "--", ...stagedFiles.slice(0, 8)],
      repoRoot,
    );
  } catch {
    return "";
  }
}

function parseHistoryEntries(output) {
  return String(output || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [commit, ...rest] = line.split("\t");
      return {
        commit: String(commit || "").trim(),
        subject: rest.join("\t").trim(),
      };
    })
    .filter((entry) => entry.commit && entry.subject);
}

function formatHistoryEntries(entries) {
  if (!entries.length) return "";
  return entries.map((entry) => `${entry.commit} ${entry.subject}`).join("\n");
}

function readPathHistory(repoRoot, stagedFiles, options = {}) {
  if (!stagedFiles.length) return [];
  const maxCommits = options.maxCommits || DEFAULT_MAX_COMMITS;
  try {
    return parseHistoryEntries(
      runGit(
        ["log", `-n${maxCommits}`, "--format=%h%x09%s", "--", ...stagedFiles.slice(0, 8)],
        repoRoot,
      ),
    );
  } catch {
    return [];
  }
}

function escapeGitRegex(input) {
  return String(input || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readSymbolHistory(repoRoot, symbolGroups, options = {}) {
  const maxCommits = options.maxCommits || DEFAULT_MAX_COMMITS;
  const entries = [];
  const seen = new Set();

  for (const group of symbolGroups) {
    for (const symbol of group.symbols || []) {
      try {
        const results = parseHistoryEntries(
          runGit(
            [
              "log",
              `-n${maxCommits}`,
              "--format=%h%x09%s",
              `-G${escapeGitRegex(symbol.name)}`,
              "--",
              group.path,
            ],
            repoRoot,
          ),
        );

        for (const entry of results) {
          if (seen.has(entry.commit)) continue;
          seen.add(entry.commit);
          entries.push({
            ...entry,
            symbol: symbol.name,
            path: group.path,
          });
          if (entries.length >= maxCommits) {
            return entries;
          }
        }
      } catch {
        continue;
      }
    }
  }

  return entries;
}

function readSessionContext(repoRoot, stagedFiles, symbolGroups, options = {}) {
  const symbolNames = normalizeStrings(
    (symbolGroups || []).flatMap((group) =>
      (group.symbols || []).map((symbol) => symbol.name),
    ),
  );
  return readSessionResidue(repoRoot, {
    paths: stagedFiles,
    symbols: symbolNames,
    maxEvents: options.maxSessionEvents || 6,
  });
}

function readDiffStat(repoRoot) {
  try {
    return runGit(["diff", "--cached", "--stat", "--compact-summary"], repoRoot);
  } catch {
    return "";
  }
}

function collectRepoContext(repoRoot, stagedFiles, options = {}) {
  const symbols = readFocusedSymbols(
    repoRoot,
    stagedFiles,
    options.stagedDiff || "",
    options,
  );
  const symbolPaths = new Set(symbols.map((item) => item.path));
  const relatedReferences = readRelatedReferences(repoRoot, symbols, options);
  const session = readSessionContext(repoRoot, stagedFiles, symbols, options);
  const pathHistory = readPathHistory(repoRoot, stagedFiles, options);
  const symbolHistory = readSymbolHistory(repoRoot, symbols, options);

  return {
    docs: readContextDocs(repoRoot, stagedFiles, options),
    session,
    recentCommits: formatHistoryEntries(pathHistory),
    pathHistory,
    symbolHistory,
    diffStat: readDiffStat(repoRoot),
    symbols,
    relatedReferences,
    snippets: readFocusedSnippets(
      repoRoot,
      stagedFiles.filter((filePath) => !symbolPaths.has(normalizeGitPath(filePath))),
      options.stagedDiff || "",
      options,
    ),
  };
}

function collectRecallContext(repoRoot, { paths = [], symbols = [], maxEvents = 6 } = {}) {
  const normalizedPaths = paths.map(normalizeGitPath).filter(Boolean);
  const normalizedSymbols = normalizeStrings(symbols);
  const pseudoSymbolGroups =
    normalizedSymbols.length > 0
      ? normalizedPaths.length > 0
        ? normalizedPaths.map((filePath) => ({
            path: filePath,
            symbols: normalizedSymbols.map((name) => ({ name })),
          }))
        : [
            {
              path: ".",
              symbols: normalizedSymbols.map((name) => ({ name })),
            },
          ]
      : [];

  return {
    docs: readContextDocs(repoRoot, normalizedPaths, {}),
    session: readSessionResidue(repoRoot, {
      paths: normalizedPaths,
      symbols: normalizedSymbols,
      maxEvents,
    }),
    pathHistory: readPathHistory(repoRoot, normalizedPaths, {}),
    symbolHistory: readSymbolHistory(repoRoot, pseudoSymbolGroups, {}),
  };
}

module.exports = {
  collectRecallContext,
  collectRepoContext,
  collectNearestContextPaths,
  formatSnippet,
  mergeRanges,
  parseStagedHunks,
  readContextDocs,
  readDiffStat,
  readFocusedSnippets,
  readFocusedSymbols,
  readPathHistory,
  readRelatedReferences,
  readRecentCommits,
  readSessionContext,
  readSymbolHistory,
  readTextIfExists,
  readStagedBlob,
  runGitRaw,
  runSearch,
  shouldIncludeSnippet,
  trimContext,
};
