# UCM Agent IDE IPC Contract

## 목적

이 문서는 Electron 기반 UCM Agent IDE의 프로세스 경계를 정의한다.

핵심 목표는 두 가지다.

1. Renderer가 로컬 시스템과 런타임에 직접 접근하지 못하게 한다.
2. IPC를 `daemon`, `queue`, `stage`가 아니라 `workspace`, `mission`, `agent`, `run`, `artifact` 중심으로 고정한다.

즉, 이 문서는 단순한 API 목록이 아니라 제품 경계를 지키기 위한 문서다.

## 프로세스 모델

초기 아키텍처는 3계층으로 나눈다.

```text
Renderer (React UI)
  -> IPC
Main Process (Electron broker)
  -> internal service bridge
Local Runtime (mission/agent/run execution engine)
```

### Renderer

책임:

- 화면 렌더링
- 사용자 입력 처리
- optimistic UI
- local view state

금지:

- 파일시스템 직접 접근
- shell command 직접 실행
- child process 직접 생성
- runtime 내부 저장소 직접 읽기

### Main Process

책임:

- BrowserWindow lifecycle
- OS integration
- 파일 열기/폴더 선택
- child process supervision
- 권한 검사
- IPC validation

금지:

- 제품 로직 대부분 구현
- mission planning 로직 보유
- agent state machine 자체 구현

### Local Runtime

책임:

- workspace session
- mission orchestration
- agent lifecycle
- run execution
- artifact/decision 기록
- terminal session 관리

금지:

- Electron window 제어
- renderer 상태 직접 변경

## IPC 원칙

모든 IPC는 아래 원칙을 따른다.

1. Renderer는 low-level runtime concept를 직접 보지 않는다.
2. IPC 이름은 제품 용어를 사용한다.
3. 스트리밍 정보는 event channel로 전달한다.
4. 장기 실행 작업은 request/response 하나로 닫지 않는다.
5. 모든 mutation은 actor와 timestamp를 남긴다.
6. Main process는 validation 실패 시 런타임에 요청을 전달하지 않는다.
7. 기본 IPC는 세밀한 운영 제어보다 high-level steering에 우선권을 둔다.

## 계약 스타일

IPC는 두 종류로 나눈다.

- `command`
  상태를 바꾸는 요청
- `query`
  현재 상태를 읽는 요청

그리고 실시간 정보는 별도 `event` 채널로 흘린다.

```text
query   -> one-shot read
command -> one-shot write / action trigger
event   -> streaming update
```

## Workspace IPC

### query.workspace.list

설명:
등록된 workspace 목록 조회

응답:

```ts
type WorkspaceListResponse = {
  workspaces: Workspace[];
};
```

### command.workspace.open

설명:
기존 workspace를 열고 앱의 active workspace로 설정

요청:

```ts
type OpenWorkspaceRequest = {
  workspaceId: string;
};
```

### command.workspace.pickDirectory

설명:
OS directory picker를 열고 새 workspace 후보 경로를 선택

응답:

```ts
type PickDirectoryResponse = {
  canceled: boolean;
  path?: string;
};
```

### command.workspace.register

설명:
선택한 디렉토리를 workspace로 등록

요청:

```ts
type RegisterWorkspaceRequest = {
  path: string;
  name?: string;
};
```

## Mission IPC

### query.mission.list

설명:
현재 workspace 또는 전체 mission 목록 조회

요청:

```ts
type ListMissionsRequest = {
  workspaceId?: string;
  status?: MissionStatus[];
};
```

### query.mission.get

설명:
mission 상세 조회

요청:

```ts
type GetMissionRequest = {
  missionId: string;
};
```

### command.mission.create

설명:
새 mission 생성

요청:

```ts
type CreateMissionRequest = {
  workspaceId: string;
  title: string;
  goal: string;
  successCriteria: string[];
  constraints: string[];
  budget?: {
    maxTokens?: number;
    maxCostUsd?: number;
    maxDurationMin?: number;
  };
  priority?: "low" | "normal" | "high" | "critical";
};
```

### command.mission.update

설명:
mission 제목, 목표, 제약, success criteria 수정

### command.mission.archive

설명:
mission을 active view에서 제외

### command.mission.attachMemory

설명:
memory 결과를 현재 mission 컨텍스트에 연결

요청:

