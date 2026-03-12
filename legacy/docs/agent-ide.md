# UCM Agent IDE

## 목적

이 문서는 기존 UCM을 재사용 대상으로 보지 않고, 실패 사례를 바탕으로 새 제품을 정의하기 위한 초기 설계 문서다.

새 제품의 목표는 다음 한 줄로 요약한다.

> UCM Agent IDE는 여러 에이전트로 구성된 소프트웨어 조직을 자동으로 운영하고, 사람은 관찰과 짧은 steering만 수행하는 데스크톱 명령센터다.

즉, 이 제품은 코드 편집기가 아니라 에이전트 운영 IDE다.

## 실패 교훈

기존 UCM은 다음 이유로 실패작으로 간주한다.

1. 제품 중심이 아니라 시스템 중심이었다.
2. 핵심 단위가 `task`와 `stage`였고 `mission`과 `agent`가 아니었다.
3. 사용자 경험이 IDE보다 운영 도구에 가까웠다.
4. 사람의 개입 지점이 구조적으로 약했다.
5. 에이전트를 1급 객체로 다루지 못했다.
6. 상태와 로그는 많았지만 판단 정보는 약했다.
7. 실행의 가시성이 낮았다.
8. CLI, web, desktop이 병렬로 존재해 제품 정체성이 흐려졌다.
9. 내부 구현 개념이 UX를 지배했다.
10. 자동화는 있었지만 orchestration experience는 없었다.

## 새 설계 원칙

새 Agent IDE는 아래 원칙으로 설계한다.

1. `Mission-first`
   사용자의 시작점은 작업이 아니라 목표다.
2. `Agent-native`
   관심의 기본 단위는 파일이 아니라 에이전트다.
3. `Conductor UX`
   사용자는 구현자가 아니라 지휘자다.
4. `Legibility-first`
   에이전트가 지금 무엇을 왜 하고 있는지 읽혀야 한다.
5. `Autopilot-first`
   기본 모드는 자동 운영이어야 하고, 사람은 드물게 steering만 해야 한다.
6. `Artifact-first`
   대화보다 spec, diff, report, decision이 중심이다.
7. `Org-as-interface`
   여러 에이전트를 조직처럼 배치하고 운영해야 한다.
8. `Desktop-primary`
   데스크톱 앱이 제품의 중심 인터페이스다.
9. `Structured autonomy`
   각 에이전트의 역할, 권한, 예산, 범위를 명시적으로 제한한다.
10. `Visible bottlenecks`
    idle, blocked, review 대기 병목이 즉시 보여야 한다.

## 제품 정의

이 제품은 기존 IDE의 `Explorer / Editor / Terminal` 중심 구조를 그대로 답습하지 않는다.

대신 아래 흐름을 제품의 주 사용자 경험으로 둔다.

```text
Goal -> Plan -> Team -> Run -> Observe -> Steer -> Approve
```

핵심 질문도 바뀐다.

- 어떤 파일을 열까?
- 어떤 함수가 문제일까?

보다는 다음 질문이 먼저 와야 한다.

- 지금 어떤 mission이 진행 중인가?
- 어떤 agent가 idle 또는 blocked 상태인가?
- 지금 시스템이 사람에게 묻고 있는 것은 무엇인가?
- 어떤 artifact가 review를 기다리고 있는가?

## 사람의 역할

기본 모드에서 사람은 운영자가 아니다.

사람의 역할은 아래 4개로 축소한다.

1. `Goal Update`
   방향, 제약, 우선순위를 짧게 수정한다.
2. `Context Injection`
   링크, 문서, 사실, 짧은 의견을 추가한다.
3. `Approval / Rejection`
   큰 결과 단위를 승인하거나 반려한다.
4. `Emergency Stop`
   비용 초과나 명백한 오작동 시에만 중단한다.

그 외 대부분은 자동화한다.

- agent spawn
- assignment
- retry
- regroup
- verifier loop
- artifact generation
- planning refresh

