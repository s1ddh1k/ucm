# UCM Agent IDE MVP Plan

## 목적

이 문서는 UCM Agent IDE의 첫 구현 범위를 고정하는 MVP 계획 문서다.

핵심 목표는 세 가지다.

1. 제품 정의를 실제 구현 단계로 변환한다.
2. 무엇을 이번 사이클에서 만들고 무엇을 의도적으로 미루는지 명확히 한다.
3. 팀이 구현 도중 다시 실패한 기존 구조로 회귀하지 않게 한다.

## MVP 목표

MVP의 목표는 "완전한 에이전트 운영 플랫폼"이 아니다.

MVP의 실제 목표는 다음이다.

> 사용자가 하나의 workspace에서 mission을 만들고, 3-agent 팀을 자동으로 운영하게 두고, 실행을 관찰하고, 짧은 steering과 승인만 할 수 있는 데스크톱 Agent IDE를 만든다.

이 목표가 닫히면 제품의 핵심 가치는 검증된다.

## MVP에 반드시 포함할 것

### 1. Workspace 열기

사용자는 로컬 프로젝트 디렉토리를 열고 workspace로 등록할 수 있어야 한다.

필수 기능:

- directory picker
- workspace 등록
- recent workspace 목록
- active workspace 전환

### 2. Mission 생성

사용자는 새 mission을 생성할 수 있어야 한다.

필수 입력:

- title
- goal
- success criteria
- constraints
- priority

### 3. 기본 plan 생성

mission 생성 후 기본 plan이 생성되어야 한다.

초기 MVP에서는 AI 기반 자동 planning이 아니라 간단한 규칙 기반 생성도 허용한다.

필수 결과:

- phases
- risks
- assumptions

### 4. 기본 agent team 생성

MVP 팀 구성은 고정된 3-agent 구성이면 충분하다.

- `conductor`
- `builder`
- `verifier`

역할 분담:

- `conductor`
  mission 해석, 할당, 병목 조정
- `builder`
  구현 및 수정
- `verifier`
  테스트, 검토, 승인 대기 생성

### 5. Command Center

사용자는 command center에서 다음 정보를 볼 수 있어야 한다.

- active mission
- agents와 상태
- blocked/review alerts
- 현재 진행 중 run

### 6. Run View

사용자는 특정 run에 대해 다음을 볼 수 있어야 한다.

- timeline
- terminal output
- diff
- artifacts
- decisions

### 7. Deliverable Revision

MVP에서도 최종 전달물은 overwrite가 아니라 revision으로 쌓여야 한다.

최소 요구:

- 하나의 deliverable kind 지원
- revision append
- latest revision 표시
- export 또는 inbox handoff 중 하나 지원

### 8. Steering 액션

MVP에서 최소한 아래 입력만 가능하면 된다.

- steering note 전달
- context attachment
- artifact 또는 run 승인
- artifact 또는 run 거절
- emergency stop

## MVP에서 제외할 것

다음은 의도적으로 제외한다.

1. 멀티 workspace 동시 orchestration
2. 멀티 모니터 전용 레이아웃
3. 모바일 연동
4. 음성 인터페이스
5. 자동 업데이트
6. 고급 비용 분석 대시보드
7. org template marketplace
8. 복잡한 role editor
9. 다중 provider 최적화 전략
10. 완전 자동 memory synthesis

이걸 제외하는 이유는 제품의 본질을 검증하기 전에 주변 기능으로 무게중심이 흔들리는 걸 막기 위해서다.

## MVP 성공 기준

MVP가 성공했다고 말하려면 아래 조건을 만족해야 한다.

1. 사용자가 앱만으로 workspace를 열 수 있다.
2. 사용자가 앱만으로 mission을 시작할 수 있다.
3. 최소 3-agent 팀 상태가 실시간으로 보인다.
4. 실행 중 blocked 상태와 review 필요 상태를 즉시 알 수 있다.
5. 사용자가 run을 열고 terminal/diff/artifact를 확인할 수 있다.
6. 사용자가 deliverable revision history를 확인할 수 있다.
7. 사용자가 approve/reject/steering/context attachment 액션을 수행할 수 있다.
8. 앱이 crash 후에도 mission과 run 상태를 복구할 수 있다.

## 제품 검증 질문

MVP 리뷰 시 아래 질문에 답할 수 있어야 한다.

- 이 앱은 기존 웹 대시보드와 달리 정말 `Agent IDE`처럼 느껴지는가?
- 사용자가 파일보다 `agent team`을 먼저 보게 되는가?
- 지금 병목이 어디인지 5초 안에 보이는가?
- 사람이 응답해야 하는 시점이 드물고 명확한가?
- run이 단순 로그 화면이 아니라 감독 가능한 실행 화면처럼 보이는가?

## 구현 단계

MVP는 6단계로 나눠 구현한다.

## Phase 1: Desktop Shell

목표:

- Electron 앱 실행
- 단일 window
- navigation shell
- preload + IPC 기초

산출물:

- Electron main process
- preload bridge
- React renderer shell
- 기본 route 구조

완료 조건:

