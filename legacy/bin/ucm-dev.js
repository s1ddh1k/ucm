#!/usr/bin/env node
// ucm-dev — 개발 인스턴스 CLI
// UCM_DIR을 ~/.ucm-dev로 설정하여 운영과 격리
const { applyDevEnv } = require("./dev-env.js");

applyDevEnv({ setUiPort: true });
require("./ucm.js");
