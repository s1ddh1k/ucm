# ucm — Ultimate Click Machine

AI 에이전트 오케스트레이션 시스템. 데몬이 Git worktree로 태스크를 격리하고, 파이프라인 스테이지별로 AI를 spawn하여 코드 작업을 자동화한다.

## 설치

### 릴리즈 (운영)
```bash
node ~/git/ucm/bin/ucm-dev.js release   # 개발 소스 → ~/.ucm/release/ 배포
cd ~/.ucm/release && npm link            # ucm, ucmd 명령어 등록
```

### 개발
```bash
cd ~/git/ucm
bash scripts/setup-dev.sh               # ucm-dev, ucmd-dev 명령어 등록
```

## 시작하기

```bash
# 대시보드
ucm ui

# 채팅
ucm chat

# 태스크 제출
ucm submit --title "버그 수정" --project ~/git/my-project

# 태스크 시작 (등록만 하면 pending 상태)
ucm start <taskId>

# 태스크 목록
ucm list

# 리뷰 승인/거절
ucm approve <taskId>
ucm reject <taskId> --feedback "이유"
```

## 아키텍처

```
ucm submit → pending 등록
               ↓
           ucm start
               ↓
           Git worktree 생성
               ↓
           파이프라인 실행
               ↓
         ┌─→ gather (요구사항 정제)
         │   analyze (코드 분석)
         │   implement (구현)
         │   test (테스트)
         │   self-review ──→ FAIL → implement (최대 3회)
         │        ↓ PASS
         └── review (사람 승인 대기)
```

### 파이프라인

| 파이프라인 | 스테이지 | 용도 |
|-----------|---------|------|
| quick | implement → test → self-review | 간단한 작업 |
| implement | gather → analyze → implement → test → self-review | 기본 구현 |
| research | analyze | 조사/분석만 |
| thorough | gather → spec → analyze → implement → test → self-review (RSA) | 대규모 작업 |

### 하네스

파이프라인 품질을 높이는 12개 결정적 하네스:

| 하네스 | 역할 |
|--------|------|
| context-prefetch | 관련 파일 사전 조립 (`git grep` + import 추적) |
| context-budget | 토큰 예산 관리 (변수별 우선순위) |
| convention-inject | 프로젝트 코딩 컨벤션 자동 주입 |
| task-refinement | 태스크 요구사항 구체화 (Interactive Q&A / Auto-pilot) |
| lesson-inject | 과거 교훈 자동 주입 (태그 매칭 + 지수 감쇠) |
| iteration-history | 반복 실패 기억 ("What NOT to repeat") |
| rsa-dedup | RSA 결과 중복 제거 (trigram Jaccard) |
| adaptive-loop | 실패 시그니처 추적, 동일 실패 반복 시 조기 중단 |
| deterministic-gate | 결정적 검증 (구문 검사, 린트, 테스트 출력 파싱) |
| drift-detector | 계획 vs 실행 드리프트 감지 |
| gate-parser-v2 | 강화된 게이트 파서 (모순 감지, 신뢰도 판정) |
| improvement-proposal | 범위 밖 개선 기회 구조화 추출 |

### 자기 개선 루프

```
관찰 (ucm observe) → 제안 생성 → 사람 선별 → 파이프라인 실행 → 평가 → 학습 → 반복
```

## 채팅

CLI와 웹 UI 양쪽에서 사용 가능. 세션이 유지되며, UCM 데몬 명령을 직접 실행할 수 있다.

```bash
ucm chat              # CLI 채팅
```

슬래시 명령: `/help`, `/clear`, `/memory`, `/compress`, `/new`

## CLI 명령어

| 명령어 | 설명 |
|--------|------|
| `ucmd start` | 데몬 시작 |
| `ucmd stop` | 데몬 종료 |
| `ucm submit` | 태스크 제출 |
| `ucm start <id>` | pending 태스크 시작 |
| `ucm list` | 태스크 목록 |
| `ucm status <id>` | 태스크 상태 |
| `ucm approve <id>` | 리뷰 승인 |
| `ucm reject <id>` | 리뷰 거절 |
| `ucm diff <id>` | 변경사항 확인 |
| `ucm logs <id>` | 실행 로그 |
| `ucm chat` | 채팅 모드 |
| `ucm observe` | 로그 분석 → 개선안 생성 |
| `ucm stats` | 데몬 통계 |

## Gen AI Native 프로시저

UCM은 **Gen AI Native** 패러다임을 따른다. 결정적(deterministic)으로 풀기 어렵거나 비용이 큰 문제를 AI 에이전트에게 자연어로 위임하고, 그 결과를 파이프라인에 다시 흘려보내는 구조다.