- 앱이 실행된다
- `Home`, `Command Center`, `Mission`, `Run`, `Memory`, `Settings` 빈 화면이 열린다

## Phase 2: Core Data Model

목표:

- workspace, mission, agent, run, artifact, decision의 기본 모델과 저장 구조 구현

산출물:

- runtime metadata store
- entity repository
- event bus 기초

완료 조건:

- 앱 재시작 후 workspace와 mission이 유지된다
- mock 데이터 없이 실제 로컬 저장소에서 읽힌다

## Phase 3: Mission Flow

목표:

- workspace 열기
- mission 생성
- 기본 plan 생성
- 기본 3-agent team 생성

산출물:

- Home 화면 동작
- Mission 생성 폼
- 기본 planning rule
- team bootstrap 로직

완료 조건:

- 사용자가 UI에서 새 mission을 만들면 command center에 team이 표시된다

## Phase 4: Run Orchestration

목표:

- conductor, builder, verifier run lifecycle 구현
- basic execution state update

산출물:

- Run Orchestrator 초안
- Agent Registry 초안
- run status event stream

완료 조건:

- 최소 한 agent run을 시작하고 상태가 실시간 반영된다
- blocked/review 상태를 만들 수 있다

## Phase 5: Run Inspection

목표:

- Run View에서 timeline, terminal, diff, artifact, decision 확인

산출물:

- terminal service 연결
- artifact viewer
- decision timeline
- diff surface

완료 조건:

- 사용자가 특정 run을 열어 무엇이 벌어졌는지 파악할 수 있다

## Phase 6: Steering Loop

목표:

- steering/context/approve/reject/stop 액션 구현
- basic recovery 구현

산출물:

- steering commands
- alert model
- crash recovery path

완료 조건:

- blocked 또는 steering-needed run에 짧은 의견을 보내 자동 재개를 유도할 수 있다
- review 필요 artifact를 approve/reject 할 수 있다
- 앱 재시작 후 active state를 잃지 않는다

## MVP 권장 구현 순서

실제 개발 순서는 아래가 가장 안전하다.

1. Electron shell
2. IPC bridge
3. runtime metadata store
4. workspace flow
5. mission flow
6. agent registry
7. command center
8. run orchestrator
9. run view
10. steering actions
11. persistence and recovery

## 기술 방향

MVP에서는 기술 선택도 보수적으로 간다.

### Renderer

- React
- TanStack Query
- Zustand or equivalent local state

### Main Process

- Electron main
- preload bridge
- strict context isolation

### Runtime

- Node-based runtime in-process or worker process
- sqlite metadata store
- file-backed artifacts
- PTY terminal sessions

### Why

이 선택의 이유는 단순하다.

- 디버깅 가능해야 한다
- 배포 단순성이 있어야 한다
- 로컬 상태 복구가 쉬워야 한다

## 위험 요소

MVP에서 특히 조심할 위험은 아래다.

### 1. 다시 운영툴로 퇴화할 위험

징후:

- command center보다 로그 화면이 더 중요해짐
- agent보다 task/stage가 앞에 나옴

대응:

- 모든 새 기능은 "agent IDE 경험에 기여하는가?"를 기준으로 심사

### 2. 너무 이른 자동화 확장

징후:

- 역할 수가 늘어나고 설정이 폭증

대응:

- 3-agent 고정 구조를 MVP 내내 유지

### 3. 실행 엔진 중심 사고

징후:

- UI가 런타임 내부 개념을 그대로 보여줌

대응:

- renderer는 오직 IPC 계약의 제품 용어만 사용

### 4. 복구 경로 부재

징후:

- 앱 재시작 시 진행 중 상태 손실

대응:

- Phase 2부터 persistence를 붙이고 Phase 6 전에 복구를 마무리

## 테스트 전략

MVP 단계의 테스트는 다음 4층으로 나눈다.

1. 도메인 모델 테스트
2. 런타임 서비스 테스트
3. IPC contract 테스트
4. 핵심 사용자 흐름 E2E 테스트

MVP에서 반드시 있는 E2E는 이 3개다.

1. workspace 열기 -> mission 생성 -> team 생성
2. run 시작 -> steering-needed -> note 전달 -> 자동 재개
3. artifact 생성 -> approve/reject

## 데모 시나리오

첫 내부 데모는 아래 시나리오 하나로 충분하다.

```text
1. myapp workspace open
2. mission create: "checkout auth regression fix"
3. conductor creates plan
4. builder run starts
5. verifier flags failing test
6. builder becomes blocked
7. user sends a short steering note with missing context
8. system resumes automatically
9. verifier produces report
10. user approves
```

이 시나리오가 자연스럽게 보이면 MVP 방향은 맞다.

## 문서 체크포인트

구현 시작 전에 아래 문서가 모두 있어야 한다.

- Agent IDE 제품 정의
- Agent IDE 와이어프레임
- Agent IDE IPC 계약
- Agent IDE 런타임 구조
- Agent IDE MVP 계획

## 다음 문서

이 다음은 저장 구조 문서나 실제 구현용 기술 설계 문서로 이어가면 된다.
