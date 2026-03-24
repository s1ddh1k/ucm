# UCM Workflow Spec

기준일: 2026-03-24

## 0. 목적

이 문서는 UCM vNext의 실제 실행 흐름을 정의한다.

- 어떤 phase가 있는가
- 각 phase의 entry/exit 조건은 무엇인가
- 어떤 event가 follow-up run을 만드는가
- 언제 review, steering, verification으로 분기하는가
- provider quota/auth/billing 문제를 어떻게 workflow에 반영하는가

이 문서는 [system-architecture.md](/home/eugene/git/ucm/system-architecture.md)의 실행 규약 버전이다.

## 1. 핵심 원칙

- 비사소한 작업은 `deliberation -> decision -> execution` 순서를 따른다.
- 코드는 결과물이 아니라 중간 산출물이다.
- `evidence`가 없으면 승급하지 않는다.
- provider session은 disposable이고 workflow state만 durable하다.
- quota/auth/billing 충돌은 retry 루프가 아니라 orchestration event다.

## 2. 기본 엔티티

- `Mission`: 사용자의 상위 목표
- `Phase`: mission 내부의 실행 구간
- `Run`: 한 명의 agent가 수행하는 bounded execution unit
- `RunEvent`: run에서 발생한 material event
- `DeliverableRevision`: 사람이 검토하거나 승인하는 패킷
- `EvidencePack`: 승급 판단에 필요한 증거 묶음
- `ProviderSeat`: Codex / Claude / Gemini subscription surface

## 3. 표준 워크플로

```text
Mission Intake
  → Deliberation
  → Decision Freeze
  → Execution
  → Verification
  → Review / Steering
  → Promotion / Completion
  → Runtime Ops / Re-entry
```

## 3.1 Phase-to-lane 매핑

워크플로 phase는 책임 lane과 느슨하게 대응한다.

- `Mission Intake` = `Compass`
- `Deliberation` = `Compass + Atlas + Architect lane`
- `Decision Freeze` = `Conductor + Architect lane`
- `Execution` = `Forge`
- `Verification` = `Judge`
- `Review / Steering` = `Judge + Human review`
- `Promotion / Completion` = `Harbor`
- `Runtime Ops / Re-entry` = `Pulse + Mirror`

이 매핑은 런타임 내부 상태명을 바꾸기 위한 것이 아니라, 역할 배치와 산출물 책임을 분명히 하기 위한 것이다.

## 3.2 표준 산출물 계약

각 phase는 대화가 아니라 표준 산출물을 남겨야 한다.

- `Mission Intake`
  - `spec/brief.md`
  - `spec/acceptance.yaml`
  - `spec/success-metrics.yaml`
- `Deliberation`
  - `research/dossier.md`
  - `research/evidence.jsonl`
  - `research/risks.md`
  - `design/alternatives.md`
- `Decision Freeze`
  - `design/architecture.md`
  - `design/adr/<decision>.md`
  - `plan/backlog.json`
- `Execution`
  - `runs/<runId>/trace.json`
  - `runs/<runId>/artifacts/*.json`
  - `runs/<runId>/patches/*.diff`
- `Verification`
  - `evals/regression/*`
  - `evals/security/*`
  - `runs/<runId>/evidence/<evidencePackId>.json`
  - `runs/<runId>/review/review-packet.md`
- `Promotion / Completion`
  - `release/manifest.yaml`
  - `release/notes.md`
  - `release/rollback-plan.md`
- `Runtime Ops / Re-entry`
  - `ops/incidents/<incidentId>.md`
  - `ops/postmortem.md`
  - `improvements/proposal.md`

규칙:

- 다음 phase는 이전 phase의 표준 산출물을 입력으로 읽는다
- builder는 대화 로그를 1차 입력으로 쓰지 않는다
- phase 종료는 상태 전이뿐 아니라 최소 산출물 존재를 요구한다

## 4. Phase 정의

## 4.1 Mission Intake

### Entry

- 사용자가 새 목표를 생성함
- 운영 이벤트가 새 mission을 열어야 함
- 기존 mission에서 별도 track이 필요해 새 mission을 분기함

### Required inputs

- `title`
- `goal`
- 선택적 `command`
- 최소 `successCriteria`
- 최소 `constraints`

### Outputs

- `MissionSnapshot`
- `MissionDetail`
- 초기 `Run`
- 초기 `DeliverableRevision`

### Exit

- trivial/local command mission이면 바로 `Execution`
- 그 외는 `Deliberation`

## 4.2 Deliberation

### Purpose