```ts
type AttachMemoryRequest = {
  missionId: string;
  memoryIds: string[];
};
```

## Plan IPC

### query.plan.get

설명:
mission의 active plan 조회

### command.plan.generate

설명:
mission 기반 plan 생성

요청:

```ts
type GeneratePlanRequest = {
  missionId: string;
  strategy?: "balanced" | "fast" | "careful";
};
```

### command.plan.updatePhase

설명:
plan phase 수정

### command.plan.reorderPhases

설명:
phase 순서 재정렬

## Agent IPC

### query.agent.list

설명:
mission 소속 agent 목록 조회

요청:

```ts
type ListAgentsRequest = {
  missionId: string;
};
```

### query.agent.get

설명:
agent 상세 조회

### command.agent.spawn

설명:
mission에 새 agent 생성

요청:

```ts
type SpawnAgentRequest = {
  missionId: string;
  role: AgentRole;
  name?: string;
  objective: string;
  permissions?: {
    canWrite?: boolean;
    canRunCommands?: boolean;
    canUseNetwork?: boolean;
    writablePaths?: string[];
  };
  budget?: {
    maxTokens?: number;
    maxCostUsd?: number;
  };
};
```

### command.agent.update

설명:
agent objective, budget, permissions 수정

### command.agent.stop

설명:
agent를 offline 상태로 전환

### command.agent.assign

설명:
agent에 phase 또는 ad hoc task를 할당

요청:

```ts
type AssignAgentRequest = {
  agentId: string;
  missionId: string;
  title: string;
  objective: string;
  relatedPhaseId?: string;
};
```

### command.agent.steer

설명:
특정 agent 또는 현재 run에 짧은 steering update 전달

요청:

```ts
type SteerAgentRequest = {
  agentId: string;
  message: string;
};
```

## Run IPC

### query.run.list

설명:
mission 또는 agent 기준 run 목록 조회

요청:

```ts
type ListRunsRequest = {
  missionId?: string;
  agentId?: string;
  status?: RunStatus[];
};
```

### query.run.get

설명:
run 상세 조회

### command.run.start

설명:
agent의 새 run 시작

요청:

```ts
type StartRunRequest = {
  missionId: string;
  agentId: string;
  title: string;
  objective: string;
};
```

### command.run.attachContext

설명:
현재 run에 링크, 메모, 파일 참조 등 추가 컨텍스트를 주입

요청:

```ts
type AttachRunContextRequest = {
  runId: string;
  items: Array<{
    kind: "note" | "link" | "path";
    value: string;
  }>;
};
```

### command.run.abort

설명:
run 중단

### command.run.approve

설명:
needs_review 상태 run 또는 artifact 승인

### command.run.reject

설명:
run 또는 artifact 거절과 피드백 전달

요청:

```ts
type RejectRunRequest = {
  runId: string;
  feedback: string;
};
```

## Artifact IPC

### query.artifact.list

설명:
mission/run/agent 기준 artifact 목록 조회

요청:

```ts
type ListArtifactsRequest = {
  missionId?: string;
  runId?: string;
  agentId?: string;
  types?: ArtifactType[];
};
```

### query.artifact.get

설명:
artifact 상세 내용 조회

### command.artifact.pin

설명:
artifact를 mission 또는 memory에 pin

### command.artifact.export

설명:
artifact를 파일로 내보내기

이 요청은 main process가 OS save dialog를 열고 저장 경로를 선택한 뒤 런타임에 위임한다.

## Deliverable IPC

### query.deliverable.list

설명:
mission 기준 deliverable 목록 조회

### query.deliverable.get

설명:
특정 deliverable과 latest revision 조회

### query.deliverable.revisions

설명:
deliverable revision history 조회

### command.deliverable.generate

설명:
현재 artifact 집합을 바탕으로 새 deliverable revision 생성

요청:

```ts
type GenerateDeliverableRequest = {
  missionId: string;
  kind: "release_brief" | "review_packet" | "merge_handoff" | "deployment_note";
  basedOnArtifactIds: string[];
};
```

### command.deliverable.export

설명:
deliverable revision을 파일로 내보내기

### command.deliverable.handoff

설명:
deliverable revision을 사람에게 전달 가능한 상태로 기록

요청:

```ts
type HandoffDeliverableRequest = {
  deliverableRevisionId: string;
  channel: "inbox" | "export" | "share";
  target?: string;
};
```

