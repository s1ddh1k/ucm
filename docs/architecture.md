# UCM Architecture

## Overview

UCM(Ultimate Click Machine)은 AI 에이전트 오케스트레이션 시스템이다. 두 개의 파이프라인 엔진이 태스크를 처리하고, 데몬이 상태를 관리하며, 웹 대시보드가 사용자 인터페이스를 제공한다.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Web Dashboard (React)                       │
│                        localhost:17172                               │
├─────────────────────────┬───────────────────────────────────────────┤
│   ucm-ui-server.js      │         WebSocket Events                  │
│   HTTP + WS Proxy       │         (stage:*, task:*, daemon:*)       │
├─────────────────────────┴───────────────────────────────────────────┤
│                                                                     │
│   ucmd.js — Daemon (Unix Socket: ~/.ucm/daemon/ucm.sock)           │
│                                                                     │
│   ┌──────────────┐  ┌───────────────┐  ┌──────────────────┐       │
│   │ Task Queue   │  │ Forge Pipeline│  │ Observer/Autopilot│       │
│   │ (processLoop)│──│ (ForgePipeline│  │ (ucmd-autopilot, │       │
│   │              │  │  per task)    │  │  ucmd-observer)  │       │
│   └──────────────┘  └───────────────┘  └──────────────────┘       │
│                            │                                        │
│                     ┌──────┴──────┐                                 │
│                     │ Git Worktree│                                 │
│                     │ (격리 실행) │                                 │
│                     └─────────────┘                                 │
├─────────────────────────────────────────────────────────────────────┤
│   lib/core/          AI Agent Layer                                 │
│   agent.js           Claude/Codex/Gemini CLI spawn                 │
│   llm.js             LLM 텍스트/JSON 추상화                        │
│   browser-agent.js   Chrome DevTools MCP 브라우저 에이전트          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Daemon (ucmd.js)

백그라운드 프로세스로 태스크 큐, 파이프라인 실행, 리소스 모니터링을 담당한다.

### 통신

- **Unix Socket** (`~/.ucm/daemon/ucm.sock`) — JSON-line 프로토콜로 CLI/UI 서버와 통신
- **WebSocket** — Socket subscriber에게 이벤트 브로드캐스트

### 태스크 라이프사이클

```
submit → pending → start → running → review → approve → done
                                   ↘ reject (with feedback) → running (resume)
                                   ↘ reject (no feedback) → failed
                          ↘ error → failed → retry → pending
                          ↘ cancel → failed
```

태스크 파일은 `~/.ucm/tasks/{state}/{taskId}.md` 에 YAML frontmatter + body 형식으로 저장된다.

### 모듈 구성

| 모듈 | 역할 |
|------|------|
| `ucmd-constants.js` | 경로, 기본 설정, 상수 |
| `ucmd-handlers.js` | 소켓 메서드 핸들러 (submit, approve, reject, config 등) |
| `ucmd-server.js` | Unix Socket 서버, WebSocket 브로드캐스트 |
| `ucmd-task.js` | 태스크 파싱, git 유틸, 프로세스 관리 |
| `ucmd-observer.js` | 주기적 프로젝트 분석, 개선 제안 생성 |
| `ucmd-autopilot.js` | 자율 실행 세션 (planning → execution → release) |
| `ucmd-refinement.js` | 대화형 요구사항 정제 (Q&A) |
| `ucmd-proposal.js` | 제안서 CRUD |
| `ucmd-sandbox.js` | Self-modification 안전장치 |
| `ucmd-prompt.js` | 템플릿 로딩 |
| `ucmd-structure.js` | 프로젝트 구조 분석 |

### 의존성 주입

`setDeps()` 패턴으로 모듈 간 의존성을 주입한다. `startDaemon()` 에서 각 모듈에 런타임 의존성을 전달하며, config/daemonState는 getter 함수로 전달하여 항상 최신 값을 참조한다.

```js
ucmdHandlers.setDeps({
  config: () => config,
  daemonState: () => daemonState,
  log, broadcastWs, markStateDirty,
  inflightTasks, taskQueue,
  activeForgePipelines,
  reloadConfig: loadConfig,
  // ...
});
```

