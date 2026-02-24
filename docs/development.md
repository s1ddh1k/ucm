# UCM Development Guide

## 프로젝트 구조

```
ucm/
├── bin/                    # CLI 진입점 (실행 래퍼)
│   ├── ucm.js              #   통합 CLI (forge, list, approve, dashboard, ...)
│   ├── ucmd.js              #   데몬 실행 엔트리
│   ├── ucm-dev.js           #   개발 모드 CLI
│   ├── ucmd-dev.js          #   개발 모드 데몬
│   ├── ucm-watchdog.js      #   프로세스 감시
│   ├── hm.js                #   Hivemind CLI
│   ├── hmd.js               #   Hivemind 데몬
│   ├── rsa.js / qna.js / spec.js / req.js / prl.js
│   │                        #   독립 도구 CLI
│
├── lib/                    # 핵심 구현
│   ├── core/               #   AI 에이전트, LLM, worktree, task DAG
│   │   ├── llm.js           #     LLM 프로바이더 추상화
│   │   ├── agent.js         #     코드 에이전트 (Claude CLI spawn)
│   │   ├── browser-agent.js #     브라우저 에이전트 (Chrome DevTools)
│   │   ├── task.js          #     TaskDag (스테이지 이력, 토큰 추적)
│   │   ├── worktree.js      #     Git worktree + artifact 관리
│   │   ├── constants.js     #     파이프라인 정의, 타임아웃
│   │   ├── rsa.js           #     Recursive Self-Aggregation
│   │   ├── qna.js           #     Q&A 인터랙션
│   │   ├── spec.js          #     EARS 명세 생성
│   │   ├── parallel.js      #     병렬 실행 유틸
│   │   └── browser.js       #     Puppeteer 유틸
│   │
│   ├── forge/              #   파이프라인 스테이지 모듈
│   │   ├── index.js         #     ForgePipeline 클래스 + wireEvents
│   │   ├── intake.js        #     복잡도 분류
│   │   ├── clarify.js       #     요구사항 정제
│   │   ├── specify.js       #     명세 생성
│   │   ├── decompose.js     #     서브태스크 분해
│   │   ├── design.js        #     설계
│   │   ├── implement.js     #     구현
│   │   ├── verify.js        #     검증
│   │   ├── ux-review.js     #     UX 리뷰
│   │   ├── polish.js        #     코드 품질 개선
│   │   ├── integrate.js     #     통합
│   │   └── deliver.js       #     결과 정리/머지
│   │
│   ├── hivemind/           #   Zettelkasten 지식 메모리
│   │   ├── store.js         #     SQLite 저장소
│   │   ├── search.js        #     BM25 + keyword + knowledge graph 검색
│   │   ├── indexer.js       #     콘텐츠 인덱싱
│   │   ├── extract.js       #     지식 추출
│   │   ├── lifecycle.js     #     Ebbinghaus 쇠퇴, GC
│   │   └── adapters/        #     Claude/Codex/Document 어댑터
│   │
│   ├── ucmd.js             #   메인 데몬 (태스크 큐, processLoop)
│   ├── ucmd-constants.js   #   상수, 기본 설정
│   ├── ucmd-handlers.js    #   소켓 메서드 핸들러
│   ├── ucmd-server.js      #   Unix Socket 서버
│   ├── ucmd-task.js        #   태스크 파싱, git 유틸
│   ├── ucmd-observer.js    #   자동 프로젝트 분석
│   ├── ucmd-autopilot.js   #   자율 실행 세션
│   ├── ucmd-refinement.js  #   대화형 Q&A 정제
│   ├── ucmd-proposal.js    #   제안서 관리
│   ├── ucmd-sandbox.js     #   Self-modification 안전장치
│   ├── ucmd-prompt.js      #   템플릿 로딩
│   ├── ucmd-structure.js   #   프로젝트 구조 분석
│   ├── ucm-ui-server.js    #   대시보드 HTTP/WS 서버 (web/dist 정적 서빙)
│   └── socket-client.js    #   소켓 클라이언트 유틸
│
├── web/                    # React 대시보드
│   ├── src/
│   │   ├── api/             #   HTTP/WS 클라이언트, TypeScript 타입
│   │   ├── components/      #   UI 컴포넌트 (tasks, proposals, autopilot, ...)
│   │   ├── hooks/           #   커스텀 훅 (useWebSocket, useAutoScroll, ...)
│   │   ├── queries/         #   React Query (tasks, stats, proposals, autopilot)
│   │   ├── routes/          #   페이지 (dashboard, tasks, proposals, settings, ...)
│   │   ├── stores/          #   Zustand 상태 (daemon, events, ui, terminal)
│   │   └── lib/             #   유틸, 상수, 포맷터
│   └── package.json
│
├── templates/              # 프롬프트 템플릿 (ucm-*.md, rsa-*.md, qna-*.md)
├── test/                   # 테스트 스위트
├── scripts/                # 설치/배포 스크립트
├── skill/                  # Claude Code 스킬 (recall.md)
├── docs/                   # 문서
└── package.json            # 루트 패키지 설정
```