### 설계 원칙

**"코드로 풀 수 있으면 코드로, 아니면 AI에게 맡긴다."**

기존 소프트웨어 개발에서 결정적 코드가 처리하기 어려운 영역들이 있다:

- **브라우저 UI 검증** — DOM 구조를 assertion으로 커버하는 데 한계. 시각적 회귀, 레이아웃 깨짐, 접근성 문제는 사람 눈이 필요했다 → `browserAgent`가 대체
- **코드 리뷰** — 린트와 테스트만으로는 설계 의도, 네이밍 적절성, 보안 패턴을 잡지 못한다 → `spawnAgent`가 멀티렌즈 리뷰 수행
- **요구사항 정제** — 사용자의 모호한 요청을 실행 가능한 스펙으로 바꾸려면 대화가 필요하다 → `llmJson` + QnA 패턴
- **테스트 시나리오 생성** — 엣지 케이스를 사람이 일일이 나열하는 건 비효율적 → AI가 스펙에서 추출

UCM의 각 프로시저는 이런 영역을 하나씩 커버한다. 새 영역이 발견되면 프로시저를 추가한다.

### 프로시저 추가 방법

새 프로시저는 `lib/core/`에 모듈로 만들고, 파이프라인 스테이지나 CLI에서 호출한다.

**패턴:**

```
1. AI 도구 선택 (어떤 AI CLI + 어떤 MCP/도구 조합이 필요한가)
2. lib/core/<name>.js 에 래퍼 함수 작성
3. 시스템 프롬프트 설계 (AI가 무엇을 하고, 어떤 형식으로 반환할지)
4. 파이프라인 스테이지에서 호출하거나 CLI 하네스로 노출
```

**구현 템플릿:**

```javascript
// lib/core/my-agent.js
const { spawnLlm } = require("./llm");

const SYSTEM_PROMPT = `You are a ... agent.
Your tools: ...
Return format: ...`;

async function myAgent(input, instruction, opts = {}) {
  // 1. 작업 디렉토리 + 설정 파일 생성 (MCP 등)
  // 2. spawnLlm() 또는 spawnAgent()로 AI 호출
  // 3. 결과 파싱
  // 4. 정리 (임시 파일, 프로세스)
  return { status, text, json, durationMs };
}

module.exports = { myAgent };
```

**스테이지에서 호출:**

```javascript
// lib/forge/my-stage.js
const { myAgent } = require("../core/my-agent");

async function run({ taskId, project, onLog }) {
  const result = await myAgent(context, "이것을 검증해줘", { onLog });
  await saveArtifact(taskId, "my-result.json", JSON.stringify(result.json));
  return { status: "pass", output: result.text, tokenUsage: result.tokenUsage };
}
```

### 추가 대상 후보

아직 프로시저가 없지만 AI 위임이 효과적인 영역들:

| 영역 | AI 도구 | MCP/Tool | 하는 일 |
|------|---------|----------|---------|
| **API 테스트 생성** | Claude | 코드 읽기 | 엔드포인트 스펙에서 테스트 케이스 자동 생성 |
| **DB 마이그레이션 검증** | Claude | SQL 실행 | 마이그레이션 스크립트 적용 전후 스키마 diff + 데이터 무결성 확인 |
| **성능 프로파일링** | Gemini | Chrome DevTools | Lighthouse 실행 + 병목 분석 + 개선 제안 |
| **문서 동기화** | Claude | 코드 읽기 | 코드 변경 후 README/API 문서가 outdated인지 감지 + 업데이트 |
| **디자인 시스템 검증** | Gemini | Chrome DevTools | 컴포넌트가 디자인 토큰(색상, 간격, 폰트)을 준수하는지 확인 |
| **의존성 보안 감사** | Claude | npm audit | 취약점 분석 + 업그레이드 영향 평가 + PR 자동 생성 |
| **로그 이상 탐지** | Claude | 로그 파일 | 에러 패턴 분류 + 근본 원인 추론 + 수정 제안 |
| **i18n 검증** | Gemini | Chrome DevTools | 각 로케일에서 UI가 깨지지 않는지, 번역 누락이 없는지 확인 |

### 현재 구현된 프로시저

### Browser Agent (`lib/core/browser-agent.js`)

Claude/Codex/Gemini + Chrome DevTools MCP로 브라우저를 자연어로 조작. UI 검증, 디버깅, 시각적 테스트에 사용.

