#!/usr/bin/env node
process.env.UCM_DIR = process.env.UCM_DIR || require("path").join(require("os").homedir(), ".ucm-dev");
require("./ucmd.js");
