const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { validateWebDist } = require("../../lib/core/web-dist.js");

const WEB_DIR = path.join(__dirname, "..", "..", "web");
const DIST_DIR = path.join(WEB_DIR, "dist");

function ensureWebDistBuilt() {
  const initial = validateWebDist(DIST_DIR);
  if (initial.ok) return;

  execFileSync("npm", ["run", "build"], {
    cwd: WEB_DIR,
    stdio: "inherit",
  });

  const afterBuild = validateWebDist(DIST_DIR);
  if (!afterBuild.ok) {
    const suffix = afterBuild.missingAssets?.length
      ? ` (missing: ${afterBuild.missingAssets.join(", ")})`
      : "";
    throw new Error(
      `web dist validation failed after build: ${afterBuild.reason}${suffix}`,
    );
  }
}

module.exports = { ensureWebDistBuilt };
