#!/usr/bin/env node
// ucm-dev — 개발 인스턴스 CLI
// UCM_DIR을 ~/.ucm-dev로 설정하여 운영과 격리
process.env.UCM_DIR = process.env.UCM_DIR || require("path").join(require("os").homedir(), ".ucm-dev");
process.env.UCM_UI_PORT = process.env.UCM_UI_PORT || "17173";
require("../lib/ucm-cli.js");
