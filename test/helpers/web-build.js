const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const WEB_DIR = path.join(__dirname, "..", "..", "web");
const DIST_INDEX = path.join(WEB_DIR, "dist", "index.html");

let builtInProcess = false;

function ensureWebDistBuilt() {
  if (builtInProcess) return;
  if (fs.existsSync(DIST_INDEX)) {
    builtInProcess = true;
    return;
  }

  execFileSync("npm", ["run", "build"], {
    cwd: WEB_DIR,
    stdio: "inherit",
  });
  builtInProcess = true;
}

module.exports = { ensureWebDistBuilt };

