# UCM Agent IDE Execution Policy

## 목적

이 문서는 UCM Agent IDE가 "언제 agent가 시작되고, 언제 멈추고, 언제 사람에게 넘기는가"를 어떤 규칙으로 결정하는지 고정한다.

핵심 원칙은 단순하다.

- 사람은 agent를 직접 시작하거나 종료하지 않는다.
- runtime은 mission state, run event, lifecycle policy를 보고 자동으로 agent lifecycle을 결정한다.
- conductor는 긴 문맥을 계속 붙잡는 관리자가 아니라, 이벤트 하나를 보고 한 번의 좁은 결정을 내리는 함수다.

## Mission State Machine

Mission 상태는 제품 전면에서 이 네 가지로 충분하다.

```text
queued -> running -> review -> completed
```

보조 규칙:

- `queued`
  - mission이 생성됐지만 아직 실행 가능한 첫 패스가 준비되지 않음
- `running`
  - 하나 이상의 agent가 active work를 수행 중이거나, blocked/steering 상태를 포함한 실행 루프 안에 있음
- `review`
  - 사람에게 넘길 deliverable revision이 준비됐고, 현재 루프의 핵심 질문이 review 또는 approval임
- `completed`
  - mission 종료 조건을 충족했고 추가 orchestration이 필요하지 않음

초기 MVP에서는 `failed`, `aborted`, `blocked`를 mission 전면 상태로 올리지 않는다. 이런 값은 run event와 lifecycle event로 설명한다.

## Mission Transition Rules

| Trigger | From | To | Reason |
|--------|------|----|--------|
| mission created | any | queued | 새 mission은 먼저 scope를 좁혀야 한다 |
| first executable artifact appears | queued | running | 실제 agent work가 시작될 수 있다 |
| blocker arrives | running | running | mission은 계속 진행 중이되, steering이 필요할 뿐이다 |
| review_requested / needs_review / completed event | running | review | 사람 inbox에 결과물을 올리는 단계다 |
| approved final handoff | review | completed | 핵심 종료 조건이 충족됐다 |

## Agent Lifecycle Policy

Agent는 사용자가 수동으로 고르지 않는다. role별 시작/정지 조건이 있다.

### Conductor

- `spawn`
  - mission 생성 직후
  - 중요한 run event가 들어왔을 때
- `park`
  - 추가로 처리할 material event가 없을 때

### Builder

- `spawn`
  - active phase에 executable objective가 있을 때
- `park`
  - review 요청 또는 blocker escalation 이후
- `resume`
  - steering/context가 주입되어 blocker가 풀렸을 때

### Verifier

- `spawn`
  - diff/report artifact가 생겼을 때
- `park`
  - review packet handoff 이후

### Researcher

- `spawn`
  - blocker 원인이 external context 부족일 때
- `park`
  - 필요한 context artifact를 전달했을 때

## Event Taxonomy

자동화가 반응하는 사실은 이 이벤트들이다.

- `artifact_created`
- `blocked`
- `needs_review`
- `review_requested`
- `steering_requested`
- `agent_status_changed`
- `completed`

`timeline`은 UI 기록이고, orchestration 입력은 반드시 event stream이어야 한다.

## Conductor Decision Table

| Event | Decision | Effect |
|------|----------|--------|
| `artifact_created` | `prepare_revision` | deliverable revision append |
| `blocked` | `prepare_revision_and_request_steering` | deliverable revision + steering handoff + builder parked |
| `needs_review` | `prepare_revision_and_request_review` | deliverable revision + review handoff + verifier/relevant agent reviewing |
| `review_requested` | `observe` | 이미 사람 inbox로 넘어갔으므로 대기 |
| `steering_requested` | `observe` | 사람 입력 대기 |
| `agent_status_changed` | `observe` | lifecycle 변화는 다음 material event를 기다림 |
| `completed` | `prepare_revision_and_request_review` or `complete mission` | 종료 성격에 따라 review 또는 completion |

## Human Interface Contract

사람은 기본적으로 관찰자다. 기본 개입 채널은 이 세 가지뿐이다.

- `brief steering`
  - blocked 또는 steering_requested 때만 짧게 방향 제시
- `approval`
  - review packet을 읽고 승인 또는 반려
- `emergency stop`
  - 비용, 범위, 안전 이슈가 명확할 때만 중단

사람이 하지 않는 일:

- agent 직접 시작/종료
- revision 수동 생성
- handoff 수동 조립
- agent 간 수동 재할당

## Implementation Rule

정책은 반드시 코드에서 함수로 분리한다.

- `deriveMissionStatus(...)`
- `decideFromContext(...)`
- `applyLifecyclePolicy(...)`

즉 "LLM이 알아서"가 아니라, runtime이 좁은 입력과 좁은 출력을 갖는 정책 함수들을 조합해 굴러가야 한다.
