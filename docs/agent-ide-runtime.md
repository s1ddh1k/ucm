# UCM Agent IDE Runtime

## 목적

이 문서는 UCM Agent IDE의 로컬 런타임 구조를 정의한다.

Mission 상태 전이와 agent lifecycle 자동화 규칙은 별도 문서 [Agent IDE Execution Policy](agent-ide-execution-policy.md)에서 고정한다.

여기서 말하는 런타임은 Electron 메인 프로세스가 아니라, 앱 내부에서 mission, agent, run을 실제로 운영하는 엔진이다.

이 문서의 목표는 다음과 같다.

1. 런타임 내부 서비스 경계를 고정한다.
2. 어떤 서비스가 어떤 상태를 소유하는지 명확히 한다.
3. 기존 실패처럼 `daemon + queue + pipeline` 중심 구조로 다시 미끄러지지 않게 한다.

## 핵심 관점

이 런타임은 작업 큐 관리자나 백그라운드 daemon이 아니다.

핵심은 다음이다.

> Agent IDE Runtime은 mission을 중심으로 agent team을 조율하고, run을 실행하고, artifact와 deliverable revision을 축적하는 로컬 실행 시스템이다.

즉 런타임의 중심 객체는 다음 순서다.

```text
Mission -> Agent Team -> Run -> Artifact / Deliverable / Decision
```

`task`, `queue`, `stage`는 내부 구현 디테일일 수는 있어도 런타임의 전면 개념이 아니다.

## 런타임 개요

```text
Main Process
  -> Runtime Bridge

Agent IDE Runtime
  ├─ Workspace Service
  ├─ Mission Service
  ├─ Planning Service
  ├─ Agent Registry
  ├─ Run Orchestrator
  ├─ Execution Service
  ├─ Terminal Service
  ├─ Artifact Service
  ├─ Deliverable Service
  ├─ Decision Service
  ├─ Memory Service
  ├─ Event Bus
  └─ Persistence Layer
```

## 서비스 분해

### Workspace Service

책임:

- workspace 등록
- active workspace 전환
- workspace 메타 조회
- workspace 범위 검증

소유 상태:

- workspace 목록
- active workspace id
- workspace별 git/sandbox 메타

하지 않는 일:

- mission planning
- run execution

### Mission Service

책임:

- mission 생성/수정/보관
- mission 상태 전이 관리
- mission budget/constraints 관리
- mission와 plan/agent/run 연결 유지

소유 상태:

- mission aggregate
- mission status
- mission alerts

Mission Service는 제품 수준의 상태 진입점을 담당한다.

### Planning Service

책임:

- mission 기반 초기 plan 생성
- plan phase 재구성
- risk/assumption 갱신
- team structure recommendation 생성

소유 상태:

- active plan
- phase graph
- planning rationale

Planning Service는 실행 서비스가 아니다. 실행 전에 구조를 만든다.

### Agent Registry

책임:

- agent 생성/갱신/중지
- role, permissions, budget 관리
- current run binding 관리
- idle/running/blocked 상태 집계

소유 상태:

- agent definitions
- live agent status
- agent capability profiles

Agent Registry는 조직도와 같은 역할을 한다.

### Run Orchestrator

책임:

- 어느 agent가 어떤 run을 언제 시작할지 결정
- blocked/idle/review 병목 식별
- agent 간 handoff 관리
- run 우선순위 조정

소유 상태:

- active run map
- assignment graph
- human steering queue

Run Orchestrator는 런타임의 중심 서비스다.

기존 시스템의 queue manager와 달리, 이 서비스는 "누가 다음에 일할까?"를 조직 수준에서 자동 결정한다.

### Execution Service

책임:

- 실제 agent session 실행
- tool invocation 중개
- sandbox/worktree/session 연결
- run lifecycle 관리

소유 상태:

- execution handles
- subprocess/session references
- run-local context

Execution Service는 planning을 하지 않는다. 받은 objective를 실행한다.

### Terminal Service

책임:

