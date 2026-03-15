# UCM Architecture Redesign

## 목적

이 문서는 현재 UCM 리포지토리를 기준으로 제품 구조를 다시 정리하고, `legacy/`와 `ucm-desktop/`로 갈라진 구현을 새 제품 코어로 재구성하기 위한 기준선이다.

핵심 목표는 세 가지다.

1. 제품의 실제 코어를 하나로 만든다.
2. 데스크톱 앱이 그 코어 위에서 안정적으로 동작하게 만든다.
3. `legacy/`는 참고용 아카이브로만 두고, 새 제품 경로에서는 의존 없이 단계적으로 제거한다.

## 현재 구조 요약

현재 리포지토리는 크게 두 덩어리로 나뉜다.

- `ucm-desktop/`
  - Electron + React 기반의 현재 제품 셸
  - `RuntimeService` 중심의 워크스페이스/미션/런/에이전트 상태 모델
  - 로컬 JSON 파일 기반 상태 저장
- `legacy/`
  - 기존 CLI, daemon, web, forge, hivemind 전체
  - 동작 참고용 코드와 문서

즉 현재는 "새 제품 셸"과 "폐기 예정인 옛 엔진"이 같은 리포에 공존한다.

## 현재 구조의 핵심 문제

### 1. 제품 코어가 이중화되어 있다

현재는 두 개의 오케스트레이션 모델이 병존한다.

- `legacy/lib/ucmd.js`, `legacy/lib/ucmd-handlers.js`, `legacy/lib/ucmd-server.js`
  - 태스크 큐, 상태 전이, 데몬 제어, forge 실행
- `ucm-desktop/src/main/runtime.ts`
  - 미션, 런, 자동 진행, 전달물, 터미널 세션

문제는 둘 중 하나가 다른 하나의 얇은 래퍼가 아니라는 점이다. 서로 다른 개념 체계를 따로 구현하고 있다.

결과:

- 같은 제품 개념이 `task`와 `mission/run`으로 이중 표현된다.
- 데스크톱에서 쌓은 새 모델이 forge/hivemind/worktree 엔진과 직접 이어지지 않는다.
- `legacy`의 CLI/web/daemon은 여전히 옛 모델에 묶여 있고, 데스크톱은 별도 런타임을 갖는다.

### 2. 거대 파일이 시스템 경계를 대신하고 있다

대표적으로 다음 파일들이 지나치게 많은 책임을 가진다.

- `legacy/lib/ucmd.js` 1683 lines
- `legacy/lib/ucmd-handlers.js` 1506 lines
- `legacy/lib/ucm-ui-server.js` 1653 lines
- `ucm-desktop/src/main/runtime.ts` 1077 lines
- `ucm-desktop/src/renderer/app.tsx` 2223 lines

이 상태에서는 "모듈 분리"보다 "파일 내부 관례"가 아키텍처를 지배한다.

결과:

- 변경 영향 범위를 예측하기 어렵다.
- 기능 추가가 곧 파일 비대화로 이어진다.
- 테스트가 있어도 책임 분리가 약해 회귀 리스크가 남는다.

### 3. 도메인 모델과 전송 계층이 섞여 있다

예시:

- `ucm-desktop/src/main/index.ts`
  - Electron 창 생성
  - IPC 등록
  - 런타임 이벤트 브로드캐스트
  - 자동 진행 타이머
- `ucm-desktop/src/preload/index.ts`
  - 렌더러 API 계약을 직접 정의
- `ucm-desktop/src/shared/contracts.ts`
  - UI view model, 런타임 엔터티, IPC 계약이 한 파일에 섞여 있음

결과:

- "도메인 변경"이 곧 "IPC 변경"이 된다.
- 데스크톱 main/renderer 경계를 넘어 같은 코어를 재사용하기 어렵다.
- 타입은 공유되지만 계층은 분리되지 않는다.

### 4. 영속화 전략이 일관되지 않다

현재 저장 방식이 세 갈래로 갈라져 있다.

- `legacy`: `~/.ucm/tasks`, `~/.ucm/artifacts`, `~/.ucm/worktrees`, `~/.ucm/forge`
- `hivemind`: `~/.hivemind` + SQLite FTS
- `desktop`: Electron `userData/runtime-state.db` + legacy JSON migration

결과:

- 어떤 상태가 진실의 원천인지 불분명하다.
- 데스크톱 런타임 상태를 장기적으로 확장하고 복구하기 어렵다.
- 복구, 동시성, 감사 추적, 마이그레이션이 모두 어려워진다.

