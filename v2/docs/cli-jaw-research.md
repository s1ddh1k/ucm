# CLI-JAW 조사 보고서

> 출처: https://github.com/lidge-jun/cli-jaw
> 조사일: 2026-03-02
> 버전: 1.2.1 / Node.js >= 22 / TypeScript 5.7 / MIT(ISC)

---

## 한줄 요약

5개 AI CLI(Claude, Codex, Gemini, OpenCode, Copilot)를 오케스트레이션하는 로컬 개인 AI 비서. 웹(localhost:3457) + 터미널 TUI + 텔레그램 봇 인터페이스.

---

## 핵심 아이디어

| 항목 | 설명 |
|------|------|
| **CLI-native 스폰** | API 키 대신 각 벤더의 공식 CLI 바이너리를 stdio로 spawn. 밴 위험 없음 |
| **자동 Fallback** | claude → codex → gemini 순으로 엔진 장애 시 자동 전환 |
| **멀티 에이전트 오케스트레이션** | 복잡한 요청은 triage → 서브에이전트 분산 (5-phase pipeline) |
| **108 스킬** | 17 active(시스템 프롬프트 주입) + 90 reference(온디맨드 참조) |
| **MCP 단일 설정** | 하나의 `mcp.json`이 5개 CLI 포맷으로 자동 변환 |

---

## 아키텍처

```
┌─────────────────────────────────────────────────┐
│              USER INTERFACES                    │
│  Web UI (ES Modules)  │  Terminal TUI  │  Telegram Bot  │
│        HTTP+WS        │     HTTP       │    Grammy      │
├───────────────────────┴────────────────┴────────┤
│            EXPRESS SERVER (server.ts)            │
│  40+ REST endpoints · WebSocket · Security      │
├─────────────────────────────────────────────────┤
│                 CORE ENGINE                     │
│  agent.ts    → CLI spawn + ACP + queue          │
│  orchestrator.ts → triage + 5-phase pipeline    │
│  events.ts   → NDJSON 파싱 + 이벤트 중복제거    │
│  prompt.ts   → 시스템/서브에이전트 프롬프트 조립 │
│  commands.ts → 슬래시 명령 레지스트리            │
├─────────────────────────────────────────────────┤
│              INFRASTRUCTURE                     │
│  SQLite DB · Memory · MCP Sync · CLI Registry   │
│  Security Guards · Browser CDP · Heartbeat      │
├─────────────────────────────────────────────────┤
│              CLI BINARIES (spawned)              │
│  claude · codex · gemini · opencode · copilot   │
└─────────────────────────────────────────────────┘
```

### 오케스트레이션 파이프라인

```
User Request
  → needsOrchestration() AI triage
    → Simple: 단일 에이전트 직접 응답
    → Complex: Planning → Review → Dev → Debug → Integration
       (각 phase 사이 gate review)
```

### 소스 구조

```
src/
  agent/        에이전트 라이프사이클 (spawn, events, args)
  browser/      Chrome CDP 자동화
  cli/          CLI 레지스트리 + 프리셋
  orchestrator/ 멀티에이전트 파이프라인 (collect, distribute, gateway, parser, pipeline)
  routes/       40+ REST 엔드포인트
  telegram/     봇 통합
  core/         config, db, bus, memory
  security/     path traversal, ID injection 방어
  http/         ok()/fail() 표준화, 에러 미들웨어
  prompt/       시스템 프롬프트 조립
  memory/       영구 메모리 (MEMORY.md + daily log)
  command-contract/  capability-based 접근 제어
server.ts       Express 서버 (~949줄)
```

---

## 기술 스택

| 영역 | 기술 |
|------|------|
| 런타임 | Node.js >= 22 (ESM only) |
| 언어 | TypeScript 5.7 strict |
| 서버 | Express 4 |
| DB | better-sqlite3 |
| 텔레그램 | Grammy |
| 브라우저 | Playwright-core (Chrome CDP) |
| WebSocket | ws |
| 보안 | Helmet |
| 프론트엔드 | Vanilla ES Modules (marked + hljs + KaTeX + Mermaid) |
| 빌드 | esbuild + tsc |
| 테스트 | node:test (608 passing) |

---

## 설치 및 실행

```bash
npm install -g cli-jaw
jaw serve
# → http://localhost:3457
```

AI 엔진 인증 (최소 1개):
```bash
copilot login    # 무료
opencode         # 무료 모델 있음
claude auth      # Anthropic
codex login      # OpenAI
gemini           # Google
```

상태 확인: `jaw doctor`

### CLI 명령어

| 명령어 | 설명 |
|--------|------|
| `jaw serve` | 웹 서버 시작 (localhost:3457) |
| `jaw service install` | 시스템 서비스 등록 (systemd/launchd/Docker) |
| `jaw chat` | 터미널 TUI 채팅 |
| `jaw doctor` | 환경 진단 |
| `jaw skill install` | 스킬 설치 |
| `jaw mcp install` | MCP 서버 설치 |
| `jaw memory search` | 메모리 검색 |
| `jaw browser start` | Chrome 자동화 시작 |
| `jaw clone` | 인스턴스 복제 |
| `jaw reset` | 초기화 |

### Docker

```bash
docker-compose up    # production
# 또는 Dockerfile.dev로 개발 환경
```

비root 실행, Chromium sandbox 활성, 호스트 접근 차단.

---

## 주요 기능 상세

### 1. 멀티 엔진 스폰

