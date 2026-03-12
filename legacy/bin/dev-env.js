const os = require("node:os");
const path = require("node:path");

const DEV_UCM_DIR = path.join(os.homedir(), ".ucm-dev");
const DEV_UI_PORT = "17173";

function applyDevEnv(options = {}) {
  const { setUiPort = false } = options;
  process.env.UCM_DIR = process.env.UCM_DIR || DEV_UCM_DIR;

  if (setUiPort) {
    process.env.UCM_UI_PORT = process.env.UCM_UI_PORT || DEV_UI_PORT;
  }
}

module.exports = { applyDevEnv };