### 5. UI 셸이 제품을 나누고 있다

현재 UI도 둘로 갈라진다.

- `legacy/web/`
  - daemon API를 직접 소비하는 전통적인 대시보드
- `ucm-desktop/src/renderer/app.tsx`
  - 별도의 미션 중심 데스크톱 UI

이 둘은 같은 백엔드 계약을 쓰지 않는다.

결과:

- 화면은 다르지만 같은 시스템을 보는 것이 아니라, 사실상 다른 제품을 보고 있다.
- 기능 parity 유지가 불가능하다.

### 6. Forge와 Hivemind 요구사항이 새 제품 코어에 편입되지 않았다

`legacy/lib/forge/index.js`와 `legacy/lib/hivemind/*`는 구현 재사용 대상이 아니라, 새 코어가 만족해야 할 기능 요구사항의 참고본이다. 그런데 현재 `ucm-desktop`의 런타임 모델은 그 요구사항을 아직 흡수하지 못했다.

결과:

- 데스크톱은 시연 가능한 오케스트레이션 셸에 가깝고,
- 실제 제품 가치가 있는 파이프라인/메모리 요구사항은 아직 새 코어에 재구현되지 않았다.

## 재설계 원칙

### 1. 제품 용어를 과하게 바꾸지 않고 정리한다

새 코어에서는 내부 코드와 문서 모두 사용자가 바로 이해할 수 있는 제품 용어를 표준으로 삼는다.

| 기존 용어 | 새 표준 용어 | 사용자 설명 |
|------|------|------|
| `Workspace` | `Workspace` | 작업 대상 저장소 |
| `Mission` | `Mission` | 사용자가 요청한 일 |
| `Run` | `Run` | 한 번의 실행 또는 재실행 |
| `StageExecution` | `Step` | 설계, 구현, 검증 같은 진행 단계 |
| `Artifact` | `Artifact` | 코드 변경, 리포트, 테스트 결과 |
| `Deliverable` | `Release` | 버전이 붙는 마일스톤 결과물 |
| `Handoff` | `Handoff` | 정리본을 공유한 기록 |
| `Review` | `Review` | 승인 또는 반려 |
| `Steering` | `Steering` | 사람이 주는 추가 안내 |
| `ExecutionSession` | `Session` | 모델 또는 터미널과 연결된 세션 |
| `MemoryEntry` | `Note` | 기억/지식 노트 |
| `Provider` | `Engine` | Claude, Codex, local 같은 실행 엔진 |
| `Autopilot` | `Automation` | 자동 진행 로직 |
| `Conductor` | `Coordinator` | 흐름 조정 로직 |

표현 원칙:

- UI와 문서에서는 `Workspace`, `Mission`, `Run`, `Artifact`, `Release`, `Handoff`를 표준 용어로 사용한다.
- 새 패키지와 새 계약도 가능하면 위 표준 용어 기준으로 맞춘다.
- 과도하게 일반적인 말(`Task`, `Execution`, `Result`, `Project`)로 치환하지 않는다.

기존 `task`, `dag`, `proposal` 등은 위 모델 아래로 흡수한다.

매핑 원칙:

- legacy task = mission + primary run
- TaskDag stage history = step history
- proposal = mission template 또는 system improvement proposal

### 2. 데스크톱 셸보다 코어를 먼저 만든다

현재 제품 범위는 데스크톱 앱 하나다. 따라서 코어를 먼저 만들고, 데스크톱은 그 위의 셸로 유지한다.

셸이 가져야 할 책임:

- 입력 수집
- 상태 표시
- 로컬 상호작용
- 운영자 개입

셸이 가지면 안 되는 책임:

- 런타임 정책 판단
- 상태 전이
- 스케줄링
- engine 선택
- artifact/release 생성 규칙

### 3. 저장소는 단일한 기준 저장소를 가진다

새 기준 저장소는 SQLite + 파일 아티팩트 조합으로 통일한다.

- SQLite
  - workspace, mission, run, step, session, review, queue, event journal 저장
- filesystem
  - diff, 로그, 산출물, worktree, 첨부 파일 저장

이유:

- 데스크톱 런타임은 이미 SQLite 저장소로 전환됐다.
- 현재 데스크톱 구현은 `runtime_state_store` snapshot과 `runtime_workspace_index`, `runtime_mission_index`, `runtime_run_index`, `runtime_release_index`, `runtime_handoff_index` projection을 같이 유지한다.
- hivemind도 SQLite 기반 인덱스를 쓰고 있어 방향이 맞다.
- 파일 단위 task storage보다 동시성, 조회, 복구가 낫다.