---

## 개발 환경 설정

### 설치

```bash
cd ~/git/ucm
npm install
bash scripts/setup-dev.sh    # ucm-dev, ucmd-dev 명령어 등록
```

### Dev vs Release 모드

| | 개발 (`ucm-dev`) | 운영 (`ucm`) |
|---|---|---|
| 소스 | `~/git/ucm/` (git repo) | `~/.ucm/release/` (스냅샷) |
| 데이터 | `~/.ucm-dev/` | `~/.ucm/` |
| UI 포트 | 17173 | 17172 |
| 소켓 | `~/.ucm-dev/daemon/ucm.sock` | `~/.ucm/daemon/ucm.sock` |
| 코드 반영 | 데몬 재시작 시 즉시 | `ucm-dev release`로 갱신 |

### 개발 워크플로

```bash
# 1. 코드 수정
vim lib/forge/index.js

# 2. 테스트
node test/core.test.js

# 3. 개발 데몬으로 확인
ucm-dev daemon stop && ucm-dev daemon start
ucm-dev submit --title "테스트" --project ~/git/some-project
ucm-dev start <taskId>

# 4. 프론트엔드 개발 (HMR)
cd web && npm run dev

# 5. 안정 확인 후 릴리즈
ucm-dev release
```

---

## 테스트

### 실행

```bash
# 전체 테스트 스위트
npm test

# 릴리즈 전 최소 검증
node test/core.test.js
cd web && npm run build
cd ucm-desktop && bun run build

# 추가 개별 실행
node test/ucm.test.js          # UCM 종합 테스트
node test/hivemind.test.js     # Hivemind 테스트
node test/integration.js       # 통합 테스트 (Socket + HTTP API)
node test/browser.js           # 브라우저 에이전트 테스트
```

### 테스트 격리

`UCM_DIR` 환경변수로 데이터 디렉토리를 격리한다. 테스트는 `/tmp/ucm-test-{pid}` 를 사용하여 운영 데몬과 충돌하지 않는다.

### 대시보드 E2E 테스트

```bash
# 전체 (릴리즈 전)
UCM_BROWSER_AGENT_PROVIDER=codex node test/dashboard.test.js --profile full

# 스모크 (빠른 확인)
UCM_BROWSER_AGENT_PROVIDER=codex node test/dashboard.test.js --profile smoke

# 변경 파일 기반 자동 추정
UCM_BROWSER_AGENT_PROVIDER=codex node test/dashboard.test.js --profile changed

# Watch 모드 (개발 중 반복 검증)
UCM_BROWSER_AGENT_PROVIDER=codex node test/dashboard.test.js --watch --layer browser --groups "Task CRUD"

# 특정 케이스만
UCM_BROWSER_AGENT_PROVIDER=codex node test/dashboard.test.js --layer browser --ids "TC-023,TC-050"
```

---

## 프론트엔드

### 기술 스택

- React 19, TypeScript, Vite
- Tailwind CSS 4 (utility-first)
- Radix UI (headless 컴포넌트)
- React Query (서버 상태 관리)
- Zustand (클라이언트 상태)
- Lucide React (아이콘)

### 빌드