```javascript
const { browserAgent, browserAgentBatch } = require("./core/browser-agent");

// 단일 지시: UI 상태 확인
const result = await browserAgent("http://localhost:3000",
  "Proposals 탭에서 Analyze 버튼 클릭 후 로딩 상태가 표시되는지 확인해줘",
  { provider: "codex" } // "claude" | "codex" | "gemini"
);
console.log(result.text); // AI가 관찰한 결과 리포트

// 배치: 여러 검증을 단일 spawn으로 실행
const results = await browserAgentBatch("http://localhost:3000", [
  { id: "nav", instruction: "탭 전환이 제대로 되는지 확인" },
  { id: "form", instruction: "태스크 생성 모달이 열리는지 확인" },
  { id: "stats", instruction: "통계 바에 숫자가 표시되는지 확인" },
], { provider: "gemini" });
results.forEach(r => console.log(`${r.pass ? "PASS" : "FAIL"} ${r.id}: ${r.evidence}`));
```

#### 사용 시나리오

| 시나리오 | 사용법 |
|---------|--------|
| UX Review 스테이지 | `browserAgent(devUrl, "접근성 문제가 있는지 확인")` |
| E2E 테스트 | `browserAgentBatch(url, testCases)` |
| 개발 중 디버깅 | `node test/debug-ui.js "검색 필터 동작 확인"` |
| 시각적 회귀 검증 | `browserAgent(url, "레이아웃이 깨진 곳이 없는지 스크린샷으로 확인")` |
| 파이프라인 내 자동 검증 | verify 스테이지에서 프론트엔드 변경 시 자동 호출 |

#### CLI 디버그 하네스

```bash
# One-shot: 지시 한 줄로 브라우저 검증
node test/debug-ui.js "태스크를 만들고 toast가 나타나는지 확인"

# Interactive: 반복 디버깅
node test/debug-ui.js
debug> Proposals 탭 레이아웃 확인
debug> Autopilot 시작 폼에서 Browse 버튼 동작 확인
debug> exit

# 외부 서버에 연결 (개발 중인 서버)
node test/debug-ui.js --url http://localhost:3000 "레이아웃 확인"

# 프로바이더 지정
node test/debug-ui.js --provider codex "Autopilot 탭 구조 확인"
```

#### Dashboard E2E 실행 모드 (`test/dashboard.test.js`)

개발 중에는 변경 영향 범위만 빠르게 돌리고, 릴리즈 직전에만 전체를 돌릴 수 있다.
`--watch`/`--watch-on-change` 모드는 한 번 서버를 띄운 뒤 반복 실행하며, `Ctrl+C`로 종료한다.

```bash
# 전체 (릴리즈 전)
UCM_BROWSER_AGENT_PROVIDER=codex node test/dashboard.test.js --profile full

# 스모크 (빠른 확인)
UCM_BROWSER_AGENT_PROVIDER=codex node test/dashboard.test.js --profile smoke

# API만
node test/dashboard.test.js --layer api

# 브라우저 특정 그룹만 (개발 중 권장)
UCM_BROWSER_AGENT_PROVIDER=codex node test/dashboard.test.js --layer browser --groups "Task CRUD,Autopilot"

# 브라우저 특정 케이스만
UCM_BROWSER_AGENT_PROVIDER=codex node test/dashboard.test.js --layer browser --ids "TC-023,TC-050,TC-051"

# 현재 git 변경 파일 기반 자동 추정
UCM_BROWSER_AGENT_PROVIDER=codex node test/dashboard.test.js --profile changed

# 디버깅 루프: 주기적으로 계속 재검증
UCM_BROWSER_AGENT_PROVIDER=codex node test/dashboard.test.js --watch --layer browser --groups "Task CRUD,Autopilot"

# 디버깅 루프: git 변경이 생겼을 때만 재검증
UCM_BROWSER_AGENT_PROVIDER=codex node test/dashboard.test.js --watch-on-change --layer browser --ids "TC-023,TC-050,TC-051"

# 사용 가능한 그룹 확인
node test/dashboard.test.js --list-groups
```

지원 옵션:

| 옵션 | 설명 |
|------|------|
| `--profile full` | API + Browser 전체 실행 (기본값) |
| `--profile release` | `full`과 동일 (릴리즈 파이프라인 용도) |
| `--profile smoke` | 대표 케이스 ID만 빠르게 실행 |
| `--profile changed` | git working tree 변경 파일 기준으로 그룹 자동 추정 |
| `--layer all|api|browser` | 레이어 선택 실행 |
| `--watch` | 프로세스를 유지한 채 동일 테스트 플랜 반복 실행 (새로고침/재검증 루프) |
| `--watch-on-change` | `git status` 변경이 감지될 때만 반복 실행 |
| `--watch-interval-ms <ms>` | watch 모드 반복 간격 (기본 5000ms) |
| `--max-cycles <n>` | watch 모드 반복 횟수 제한 (0=무제한) |
| `--api-groups "A,B"` | API 그룹만 선택 |
| `--groups "A,B"` | Browser 그룹만 선택 (`--browser-groups` 별칭) |
| `--ids "TC-001,TC-050"` | Browser 케이스 ID 선택 |
| `--list-groups` | 선택 가능한 API/Browser 그룹 출력 |