### 4. Electron transport와 제품 코어를 분리한다

현재 제품의 실제 전송 경계는 Electron renderer ↔ main IPC다.

하지만 이 경계가 곧 도메인 경계가 되면 안 된다.

- renderer는 contracts/view model만 안다
- main process는 application/runtime/execution을 조합한다
- 코어 로직은 Electron API를 직접 몰라야 한다

### 5. `legacy` 코드는 읽기 전용 참고 자료로만 사용한다

앞으로의 기준은 다음과 같다.

- `legacy` 코드를 새 런타임에 직접 링크하지 않는다.
- 새 패키지에서 `legacy/*` import를 금지한다.
- 필요한 것은 코드가 아니라 동작, 정책, 화면 요구사항만 추출한다.

즉 `legacy`는 마이그레이션 소스가 아니라 참고 스펙이다.

## 목표 아키텍처

### 한 문장 요약

UCM은 "하나의 코어 런타임 + 데스크톱 앱" 구조로 재편한다.

### 목표 다이어그램

```text
ucm-desktop (renderer)
        │
        ▼
Electron IPC
        │
        ▼
desktop main host ──> application core ──> infrastructure adapters
                          │                        │
                          │                        ├── engine runners
                          │                        ├── terminal sessions
                          │                        ├── git/worktree
                          │                        ├── sqlite storage
                          │                        └── hivemind memory
                          └── projections/events
```

## 목표 리포지토리 구조

```text
ucm-desktop/
  src/main/
  src/preload/
  src/renderer/

packages/
  contracts/
  domain/
  application/
  runtime/
  execution/
  forge/
  memory/
  storage/
  observability/

legacy/
  ...archived reference only...
```

### 패키지 책임

#### `packages/contracts`

- 런타임 command/query/event 스키마
- transport-neutral DTO
- IPC/HTTP/WS 공용 계약

이 패키지에는 UI 문구나 렌더링 전용 타입을 두지 않는다.

#### `packages/domain`

- 미션, 런, 리뷰, 아티팩트, 릴리즈, 단계 엔터티
- 상태 전이 규칙
- 정책 판별용 순수 함수

현재 `runtime-policy.ts`, `runtime-conductor.ts`, `runtime-run-helpers.ts`의 핵심 로직이 이 층으로 이동한다.

#### `packages/application`

- command handlers
- query services
- automation / coordinator orchestration
- review, approval, retry, resume 유스케이스

중요한 점은 이 층이 Electron, HTTP, Unix socket을 모르도록 유지하는 것이다.

#### `packages/runtime`

- job scheduler
- queue manager
- mission/run lifecycle coordinator
- background timers

현재 `RuntimeService`의 큰 덩어리를 이 층으로 분해해 옮긴다.

#### `packages/execution`

- engine adapter registry
- terminal session manager
- local shell execution
- workspace/worktree lifecycle

현재 공용 실행 엔진은 `packages/execution`에 있고, 데스크톱은 host wrapper만 유지한다.
`RuntimeExecutionEngine`이 provider terminal, provider pipe, local shell 실행을 같은 session 모델로 다루고,
`GitWorktreeManager`가 workspace command를 run 단위 worktree로 격리한다.

#### `packages/forge`

- stage pipeline engine
- stage executors
- iteration policy
- stage gate

이 패키지는 `legacy/lib/forge/*`의 동작을 참고하되, 새 도메인 모델 위에 다시 구현한다.

#### `packages/memory`

- hivemind CRUD
- extraction
- indexing
- recall/search
- session hook integration

이 패키지는 `legacy/lib/hivemind/*`의 검색/추출 요구사항을 참고하되, 저장과 런타임 연결은 새 구조에 맞춰 다시 구현한다.

#### `packages/storage`

- SQLite repositories
- artifact/blob store
- migrations
- optional one-time importers from legacy data

#### `packages/observability`

- structured logging
- run/event tracing
- metrics and health snapshots

## 표준 실행 흐름

### 1. 미션 생성

1. 셸이 `CreateMission` command를 보낸다.
2. application layer가 mission record를 만든다.
3. runtime layer가 초기 run과 planning step을 큐에 등록한다.
4. projection이 mission summary를 갱신한다.
5. 데스크톱 renderer와 projection이 같은 상태 변화를 기준으로 갱신된다.

### 2. 런 실행