- run별 terminal session 생성
- PTY 입출력 관리
- resize/write/close 처리
- output stream 요약 전달

소유 상태:

- terminal session table
- session to run mapping

### Artifact Service

책임:

- artifact 생성/조회/분류
- artifact preview/index 갱신
- export/pin 지원

소유 상태:

- artifact metadata index
- artifact storage location mapping

Artifact Service는 파일 저장만 하는 서비스가 아니라, 결과물을 UI가 소비할 수 있는 객체로 정규화한다.

### Deliverable Service

책임:

- deliverable 생성
- revision append
- latest revision 관리
- handoff/export/share용 묶음 생성

소유 상태:

- deliverable metadata
- revision history
- latest revision pointers
- handoff log

Deliverable Service는 사람이 실제로 받는 결과물을 관리한다. artifact는 재료고, deliverable revision은 전달본이다.

### Decision Service

책임:

- 중요한 판단 기록
- approval/rejection 이력 축적
- run timeline과 decision 연결

소유 상태:

- decision log
- approval history

### Memory Service

책임:

- 과거 mission, artifact, decision 검색
- pinned memory 관리
- template recall

소유 상태:

- memory index
- attachment links

### Event Bus

책임:

- 런타임 내부 서비스 간 이벤트 전달
- main process bridge로 이벤트 전달

Event Bus는 저장소가 아니다. 비동기 상태 알림 채널이다.

### Persistence Layer

책임:

- aggregate 저장
- append-only event or timeline 저장
- crash recovery용 snapshot 저장

Persistence Layer는 UI 친화적 view model이 아니라 source of truth를 저장한다.

## 상태 소유권

상태 충돌을 피하려면 누가 무엇을 소유하는지 명확해야 한다.

### Workspace 상태

- 소유자: `Workspace Service`

### Mission 상태

- 소유자: `Mission Service`

### Plan 상태

- 소유자: `Planning Service`

### Agent 상태

- 소유자: `Agent Registry`

### Run 상태

- 소유자: `Run Orchestrator`

### Run 실행 핸들

- 소유자: `Execution Service`

### Terminal 세션

- 소유자: `Terminal Service`

### Artifact 메타

- 소유자: `Artifact Service`

### Deliverable / Revision / Handoff

- 소유자: `Deliverable Service`

### Decision 이력

- 소유자: `Decision Service`

### Searchable Memory

- 소유자: `Memory Service`

## 실행 흐름

### 새 mission 시작

```text
1. Mission Service creates mission
2. Planning Service generates plan
3. Agent Registry provisions team
4. Run Orchestrator computes first assignments
5. Execution Service starts first run(s)
6. Artifact, Deliverable, Decision services record outputs
7. Event Bus emits mission/agent/run updates
```

### 사람 응답이 필요한 상황 처리

```text
1. Execution Service detects blocked condition
2. Run Orchestrator marks run blocked
3. Agent Registry updates agent status
4. Decision Service records why blocked
5. Event Bus raises steering-needed alert
6. Human responds through Renderer with brief steering or added context
7. command.agent.steer or command.run.attachContext arrives
8. Run Orchestrator decides whether to resume, retry, or reroute automatically
```

### review 승인 흐름

```text
1. Artifact Service marks artifact reviewable
2. Run Orchestrator sets run to needs_review
3. Human inspects diff/report/artifact
4. command.run.approve or command.run.reject
5. Decision Service records approval
6. Run Orchestrator either completes or automatically reassigns follow-up work
```

## 내부 상태 기계

제품 전면 상태는 적게 유지하되 런타임 내부에서는 좀 더 자세한 상태를 가질 수 있다.

### Agent 상태

외부 노출:

- `idle`
- `running`
- `blocked`
- `waiting`
- `needs_input`
- `offline`

내부 세부 상태 예:

- `starting`
- `loading_context`
- `tool_running`
- `handoff_pending`
- `approval_pending`

이 내부 상태는 UI에 직접 노출하지 않고 event 요약이나 timeline으로 번역한다.

