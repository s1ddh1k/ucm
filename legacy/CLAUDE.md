## 구조

```
bin/              CLI → unix socket → lib/ucmd* 데몬
web/              React 대시보드 (localhost:17172)
ucm-desktop/      Electrobun 앱 (localhost:17173)
lib/hivemind/     Zettelkasten 메모리 (데이터: ~/.hivemind/)
lib/forge/        태스크 파이프라인
```

데이터: `~/.ucm/` (기본), `~/.ucm-dev/` (UCM_DEV=1), `~/.ucm-desktop/`

## 테스트

```bash
node test/core.test.js          # 코어
cd web && npm run build         # 프론트엔드
cd ucm-desktop && bun run build # 데스크톱
```