터널링을 막고 실행 전에 대안과 검증 기준을 고정한다.

### Required roles

- `proposer_a`
- `proposer_b`
- `skeptic`
- `verifier`
- 필요시 `broadener`

### Required outputs

- `AlternativeSet`
- `DecisionRecord`
- `AcceptanceChecks`
- `OpenQuestions`

### Entry rules

- trivial이 아닌 mission/run
- 이전 run이 `blocked` 이후 재계획이 필요함
- `evidence delta == 0` 상태가 반복됨

### Exit rules

- acceptance checks가 존재해야 한다
- 대안 2개 이상이 비교되어야 한다
- `DecisionRecord.category=planning|technical|risk` 중 최소 하나가 생성되어야 한다

### Failure path

- open question이 풀리지 않으면 `blocked`
- provider seat가 review lane에 없으면 `queued`

## 4.3 Decision Freeze

### Purpose

실행 전에 무엇을 왜 할지 고정한다.

### Required outputs

- 현재 선택안
- rejected alternatives 요약
- 예상 evidence 목록
- 예상 deliverable kind

### Exit rules

- `run.expectedEvidence`가 비어 있지 않다
- `mission.activePhase`와 선택안이 연결된다
- policy가 실행을 허용한다

## 4.4 Execution

### Purpose

bounded run 단위로 실제 작업을 수행한다.

### Inputs

- `objective`
- `providerPreference`
- `budgetClass`
- `workspacePath`
- `steeringContext`
- `expectedEvidence`

### Outputs

- `ArtifactRecord`
- `RunEvent`
- `terminalPreview`
- optional `DeliverableRevision`

### Entry rules

- provider seat가 `healthy`
- seat status가 `ready` 또는 queueable
- acceptance checks 정의 완료

### Exit event kinds

- `artifact_created`
- `blocked`
- `needs_review`
- `completed`

### Failure paths

- provider window unavailable → `queued`
- auth invalid → `blocked(provider_reauth_required)`
- subscription/API 충돌 → `blocked(billing_mode_conflict)`
- evidence 없이 patch만 생성 → verification 승급 금지

## 4.5 Verification

### Purpose

실행 결과를 review-ready 상태로 승급 가능한지 확인한다.

### 기본 규칙

- diff artifact가 생기면 verification lane을 우선 고려한다
- verifier run은 implementation run과 분리한다
- verification은 evidence를 생산해야 한다

### Required outputs

- `test_result`
- `EvidencePack`
- optional `review_packet`

### Exit rules

- 모든 required check가 `pass` 또는 허용 가능한 `warn`
- evidence가 최신 artifact를 참조
- review packet 생성 가능

### Failure paths

- verification failed → `blocked(verification_failed)` 또는 replan
- verification provider quota 부족 → `queued` 또는 alternate provider

## 4.6 Review / Steering

### Purpose

사람이 고위험 판단을 하거나, 막힌 작업에 짧은 steer를 준다.

### Review entry

- `needs_review`
- `review_requested`
- approval-worthy deliverable revision 생성

### Steering entry

- `blocked`
- `steering_requested`

### Review outputs

- approved deliverable revision
- superseded revision
- reject + feedback

### Steering outputs

- `steering_submitted`
- revised objective
- resumed run context

### Exit rules

- review 승인 → `Mission completed` 또는 다음 배포/운영 phase
- steering 제출 → blocked implementation run 재개 또는 follow-up run 생성

## 4.7 Promotion / Completion

### Purpose

검증된 결과를 deliverable과 handoff로 바꾸고 mission을 닫는다.

### Required conditions

- approved revision 존재
- required evidence 충족
- policy가 승급 허용

### Outputs

- `HandoffRecord`
- `Mission.status=completed`
- completion event

## 4.8 Runtime Ops / Re-entry

### Purpose

mission이 끝난 뒤 또는 운영 중 발생한 이벤트를 다시 workflow로 넣는다.

### Inputs

- quota exhaustion
- reauth required
- user feedback
- new bug signal
- performance regression
- release blocker

### Behavior

- 새 mission 생성
- 기존 mission에 follow-up phase 추가
- blocked run 재개
- provider seat health 업데이트

## 4.9 운영 모드 오버레이

같은 상태기계라도 운영 모드에 따라 강조점이 달라진다.

### Interactive Mode

- 기본 진입 phase는 `Mission Intake`, `Deliberation`, `Review / Steering`
- 목적은 spec lock, open question 해소, human steer 반영
- long-running build보다 decision quality를 우선한다

### Batch Build Mode