## 핵심 객체

새 제품의 기본 도메인은 다음 10개로 정의한다.

### Workspace

하나의 프로젝트 작업 공간. 로컬 경로, git 정보, memory 범위를 가진다.

### Mission

사용자가 선언한 상위 목표. 성공 조건, 제약, 예산, 우선순위를 가진다.

예:

- "결제 장애 원인 파악 후 안전하게 수정"
- "모바일 로그인 이탈률을 낮추는 UX 개선안 구현"

### Plan

Mission을 어떻게 풀지에 대한 실행 구조. phase, deliverable, risk, assignment를 포함한다.

### Agent

역할을 가진 실행 단위. 단순 세션이 아니라 `role + permissions + context contract`를 가진다.

예:

- `conductor`
- `architect`
- `builder`
- `verifier`
- `researcher`
- `reviewer`

### Run

특정 agent가 특정 mission 아래에서 실제로 수행한 실행 세션.

### Artifact

실행 중 또는 완료 후 생성된 결과물.

예:

- spec
- design note
- diff
- patch
- test result
- report
- handoff note

### Deliverable

사람에게 전달되는 논리적 결과물 묶음. 여러 artifact를 재료로 삼아 생성된다.

예:

- release brief
- review packet
- merge handoff
- deployment note

### Deliverable Revision

deliverable의 실제 버전 스냅샷. append-only로 쌓인다.

예:

- `release-handoff v1`
- `release-handoff v2`
- `release-handoff v3`

revision은 overwrite하지 않고 누적한다.

### Handoff

어떤 deliverable revision이 언제 누구에게 전달되었는지 남기는 기록.

### Decision

중요한 판단 기록. 왜 그렇게 결정했는지 남긴다.

## 도메인 관계

```text
Workspace
  └─ Mission
      ├─ Plan
      ├─ Agent[]
      ├─ Run[]
      ├─ Artifact[]
      ├─ Deliverable[]
      ├─ DeliverableRevision[]
      ├─ Handoff[]
      └─ Decision[]
```

상세 관계는 다음과 같다.

- `Workspace` has many `Mission`
- `Mission` has one active `Plan`
- `Mission` has many `Agent`
- `Mission` has many `Run`
- `Run` produces many `Artifact`
- `Mission` has many `Deliverable`
- `Deliverable` has many `DeliverableRevision`
- `DeliverableRevision` is composed from one or more `Artifact`
- `Handoff` records delivery of a specific `DeliverableRevision`
- `Run` emits many `Decision`
- `Artifact`와 `Decision`은 특정 `Agent`에 연결될 수 있다

## 결과물 누적 원칙

결과물은 항상 버전업으로 누적돼야 한다.

잘못된 방식:

- `summary.md` 하나를 계속 덮어쓰기
- latest만 남고 이전 전달본이 사라짐

올바른 방식:

- deliverable identity는 고정
- revision은 append-only
- latest pointer는 별도 관리

즉 구조는 다음과 같다.

```text
Artifact -> Deliverable -> DeliverableRevision -> Handoff
```

의미는 다음과 같다.

- `Artifact`
  원재료
- `Deliverable`
  결과물의 논리적 묶음
- `DeliverableRevision`
  사람에게 보여줄 실제 버전
- `Handoff`
  전달 이벤트

## 타입 초안

