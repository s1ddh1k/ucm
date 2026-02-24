# UCM 프로젝트 구조

## 구성요소

```
CLI (bin/)           사용자 명령 → 데몬 소켓 또는 포그라운드 실행
    ↕ unix socket
Daemon (lib/ucmd*)   태스크 큐, 상태 관리, 에이전트 스폰
    ↕ http + ws
Web (web/)           React 대시보드, localhost:17172
    ↕ embeds
Desktop (ucm-desktop/) Electrobun 앱, 데몬 내장 스폰, localhost:17173

Hivemind (lib/hivemind/) AI 세션에서 지식 추출·검색하는 Zettelkasten 메모리
    ↕ hook + cli
Claude/Codex 세션     SessionStart 훅으로 컨텍스트 주입, /recall로 검색

Forge (lib/forge/)   intake→clarify→design→implement→verify→polish→deliver 파이프라인
```

## 통신 경로

- **CLI ↔ Daemon**: Unix socket (`~/.ucm/daemon/ucm.sock`), JSON 요청/응답
- **Web ↔ Daemon**: HTTP API (`/api/*`) + WebSocket (실시간 로그)
- **Desktop → Daemon**: 자식 프로세스로 스폰, IPC로 ready 신호 수신
- **Hivemind → 세션**: SessionStart 훅으로 컨텍스트 자동 주입

## 데이터 디렉토리

- `~/.ucm/` — 기본 (daemon/, tasks/, worktrees/, artifacts/, logs/)
- `~/.ucm-dev/` — 개발용 (UCM_DEV=1)
- `~/.ucm-desktop/` — 데스크톱 앱 전용
- `~/.hivemind/` — 지식 저장소 (zettel/, index/, archive/)

## 포트

| 용도 | 포트 | 비고 |
|------|------|------|
| Web UI (기본) | 17172 | ucm ui |
| Web UI (dev/desktop) | 17173 | ucm-dev, ucm-desktop |

## 테스트

```bash
node test/core.test.js          # 코어 단위 테스트
cd web && npx tsc --noEmit      # 프론트엔드 타입 체크
cd ucm-desktop && bun run build # 데스크톱 빌드
```

## 작업 시 참고

- 데몬 변경은 CLI, 웹, 데스크톱 앱 모두에 영향을 준다
- 웹 API 변경은 프론트엔드 타입(web/src/api/)과 함께 수정한다
- forge 파이프라인 변경은 데몬 상태 전이와 일관성을 유지한다
- hivemind 변경은 훅 등록(hm init)과 검색 결과에 영향을 준다
