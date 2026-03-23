const path = require("node:path");

const JS_LIKE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
]);

function isJsLikePath(filePath) {
  return JS_LIKE_EXTENSIONS.has(path.extname(String(filePath || "")).toLowerCase());
}

function splitLines(text) {
  return String(text || "").split("\n");
}

function countChar(line, char) {
  let count = 0;
  for (const current of String(line || "")) {
    if (current === char) count++;
  }
  return count;
}

function detectSymbolCandidate(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed || trimmed.startsWith("//")) return null;

  let match = trimmed.match(
    /^(?:export\s+default\s+|export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/,
  );
  if (match) {
    return { name: match[1], kind: "function" };
  }

  match = trimmed.match(/^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)\b/);
  if (match) {
    return { name: match[1], kind: "class" };
  }

  match = trimmed.match(
    /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
  );
  if (match) {
    return { name: match[1], kind: "arrow" };
  }

  match = trimmed.match(
    /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?function\b/,
  );
  if (match) {
    return { name: match[1], kind: "function-expression" };
  }

  match = trimmed.match(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/);
  if (match) {
    return { name: match[1], kind: "variable" };
  }

  match = trimmed.match(/^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)\b/);
  if (match) {
    return { name: match[1], kind: "interface" };
  }

  match = trimmed.match(/^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/);
  if (match) {
    return { name: match[1], kind: "type" };
  }

  return null;
}

function findSymbolEnd(lines, startIndex) {
  let seenBrace = false;
  let braceDepth = 0;

  for (let index = startIndex; index < lines.length; index++) {
    const line = lines[index];
    const opens = countChar(line, "{");
    const closes = countChar(line, "}");

    if (opens > 0) {
      seenBrace = true;
    }

    braceDepth += opens;
    braceDepth -= closes;

    if (seenBrace && braceDepth <= 0) {
      return index + 1;
    }

    if (!seenBrace) {
      const trimmed = line.trim();
      if ((index > startIndex && trimmed === "") || /[;,)]+$/.test(trimmed)) {
        return index + 1;
      }
    }
  }

  return lines.length;
}

function scanJsSymbols(text) {
  const lines = splitLines(text);
  const symbols = [];
  let braceDepth = 0;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const candidate = braceDepth === 0 ? detectSymbolCandidate(line) : null;
    if (candidate) {
      const start = index + 1;
      const end = findSymbolEnd(lines, index);
      const snippet = lines.slice(start - 1, end).join("\n").trimEnd();

      symbols.push({
        name: candidate.name,
        kind: candidate.kind,
        start,
        end,
        snippet,
      });
    }

    braceDepth += countChar(line, "{");
    braceDepth -= countChar(line, "}");
  }

  return symbols;
}

function findEnclosingSymbols(symbols, lineNumber) {
  return symbols
    .filter((symbol) => symbol.start <= lineNumber && symbol.end >= lineNumber)
    .sort((left, right) => {
      const leftSize = left.end - left.start;
      const rightSize = right.end - right.start;
      return leftSize - rightSize || left.start - right.start;
    });
}

function selectChangedSymbols(text, ranges) {
  const symbols = scanJsSymbols(text);
  const selected = [];
  const seen = new Set();

  for (const range of ranges) {
    for (let lineNumber = range.start; lineNumber <= range.end; lineNumber++) {
      const match = findEnclosingSymbols(symbols, lineNumber)[0];
      if (!match) continue;

      const key = `${match.name}:${match.start}:${match.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      selected.push(match);
    }
  }

  return selected;
}

module.exports = {
  detectSymbolCandidate,
  findEnclosingSymbols,
  findSymbolEnd,
  isJsLikePath,
  scanJsSymbols,
  selectChangedSymbols,
  splitLines,
};