1. scheduler가 실행 가능한 step을 pick 한다.
2. execution layer가 engine/local/worktree/session을 준비한다.
3. forge step이 artifact를 만든다.
4. application layer가 결과를 domain event로 저장한다.
5. projection이 run status, review queue, releases를 갱신한다.

### 3. Human intervention

1. blocker 또는 review-needed event 발생
2. application layer가 `ReviewRequested` 또는 `SteeringRequested` 생성
3. 데스크톱 UI는 inbox/query projection을 통해 같은 대기열을 본다.
4. 사용자가 approve/reject/steer command를 보내면 다음 run이 이어진다.

## 데이터 저장 설계

### 기준 원칙

- SQLite가 진실의 원천
- 파일 시스템은 큰 산출물과 worktree 보관 용도
- 모든 중요한 상태 변화는 event journal에 남긴다

### 권장 디렉토리

```text
~/.ucm/
  data/
    ucm.db
  artifacts/
  logs/
  worktrees/
  cache/
```

### 권장 테이블

- `missions`
- `runs`
- `steps`
- `run_events`
- `reviews`
- `releases`
- `handoffs`
- `sessions`
- `engine_leases`
- `artifacts`
- `notes`
- `system_events`

### 스냅샷 전략

- append-only `run_events`
- query 성능을 위한 projection table 유지
- 긴 텍스트 로그는 파일 저장 + DB에는 메타데이터만 유지

이 방식은 "완전한 이벤트 소싱"보다 단순하고, 현재 제품 요구에는 충분하다.

## 제품 범위

### Desktop

- 기본 운영 콘솔
- 내장 daemon 프로세스 또는 in-process runtime host 사용
- 터미널, 로컬 워크스페이스 접근, 실시간 개입에 최적화

### Legacy

- 과거 CLI/web/daemon/forge/hivemind 참고 구현
- 새 제품 목표에는 포함하지 않는다
- 필요한 경우 동작 참고용으로만 읽는다

## 구체적 재설계 결정

### 결정 1. `ucm-desktop`은 코어가 아니라 셸로 강등한다

현재는 데스크톱 main process가 사실상 제품 런타임을 소유한다. 이 구조는 장기적으로 유지하면 안 된다.

앞으로는:

- 데스크톱 main process = transport host + window lifecycle
- 제품 런타임 = `packages/application`, `packages/runtime`, `packages/execution`

### 결정 2. `legacy/lib/forge`와 `legacy/lib/hivemind`는 참고 스펙이지 이관 대상이 아니다

중요한 것은 기존 코드가 아니라 기존에 검증된 동작이다. 파이프라인, stage gate, memory 흐름은 제품 요구사항으로 가져오되, 구현은 새 코어에 맞게 다시 만든다.

전략:

- `legacy`에서 동작 규칙과 UX 요구사항만 추출한다.
- 새 패키지에서 TypeScript 기준으로 다시 구현한다.
- 새 코드에서 `legacy` runtime dependency를 만들지 않는다.

### 결정 3. `RuntimeService`는 쉬운 이름의 서비스로 쪼갠다

현재 `ucm-desktop/src/main/runtime.ts`는 최소 다음 책임을 동시에 가진다.

- state loading/writing
- workspaces/missions/runs 조회
- run scheduling
- automation
- terminal integration
- release lifecycle

목표 분리:

- `MissionService`
- `RunCoordinator`
- `RuntimeHost`

### 결정 4. `shared/contracts.ts`는 분할한다

현재 파일은 너무 많은 계층을 담고 있다.

목표 분리:

- `contracts/commands.ts`
- `contracts/queries.ts`
- `contracts/events.ts`
- `contracts/view-models.ts`

UI 전용 view model은 contracts 패키지 하위 또는 셸 내부 projection으로 제한한다.

### 결정 5. 워크스페이스 목록과 실행 디렉터리를 분리한다

현재 `workspace-discovery.ts`는 사용자의 로컬 저장소를 찾는 책임이고, legacy는 별도 git worktree lifecycle을 갖는다.

앞으로는:

- `WorkspaceCatalog`: 사용자가 연결한 저장소 목록 관리
- `RunWorkspaceManager`: 실행용 worktree 생성/정리

이 둘은 이름만 비슷하지 전혀 다른 책임이다.

## 권장 마이그레이션 단계

### Phase 0. 기준선 확정

- 루트 문서에서 현재 제품 경로와 재설계 문서를 명확히 노출
- `legacy`를 archived/reference only로 명시
- 핵심 용어를 workspace/mission/run 중심으로 통일

