# UCM Agent IDE Wireframes

## 목적

이 문서는 [Agent IDE](agent-ide.md)의 제품 정의를 실제 화면 구조로 풀어낸 1차 와이어프레임 문서다.

목표는 다음 두 가지다.

1. 제품의 1차 인터페이스가 무엇인지 고정한다.
2. 구현 전에 어떤 정보가 어느 화면의 주인공인지 합의한다.

이 문서는 시각 스타일 문서가 아니다. 정보 구조와 사용자 행동을 정의하는 문서다.

## 글로벌 레이아웃

모든 핵심 화면은 공통적으로 아래 UI 골격을 공유한다.

```text
+------------------------------------------------------------------------------+
| Top Bar                                                                      |
| Workspace | Mission | Search | Quick Command | Budget | Agent Count | Alerts |
+------------------+-----------------------------------------------------------+
| Navigation Rail  | Main Surface                                              |
| Home             |                                                           |
| Command Center   |                                                           |
| Mission          |                                                           |
| Run              |                                                           |
| Memory           |                                                           |
| Settings         |                                                           |
+------------------+-----------------------------------------------------------+
| Context Strip / Status Strip                                                 |
+------------------------------------------------------------------------------+
```

### Top Bar

항상 보여야 하는 정보:

- 현재 workspace
- 현재 선택 mission
- global search
- quick command palette 진입
- 현재 budget 사용량
- active agent 수
- blocked/review alert 수

기본 원칙:

- alert는 "사람이 지금 응답해야 하는가"만 드러내야 한다
- low-level 운영 신호는 기본 모드에서 숨긴다

### Navigation Rail

초기 탭은 6개만 둔다.

- `Home`
- `Command Center`
- `Mission`
- `Run`
- `Memory`
- `Settings`

### Context Strip

하단 strip는 화면에 따라 역할이 달라진다.

- live run 전환 strip
- 최근 decision strip
- active alerts strip

## 화면 1: Home

### 목적

앱을 켰을 때 사용자가 바로 다음 행동을 선택하게 하는 화면이다.

질문은 단순해야 한다.

- 어떤 workspace에서 일할 것인가?
- 어떤 mission을 다시 열 것인가?
- 새 mission을 시작할 것인가?

### 레이아웃

```text
+------------------------------------------------------------------------------+
| Home                                                                         |
+----------------------------------+-------------------------------------------+
| Recent Workspaces                | Active Missions                           |
|                                  |                                           |
| myapp                            | Checkout rollback fix                     |
| storefront                       | Search latency investigation              |
| mobile-app                       | Release prep                             |
|                                  |                                           |
| [Open Workspace]                 | [Resume Mission] [New Mission]            |
+----------------------------------+-------------------------------------------+
| Org Templates                    | Recent Decisions                          |
|                                  |                                           |
| Bug Triage Team                  | "Verifier blocked on fixture path"        |
| Refactor Crew                    | "Builder approved patch strategy"         |
| Release Captain                  |                                           |
+------------------------------------------------------------------------------+
```

### 핵심 액션

- workspace 열기
- 새 mission 시작
- mission 재개
- org template 선택

### Home에 두지 말 것

- 파일 트리
- 실시간 로그
- 상세 terminal
- 설정 폼 남발

Home은 launcher여야지 dashboard가 되면 안 된다.

## 화면 2: Command Center

### 목적

현재 에이전트 조직이 어떤 상태인지 5초 내 파악하게 하는 메인 화면이다.

### 레이아웃

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

### 핵심 질문

- 누가 idle인가?
- 어디가 blocked인가?
- 지금 사람이 판단해야 할 것은 무엇인가?
- 어떤 산출물이 review를 기다리는가?

### 핵심 액션

- 현재 상태 관찰
- 사람 입력이 필요한 alert 확인
- steering update 전달
- review 승인/거절

### Command Center에 두지 말 것

- 저수준 daemon 상태
- stage 나열
- 장문의 raw log
- queue 관리자 관점의 정보 구조

## 화면 3: Mission

### 목적

사용자의 목표를 구조화하는 화면이다.

Mission 화면은 "무엇을 할까?"를 "어떻게 운영할까?"로 바꾸는 지점이다.

### 레이아웃

```text
+------------------------------------------------------------------------------+
| Mission: Checkout rollback fix                                               |
+----------------------------------+-------------------------------------------+
| Goal                             | Plan Summary                              |
| Restore checkout stability       | 1. reproduce bug                          |
| without breaking auth flow       | 2. isolate auth regression                |
|                                  | 3. patch and verify                       |
+----------------------------------+-------------------------------------------+
| Success Criteria                 | Constraints                               |
| - checkout succeeds              | - no schema change                        |
| - auth unchanged                 | - deploy-safe patch                       |
| - tests green                    | - finish within $20 budget                |
+----------------------------------+-------------------------------------------+
| Team Structure                   | Risks                                     |
| Conductor                        | flaky test masking bug                    |
| Architect                        | hidden auth coupling                      |
| Builder                          | rollback may miss edge cases              |
| Verifier                         |                                           |
+------------------------------------------------------------------------------+
| Actions: [Edit Mission] [Regenerate Plan] [Add Agent] [Start Run]            |
+------------------------------------------------------------------------------+
```