---

## Forge Pipeline (lib/forge/)

소프트웨어 작업을 스테이지별로 분해하여 AI 에이전트가 실행하는 파이프라인 엔진.

### 파이프라인 유형

| 파이프라인 | 단계 | 용도 |
|-----------|------|------|
| **trivial** | implement → verify → deliver | 오타, 한 줄 수정 |
| **small** | design → implement → verify → deliver | 함수 추가, 간단한 기능 |
| **medium** | clarify → specify → design → implement → verify → ux-review → polish → deliver | 일반적인 기능 개발 |
| **large** | clarify → specify → decompose → design → implement → verify → ux-review → polish → integrate → deliver | 대규모 리팩토링 |

### ForgePipeline 클래스

`EventEmitter`를 상속하며, 각 스테이지를 순차 실행한다.

```
constructor → run() → runIntake() → [stages...] → learnToHivemind()
                                        ↓
                                   runStage(name)
                                        ↓
                               waitForStageGate(name)  ← Stage Approval Gate
```

주요 메서드:

| 메서드 | 역할 |
|--------|------|
| `run()` | 파이프라인 전체 실행 |
| `runStage(name)` | 단일 스테이지 실행 |
| `runIntake()` | 복잡도 분류 (파이프라인 자동 결정) |
| `runSubtaskStages()` | decompose 후 서브태스크 병렬 실행 |
| `runImplementVerifyLoop()` | implement → verify 반복 (최대 3회) |
| `waitForStageGate(name)` | Stage Approval Gate 대기 |
| `resolveGate(action, feedback)` | Gate 승인/거절 |
| `abort()` | 파이프라인 중단 |

### 이벤트

| 이벤트 | 데이터 | 설명 |
|--------|--------|------|
| `pipeline:start` | `{pipeline, input}` | 파이프라인 시작 |
| `pipeline:complete` | `{status}` | 파이프라인 완료 |
| `pipeline:error` | `{error}` | 파이프라인 에러 |
| `stage:start` | `{stage}` | 스테이지 시작 |
| `stage:complete` | `{stage, durationMs, status}` | 스테이지 완료 |
| `stage:gate` | `{stage, status}` | Gate 승인 대기 |
| `stage:gate_resolved` | `{stage, action}` | Gate 해제 |
| `agent:output` | `{stage, chunk}` | AI 에이전트 출력 (실시간) |

### 스테이지 모듈

각 스테이지는 `lib/forge/{name}.js` 파일로 구현된다. 공통 인터페이스:

```js
async function run({ taskId, dag, project, autopilot, subtask, timeouts, onLog }) {
  // 1. 아티팩트 로드
  // 2. AI 에이전트 실행
  // 3. 결과 저장
  return { status: "pass", tokenUsage: { input, output } };
}
```

---

## Stage Approval Gate

각 스테이지 완료 후 사용자 승인을 받을 수 있는 게이트 메커니즘.

### 동작 원리

```
Stage 실행 완료
     ↓
stageApproval[stage] === false ?
     ├── Yes → stage:gate 이벤트 발행, Promise 블로킹
     │          ↓
     │    resolveGate("approve") → 다음 스테이지 진행
     │    resolveGate("reject")  → 파이프라인 실패
     │
     └── No (기본값: true) → 자동 통과, 다음 스테이지 진행
```

### 설정

`~/.ucm/config.json`의 `stageApproval` 필드에서 스테이지별 auto-approve를 설정한다:

```json
{
  "stageApproval": {
    "clarify": true,
    "specify": true,
    "decompose": true,
    "design": false,
    "implement": false,
    "verify": true,
    "ux-review": true,
    "polish": true,
    "integrate": true
  }
}
```

- `true` (기본값): 자동 통과 — 기존 동작과 동일
- `false`: 수동 승인 대기 — 대시보드에서 Approve/Reject

`intake`와 `deliver`는 항상 자동 통과한다.

### API

| 메서드 | 엔드포인트 | 설명 |
|--------|-----------|------|
| POST | `/api/stage-gate/approve/{taskId}` | 현재 gate 승인 |
| POST | `/api/stage-gate/reject/{taskId}` | 현재 gate 거절 |
| GET | `/api/config` | 설정 조회 |
| POST | `/api/config` | 설정 변경 |

