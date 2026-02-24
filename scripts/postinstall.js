#!/usr/bin/env node
const { execSync } = require("node:child_process");
const path = require("node:path");

// set up git hooks
try {
  const hooksDir = path.join(__dirname, "hooks");
  execSync(`git config core.hooksPath "${hooksDir}"`, { stdio: "ignore" });
} catch {}

const msg = `
  ucm 설치 완료!

  Claude Code /recall 스킬을 설치하려면:
    npm run install-skill

  사용 가능한 명령어:
    mem, memd, rsa, qna, spec, prl, req

  자세한 내용은 README.md를 참고하세요.
`;

console.log(msg);
