# UCM 사용 매뉴얼

## UCM이란?

UCM(Ultimate Click Machine)은 AI 에이전트 오케스트레이션 시스템이다. 소프트웨어 작업을 파이프라인 단계별로 분해하여 AI 에이전트가 자동으로 수행한다. 요구사항 정리부터 설계, 구현, 검증, 코드 폴리싱, 머지까지 전 과정을 자동화한다.

---

## 설치

```bash
cd ~/git/ucm
npm install
npm link        # ucm, hm, prl, rsa, qna, spec, req 명령어 등록
```

필수 요건:
- Node.js >= 18
- Claude CLI (`claude`) 또는 Codex CLI (`codex`) 설치
- `ANTHROPIC_API_KEY` 또는 `OPENAI_API_KEY` 환경변수 설정

---

## 빠른 시작

```bash
# 1. 작업 시작 — 프로젝트 디렉토리에서 실행
ucm forge "로그인 API에 rate limiting 추가" --project ~/git/myapp

# 2. 진행 상황 확인
ucm list
ucm status forge-20260219-a3f2

# 3. 결과 확인 후 승인
ucm diff forge-20260219-a3f2
ucm approve forge-20260219-a3f2
```

이것만으로 UCM이 복잡도를 판단하고, 필요한 단계를 자동으로 실행하고, 코드를 작성하고, 검증한 뒤, 리뷰 대기 상태로 넘긴다.

---

## 핵심 개념

### 파이프라인

작업 복잡도에 따라 4가지 파이프라인이 자동 선택된다:

| 파이프라인 | 단계 | 용도 |
|-----------|------|------|
| **trivial** | implement → verify → deliver | 오타, 한 줄 수정 |
| **small** | design → implement → verify → deliver | 함수 추가, 간단한 기능 |
| **medium** | clarify → specify → design → implement → verify → ux-review → polish → deliver | 일반적인 기능 개발 |
| **large** | clarify → specify → decompose → design → implement → verify → ux-review → polish → integrate → deliver | 대규모 리팩토링, 새 모듈 |

`--pipeline` 플래그로 강제 지정할 수 있다:

```bash
ucm forge "README 오타 수정" --pipeline trivial --project .
ucm forge --file epic.md --pipeline large --project ~/git/myapp
```

커스텀 파이프라인도 가능하다:

```bash
ucm forge "빠르게 구현만" --pipeline "implement,verify,deliver" --project .
```

### 단계(Stage) 설명

| 단계 | 하는 일 | 예상 시간 |
|------|---------|----------|
| **intake** | 작업 분류 (복잡도, 종류 판별) | ~1-5분 |
| **clarify** | 사용자에게 객관식 질문으로 요구사항 구체화 | ~3-10분 |
| **specify** | 요구사항 명세서 생성 (EARS 표기법) | ~3-15분 |
| **decompose** | 대규모 작업을 하위 태스크로 분해 (DAG) | ~3-10분 |
| **design** | 코드베이스 분석 후 구현 설계서 작성 | ~5-20분 |
| **implement** | 설계서 기반 코드 작성 및 커밋 | ~10-45분 |
| **verify** | 테스트 실행 + 코드 리뷰 (통과할 때까지 최대 3회 반복) | ~5-20분 |
| **ux-review** | 프론트엔드 사용성/모바일 동선 점검 | ~5-15분 |
| **polish** | 다관점 리뷰-수정 루프 (코드 품질/설계/테스트/보안) | ~10-60분 |
| **integrate** | 하위 태스크 워크트리 병합, 충돌 해결 | ~5-20분 |
| **deliver** | 변경사항 요약, 리뷰 대기 또는 자동 머지 | ~1-5분 |

### 워크트리

UCM은 프로젝트의 git worktree를 생성하여 격리된 환경에서 작업한다. 원본 프로젝트는 건드리지 않는다.

```
~/.ucm/worktrees/<taskId>/<projectName>/   ← 여기서 코드 수정
```

`ucm approve` 시 이 워크트리의 브랜치(`ucm/<taskId>`)가 원본에 머지된다.

### 아티팩트

