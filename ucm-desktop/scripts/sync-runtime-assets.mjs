import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(desktopRoot, "..");
const outputRoot = path.join(desktopRoot, "resources", "runtime-config");
const manifestPath = path.join(outputRoot, ".sync-manifest.json");

const sources = [
  {
    from: path.join(repoRoot, "roles"),
    to: path.join(outputRoot, "roles"),
  },
  {
    from: path.join(repoRoot, "schemas"),
    to: path.join(outputRoot, "schemas"),
  },
];

for (const source of sources) {
  if (!fs.existsSync(source.from)) {
    console.error(`[ucm-runtime-assets] Missing source directory: ${source.from}`);
    process.exit(1);
  }
}

const nextManifest = Object.fromEntries(
  sources.map((source) => [
    path.basename(source.from),
    collectDirectoryManifest(source.from),
  ]),
);
const previousManifest = readManifest(manifestPath);

if (
  previousManifest &&
  JSON.stringify(previousManifest) === JSON.stringify(nextManifest)
) {
  console.log("[ucm-runtime-assets] Runtime assets unchanged; skipping sync.");
  process.exit(0);
}

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(outputRoot, { recursive: true });

for (const source of sources) {
  fs.cpSync(source.from, source.to, { recursive: true });
}

fs.writeFileSync(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, "utf8");

console.log(`[ucm-runtime-assets] Synced runtime contracts and schemas to ${outputRoot}`);

function readManifest(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function collectDirectoryManifest(rootPath) {
  const entries = [];
  walkDirectory(rootPath, rootPath, entries);
  return entries;
}

function walkDirectory(rootPath, currentPath, entries) {
  const children = fs.readdirSync(currentPath, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name, "en"));

  for (const child of children) {
    const childPath = path.join(currentPath, child.name);
    const relativePath = path.relative(rootPath, childPath);
    if (child.isDirectory()) {
      entries.push({ type: "dir", path: relativePath });
      walkDirectory(rootPath, childPath, entries);
      continue;
    }

    const stats = fs.statSync(childPath);
    entries.push({
      type: "file",
      path: relativePath,
      size: stats.size,
      mtimeMs: Math.trunc(stats.mtimeMs),
    });
  }
}