#### 아키텍처

```
browserAgent(url, instruction)
        │
        ▼
  selected provider CLI (claude/codex/gemini)
        │ stdin: 자연어 지시
        │ provider별 MCP 설정 주입
        ▼
  chrome-devtools-mcp (headless Chrome)
        │ navigate, click, evaluate_script,
        │ take_screenshot, fill, press_key ...
        ▼
  Target Web App (url)
```

### Code Agent (`lib/core/agent.js`)

Claude CLI로 코드 작업을 자연어로 위임. 구현, 리뷰, 리팩터링에 사용.

```javascript
const { spawnAgent } = require("./core/agent");
const result = await spawnAgent("이 파일의 에러 핸들링을 개선해줘", {
  cwd: projectPath, model: "opus", taskId, stage: "implement",
});
```

### LLM 도구 (`lib/core/llm.js`)

프로바이더(Claude, Codex, Gemini) 추상화. 텍스트/JSON 응답, 스트리밍, 재시도.

```javascript
const { llmText, llmJson } = require("./core/llm");
const { text } = await llmText("이 코드를 설명해줘", { model: "sonnet" });
const { data } = await llmJson("JSON으로 분류해줘", { model: "sonnet" });
```

## 빌딩블록 도구

UCM 파이프라인 내부에서 사용되는 독립 도구들. 단독으로도 사용 가능.

| 도구 | 설명 |
|------|------|
| `rsa` | Recursive Self Aggregation — N개 병렬 실행 + 취합 |
| `qna` | 템플릿 기반 설계 Q&A (객관식 질문 → 설계 결정 수집) |
| `spec` | EARS 요구사항 스펙 생성 + 7개 기준 검증 |
| `req` | qna → spec 반복 워크플로 |
| `prl` | 병렬 프롬프트 실행 |
| `hm` | hivemind 지식 기억 관리 (search/add/gc) |
| `hmd` | hivemind 데몬 (세션 자동 수집 + 지식 추출) |

## 디렉토리 구조

```
~/.ucm/
  ├── daemon/          # 데몬 소켓, PID, 로그
  ├── tasks/           # pending, running, failed
  ├── proposals/       # 개선안 대기열
  ├── logs/            # 스테이지별 실행 로그
  ├── artifacts/       # 스테이지 결과물
  ├── lessons/         # 과거 실수 기록
  ├── chat/            # 채팅 세션
  └── workspaces/      # 임시 워크스페이스
```

## Release vs Dev

| | 운영 (`ucm`) | 개발 (`ucm-dev`) |
|---|---|---|
| 소스 | `~/.ucm/release/` (스냅샷) | `~/git/ucm/` (git repo) |
| 데이터 | `~/.ucm/` | `~/.ucm-dev/` |
| 소켓 | `~/.ucm/daemon/ucm.sock` | `~/.ucm-dev/daemon/ucm.sock` |
| UI 포트 | 17172 | 17173 |
| 명령어 | `ucm`, `ucmd` | `ucm-dev`, `ucmd-dev` |
| 코드 반영 | `ucm-dev release`로 갱신 | 데몬 재시작 시 즉시 |

### 개발 워크플로

1. 코드 수정 (`~/git/ucm/`)
2. ucm-dev로 테스트:
```bash
ucm-dev daemon stop && ucm-dev daemon start
ucm-dev submit --title "테스트" --project ~/git/some-project
```
3. 안정 확인 후 릴리즈:
```bash
ucm-dev release          # 테스트 → 복사 → prod 데몬 재시작
ucm list                 # 운영 확인
```

## LLM 프로바이더

```bash
export LLM_PROVIDER=claude   # 또는 codex, gemini
```

| 프로바이더 | 용도 | CLI |
|-----------|------|-----|
| `claude` | 코드 에이전트 + 브라우저 에이전트 | `claude` |
| `codex` | 코드 에이전트 + 브라우저 에이전트 | `codex` |
| `gemini` | 코드 에이전트(옵션) + 브라우저 에이전트 | `gemini` |

브라우저 에이전트 기본 프로바이더는 `gemini`이며, `provider` 옵션 또는 `UCM_BROWSER_AGENT_PROVIDER` 환경변수로 바꿀 수 있다.