```ts
type ID = string;
type ISODate = string;

type Workspace = {
  id: ID;
  name: string;
  rootPath: string;
  git?: {
    branch: string;
    defaultBranch?: string;
    dirty: boolean;
    ahead?: number;
    behind?: number;
  };
  memoryScopeId?: ID;
  createdAt: ISODate;
  updatedAt: ISODate;
};

type MissionStatus =
  | "draft"
  | "planned"
  | "running"
  | "blocked"
  | "needs_review"
  | "completed"
  | "aborted"
  | "failed";

type Mission = {
  id: ID;
  workspaceId: ID;
  title: string;
  goal: string;
  successCriteria: string[];
  constraints: string[];
  budget?: {
    maxTokens?: number;
    maxCostUsd?: number;
    maxDurationMin?: number;
  };
  priority: "low" | "normal" | "high" | "critical";
  status: MissionStatus;
  activePlanId?: ID;
  createdAt: ISODate;
  updatedAt: ISODate;
};

type PlanPhaseStatus = "todo" | "active" | "done" | "skipped" | "failed";

type Plan = {
  id: ID;
  missionId: ID;
  summary: string;
  phases: Array<{
    id: ID;
    title: string;
    objective: string;
    status: PlanPhaseStatus;
    assignedAgentIds: ID[];
    deliverables: string[];
    dependencies: ID[];
  }>;
  risks: string[];
  assumptions: string[];
  createdAt: ISODate;
  updatedAt: ISODate;
};

type AgentRole =
  | "conductor"
  | "architect"
  | "builder"
  | "verifier"
  | "researcher"
  | "reviewer";

type AgentStatus =
  | "idle"
  | "thinking"
  | "running"
  | "waiting"
  | "blocked"
  | "needs_input"
  | "offline";

type Agent = {
  id: ID;
  missionId: ID;
  name: string;
  role: AgentRole;
  status: AgentStatus;
  objective: string;
  contextWindow?: number;
  permissions: {
    canWrite: boolean;
    canRunCommands: boolean;
    canUseNetwork: boolean;
    writablePaths: string[];
  };
  budget?: {
    maxTokens?: number;
    maxCostUsd?: number;
  };
  currentRunId?: ID;
  createdAt: ISODate;
  updatedAt: ISODate;
};

type RunStatus =
  | "queued"
  | "starting"
  | "running"
  | "blocked"
  | "needs_review"
  | "completed"
  | "failed"
  | "aborted";

type Run = {
  id: ID;
  missionId: ID;
  planId?: ID;
  agentId: ID;
  title: string;
  status: RunStatus;
  summary?: string;
  startedAt?: ISODate;
  endedAt?: ISODate;
  usage: {
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd?: number;
    durationMs?: number;
  };
  branchName?: string;
  worktreePath?: string;
  terminalSessionId?: ID;
};

type ArtifactType =
  | "spec"
  | "plan"
  | "note"
  | "patch"
  | "diff"
  | "test_result"
  | "report"
  | "log_excerpt"
  | "handoff";

type Artifact = {
  id: ID;
  missionId: ID;
  runId?: ID;
  agentId?: ID;
  type: ArtifactType;
  title: string;
  uri?: string;
  contentPreview?: string;
  metadata?: Record<string, unknown>;
  createdAt: ISODate;
};

type DeliverableKind =
  | "release_brief"
  | "review_packet"
  | "merge_handoff"
  | "deployment_note";

type Deliverable = {
  id: ID;
  missionId: ID;
  kind: DeliverableKind;
  title: string;
  latestRevisionId?: ID;
  createdAt: ISODate;
};

type DeliverableRevision = {
  id: ID;
  deliverableId: ID;
  revision: number;
  basedOnArtifactIds: ID[];
  summary: string;
  bodyUri?: string;
  createdAt: ISODate;
};

type Handoff = {
  id: ID;
  deliverableRevisionId: ID;
  channel: "inbox" | "export" | "share";
  target?: string;
  createdAt: ISODate;
};

type Decision = {
  id: ID;
  missionId: ID;
  runId?: ID;
  agentId?: ID;
  category:
    | "planning"
    | "scope"
    | "technical"
    | "risk"
    | "approval"
    | "rollback";
  summary: string;
  rationale: string;
  alternatives?: string[];
  approvedBy?: "human" | "agent";
  createdAt: ISODate;
};
```

## 1차 정보 구조

핵심 화면은 5개로 시작한다.

1. `Home`
   최근 workspace, 최근 mission, 템플릿 진입점