### Run 상태

외부 노출:

- `queued`
- `starting`
- `running`
- `blocked`
- `needs_review`
- `completed`
- `failed`
- `aborted`

이 상태는 `Run Orchestrator`만 전이할 수 있어야 한다.

## 런타임 저장 전략

초기 구현은 지나치게 복잡하게 가지 않는다.

권장 전략:

- aggregate metadata: sqlite
- large artifact body: file storage
- timeline/event stream: append-only log
- terminal transcript: file chunk storage

### sqlite에 둘 것

- workspace
- mission
- plan
- agent
- run
- artifact metadata
- deliverable
- deliverable revision
- handoff
- decision
- alert

### 파일 저장소에 둘 것

- diff body
- patch
- full logs
- large reports
- exported summaries
- deliverable revision bodies
- terminal transcript chunks

## 디렉토리 전략

초기 로컬 데이터 구조 예시는 다음과 같다.

```text
~/.ucm-agent-ide/
  runtime.db
  events/
  artifacts/
  terminals/
  sandboxes/
  cache/
```

설명:

- `runtime.db`
  정규화된 metadata 저장
- `events/`
  timeline/event append log
- `artifacts/`
  artifact 원문
- `terminals/`
  terminal transcript
- `sandboxes/`
  worktree 또는 isolated workspace
- `cache/`
  preview, derived index, temp data

## sandbox 전략

기존 실패를 반복하지 않기 위해 sandbox는 런타임의 보조 서비스로 다룬다.

원칙:

1. sandbox는 제품 모델이 아니다.
2. sandbox는 run을 지원하는 실행 환경이다.
3. renderer는 sandbox path를 직접 다루지 않는다.

지원 가능한 방식:

- git worktree
- workspace copy
- ephemeral temp sandbox

선택은 구현 시점에 하되, 상위 모델은 바뀌지 않게 유지한다.

## 장애 복구

런타임은 데스크톱 앱이므로 crash recovery가 중요하다.

복구 전략:

1. aggregate snapshot 저장
2. active run execution handle 재구성 시도
3. 불가능하면 run을 `failed`가 아니라 `interrupted` 또는 `blocked` 성격으로 복구
4. 사용자에게 자동 복구 결과를 보여줌

복구 시 중요한 질문:

- 어떤 run이 실행 중이었는가?
- 어떤 artifact가 이미 생성되었는가?
- 어떤 decision이 기록되었는가?
- 어느 지점에서 사람의 steering이 필요한가?

즉, 복구의 목적은 “프로세스 재시작”이 아니라 “mission continuity 보존”이다.

## 관측성

런타임이 제공해야 할 핵심 관측성 신호는 아래다.

- active agents
- idle agents
- steering-needed alerts
- needs_review runs
- budget usage
- run duration
- artifact creation rate
- steering queue size

이 신호들은 모두 `Command Center`가 바로 소비할 수 있어야 한다.

## 런타임이 제공하지 않을 것

의도적으로 제외하는 것:

- 사용자에게 직접 노출되는 stage engine
- daemon 운영 패널
- queue depth 중심 운영지표
- child process PID 중심 디버그 UX
- 무한 수동 제어 토글 확장

이런 요소는 개발자용 debug 모드에서만 제한적으로 다룬다.

## 구현 순서 제안

런타임 구현 순서는 다음이 적절하다.

1. Event Bus
2. Persistence Layer
3. Workspace Service
4. Mission Service
5. Planning Service
6. Agent Registry
7. Run Orchestrator
8. Artifact Service
9. Deliverable Service
10. Decision Service
11. Terminal Service
12. Execution Service
13. Memory Service

이 순서인 이유는, 먼저 제품 모델과 기록 체계를 세워야 실행 엔진이 다시 시스템 중심으로 흐르지 않기 때문이다.

## 다음 문서

이 문서 다음 단계는 `저장 구조 문서` 또는 [MVP 구현 계획 문서](agent-ide-mvp-plan.md)다.