```bash
cd web
npm install
npm run dev      # 개발 서버 (HMR)
npm run build    # 프로덕션 빌드 → web/dist/
```

프로덕션 빌드 결과(`web/dist`)는 `ucm-ui-server.js`가 정적 파일로 서빙한다.

### 디렉토리 규칙

| 디렉토리 | 규칙 |
|----------|------|
| `components/ui/` | Radix 래퍼 (shadcn/ui 스타일) — 범용 |
| `components/{domain}/` | 도메인별 컴포넌트 (tasks, proposals, autopilot) |
| `components/shared/` | 공유 컴포넌트 (EmptyState, StatusDot, TimeAgo) |
| `routes/` | 페이지 컴포넌트 (라우터 진입점) |
| `queries/` | React Query 훅 (useTasksQuery, useStageGateApprove, ...) |
| `stores/` | Zustand 스토어 (daemon, events, ui, terminal) |
| `hooks/` | 커스텀 훅 (useWebSocket, useAutoScroll, ...) |
| `api/` | HTTP/WS 클라이언트, TypeScript 타입 |

---

## 새 기능 추가 가이드

### 새 소켓 메서드 추가

1. `lib/ucmd-handlers.js` — 핸들러 함수 작성, `module.exports`에 추가
2. `lib/ucmd-server.js` — `socketHandlers` 객체에 등록
3. `lib/ucmd.js` — `handlers()` 객체에 추가, 필요하면 `setDeps()`에 의존성 추가
4. `lib/ucm-ui-server.js` — HTTP proxy route 추가 (PROXY_ROUTES 배열)

### 새 Forge 스테이지 추가

1. `lib/forge/{stage-name}.js` 생성 — `run()` 함수 export
2. `lib/core/constants.js` — FORGE_PIPELINES에 스테이지 추가
3. `lib/core/constants.js` — STAGE_TIMEOUTS, STAGE_ARTIFACTS 설정

### 새 프론트엔드 기능 추가

1. `web/src/api/types.ts` — TypeScript 타입 추가
2. `web/src/api/client.ts` — API 호출 함수 추가
3. `web/src/queries/{domain}.ts` — React Query 훅 추가
4. `web/src/hooks/use-websocket.ts` — WS 이벤트 핸들러 추가 (필요시)
5. `web/src/components/` — UI 컴포넌트 추가/수정
6. `web/src/routes/` — 페이지 컴포넌트 수정 (필요시)

---

## 릴리즈

```bash
# 1. 릴리즈 전 최소 검증
node test/core.test.js
cd web && npm run build && cd ..
cd ucm-desktop && bun run build && cd ..

# 2. (선택) 전체 테스트 스위트
npm test

# 3. 릴리즈 (~/.ucm/release/ 복사 → prod 데몬 재시작)
ucm-dev release

# 4. 운영 확인
ucm list
```

---

## 설정 (config.json)

`~/.ucm/config.json` 에서 데몬 동작을 제어한다. 기본값은 `lib/ucmd-constants.js`의 `DEFAULT_CONFIG`에 정의되어 있다.

주요 설정:

| 키 | 기본값 | 설명 |
|----|--------|------|
| `concurrency` | `1` | 동시 실행 태스크 수 |
| `provider` | `"claude"` | LLM 프로바이더 |
| `model` | `"opus"` | 기본 모델 |
| `httpPort` | `17171` | 데몬 HTTP 포트 |
| `uiPort` | `17172` | UI 서버 포트 |
| `stageApproval` | 모두 `true` | 스테이지별 auto-approve 설정 |
| `resources` | `{cpuThreshold, memoryMinFreeMb, ...}` | 리소스 압력 임계값 |
| `quota` | `{source, mode, ...}` | API 쿼타 관리 |
| `observer` | `{enabled, intervalMs, ...}` | Observer 설정 |
| `autopilot` | `{releaseEvery, maxItems, ...}` | Autopilot 설정 |
| `selfImprove` | `{enabled, maxRisk, ...}` | Self-improvement 설정 |
| `regulator` | `{enabled, maxRiskForAutoApprove, ...}` | Regulator 설정 |