2. `Command Center`
   전체 agent 팀 현황, 병목, review 대기, 비용
3. `Mission`
   goal, constraints, plan, success criteria, team structure
4. `Run`
   live execution, terminal, diff, artifact, decision
5. `Memory`
   과거 mission, 재사용 가능한 org template, failed pattern

## 첫 화면: Command Center

첫 화면은 코드 에디터가 아니라 명령센터여야 한다.

레이아웃은 다음 구성을 기본안으로 한다.

```text
+------------------------------------------------------------------------------+
| UCM Agent IDE   Workspace: myapp   Mission: Checkout rollback fix            |
| Search  Quick Command  Budget $12.40/$20  6 agents  2 blocked  1 review      |
+---------------+---------------------------------------+----------------------+
| Missions      | Org Board                             | Inspector            |
|               |                                       |                      |
| Active        | Conductor                             | Selected: Builder-2  |
| - Checkout    | running                               | Role: Builder        |
| - Release     | "rebalancing work"                    | Status: Blocked      |
|               |                                       | Needs input          |
| Queued        | Architect   Builder-1   Builder-2     | - auth contract      |
| - Billing     | idle        running     blocked       | - fixture path       |
| - Search UX   |                                       |                      |
|               | Researcher  Verifier                  | Actions              |
| Templates     | running     needs_review              | [Resume] [Message]   |
| - Bug triage  |                                       | [Reassign] [Stop]    |
| - Refactor    | links = assignment or handoff edges   |                      |
+---------------+---------------------------------------+----------------------+
| Live Strip: terminal | diff | tests | decisions | artifacts                 |
+------------------------------------------------------------------------------+
```

### pane 역할

- 좌측 `Mission Rail`
  active, queued, recent mission과 org template를 보여준다.
- 중앙 `Org Board`
  agent를 카드로 배치하고 상태와 관계를 시각화한다.
- 우측 `Inspector`
  선택한 agent 또는 run의 상세 상태와 steering 관련 정보를 보여준다.
- 하단 `Live Strip`
  terminal, diff, test, decision feed를 빠르게 넘나들게 한다.

### 첫 화면에 두지 말 것

다음 요소는 첫 화면의 주인공이 아니다.

- 파일 트리
- 전체 로그 텍스트
- stage list
- daemon 상태
- queue 관리자 화면
- 과도한 설정 UI

## 아키텍처 방향

데스크톱 앱은 Electron 기준으로 아래 구조를 목표로 한다.

### Main Process

- window lifecycle
- OS integration
- child process supervision
- secure IPC broker

### Renderer

- React 기반 UI
- mission, org, run, memory 중심 화면

### Local Runtime

- agent orchestration runtime
- mission execution manager
- terminal/session manager
- local storage and index

### Execution Sandboxes

- isolated worktree or workspace copy
- terminal session
- browser session
- artifact storage

## 의도적으로 버릴 것

기존 실패를 반복하지 않기 위해 다음은 의도적으로 후순위로 둔다.

- stage-heavy UX
- daemon/admin 대시보드 중심 구조
- task list 중심 탐색
- 로그 우선 화면
- CLI 기준의 정보 구조
- 기능 수 확장을 통한 가치 증명

## MVP

1차 MVP 범위는 작게 잡는다.

1. workspace 열기
2. mission 생성
3. 기본 agent team 생성
   - conductor
   - builder
   - verifier
4. command center 표시
5. run 상세 보기
6. artifact와 diff 보기
7. 중단, 재시도, 승인, 재할당

## 다음 문서

이 문서 다음 단계로 필요한 설계 문서는 아래와 같다.

1. [화면 와이어프레임](agent-ide-wireframes.md)
2. [IPC 계약](agent-ide-ipc.md)
3. [로컬 런타임 구조](agent-ide-runtime.md)
4. 저장소 구조
5. [MVP 구현 순서](agent-ide-mvp-plan.md)