### 대시보드 UI

- **Pipeline Stepper**: gate 대기 중인 스테이지는 amber Pause 아이콘으로 표시
- **Task Detail**: gate 활성 시 "Approve Stage" / "Reject Stage" 버튼 표시
- **Settings**: Stage Approval 카드에서 스테이지별 auto-approve 토글

---

## 자율 개선 루프

```
Observer → Proposal → Regulator → Forge → Evaluation → Learning → 반복
```

| 단계 | 역할 |
|------|------|
| **Observer** | 프로젝트 분석, 메트릭스 스냅샷, 개선 기회 식별 |
| **Proposal** | 구체적인 개선 제안 생성 (dedup hash로 중복 방지) |
| **Regulator** | 위험도 검증, 최근 실패 패턴 차단 |
| **Forge** | 승인된 제안을 코드 변경으로 실행 |
| **Evaluation** | baseline vs current 메트릭스 비교 |
| **Learning** | Hivemind에 실행 경험 축적 |

---

## Git Worktree 격리

모든 태스크는 격리된 git worktree에서 실행된다:

```
~/.ucm/worktrees/{taskId}/{projectName}/   ← 코드 수정 공간
```

- 원본 프로젝트는 건드리지 않음
- `ucm approve` 시 worktree 브랜치(`ucm/{taskId}`)가 원본에 머지
- 태스크 취소/실패 시 worktree 자동 정리

---

## UI Server (ucm-ui-server.js)

브라우저에 대시보드를 제공하는 HTTP/WebSocket 서버.

```
Browser ←→ ucm-ui-server.js (port 17172) ←→ ucmd.js (Unix Socket)
                 ↑
           HTTP Proxy Routes
           WebSocket Bridge
           PTY Sessions (xterm.js)
```

- **HTTP Proxy Routes**: REST API 요청을 데몬 소켓으로 프록시
- **WebSocket Bridge**: 데몬 이벤트를 브라우저에 브로드캐스트
- **PTY Sessions**: Claude CLI 채팅 세션 (node-pty + xterm.js)

---

## 데이터 디렉토리

```
~/.ucm/
├── config.json             # 데몬 설정 (concurrency, provider, stageApproval, ...)
├── daemon/
│   ├── ucm.sock            # Unix Socket
│   ├── ucmd.pid            # PID 파일
│   ├── ucmd.log            # 데몬 로그
│   └── state.json          # 데몬 상태 (activeTasks, stats)
├── tasks/{state}/{id}.md   # 태스크 파일 (YAML frontmatter + body)
├── forge/{taskId}/         # TaskDag (task.json)
├── artifacts/{taskId}/     # 스테이지 산출물
├── worktrees/{taskId}/     # Git worktree
├── proposals/              # 개선 제안서
├── snapshots/              # 메트릭 스냅샷
├── lessons/                # 실행 교훈
├── logs/                   # 태스크별 실행 로그
├── chat/                   # 채팅 세션 데이터
├── autopilot/              # Autopilot 세션
└── workspaces/             # 임시 워크스페이스 (프로젝트 미지정 시)
```

---

## LLM Provider 추상화

`lib/core/llm.js`가 여러 LLM 프로바이더를 추상화한다:

| 프로바이더 | CLI | 용도 |
|-----------|-----|------|
| `claude` | `claude` | 코드 에이전트, 브라우저 에이전트 (기본) |
| `codex` | `codex` | 코드 에이전트, 브라우저 에이전트 |
| `gemini` | `gemini` | 브라우저 에이전트 (기본 브라우저 프로바이더) |

주요 함수:

| 함수 | 역할 |
|------|------|
| `llmText(prompt, opts)` | 텍스트 응답 |
| `llmJson(prompt, opts)` | JSON 응답 (스키마 검증) |
| `spawnAgent(prompt, opts)` | CLI 에이전트 실행 (코드 수정 권한) |
| `browserAgent(url, instruction)` | Chrome DevTools 브라우저 에이전트 |