각 단계의 산출물(설계서, 명세서, 검증 결과 등)은 아티팩트로 저장된다:

```
~/.ucm/artifacts/<taskId>/
  ├── task.md              # 원본 작업 설명
  ├── decisions.md         # clarify 결과
  ├── spec.md              # 요구사항 명세
  ├── design.md            # 구현 설계서
  ├── verify.json          # 검증 결과
  ├── polish-summary.json  # 폴리시 결과
  └── summary.md           # 최종 요약
```

---

## 명령어 레퍼런스

### `ucm forge` — 새 작업 시작

```bash
ucm forge "<설명>" [옵션]
ucm forge --file <파일.md> [옵션]
```

| 옵션 | 설명 |
|------|------|
| `--project <dir>` | 프로젝트 디렉토리 (기본: 현재 디렉토리) |
| `--pipeline <name>` | 파이프라인 강제 지정 |
| `--bg`, `--background` | 데몬에 위임하고 즉시 반환 |
| `--budget <N>` | 토큰 예산 제한 |
| `-v`, `--verbose` | 에이전트 출력 상세 표시 |

**예시:**

```bash
# 인라인 설명
ucm forge "사용자 목록 API에 페이지네이션 추가" --project ~/git/myapp

# 파일에서 읽기 (긴 설명)
ucm forge --file requirements.md --project ~/git/myapp --pipeline medium

# 백그라운드 실행
ucm forge "테스트 추가" --project . --bg

# 토큰 제한
ucm forge "DB 스키마 마이그레이션" --project . --budget 500000
```

### `ucm list` — 작업 목록

```bash
ucm list                    # 전체 목록
ucm list --status review    # 리뷰 대기 중인 것만
```

상태 필터(`ucm list --status`): `pending`, `running`, `review`, `done`, `failed`

### `ucm start <id>` — pending 작업 시작

```bash
ucm start forge-20260224-a3f2
```

`ucm submit`으로 등록된 작업은 자동 실행되지 않는다. `ucm start <id>`를 호출해야 큐에 등록되어 실행된다.

### `ucm status [<id>]` — 작업/데몬 상태 조회

```bash
ucm status forge-20260219-a3f2
ucm status                   # 데몬 상태 요약
```

단계별 이력, 토큰 사용량, 경고, 하위 태스크 정보를 보여준다. 현재 상태에 따른 다음 액션도 안내한다:

- `review` → `ucm approve` 또는 `ucm reject`
- `failed` 또는 `running(suspended)` → `ucm resume --from <stage>`

### `ucm diff <id>` — 변경사항 확인

```bash
ucm diff forge-20260219-a3f2
```

워크트리의 git diff를 보여준다. 승인 전에 반드시 확인할 것.

### `ucm logs <id>` — 로그 보기

```bash
ucm logs forge-20260219-a3f2
ucm logs forge-20260219-a3f2 --lines 500
```

### `ucm approve <id>` — 승인 (머지)

```bash
ucm approve forge-20260219-a3f2
ucm approve forge-20260219-a3f2 --score 4   # (선택) 리뷰 점수 기록
```

워크트리 브랜치를 원본 프로젝트에 머지하고, 워크트리를 정리한다.

### `ucm reject <id>` — 반려

```bash
ucm reject forge-20260219-a3f2 --feedback "빈 입력에 대한 에러 처리가 빠져있음"
```

피드백과 함께 반려하면 태스크가 즉시 `running`으로 전환되어 `implement` 단계부터 자동 재실행된다. 피드백 없이 반려하면 `failed`로 종료된다.

### `ucm resume <id>` — 재개

```bash
ucm resume forge-20260219-a3f2                    # 자동으로 마지막 실패 단계부터
ucm resume forge-20260219-a3f2 --from design      # 특정 단계부터
ucm resume forge-20260219-a3f2 --from implement   # 구현부터 다시
```

### `ucm abort <id>` — 중단

```bash
ucm abort forge-20260219-a3f2
```

진행 중인 작업을 강제 중단하고 워크트리를 정리한다.

### `ucm gc` — 정리

