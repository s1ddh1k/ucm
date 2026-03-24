# UCM Runtime State Machine

기준일: 2026-03-24

## 0. 목적

이 문서는 UCM vNext 런타임의 상태 전이를 정의한다.

- `Mission`
- `Run`
- `Agent`
- `DeliverableRevision`
- `ProviderSeat`

현재 구현의 이벤트 타입과 최대한 맞춘다.

- `artifact_created`
- `blocked`
- `agent_status_changed`
- `needs_review`
- `review_requested`
- `steering_requested`
- `steering_submitted`
- `completed`

## 1. 공통 원칙

- 상태는 durable store에 기록된다.
- provider session 종료는 상태 종료를 의미하지 않는다.
- 상태 전이는 event-driven이어야 한다.
- event 없이 상태를 조용히 바꾸지 않는다.
- 각 상태 전이는 `why`를 남겨야 한다.

## 2. Mission State Machine

## 2.1 상태

- `queued`
- `running`
- `review`
- `blocked`
- `completed`

## 2.2 전이

### `queued -> running`

조건:

- 첫 실행 run이 시작됨
- 또는 blocked/review 상태에서 실행 가능한 run이 다시 열림

트리거:

- `artifact_created`
- `steering_submitted`
- `agent_status_changed(status=running)`

### `running -> blocked`

조건:

- active run 또는 critical follow-up run이 `blocked`
- provider auth/quota/billing/policy 문제로 전진 불가

트리거:

- `blocked`

### `running -> review`

조건:

- review 가능한 deliverable revision이 생성됨
- human review가 필요한 packet이 활성화됨

트리거:

- `needs_review`
- `review_requested`
- `completed` with approval-ready evidence

### `review -> running`

조건:

- steering이 제출되어 작업이 재개됨
- review reject로 인해 새 execution/verification run이 시작됨

트리거:

- `steering_submitted`
- `agent_status_changed(status=running)`

### `review -> completed`

조건:

- approved deliverable revision이 handoff됨
- mission success criteria가 충족됨

트리거:

- revision approval
- completion handoff

### `blocked -> running`

조건:

- blocker가 해소됨
- provider seat가 회복됨
- 필요한 steering/context가 제출됨

트리거:

- `steering_submitted`
- `agent_status_changed(status=running)`
- provider health recovery event

## 2.3 Mission 불변조건

- active mission은 최대 1개의 `activeWorkspaceId`를 가진다
- `completed` mission은 적어도 1개의 승인 revision 또는 동등한 completion artifact가 있어야 한다
- `blocked` mission은 최소 1개의 unresolved blocked run 또는 provider blocker를 가진다

## 3. Run State Machine

## 3.1 상태

- `queued`
- `running`
- `blocked`
- `needs_review`
- `completed`

## 3.2 Blocked reason taxonomy

```ts
type BlockedReason =
  | "missing_context"
  | "provider_quota_exhausted"
  | "provider_reauth_required"
  | "billing_mode_conflict"
  | "evidence_insufficient"
  | "policy_denied"
  | "verification_failed";
```

## 3.3 전이

### `queued -> running`

조건:

- provider seat reservation 성공
- budget governor 허용
- policy 승인

트리거:

- scheduler dispatch
- provider window reopen

### `running -> queued`

조건:

- provider window 부족으로 즉시 실행 불가
- run 자체는 유효하지만 현재 seat가 수용하지 못함

트리거:

- executionService.spawnAgentRun() returns false
- `agent_status_changed(source=provider_queue)`

### `running -> blocked`

조건:

- missing input
- provider auth 문제
- quota exhaustion with no alternate seat
- billing mode conflict
- verification failure

트리거:

- `blocked`
- policy denial

### `running -> needs_review`

조건:

- run이 review 가능한 packet을 만들었음
- evidence gate를 통과함

트리거:

- `needs_review`
- conductor decision `prepare_revision_and_request_review`

### `running -> completed`

조건:

- run scope의 objective를 충족하고 parking 가능
- verifier run은 evidence를 남긴 뒤 종료
- implementation run은 후속 verification run으로 handoff 가능

트리거:

- `completed`
- implementation artifact + conductor handoff 완료

### `blocked -> running`

조건:

- steering 제공
- missing context 해소
- alternate provider로 재배정
- auth 복구

트리거:

- `steering_submitted`
- scheduler resume

### `needs_review -> running`

조건:

- review reject 또는 추가 증거 요구
- review 후 새 execution run이 열림

트리거:

- manual retry
- follow-up run creation

### `needs_review -> completed`

조건:

- revision approval 완료
- run이 더 이상 open work를 가지지 않음

트리거:

- approval mutation

## 3.4 Run 불변조건

- `running` run은 하나의 `agentId`에 귀속된다
- `blocked` run은 blocked reason metadata가 필요하다
- `needs_review` run은 적어도 1개의 active deliverable revision을 가져야 한다
- `completed` run은 terminal session이 남아 있어도 재개 대상이 아니다

## 4. Agent State Machine

## 4.1 상태

- `idle`
- `running`
- `queued`
- `blocked`
- `needs_review`

## 4.2 전이

### `idle -> running`

조건:

- active phase objective가 agent 역할과 맞음
- scheduler가 해당 role run을 시작함

### `running -> queued`

조건:

- provider window가 꽉 참

### `running -> blocked`

조건:

- run blocked

### `running -> needs_review`

조건:

- run이 review lane으로 진입

### `running -> idle`

조건:

- run completed and parked

### `blocked -> running`

조건:

- steering 또는 context 복구

### `needs_review -> idle`

조건:

- review 종료 후 더 이상 active review task가 없음

## 4.3 Agent 불변조건

- 하나의 agent는 동시에 하나의 active running run만 가진다
- `queued` agent는 provider seat를 아직 잡지 못했다
- `needs_review` agent는 review packet 또는 review run과 연결된다

## 5. DeliverableRevision State Machine

## 5.1 상태

- `active`
- `approved`
- `superseded`

## 5.2 전이

### `active -> approved`

조건:

- human reviewer 또는 policy-controlled reviewer 승인

### `active -> superseded`

조건:

- 더 최신 revision 생성
- review reject 후 새 revision 생성

### `approved -> approved`

조건:

- immutable terminal state

### `approved -> superseded`

조건:

- 허용하지 않음

## 5.3 Deliverable 불변조건

- 한 deliverable은 최대 1개의 latest revision을 가진다
- latest revision은 `approved` 또는 `active` 중 하나다
- superseded revision은 approval 대상이 아니다

## 6. ProviderSeat State Machine

## 6.1 상태

- `ready`
- `busy`
- `cooldown`
- `unavailable`

추가 auth 상태:

- `healthy`
- `reauth_required`
- `misconfigured`

## 6.2 전이

### `ready -> busy`

조건:

- run이 seat를 할당받음

### `busy -> ready`

조건:

- run checkpoint 저장 후 종료
- seat가 즉시 재사용 가능

### `busy -> cooldown`

조건:

- session/window cap에 근접함
- provider가 잠시 추가 실행을 막음

### `cooldown -> ready`

조건:

- window reset
- observed reset time 도래

### `ready|busy|cooldown -> unavailable`

조건:

- login expired
- CLI misconfigured
- billing route conflict
- provider outage

### `unavailable -> ready`

조건:

- reauth 성공
- config 복구
- operator intervention 완료

## 6.3 ProviderSeat 불변조건

- `authState=reauth_required`면 seat status는 `ready`가 될 수 없다
- `billingMode=subscription_only`인데 API billing route가 열려 있으면 `misconfigured`
- shared scope는 vendor별 allowance 충돌 판단에 사용한다

## 7. Event-to-transition mapping

## 7.1 `artifact_created`

영향:

- run stays `running` 또는 implementation artifact 기준 follow-up verification 고려
- mission은 대체로 `running`
- deliverable revision refresh 가능

추가 동작:

- conductor may `prepare_revision`
- scheduler may create verification run

## 7.2 `blocked`

영향:

- run -> `blocked`
- source agent -> `blocked`
- mission may -> `blocked`

추가 동작:

- conductor packages steering request
- scheduler may create research follow-up run

## 7.3 `needs_review`

영향:

- run -> `needs_review`
- agent -> `needs_review`
- mission -> `review`

추가 동작:

- conductor refreshes review packet
- scheduler may create dedicated review run

## 7.4 `review_requested`

영향:

- mission stays or becomes `review`
- run usually stays `needs_review`

추가 동작:

- no immediate execution restart
- waits for approval or rejection

## 7.5 `steering_requested`

영향:

- run remains `blocked`
- waits for human input

## 7.6 `steering_submitted`

영향:

- blocked steering events become `resolved`
- run may go `blocked -> running`
- mission may go `blocked -> running`

## 7.7 `completed`

영향:

- run -> `completed` or parked
- agent -> `idle`
- mission may stay `running`, move to `review`, or `completed`

## 8. Provider-specific state considerations

## 8.1 Codex

- surface별 allowance 공유 여부가 항상 명확하지 않을 수 있다
- 따라서 `window.confidence`를 반드시 기록한다
- fixed limit 하드코딩보다 observed reset time과 recent denial event를 우선 사용한다

## 8.2 Claude

- 5시간 session window와 7일 usage cap을 상태 객체로 추적한다
- `/status`에서 읽은 값이 있으면 official/observed로 반영한다
- `ANTHROPIC_API_KEY` 충돌은 `misconfigured`

## 8.3 Gemini

- CLI와 Code Assist agent mode는 shared scope
- web/app surface는 별도 scope
- auth exit code `41`, turn limit exit code `53`은 blocked reason 분류에 사용한다

## 9. Mandatory audit fields

모든 의미 있는 상태 전이는 다음 메타데이터를 남겨야 한다.

- `sourceEventId`
- `sourceEventKind`
- `previousState`
- `nextState`
- `reason`
- `provider`
- `seatId`
- `timestamp`

## 10. 구현 메모

현재 구현과 직접 연결되는 우선 수정 지점은 아래다.

- `RunDetail.status` 확장 없이도 `blocked reason`은 metadata로 먼저 도입 가능
- `ProviderWindowSummary`는 `codex/claude`에서 `codex/claude/gemini`로 일반화 필요
- `terminalProvider` 타입은 `gemini`를 포함하도록 확장 필요
- `agent_status_changed` event metadata에 `seatId`, `blockedReason`, `windowKind`를 넣는 것이 좋다