### 핵심 액션

- mission 생성/수정
- 성공 조건 설정
- 제약과 budget 설정
- plan 생성 또는 재생성
- agent team 구성

### Mission 화면의 원칙

- 목표와 제약이 먼저다.
- 구현 세부보다 성공 조건이 먼저 보여야 한다.
- 팀 구조는 side effect가 아니라 planning의 일부다.

## 화면 4: Run

### 목적

실행 중인 작업을 관찰하고, 필요한 경우에만 짧게 steering하는 화면이다.

여기서 사용자는 raw chat을 읽는 사람이 아니라, 실행을 감독하는 사람이어야 한다.

### 레이아웃

```text
+------------------------------------------------------------------------------+
| Run: Builder-2 / Patch checkout auth regression                              |
+------------------------------+-----------------------------------------------+
| Run Timeline                 | Active Surface                                |
|                              |                                               |
| started                      | Terminal                                      |
| context loaded               | ------------------------------------------    |
| tests failed                 | npm test ...                                 |
| patch drafted                | failing: auth redirect spec                  |
| waiting for input            |                                               |
|                              | Tabs: Terminal | Diff | Tests | Artifacts    |
+------------------------------+-----------------------------------------------+
| Decisions                    | Inspector                                     |
|                              |                                               |
| use existing auth helper     | Status: Blocked                              |
| avoid token refresh path     | Needs input: fixture location                |
|                              | Tokens: 18.2k                                |
|                              | Cost: $1.47                                  |
+------------------------------------------------------------------------------+
| Actions: [Add Steering] [Attach Context] [Approve] [Reject] [Stop]           |
+------------------------------------------------------------------------------+
```

### 탭 구조

Run 화면의 주요 surface는 탭으로 분리한다.

- `Terminal`
- `Diff`
- `Tests`
- `Artifacts`
- `Decisions`

### 핵심 액션

- steering 전달
- context attachment
- artifact 열기
- diff 검토
- approval/rejection

### Run 화면의 원칙

- 로그는 전부가 아니라 선택적으로 보여준다.
- 중요한 전개는 timeline으로 재구성한다.
- 기본 액션은 적게 유지하고, 세밀한 운영 제어는 debug 모드로 숨긴다.

## 화면 5: Memory

### 목적

과거 작업, 재사용 가능한 팀 구조, 실패 패턴을 현재 mission에 연결하는 화면이다.

### 레이아웃

```text
+------------------------------------------------------------------------------+
| Memory                                                                       |
+----------------------------------+-------------------------------------------+
| Search                           | Results                                   |
| [checkout auth rollback     ]    |                                           |
|                                  | Past mission: login regression fix        |
| Filters                          | Decision: reuse auth helper               |
| - missions                       | Artifact: rollback verification report    |
| - decisions                      | Template: bug triage team                 |
| - artifacts                      |                                           |
+----------------------------------+-------------------------------------------+
| Pinned Knowledge                 | Preview                                   |
| auth flow map                    | selected decision or artifact preview     |
| checkout risk checklist          |                                           |
+------------------------------------------------------------------------------+
```

### 핵심 액션

- 과거 mission 검색
- decision/artifact 재사용
- template pin
- 현재 mission에 memory attach

### Memory의 원칙

- 검색은 파일명보다 mission/decision 중심이어야 한다.
- 단순 archive가 아니라 operational memory여야 한다.

## 화면 전환 흐름

권장 기본 흐름은 다음과 같다.

```text
Home
  -> New Mission
Mission
  -> Start Run
Command Center
  -> Observe
Run
  -> Attach Context
Memory
  -> Add Context
Run
  -> Approve / Steering Update
```

## 우선순위

MVP 구현 우선순위는 다음 순서가 적절하다.

1. `Home`
2. `Mission`
3. `Command Center`
4. `Run`
5. `Memory`

이 순서인 이유는 제품의 첫 10분 경험을 먼저 닫기 위해서다.

## 와이어프레임 규칙

구현 전에 지켜야 할 규칙:

1. 첫 화면의 주인공은 에이전트 조직이다.
2. 파일 트리는 기본 레이아웃에 넣지 않는다.
3. raw log는 보조 정보다.
4. 사람이 해야 할 액션은 항상 현재 상태 옆에 배치한다.
5. budget, blocked, review는 어디서나 요약돼야 한다.
6. stage나 daemon 개념은 사용자 전면에 올리지 않는다.

## 다음 문서

이 문서 다음으로 필요한 것은 아래 순서다.

1. [IPC 계약 문서](agent-ide-ipc.md)
2. 로컬 런타임 구조 문서
3. 저장 구조 문서
4. MVP 구현 계획 문서
