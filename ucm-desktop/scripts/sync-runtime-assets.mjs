import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(desktopRoot, "..");
const outputRoot = path.join(desktopRoot, "resources", "runtime-config");

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

fs.rmSync(outputRoot, { recursive: true, force: true });
fs.mkdirSync(outputRoot, { recursive: true });

for (const source of sources) {
  fs.cpSync(source.from, source.to, { recursive: true });
}

console.log(`[ucm-runtime-assets] Synced runtime contracts and schemas to ${outputRoot}`);