- 기본 진입 phase는 `Execution`, `Verification`, `Promotion / Completion`
- 목적은 bounded task execution과 review-ready deliverable 생산
- provider seat, budget, evidence gate가 자동 governor로 작동한다

### Daemon Mode

- 기본 진입 phase는 `Runtime Ops / Re-entry`
- 목적은 incident triage, backlog refresh, mirror proposal 생성
- daemon이 만든 proposal도 동일한 deliberation/review를 통과해야 한다

## 5. 표준 이벤트 흐름

## 5.1 Artifact refresh flow

```text
artifact_created
  → conductor refreshes deliverable revision
  → if latest artifact is diff, scheduler considers verification follow-up
  → verifier may create test_result / review_packet
```

## 5.2 Blocker flow

```text
blocked
  → conductor packages steering packet
  → scheduler may open research follow-up run
  → human submits steering
  → implementation run resumes or re-plans
```

## 5.3 Review flow

```text
needs_review / review_requested
  → conductor refreshes deliverable revision
  → scheduler may open dedicated review run
  → human approves or rejects revision
```

## 6. Follow-up branching rules

현재 기본 branching 규칙은 아래와 같다.

- latest artifact가 `diff`이면 `verification_from_diff_artifact`
- `blocked` + `requestedInput in {fixture_path, external_context}`이면 `research_from_blocker_context`
- `needs_review` 또는 `review_requested`이면 `review_from_review_ready_event`

추가 vNext 규칙:

- `provider_reauth_required`면 `manual_auth_recovery` follow-up run을 생성하지 않고 운영 blocker로 올린다
- `provider_quota_exhausted`면 같은 provider 재시도보다 alternate seat 탐색을 우선한다
- `billing_mode_conflict`면 실행 금지 후 policy review로 보낸다
- `evidence_insufficient`면 verification이 아니라 deliberation으로 되돌린다

## 7. Governor 규칙

workflow는 무한히 뻗지 않는다.

### Budget Governor

- `light`, `standard`, `heavy` bucket을 소비한다
- bucket이 소진되면 scheduler는 follow-up run을 막는다

### Open-run Governor

- rule별 `maxOpenRuns`를 넘기지 않는다
- exclusive rule이 열려 있으면 상충 run을 만들지 않는다

### Loop Governor

아래 중 하나면 동일 패턴 재실행을 금지하고 replan을 강제한다.

- 2회 연속 동일 failure signal
- 2회 연속 evidence delta 0
- 20분 초과 without material event
- 8회 이상 tool/action without risk reduction

## 8. Provider-aware execution policy

정액제 seat를 제대로 쓰기 위한 workflow 정책이다.

### Seat reservation

- run 시작 전 provider seat reservation이 필요하다
- reservation 실패 시 `queued`

### Window checkpointing

- 5시간 또는 일일 cap이 있는 seat는 장시간 run을 작은 checkpoint로 나눈다
- checkpoint마다 요약, patch, open question, next step을 저장한다

### Billing safety

- 기본값은 `subscription_only`
- API key가 존재하거나 meter 경로가 열리면 policy가 명시적으로 승인해야 한다

### Surface isolation

- `cli`, `web`, `cloud`, `code_assist`, `app`는 별도 surface로 관리한다
- quota가 shared scope를 가지는 경우만 합산한다

## 9. Mandatory checkpoints

모든 비사소한 mission/run은 아래 체크포인트를 가진다.

- `goal checkpoint`: active phase와 success criteria에 여전히 맞는가
- `evidence checkpoint`: 새 증거가 생겼는가
- `provider checkpoint`: quota/auth 상태가 건전한가
- `risk checkpoint`: open risk가 줄었는가 늘었는가

## 10. Minimal happy path

```text
Mission created
  → Deliberation produces 2 alternatives + acceptance checks
  → Decision freeze selects one path
  → Implementation run produces diff
  → Verification run produces test_result + evidence pack
  → Conductor refreshes review packet
  → Human approves deliverable revision
  → Mission completed
```

## 11. Minimal unhappy path

```text
Mission created
  → Execution starts
  → Provider auth expires
  → Run blocked(provider_reauth_required)
  → Operator restores auth
  → Scheduler resumes run from checkpoint
  → Verification fails
  → Replan opens new deliberation run
```

## 12. Non-goals

이 문서는 아직 아래를 정의하지 않는다.

- production deployment rollout 세부 규칙
- storage schema 세부 필드
- self-improvement benchmark protocol
- provider별 비공개 quota 수치의 자동 예측 모델