## Decision IPC

### query.decision.list

설명:
mission 또는 run 기준 decision 목록 조회

### command.decision.create

설명:
사용자가 수동 decision을 기록

요청:

```ts
type CreateDecisionRequest = {
  missionId: string;
  runId?: string;
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
};
```

## Memory IPC

### query.memory.search

설명:
과거 mission, decision, artifact, template 검색

요청:

```ts
type SearchMemoryRequest = {
  query: string;
  kinds?: Array<"mission" | "decision" | "artifact" | "template">;
  workspaceId?: string;
  missionId?: string;
};
```

### command.memory.pin

설명:
search 결과를 현재 workspace 또는 mission에 pin

### command.memory.unpin

설명:
pin 제거

## Terminal IPC

### query.terminal.sessions

설명:
활성 terminal 세션 목록 조회

### command.terminal.open

설명:
run에 연결된 terminal 세션 열기 또는 생성

요청:

```ts
type OpenTerminalRequest = {
  runId: string;
};
```

### command.terminal.write

설명:
terminal 입력 전달

요청:

```ts
type WriteTerminalRequest = {
  sessionId: string;
  data: string;
};
```

### command.terminal.resize

설명:
terminal 크기 변경

요청:

```ts
type ResizeTerminalRequest = {
  sessionId: string;
  cols: number;
  rows: number;
};
```

### command.terminal.close

설명:
terminal 세션 종료

## Settings IPC

### query.settings.get

설명:
앱 설정 조회

### command.settings.update

설명:
앱 설정 수정

설정 예:

- theme
- default model/provider
- budget defaults
- telemetry opt-in
- notifications

## Event Channels

실시간 정보는 event channel로만 전달한다.

### event.workspace.updated

workspace 메타 변경 알림

### event.mission.updated

mission 상태 또는 메타 변경 알림

### event.plan.updated

plan 생성/수정 알림

### event.agent.updated

agent 상태 변화 알림

예:

- idle -> running
- running -> blocked
- waiting -> needs_input

### event.run.updated

run 상태 변화 알림

### event.run.timeline

run timeline 항목 추가

payload 예:

```ts
type RunTimelineEvent = {
  runId: string;
  at: string;
  kind:
    | "started"
    | "context_loaded"
    | "tool_started"
    | "tool_finished"
    | "artifact_created"
    | "blocked"
    | "completed"
    | "failed";
  summary: string;
};
```

### event.run.output

terminal 또는 요약된 execution output 스트림

### event.artifact.created

새 artifact 생성 알림

### event.decision.created

새 decision 생성 알림

### event.alert.raised

사람의 짧은 응답이 필요한 상황 알림

예:

- review 필요
- blocked
- budget nearing limit
- failed run

기본 모드에서는 이 alert만 사람이 보면 된다.

## Validation Rules

Main process는 최소한 아래를 검증해야 한다.

1. 모든 ID는 문자열 규칙 검증
2. writable path는 workspace 밖으로 벗어나지 않게 검증
3. terminal write 대상 세션 존재 여부 검증
4. export 대상 경로의 사용자 승인 확인
5. command payload 크기 제한
6. 알 수 없는 IPC 이름 차단

## Renderer에 노출하지 않을 것

다음 개념은 renderer 계약에서 제외한다.

- internal queue state
- daemon PID
- raw process table
- stage-level internals
- lockfile state
- worktree recovery internals
- provider API key 상태 원문

이 정보는 운영 디버그 모드에서만 별도 surface로 제한한다.

## 실패 방지 원칙

기존 실패를 반복하지 않기 위해 IPC는 아래를 지켜야 한다.

1. `task.start`, `queue.retry`, `stage.approve` 같은 이름을 기본 계약에 쓰지 않는다.
2. renderer가 runtime 내부 개념을 직접 조합해 제품 기능을 만들지 못하게 한다.
3. command는 가능한 한 사용자 의도를 직접 나타내야 한다.
4. run timeline과 agent state를 통해 legibility를 제공하고 raw log는 보조 채널로 둔다.
5. pause/resume/reassign 같은 저수준 운영 제어는 기본 표면이 아니라 advanced/debug 표면으로 둔다.

## 다음 문서

이 문서 다음으로 필요한 것은 [로컬 런타임 구조 문서](agent-ide-runtime.md)다.
