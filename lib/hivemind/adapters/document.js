const fs = require("node:fs");
const { access, readdir, readFile, stat } = require("node:fs/promises");
const path = require("node:path");

const HOME = process.env.HOME || process.env.USERPROFILE;

function expandPath(p) {
  if (p.startsWith("~/")) return path.join(HOME, p.slice(2));
  return p;
}

async function exists(targetPath) {
  try {
    await access(targetPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  name: "document",

  async scan(state, config) {
    const processed = state.processed || {};
    const items = [];
    const dirs = config?.dirs || [];

    for (const dir of dirs) {
      const dirPath = expandPath(dir);
      if (!(await exists(dirPath))) continue;

      const stack = [dirPath];
      while (stack.length > 0) {
        const currentPath = stack.pop();
        const entries = await readdir(currentPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith(".")) continue;
          const fullPath = path.join(currentPath, entry.name);
          if (entry.isDirectory()) {
            stack.push(fullPath);
            continue;
          }
          if (!entry.name.endsWith(".md")) continue;
          const fileStat = await stat(fullPath);
          if (fileStat.size === 0) continue;
          const ref = path.relative(dirPath, fullPath);
          if (processed[ref] && processed[ref] >= fileStat.mtimeMs) continue;
          items.push({ ref, path: fullPath, mtime: fileStat.mtimeMs });
        }
      }
    }

    return items.sort((a, b) => b.mtime - a.mtime);
  },

  async read(item) {
    const content = await readFile(item.path, "utf8");
    if (!content.trim()) return [];

    // Split by ## headers
    const sections = [];
    const lines = content.split("\n");
    let currentTitle = path.basename(item.path, ".md");
    let currentLines = [];

    for (const line of lines) {
      const headerMatch = line.match(/^##\s+(.+)$/);
      if (headerMatch) {
        if (currentLines.length > 0) {
          const text = currentLines.join("\n").trim();
          if (text.length > 100) {
            sections.push({ title: currentTitle, text });
          }
        }
        currentTitle = headerMatch[1];
        currentLines = [];
      } else {
        currentLines.push(line);
      }
    }

    // Last section
    if (currentLines.length > 0) {
      const text = currentLines.join("\n").trim();
      if (text.length > 100) {
        sections.push({ title: currentTitle, text });
      }
    }

    // If no sections found (no ## headers), treat whole file as one chunk
    if (sections.length === 0 && content.trim().length > 100) {
      sections.push({
        title: path.basename(item.path, ".md"),
        text: content.trim(),
      });
    }

    return sections.map((section) => ({
      text: `# ${section.title}\n\n${section.text}`,
      metadata: {
        adapter: "document",
        ref: item.ref,
        section: section.title,
        timestamp: new Date(item.mtime).toISOString(),
      },
    }));
  },
};