공식 CLI 바이너리를 `child_process.spawn`으로 실행. NDJSON stdout 스트리밍.
Copilot만 ACP(JSON-RPC 2.0 over stdio) 프로토콜 사용.

- API 키 불필요 (벤더 OAuth/keychain 인증)
- 크로스플랫폼: macOS, Linux, WSL (.cmd shim 지원)

### 2. 이벤트 중복제거

Claude는 `stream_event`와 `assistant` 블록을 중복 발행함.
`events.ts`가 `hasClaudeStreamEvents` 플래그로 중복 차단.

### 3. MCP 동기화

하나의 `~/.cli-jaw/mcp.json`을 5개 포맷으로 변환:

| CLI | 대상 파일 | 포맷 |
|-----|----------|------|
| Claude | `~/.claude/mcp.json` | JSON |
| Codex | `~/.codex/codex.toml` | TOML |
| Gemini | `~/.gemini/settings.json` | JSON |
| OpenCode | `~/.opencode/opencode-mcp.json` | JSON |
| Copilot | 세션별 주입 | — |

### 4. 스킬 시스템

- **Active (17개)**: 시스템 프롬프트에 자동 주입
- **Reference (90개)**: AI가 필요 시 온디맨드로 읽음
- 브라우저 제어, GitHub 통합, Notion, 메모리, 텔레그램, 이미지 생성, 문서 처리 등

### 5. 브라우저 자동화

Chrome CDP 기반. snapshot → click → navigate → screenshot.
Vision Click: 스크린샷 → AI 좌표 추출 → DPR 보정 → 클릭.

### 6. 영구 메모리

`~/.cli-jaw/memory/MEMORY.md` + daily 자동 로그.
세션 종료 시 flush, 시스템 프롬프트에 주입.

### 7. 텔레그램 봇

Grammy 기반. 음성/사진/파일 전송 지원.
양방향 포워딩, origin-based 라우팅.

### 8. 하트비트

반복 일정 등록 → 자동 실행. active/quiet hours 지원.

---

## 런타임 데이터 (`~/.cli-jaw/`)

| 경로 | 설명 |
|------|------|
| `jaw.db` | SQLite (세션, 메시지) |
| `settings.json` | 사용자 설정 |
| `mcp.json` | MCP 통합 설정 (단일 소스) |
| `prompts/` | A-1, A-2, HEARTBEAT 템플릿 |
| `memory/` | 영구 메모리 |
| `skills/` | 활성 스킬 |
| `skills_ref/` | 참조 스킬 |
| `browser-profile/` | Chrome 프로필 |
| `heartbeat.json` | 스케줄 정의 |
| `worklogs/` | 오케스트레이션 워크로그 |

---

## UCM과의 비교

| 항목 | CLI-JAW | UCM v2 |
|------|---------|--------|
| **AI 엔진** | 5개 (Claude, Codex, Gemini, OpenCode, Copilot) | 2개 (Claude, Codex) |
| **인터페이스** | Web + Terminal TUI + Telegram | CLI + Web 대시보드 + Electrobun 앱 |
| **핵심 패턴** | CLI spawn + 오케스트레이션 | Worktree + implement/verify 루프 |
| **목적** | 범용 AI 비서 (채팅, 자동화, 문서) | 코드 자기개선 (태스크 → 구현 → 검증 → 머지) |
| **MCP** | 5-CLI 자동 동기화 | 미적용 |
| **스킬** | 108개 내장 | 없음 (에이전트가 직접 수행) |
| **메모리** | MEMORY.md + daily log + grep | Hivemind Zettelkasten |
| **테스트** | 608 (node:test) | 109 (자체 harness) |
| **런타임** | Node.js >= 22 | Bun |
| **DB** | SQLite (better-sqlite3) | 파일 기반 상태 |

### 참고할 만한 패턴

1. **Fallback chain**: 엔진 장애 시 자동 전환 — UCM에도 적용 가능
2. **MCP 동기화**: 단일 설정 → 멀티 CLI 포맷 변환
3. **오케스트레이션 triage**: AI가 직접 복잡도 판단 → 단일/멀티 분기
4. **이벤트 중복제거**: Claude NDJSON 스트림 특유의 중복 처리
5. **CLI 레지스트리**: 엔진 메타데이터 단일 소스 패턴

---

## REST API 요약

| 카테고리 | 엔드포인트 |
|----------|-----------|
| Core | `GET /api/session`, `POST /api/message`, `POST /api/stop` |
| Registry | `GET /api/cli-registry` |
| Orchestration | `POST /api/orchestrate/continue`, `POST /api/employees/reset` |
| Commands | `POST /api/command`, `GET /api/commands?interface=` |
| Settings | `GET/PUT /api/settings`, `GET/PUT /api/prompt` |
| Memory | `GET/POST /api/memory`, `GET /api/jaw-memory/search` |
| MCP | `GET/PUT /api/mcp`, `POST /api/mcp/sync,install,reset` |
| Skills | `GET /api/skills`, `POST /api/skills/enable,disable` |
| Browser | `POST /api/browser/start,stop,act,navigate,screenshot` |
| Employees | `GET/POST /api/employees`, `PUT/DELETE /api/employees/:id` |
| Quota | `GET /api/quota` |

---

## 수치

- Stars: 45 / Forks: 3
- 생성일: 2025-02-25
- 최근 업데이트: 2026-03-01
- 테스트: 608 passing
- 코어 파일: ~4,000줄 (server.ts 949줄 포함)
- 프론트엔드: ~4,000줄 (HTML+CSS+JS)