### Phase 1. 계약과 도메인 추출

- `ucm-desktop/src/shared/contracts.ts` 분해
- `runtime-policy`, `runtime-conductor`, `runtime-run-helpers`를 `packages/domain`으로 이동
- renderer가 main process 내부 타입이 아니라 contracts 패키지를 참조하게 수정

완료 기준:

- 데스크톱이 새 `packages/contracts`, `packages/domain`을 사용
- 기존 동작 변화 없음

### Phase 2. 런타임 코어 추출

- `RuntimeService`를 application/runtime 계층으로 분리
- Electron 의존(`app.getPath`, `ipcMain`)을 host layer로 밀어낸다
- JSON 파일 저장을 storage interface 뒤로 감춘다

완료 기준:

- 런타임 코어가 Electron 없이 테스트 가능
- 메모리 저장소와 SQLite 저장소를 모두 주입 가능

### Phase 3. execution/worktree 통합

- `ExecutionService`를 새 run execution 계층으로 올린다
- engine lease, budget bucket, session lifecycle을 daemon 기준으로 재정의
- local command/engine command 모두 `Session` 모델로 통일
- worktree lifecycle은 새 run execution 계층에서 재구현한다

완료 기준:

- 데스크톱 main process가 bespoke 실행 로직을 직접 소유하지 않음
- 실행 결과가 동일한 run event로 기록됨

현재 상태:

- 완료
- 공용 실행 엔진은 `packages/execution`에 추출됨
- 데스크톱 `ExecutionService`는 host wrapper로 축소됨
- local workspace command는 git worktree에서 실행되고, session/worktree 메타데이터가 `runtime_run_index`에 projection 된다

### Phase 4. forge 재구현

- `packages/forge`를 새 도메인 모델 위에 구현
- `legacy/lib/forge/*`는 단계, 게이트, 반복 정책의 참고본으로만 사용
- stage result를 TaskDag 전용 포맷이 아니라 표준 `Step` 기록으로 저장
- stage gate를 command/query API에 연결

완료 기준:

- 새 코어에서 forge pipeline이 돌아감
- 데스크톱 UI가 같은 stage 상태를 조회 가능

### Phase 5. memory 재구현

- `packages/memory`를 새 storage와 새 런타임 계약 위에 구현
- `legacy/lib/hivemind/*`는 추출, 인덱싱, 검색 요구사항의 참고본으로만 사용
- mission/run/artifact 기록을 note와 연결
- `/recall` 및 session hook을 새 runtime contract에 맞게 정리

완료 기준:

- memory indexing/search가 새 storage와 연결됨
- legacy daemon에 의존하지 않음

### Phase 6. desktop hardening

- 데스크톱 main host와 renderer 경계를 더 얇게 만든다
- foreground runtime과 background automation 수명을 안정화한다
- release/review/steering 흐름을 실제 운영 사용 기준으로 다듬는다

완료 기준:

- 데스크톱 앱만으로 주요 운영 흐름을 끝낼 수 있음
- 런타임 재시작과 상태 복구가 안정적임

### Phase 7. legacy 제거

- `legacy/web`, `legacy/lib/ucmd*`, `legacy/lib/server` 제거
- import path와 문서를 새 구조로 전환

완료 기준:

- 사용 중인 제품 경로에서 `legacy` 참조 0건

## 우선순위가 높은 첫 구현 과제

가장 먼저 해야 할 일은 `legacy`를 끌고 오는 것이 아니다. 아래 순서가 맞다.

1. 모놀리식 타입/도메인 분리
2. 런타임 코어를 Electron 밖으로 추출
3. storage interface 정의
4. forge를 새 코어에 연결

이 순서를 바꾸면 UI 또는 transport부터 건드리게 되고, 결국 구조만 복잡해진다.

## 이번 재설계의 결론

UCM의 문제는 단순히 파일이 지저분한 것이 아니다. 새 제품 코어가 아직 완성되지 않았는데, 폐기 예정인 `legacy`가 기능 요구사항을 대신 붙들고 있다는 점이 본질이다.

따라서 재설계의 핵심은 다음 한 줄로 요약된다.

> `legacy`를 옮기지 않는다. 하나의 작업/실행 중심 코어를 새로 세우고, 그 위에 데스크톱 앱을 안정적으로 올린다.

이 문서를 기준으로 다음 작업부터는 새 패키지 구조를 먼저 만들고, 기능은 그 위로 옮긴다.