```bash
ucm gc              # 30일 이상 된 완료/실패/중단 작업 정리
ucm gc --days 14    # 14일 기준
```

### `ucm ui` — UI 서버 시작

```bash
ucm ui
```

기본 포트 `17172`에서 UI 서버를 실행한다. 브라우저를 자동으로 열지 않고 서버만 띄우며, 포트 변경은 `--port` 또는 `UCM_UI_PORT`를 사용한다.

### `ucm dashboard` — 웹 대시보드

```bash
ucm dashboard
```

데몬이 꺼져있으면 자동 시작한 뒤 UI 서버를 띄우고, `http://localhost:17172`를 브라우저에서 연다. 포트 변경은 `~/.ucm/config.json`의 `uiPort` 또는 `UCM_UI_PORT` 환경변수로 가능하다.

대시보드 상세 사용법은 [웹 대시보드](#웹-대시보드) 섹션 참고.

### `ucm daemon` — 데몬 관리

```bash
ucm daemon start    # 데몬 시작
ucm daemon stop     # 데몬 중지
```

### `ucm pause` / `ucm resume` / `ucm stats` — 데몬 제어

```bash
ucm pause           # 데몬 일시정지
ucm resume          # 데몬 재개 (task id 없이 호출)
ucm stats           # 처리량/성공률/실행 시간 통계
```

### `ucm auto` — 자동화 토글 제어

```bash
ucm auto                                # 현재 토글 상태 조회
ucm auto on                             # autoExecute/autoApprove/autoPropose/autoConvert 전체 ON
ucm auto off                            # 전체 OFF
ucm auto set autoPropose on            # 단일 토글 변경
```

---

## 웹 대시보드

`ucm dashboard`로 브라우저에서 열리는 웹 UI. 작업 관리, 실시간 로그, 대화형 Q&A, 제안서 관리, Claude 채팅을 하나의 화면에서 할 수 있다.

### 레이아웃

```
+-----------------------------------------------------------------------------------+
| UCM Dashboard  [Overview] [Tasks] [Proposals] [Automation]  * Running [Pause]    |
+----------------+------------------------------------------------------------------+
| 프로젝트 목록   |                                                                  |
| + 작업 생성     |  작업 상세 / 제안서 상세 / 자동화 토글                             |
|                |                                                                  |
|                |  [Summary]  [Diff]  [Logs]                                        |
|                |                                                                  |
+----------------+------------------------------------------------------------------+
| Tasks: 5 | running: 1 | review: 1 ...               CPU: 12% | Mem: 2GB free       |
+-----------------------------------------------------------------------------------+
```

상단 토글로 네 화면을 전환한다:
- **Overview** — 프로젝트/큐 상태 요약
- **Tasks** — 왼쪽 작업 목록 + 오른쪽 상세
- **Proposals** — 왼쪽 제안서 목록 + 오른쪽 상세
- **Automation** — 전역/프로젝트별 자동화 토글 설정

### Tasks 화면

**왼쪽 패널 — 작업 목록:**
- 상태별 정렬: running → review → suspended → pending → done → failed
- 각 항목에 상태 뱃지, 현재 단계, 제목, 프로젝트명 표시
- 클릭하면 오른쪽에 상세 정보 표시

**오른쪽 패널 — 작업 상세:**

세 개의 탭:
- **Summary** — 완료 요약 (`summary.md` 내용)
- **Diff** — git diff (코드 변경사항)
- **Logs** — 실시간 에이전트 로그 (WebSocket으로 스트리밍)

상태에 따른 액션 버튼:

| 상태 | 가능한 액션 |
|------|------------|
| `review` | Approve, Request Changes (피드백 입력 후 반려), Reject |
| `pending` | Start, Cancel |
| `running` | Cancel |
| `failed` | Retry, Delete |
| `done` | Delete |

### 새 작업 생성

**+ New Task** 버튼 → 모달:

| 필드 | 설명 |
|------|------|
| Title | 작업 제목 (필수) |
| Project Path | 프로젝트 디렉토리 (디렉토리 브라우저 제공) |
| Description | 상세 설명 |
| Pipeline | 파이프라인 선택 |

세 가지 제출 방식:

1. **Submit** — 바로 작업 생성
2. **Q&A Refine** — 대화형 질의로 요구사항을 구체화한 뒤 생성
3. **Auto Refine** — LLM이 자동으로 질의/응답하여 구체화한 뒤 생성

### 대화형 Refinement

Q&A Refine을 선택하면 오른쪽 패널이 Refinement 모드로 전환된다:

- 영역별 커버리지 바 표시 (기능, 기술, UX, 보안 등)
- 질문이 객관식 카드로 표시 — 옵션 클릭 또는 자유 텍스트 입력
- **Auto-complete rest** — 남은 질문을 LLM이 자동 완성
- **Finalize now** — 현재까지의 결정으로 작업 생성
- **Cancel** — 취소

### 대화형 Gather

실행 중인 작업이 추가 정보를 요청할 때 (clarify 단계 등), 작업 상세 아래에 질문 패널이 나타난다. 텍스트를 입력하고 Submit하면 작업이 계속된다.

### Terminal 화면 (`/terminal`)

xterm.js 기반 풀스크린 터미널. Claude CLI 세션을 직접 열어 대화할 수 있다.

- 자동으로 Claude를 시작하고, UCM 컨텍스트가 주입된 시스템 프롬프트를 사용
- 세션이 유지되어 새로고침해도 이어서 대화 가능
- **New Session** — 기존 세션 종료 후 새 Claude 세션 시작

### Proposals 화면

AI Observer가 자동으로 생성한 개선 제안서를 관리한다.

**왼쪽 패널:**
- 상태별 정렬: proposed → approved → implemented → rejected
- 카테고리 뱃지, 위험도 색상, 제목, 프로젝트 표시

**오른쪽 패널:**
- 문제점, 제안 변경사항, 예상 효과 섹션
- AI 평가 카드 (점수, 판정, 영향도)
- 액션: Approve, Reject, 우선순위 Up/Down

### Automation 화면

Automation 탭은 데몬 자동화 토글을 관리한다.

- **Global Automation**: `autoExecute`, `autoApprove`, `autoPropose`, `autoConvert`
- **Project Overrides**: 프로젝트별로 각 토글을 `default/on/off`로 오버라이드

**자동화 API (UI 서버 경유)**

```bash
# 현재 자동화 설정 조회
curl -s http://localhost:17172/api/automation

# 자동화 설정 변경
curl -s -X POST http://localhost:17172/api/automation \
  -H 'content-type: application/json' \
  -d '{"autoExecute":true,"autoPropose":true}'

# Refinement 세션 자동완성 모드 전환
curl -s -X POST http://localhost:17172/api/refinement/autopilot \
  -H 'content-type: application/json' \
  -d '{"sessionId":"rs_xxxx"}'
```

`ucm auto` 명령은 위 `/api/automation`과 동일한 설정을 CLI에서 제어하는 인터페이스다.

### 헤더 컨트롤

- **상태 표시등** — 녹색(실행 중), 노란색(일시정지), 회색(오프라인)
- **Pause/Resume** — 데몬 일시정지/재개
- **Stop Daemon** — 데몬 중지 (확인 후)
- 오프라인 상태에서는 **Start Daemon** 버튼

### 푸터

- 왼쪽: 작업 수 통계 (`Tasks: 5 | running: 1 | review: 1 | done: 3`)
- 오른쪽: 시스템 리소스 (`CPU: 12% | Mem: 2048MB free | Disk: 50.2GB`)

---

## clarify 단계 상호작용

medium/large 파이프라인에서는 clarify 단계에서 객관식 질문을 한다:

```
  [작업 목표] 어떤 모듈을 수정해야 하나요?
    1. src/auth/login.js — 로그인 핸들러
    2. src/auth/session.js — 세션 관리
    3. src/middleware/rateLimit.js — 기존 rate limiter
  선택 (번호 또는 직접 입력): 3
```

- 번호를 입력하면 해당 옵션 선택
- 텍스트를 직접 입력하면 자유 응답으로 처리

Refinement 화면의 **Auto-complete rest** 또는 `/api/refinement/autopilot`을 사용하면 남은 답변을 LLM이 자동 완성한다.

---

## polish 단계 동작

polish는 4가지 관점(렌즈)으로 코드를 반복 리뷰하고 수정한다:

| 렌즈 | 검사 항목 |
|------|----------|
| **code_quality** | 이름 명확성, 함수 복잡도, 코드 중복, 에러 처리, 스타일 일관성 |
| **design_consistency** | 설계서-구현 일치, 아키텍처 패턴, 모듈 의존성, 관심사 분리 |
| **testing** | 테스트 커버리지, 에지케이스, 에러 경로, 테스트 안정성 |
| **security** | 입력 검증, SQL/XSS/명령어 인젝션, path traversal, 하드코딩 비밀 |

각 렌즈마다:
1. sonnet이 코드를 읽고 이슈 목록을 작성 (리뷰)
2. opus가 이슈를 수정 (픽스)
3. 테스트를 실행하여 회귀 확인 (테스트 게이트)
4. 다시 리뷰 → 연속 2회 이슈 0건이면 수렴, 다음 렌즈로 이동

안전장치:
- 렌즈당 최대 5라운드
- 전체 최대 15라운드
- 토큰 예산 95% 도달 시 조기 종료
- 매 수정 후 테스트 게이트 통과 필수

---

## 환경변수

### 디렉토리

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `UCM_DIR` | `~/.ucm` | UCM 데이터 루트 디렉토리 |
| `HIVEMIND_DIR` | `~/.hivemind` | Hivemind 데이터 디렉토리 |

### 실행 제어

| 변수 | 기본값 | 설명 |
|------|--------|------|
| `UCM_MAX_CONCURRENT` | `3` | 동시 실행 가능한 최대 작업 수 |
| `UCM_TOKEN_BUDGET` | `0` (무제한) | 기본 토큰 예산 |
| `UCM_PROVIDER` | `claude` | Forge/daemon 기본 제공자 (`claude` 또는 `codex`) |
| `LLM_PROVIDER` | `claude` | 독립 도구(`rsa/qna/spec/prl/req`) 기본 제공자 |

### 모델 오버라이드

각 단계의 모델을 환경변수로 변경할 수 있다:

| 변수 | 기본값 | 단계 |
|------|--------|------|
| `UCM_MODEL_INTAKE` | `sonnet` | 작업 분류 |
| `UCM_MODEL_CLARIFY` | `sonnet` | 요구사항 질의 |
| `UCM_MODEL_SPECIFY_WORKER` | `sonnet` | 명세 병렬 작성 |
| `UCM_MODEL_SPECIFY_CONVERGE` | `opus` | 명세 수렴 |
| `UCM_MODEL_DECOMPOSE` | `opus` | 태스크 분해 |
| `UCM_MODEL_DESIGN` | `opus` | 설계 |
| `UCM_MODEL_IMPLEMENT` | `opus` | 구현 |
| `UCM_MODEL_VERIFY` | `sonnet` | 검증 |
| `UCM_MODEL_POLISH_REVIEW` | `sonnet` | 폴리시 리뷰 |
| `UCM_MODEL_POLISH_FIX` | `opus` | 폴리시 수정 |
| `UCM_MODEL_INTEGRATE` | `opus` | 통합 |
| `UCM_MODEL_DELIVER` | `sonnet` | 요약/전달 |

### API 키

| 변수 | 설명 |
|------|------|
| `ANTHROPIC_API_KEY` | Claude API 키 |
| `OPENAI_API_KEY` | Codex/OpenAI API 키 |

---

## Hivemind — 지식 메모리

Hivemind는 Zettelkasten 방식의 지식 메모리 시스템이다. Claude Code / Codex 세션에서 자동으로 지식을 추출하고 인덱싱한다.

### 초기 설정

```bash
hm init     # 대화형 설정 — 어댑터 활성화, 문서 디렉토리 추가
hmd start   # 데몬 시작 (백그라운드 스캔)
```

### 주요 명령어

```bash
hm search "인증 패턴"          # 의미 기반 검색
hm search "rate limiting" --limit 5

hm list                        # 전체 제텔 목록
hm list --kind pattern         # 특정 종류만
hm show 20260219135742         # 제텔 상세 보기

hm add --title "발견한 것" < notes.txt   # 수동 추가

hm link <id1> <id2>            # 제텔 간 양방향 링크
hm delete <id>                 # 삭제
hm restore <id>                # 아카이브에서 복원

hm gc --dry-run                # GC 미리보기
hm gc                          # 낮은 점수 제텔 아카이브

hm stats                       # 통계
hm reindex                     # 인덱스 재구축

hm docs add ~/git/docs         # 문서 디렉토리 추가
hm docs list                   # 등록된 문서 디렉토리 목록
hm docs remove ~/git/docs      # 문서 디렉토리 제거
```

### Claude Code 연동

`hm init`에서 SessionStart 훅을 등록하면, 새 Claude Code 세션이 시작될 때 최근 작업 컨텍스트가 자동으로 주입된다. `/recall` 스킬이 등록되어 있으면 세션 중 `recall <검색어>`로 과거 지식을 검색할 수 있다.

### 제텔 종류

| 종류 | 설명 |
|------|------|
| `fleeting` | 수동 추가한 메모 |
| `literature` | 세션/문서에서 추출된 지식 |
| `permanent` | 여러 literature 노트를 종합한 영구 지식 |
| `pattern` | 사용자 행동/선호 패턴 |
| `project` | 프로젝트별 컨벤션, 아키텍처 결정 |
| `discovery` | 디버깅 중 발견한 비자명한 사실 |
| `episode` | 세션 요약 |

### Forge 연동

Forge 파이프라인 완료 시 자동으로 Hivemind에 제텔을 기록한다. design/implement 단계에서는 관련 과거 지식을 자동으로 프롬프트에 주입한다.

### 데몬

```bash
hmd start              # 백그라운드 시작
hmd start --foreground # 포그라운드 시작
hmd stop               # 중지
hmd status             # 상태 확인
hmd log --lines 100    # 로그 보기
```

데몬은 60초마다 소스를 스캔하고, 24시간마다 GC와 통합(consolidation)을 실행한다.

---

## 독립 도구

### `prl` — 병렬 LLM 실행

동일한 프롬프트를 N개 LLM 인스턴스에 동시에 실행한다.

```bash
prl --project ~/git/myapp --prompt analyze.md --count 5
echo "이 코드의 버그를 찾아줘" | prl --project ~/git/myapp --count 3
```

| 옵션 | 설명 |
|------|------|
| `--project <dir>` | 작업 디렉토리 (필수) |
| `--prompt <file>` | 프롬프트 파일 (없으면 stdin) |
| `--count <N>` | 병렬 수 (기본: 3) |
| `--model <name>` | 모델명 |
| `--output <dir>` | 출력 디렉토리 |
| `--provider <name>` | `claude` 또는 `codex` |

결과는 `<output>/<N>.md` 파일로 저장된다.

### `rsa` — Recursive Self-Aggregation

병렬 실행 → 수렴의 2단계 파이프라인. 여러 LLM의 결과를 하나로 종합한다.

```bash
rsa --project ~/git/myapp --prompt "아키텍처 설계안을 작성해줘" --count 3 --rounds 2
```

| 옵션 | 설명 |
|------|------|
| `--count <N>` | 라운드당 워커 수 (기본: 3) |
| `--rounds <N>` | 1 또는 2 라운드 (기본: 1) |

자동으로 복잡도(light/heavy)와 전략(converge/diverge)을 판별한다.

### `qna` — 설계 Q&A

대화형 객관식 질의로 설계 결정을 수집한다.

```bash
qna --project ~/git/myapp
qna --template design-template.md --output /tmp/decisions
qna --resume /tmp/decisions/decisions.md   # 이전 결과에서 이어서
```

### `spec` — 요구사항 명세 생성

decisions.md로부터 EARS 표기법의 요구사항 명세서를 생성한다.

```bash
spec --decisions /tmp/decisions/decisions.md --project ~/git/myapp
```

### `req` — Q&A + Spec 통합 워크플로

qna → spec을 검증 통과할 때까지 반복한다.

```bash
req --project ~/git/myapp --max-rounds 3
```

---

## 워크플로 레시피

### 간단한 버그 수정

```bash
ucm forge "로그인 시 빈 이메일에서 크래시" --pipeline small --project .
ucm diff <id>
ucm approve <id>
```

### 기능 개발 (대화형)

```bash
ucm forge "사용자 프로필에 아바타 업로드 기능 추가" --project ~/git/myapp
# → clarify에서 질문에 답변
# → 완료 후 리뷰
ucm diff <id>
ucm approve <id>
```

### 대규모 리팩토링

```bash
ucm forge --file refactor-plan.md --pipeline large --project ~/git/myapp --bg
ucm logs <id> --lines 200    # 진행 상황 확인
ucm status <id>              # 단계별 이력 확인
ucm diff <id>
ucm approve <id>
```

### 반려 후 재작업

```bash
ucm reject <id> --feedback "rate limiter가 Redis가 아닌 인메모리로 되어있음. Redis로 변경 필요"
# → 태스크가 running으로 전환되고 implement 단계부터 자동 재실행됨
```

### 특정 단계부터 재시작

```bash
ucm resume <id> --from design    # 설계부터 다시
ucm resume <id> --from implement # 구현부터 다시
```

### 모델 변경

```bash
# 비용 절감: implement를 sonnet으로
UCM_MODEL_IMPLEMENT=sonnet ucm forge "간단한 유틸 함수 추가" --project .

# 품질 극대화: verify도 opus로
UCM_MODEL_VERIFY=opus ucm forge "결제 모듈 리팩토링" --project .
```

### 백그라운드 모니터링

```bash
ucm forge "대규모 작업" --project . --bg
# 터미널에서 다른 작업 가능

ucm list                         # 상태 확인
ucm logs <id>                    # 로그 스트림
ucm status <id>                  # 상세 상태
```

---

## 디렉토리 구조

```
~/.ucm/
├── forge/<taskId>/         # 태스크 DAG (task.json)
├── artifacts/<taskId>/     # 단계별 산출물
├── worktrees/<taskId>/     # Git 워크트리
├── logs/                   # 실행 로그
├── tasks/                  # 데몬 작업 큐 (pending/running/review/done/failed)
├── proposals/              # AI 개선 제안서
├── lessons/                # 완료된 작업에서 추출한 교훈
├── snapshots/              # 주기적 메트릭 스냅샷
├── chat/                   # 대시보드 채팅 세션
│   └── session-id          # Claude 세션 ID
├── config.json             # 데몬 설정
└── daemon/                 # 데몬 소켓, PID, 로그
    ├── ucm.sock
    ├── ucmd.pid
    └── ucmd.log

~/.hivemind/
├── zettel/                 # 활성 제텔
├── archive/                # 아카이브된 제텔
├── index/                  # 검색 인덱스 (SQLite FTS5)
├── sources/                # 어댑터 상태
├── daemon/                 # Hivemind 데몬
├── adapters/               # 커스텀 어댑터
└── config.json             # 설정
```

---

## 트러블슈팅

| 증상 | 원인 | 해결 |
|------|------|------|
| `ECONNREFUSED` | 데몬 미실행 | `ucm daemon start` |
| `token budget exceeded` | 예산 초과 | `ucm resume <id> --budget <더큰값>` |
| `worktree locked` | 다른 작업이 진행 중 | `ucm list --status running` 확인 |
| `spawn error` | claude/codex CLI 미설치 | `npm install -g @anthropic-ai/claude-cli` |
| `merge conflict` | 자동 해결 실패 | 수동 해결 후 `ucm resume <id> --from integrate` |
| `missing required artifacts` | 이전 단계 미완료 | `ucm resume <id> --from <이전단계>` |
| `RATE_LIMITED` | API 요청 제한 | 자동 재시도됨, 대기 |
| 데몬 로그 확인 필요 | 알 수 없는 오류 | `cat ~/.ucm/daemon/ucmd.log` |
