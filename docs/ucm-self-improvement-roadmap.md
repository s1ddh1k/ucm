# UCM Self-Improvement Roadmap

기준일: 2026-03-30

## 0. 문서 목적

이 문서는 "UCM이 UCM을 만들고 개선할 수 있어야 한다"는 최종 목표를 기준으로, 현재 UCM에서 그 상태까지 가기 위한 단계별 로드맵을 정의한다.

여기서 중요한 점은 목표를 한 층으로 두지 않는 것이다. 이 문서는 아래 세 층을 분리해서 다룬다.

- 제품 목표: 지금 UCM이 실제로 더 유용해지는가
- 시스템 목표: 그 개선을 지원하는 운영 루프를 어떻게 만드는가
- 연구 목표: 장기적으로 자기호스팅과 누적 자기개선까지 갈 수 있는가

장기 연구 목표는 단순히 `learning_agent`가 회고 문서를 쓰는 상태가 아니다. 다음이 모두 성립해야 한다.

- UCM이 자기 자신의 코드베이스와 운영 정책을 `mission/run/artifact/release` 모델 안에서 대상으로 삼을 수 있다.
- 자기개선 제안이 단순 문서가 아니라 평가 가능한 변경 후보(diff, config change, policy change)로 표현된다.
- 변경 후보는 replay, benchmark, shadow run, review gate를 거쳐 실제 런타임에 승격될 수 있다.
- 한 번의 개선이 다음 개선의 속도와 품질을 높이는 방향으로 누적된다.
- 이 모든 과정이 provenance, policy, rollback, human override 안에서 통제된다.

즉 목표는 "자가개선 기능 하나"가 아니라, UCM이 자기 자신을 대상으로 하는 durable execution OS가 되는 것이다.

## 1. 목표 계층

## 1.1 1차 제품 목표

가장 먼저 달성해야 할 목표는 아래다.

- UCM 자신의 repo에서 `implementation` run을 대상으로 한다
- review 품질을 유지하거나 개선한다
- human steering 빈도를 줄인다
- prompt token과 실행 지연을 줄인다
- 이 개선이 재현 가능하게 측정된다

즉 1차 목표는 "자가개선 OS 완성"이 아니라, "UCM이 자기 작업을 더 싸고 덜 막히게 수행한다"다.

## 1.2 1차 시스템 목표

1차 제품 목표를 위해 필요한 시스템 목표는 아래다.

- `learning_agent`가 실제 runtime run으로 돈다
- `learning_agent`의 출력은 현재 계약을 따르는 `improvement_proposal`, `heuristic_update_proposal`로 제한한다
- 별도 proposal compiler가 일부 `improvement_proposal`을 constrained experiment input으로 변환한다
- 작은 replay 비교로 baseline과 proposal-derived experiment를 비교한다
- execution stats와 locality metric이 남는다

즉 Track A의 본질은 "candidate platform 구축"이 아니라 "proposal -> constrained experiment"를 작게 닫는 것이다.

## 1.3 장기 연구 목표

장기적으로는 아래 상태까지 간다.

장기 목표 상태의 UCM은 다음처럼 동작한다.

1. `Pulse`가 운영 이벤트, 실패 패턴, 비용 이상, review 병목, 반복 blocker를 수집한다.
2. `Mirror`가 이를 바탕으로 제품 개선안과 공장 개선안을 분리해 `improvement_proposal`을 만든다.
3. proposal compiler가 일부 제안을 `실행 후보(candidate)`로 변환한다.
4. 후보는 자기 자신을 대상으로 한 별도 mission으로 실행된다.
5. 실행은 git worktree, benchmark harness, replay evaluator, policy gate 안에서 이뤄진다.
6. 검증 통과 후보만 shadow run, staged promotion, canary promotion을 거친다.
7. 승격 후 효과는 다시 provenance와 metric으로 측정된다.
8. 이 결과가 다음 `Mirror` 입력으로 들어가면서 개선 능력 자체가 누적된다.

## 1.4 장기 목표를 구성하는 5개 능력

장기 목표는 아래 5개 능력이 모두 있어야 달성된 것으로 본다.

### A. 자기대상화

UCM이 사용자 프로젝트만 아니라 자기 repo, 자기 role contract, 자기 scheduler/policy/config도 정식 작업 대상으로 다룰 수 있어야 한다.

### B. 자기수정

개선안이 문서가 아니라 실제 patch, schema migration, routing change, policy diff로 표현되어야 한다.

### C. 자기평가

수정 전후를 비교할 공식 평가 체계가 있어야 한다.

- replay
- benchmark
- regression suite
- provider cost/latency/throughput metric
- approval quality metric

### D. 자기승격

검증된 후보가 human review 아래 실제 런타임으로 승격될 수 있어야 한다.

### E. 자기누적

좋은 개선이 다음 개선의 품질을 높여야 한다. 즉, heuristic, memory, evaluation harness, routing policy, proposal generator가 모두 축적 대상이어야 한다.

## 1.5 가로지르는 설계 원칙

이 로드맵은 아래 원칙을 모든 phase에 공통으로 적용한다.

### Cache-local execution

- durable state를 만든다고 해서 매 run마다 full context를 다시 주입하면 안 된다
- hot context는 가능한 한 같은 provider session에서 유지하고, cold context는 artifact store로 내린다
- prompt 기본 형태는 `stable prefix + artifact reference + delta instruction`이어야 한다
- transcript 전체 전달은 fallback이고, 기본 handoff는 evidence summary와 artifact ID여야 한다

### Session affinity before agent fan-out

- 역할 분리보다 먼저 cache locality를 본다는 뜻은 아니다
- 다만 같은 repo, 같은 phase, 같은 objective를 여러 agent가 반복해서 풀프롬프트로 먹는 구조는 금지해야 한다
- 독립 검증이 필요할 때만 session affinity를 의도적으로 끊는다

### Artifact-addressed context

- 다음 run은 대화 로그가 아니라 artifact와 decision record를 읽어야 한다
- replay, evaluation, promotion도 transcript가 아니라 artifact address를 기준으로 재현 가능해야 한다

### Cache efficiency is a product metric

- self-improvement 시스템은 task quality뿐 아니라 token, latency, cache hit locality도 최적화 대상이다
- 토큰 비용 때문에 자기개선 루프가 운영 불가능해지면 최종 목표는 실패한 것이다

## 1.6 과설계 방지 원칙

이 로드맵은 최종 목표를 크게 잡되, 구현은 의도적으로 작게 시작해야 한다.

### 기능보다 압력

- 실제 운영에서 반복적으로 아픈 지점이 확인되기 전에는 새 계층을 만들지 않는다
- "언젠가 필요할 것 같은 추상화"는 금지한다

### 한 번에 하나의 경로

- 처음부터 모든 role, 모든 provider, 모든 phase를 바꾸지 않는다
- 한 번에 하나의 run family, 하나의 provider, 하나의 benchmark 경로만 연다

### optional-first

- 새 필드는 기존 타입을 깨지 않도록 optional로 추가한다
- 새 projection/table은 기존 snapshot/index를 대체하지 않고 병행 추가한다

### in-memory before durable

- 구조가 맞는지 보기 전에는 in-memory lease, in-memory affinity, log-only metric으로 먼저 검증한다
- 효과가 입증된 뒤에만 durable store와 UI를 붙인다

### second use before abstraction

- 동일한 패턴이 두 번 이상 확인되기 전에는 공용 프레임워크나 일반화된 컴포넌트로 올리지 않는다

### delete-friendly rollout

- 새 self-improvement 기능은 feature flag 아래 둔다
- 효과가 없으면 쉽게 제거할 수 있어야 한다

## 2. 현재 기준선

현재 UCM은 최종 목표의 "씨앗"은 이미 갖고 있다.

- `learning_agent`, `mirror` lane, `improvement_proposal` 타입이 계약에 이미 존재한다.
- `mission/run/release/handoff` 커널과 SQLite index projection이 있다.
- run 단위 git worktree 실행이 가능하다.
- `Runtime Ops / Re-entry = Pulse + Mirror`라는 상위 워크플로 정의가 있다.
- 설계 문서에는 self-improvement가 명시적으로 들어 있다.

하지만 실제 구현은 아직 `제안 단계`에 머물러 있다.

- `learning_agent`는 proposal 생성까지만 허용된다.
- role contract enforcement가 실질적으로 비활성 상태다.
- 자기개선 benchmark protocol은 아직 non-goal로 남아 있다.
- run archive는 있지만 "좋은 개선 후보를 선택하고 재평가하는 meta loop"는 없다.
- 개선안의 자동 replay, shadow run, staged promotion이 없다.
- event log, heuristic store, benchmark result store가 충분히 durable하게 분리돼 있지 않다.
- provider session persistence와 prompt prefix stability를 거의 활용하지 못하는 실행 경로가 많다.

즉 현재 위치는 아래처럼 보는 게 맞다.

```text
현재 UCM
= durable mission/run kernel
+ provider-aware execution
+ review/handoff model
+ learning proposal schema
- weak context locality
- self-improvement evaluator
- self-improvement promotion loop
- recursive accumulation
```

## 3. 로드맵 구조

이 로드맵은 8개 단계로 나눈다.

- Phase 0. Goal Lock
- Phase 1. Durable Provenance
- Phase 2. Mirror as First-Class Runtime
- Phase 3. Improvement Candidate Pipeline
- Phase 4. Self-Improvement Evaluation Harness
- Phase 5. Controlled Promotion Loop
- Phase 6. Self-Hosting on UCM
- Phase 7. Recursive Improvement

이 순서를 지키는 이유는 간단하다.

- provenance 없이 자기개선은 검증 불가
- evaluation 없이 자기수정은 위험한 자동화
- promotion gate 없이 recursive loop는 운영 불가
- self-hosting 없이 "UCM이 UCM을 만든다"는 말은 문장으로만 남는다

## 3.1 실용적 진행 순서

문서상 단계는 8개지만, 실제 구현은 아래 3개 트랙으로 진행하는 것이 맞다.

### Track A. 운영 가능한 최소 루프

목표:

- Mirror가 실제 runtime run으로 돈다
- `learning_agent`가 구조화된 `improvement_proposal`을 만든다
- 작은 proposal compiler가 일부 제안을 constrained experiment로 변환한다
- replay 없이도 최소 provenance와 execution stats는 남는다

포함:

- `learning_agent` run 활성화
- 기본 execution stats
- 한정된 proposal compiler

제외:

- 신규 대형 스토어
- 모든 role/phase 확장
- 자동 승격

### Track B. 검증 가능한 개선 루프

목표:

- candidate를 baseline과 비교할 수 있다
- token/locality/cost가 평가에 들어간다

포함:

- replay pack
- held-out run set
- candidate 평가 결과 저장

제외:

- full recursive improvement
- 모든 provider/session 영속화

### Track C. 자기호스팅과 누적

목표:

- UCM이 자기 자신을 대상으로 candidate를 만들고 검증한다
- 좋은 heuristic과 context assembly가 누적된다

포함:

- self-hosting workspace
- staged promotion
- 일부 meta-level component의 개선

### 지금 당장 시작해야 할 것은 Track A 뿐이다

Track B와 C는 Track A가 실제 운영에서 유의미한 개선 후보를 만들고 있다는 증거가 생긴 뒤에만 연다.

## 3.2 Bilevel-style 중간 이정표

`Hyperagents`는 장기 목표를 설명하는 데 유용하지만, 실제 구현 경로를 닫는 데는 `Bilevel Autoresearch`가 더 직접적인 힌트를 준다.

UCM 로드맵에는 Track A와 Track B 사이에 아래 중간 이정표가 있어야 한다.

- 먼저 하나의 좁은 run family를 고른다
- 그 run family 안에서 parameter tweak보다 mechanism change가 더 큰 개선을 만드는지 본다
- 그 개선이 anecdote가 아니라 replay 비교로 재현되는지 본다

즉 "범용 자기개선 플랫폼"을 바로 여는 것이 아니라, "좁은 실행 루프 하나에서 메커니즘 수준 수정이 실제로 더 낫다"를 먼저 입증해야 한다.

### 범위

v1 범위는 아래처럼 좁게 잡는 것이 맞다.

- repo: UCM 자신의 repo
- role/run family: `implementation`
- provider: `codex` 우선
- phase: `Execution` 우선
- 변경면: prompt wording보다 `context assembly`, `handoff structure`, `review packet shape`, `retry/fallback rule` 같은 실행 메커니즘 우선

### 하지 않을 것

- 임의 코드 주입을 일반 기능으로 열지 않는다
- core policy나 scheduler 전체를 바로 자기수정 대상으로 열지 않는다
- multi-provider 일반화부터 시도하지 않는다
- 한 번 잘된 사례 하나로 자기개선 루프를 입증했다고 주장하지 않는다

### 성공 조건

이 중간 이정표는 아래 질문에 "예"라고 답할 수 있을 때 달성된 것으로 본다.

1. 같은 run family에서 prompt 미세조정보다 mechanism change가 더 큰 개선을 보였는가?
2. 그 개선이 replay 비교에서 다시 재현되는가?
3. review 품질을 유지하거나 개선하면서 token 또는 blocker를 줄였는가?
4. 실패한 mechanism candidate를 validate-and-revert로 안전하게 폐기할 수 있는가?

이 이정표를 넘기기 전에는 Track B를 크게 확장하지 않는 편이 맞다.

## 4. 단계별 로드맵

## Phase 0. Goal Lock

### 목적

제품 목표, 시스템 목표, 연구 목표의 경계를 명확히 고정한다. 무엇을 지금 완료로 볼지와 무엇을 장기 비전으로 남길지를 분리해야 한다.

### 해야 할 일

- 1차 제품 목표를 결과 지표 기준으로 문서화
- 1차 시스템 목표를 current contract 기준으로 문서화
- 장기 연구 목표를 capability 기준으로 문서화
- 개선 대상을 4종으로 분류
  - 제품 코드
  - prompt / skill / role contract
  - workflow / scheduler / policy
  - provider routing / cost policy
- 각 대상별 승격 경로와 금지 경로 정의
- v1 금지 범위 명시
  - destructive action
  - production rollout direct apply
  - human approval 없는 policy 변경

### 산출물

- `docs/ucm-self-improvement-roadmap.md`
- role/policy 수준의 금지 변경 목록
- self-improvement success metric 초안

### exit criteria

- "proposal", "candidate", "promotion"의 의미가 문서상 구분된다
- "제품 목표", "시스템 목표", "연구 목표"가 문서상 구분된다
- self-improvement 대상 범위와 금지 범위가 고정된다
- 팀이 현재 목표를 결과 지표로 설명할 수 있다

## Phase 1. Durable Provenance

### 목적

모든 자기개선 시도를 나중에 재생, 비교, 감사할 수 있도록 저장 구조를 먼저 고친다.

### 왜 먼저 필요한가

하이퍼에이전트류 시스템의 핵심은 단일 성공 사례가 아니라 "무엇이 왜 개선이었는지"를 누적하는 것이다. 지금 구조로는 snapshot과 일부 index는 있지만 meta-level replay를 위한 원장 구조가 부족하다.

### 해야 할 일

- snapshot 외에 append-only runtime event log 추가
- terminal transcript 외부 저장
- artifact body 외부 저장
- run input, provider assignment, budget decision, approval decision 원장화
- heuristic store / reflection store / replay result store 추가
- `improvement_proposal`과 실제 candidate/run/release를 연결하는 provenance edge 추가
- hot context / cold context 구분과 context reference 구조를 저장 모델에 반영

### 실용적 축소안

처음부터 모든 것을 event-sourced로 바꾸지 않는다.

- 1차는 existing snapshot 유지
- 2차는 execution stats와 candidate lineage만 별도 기록
- transcript 외부 저장도 전면 도입이 아니라 large payload부터 시작

### 필요한 저장 객체

- `runtime_event_log`
- `runtime_artifact_store`
- `runtime_evaluation_result`
- `runtime_heuristic_store`
- `runtime_candidate_index`

### 산출물

- event-sourced projection 가능 구조
- run replay용 입력 스냅샷
- improvement lineage 추적 가능성

### exit criteria

- 임의의 run에 대해 "무슨 입력으로, 어떤 provider에서, 어떤 결과가 나왔는지" 재구성 가능
- 임의의 improvement candidate에 대해 "어떤 proposal에서 나왔고, 어디에 적용됐고, 어떤 평가를 통과했는지" 역추적 가능
- snapshot 손실 없이 event log에서 핵심 상태를 재구성 가능

## Phase 2. Mirror as First-Class Runtime

### 목적

`learning_agent`를 문서상의 역할이 아니라 실제 실행 가능한 runtime lane으로 올린다.

### 해야 할 일

- `learning_agent`를 실제 run 생성 대상에 포함
- `Runtime Ops / Re-entry` phase에 Mirror run 자동 진입 규칙 추가
- Mirror 입력 표준화
  - incident
  - blocker cluster
  - review rejection
  - provider saturation
  - replay failure
  - repeated no-op run
- Mirror 출력 표준화
  - `improvement_proposal`
  - `heuristic_update_proposal`
  - `benchmark_gap_report`
- Mirror는 transcript 덤프 대신 artifact-addressed evidence를 입력으로 사용

### 중요한 제약

이 단계에서는 아직 자기수정 적용을 자동화하지 않는다. Mirror는 현재 계약을 따르는 `proposal generator`까지만 담당한다.

또한 처음에는 아래처럼 좁힌다.

- `learning_agent`는 daemon mode 전체가 아니라 수동 trigger + 일부 운영 이벤트에서만 실행
- 출력은 자유 문서가 아니라 구조화된 `improvement_proposal`로 제한
- 첫 적용 대상은 prompt / routing / review packet formatting만 허용

### 산출물

- 실제 `learning_agent` run
- Mirror run event와 artifact 스키마
- daemon / ops mode에서의 Mirror trigger

### exit criteria

- 운영 이벤트에서 Mirror run이 자동으로 열릴 수 있다
- Mirror가 단순 회고 문서가 아니라 compiler 입력으로 쓸 수 있는 구조화된 proposal을 만든다
- 같은 실패 패턴이 반복될 때 backlog가 아니라 candidate queue로 연결된다

## Phase 3. Improvement Candidate Pipeline

### 목적

`improvement_proposal`을 proposal compiler가 실제 평가 가능한 자기개선 후보로 변환한다.

### 왜 핵심인가

지금 UCM과 장기 자기개선 구조의 가장 큰 차이는 여기다. UCM이 proposal 문서에서 멈추면 개선 루프가 닫히지 않는다. 다만 compiler 단계는 `learning_agent`와 분리해 두는 것이 현재 계약과 유지보수성에 맞다.

### candidate의 최소 단위

후보는 아래 4종 중 하나여야 한다.

- `prompt_candidate`
- `contract_candidate`
- `policy_candidate`
- `code_candidate`

각 후보는 아래를 가져야 한다.

- target surface
- proposed diff
- expected win
- expected risk
- required benchmark
- rollback condition
- promotion stage

### 해야 할 일

- proposal -> candidate compile step 추가
- candidate를 별도 mission/run으로 실행
- candidate별 isolated git worktree 생성
- candidate patch와 baseline patch를 비교 저장
- candidate lineage 저장
- candidate 실행 시 stable prefix와 delta context를 유지하는 prompt assembly 규칙 추가

### 초기 허용 대상

처음에는 아래만 허용하는 것이 맞다.

- role contract
- prompt / skill
- scheduler heuristic
- provider routing
- evidence/review packet formatting

`packages/application` 핵심 상태기계와 destructive policy는 이 단계에서 제외한다.

### 유지보수 가드레일

- 처음에는 candidate 타입을 2개 이상 열지 않는다
- `prompt_candidate`와 `routing_candidate` 중 하나만 먼저 선택한다
- 효과가 확인된 뒤에만 `contract_candidate`, `code_candidate`로 넓힌다

### exit criteria

- proposal이 실제 diff 없는 문서로 남지 않는다
- 모든 candidate는 isolated workspace에서 materialized 된다
- candidate별 expected benchmark와 rollback rule이 필수 필드가 된다

## Phase 4. Self-Improvement Evaluation Harness

### 목적

자기개선 후보를 "좋아 보인다"가 아니라 "실제로 낫다"로 판정하는 체계를 만든다.

### 평가 축

- task quality
- regression rate
- review acceptance rate
- blocked rate
- replan rate
- provider cost
- latency
- run completion rate
- human steering demand

### 필요한 harness

- historical mission replay
- benchmark mission pack
- shadow scheduler simulation
- provider budget stress test
- artifact quality evaluator
- token / latency / context-locality evaluator

### 실용적 축소안

1차 harness는 거창할 필요가 없다.

- 최근 실패 run 20개 replay
- 성공/실패가 명확한 implementation run subset
- provider cost와 token 추정치 비교

처음부터 범용 benchmark framework를 만들지 않는다.

### 핵심 메트릭

UCM 버전의 `imp@k`에 대응하는 메트릭을 정의해야 한다.

- `candidate_gain@k`
- `mission_success_delta`
- `time_to_review_delta`
- `human_intervention_delta`
- `cost_per_accepted_revision_delta`
- `self_improvement_yield`
- `cache_locality_score`
- `tokens_per_successful_run`

### 해야 할 일

- replayable mission corpus 구축
- held-out mission pack 구축
- baseline vs candidate 자동 비교 실행
- benchmark result를 provenance store에 적재
- "개선 같아 보이지만 실제론 나빠지는" 후보를 자동 필터링
- 캐시 이득을 깨는 candidate를 cost regression으로 감점

### exit criteria

- candidate마다 최소 1개 replay suite와 1개 held-out suite를 통과해야 한다
- 평가 결과가 release/handoff와 동일한 수준의 durable artifact로 남는다
- 사람은 diff만이 아니라 benchmark delta를 보고 승인할 수 있다

## Phase 5. Controlled Promotion Loop

### 목적

검증된 candidate를 실제 UCM으로 승격하는 안전한 루프를 만든다.

### 승격 단계

1. Proposal
2. Candidate
3. Replay pass
4. Shadow run
5. Human review
6. Staged promotion
7. Canary observation
8. Default adoption

### 해야 할 일

- candidate approval workflow 추가
- release manifest에 "self-improvement origin" 필드 추가
- shadow runtime 모드 추가
- canary routing 추가
- automatic rollback trigger 추가
- session affinity / prompt cache locality를 승격 평가 항목에 포함

### 자동 반영 가능 범위

이 단계에서도 모든 것이 자동 반영되면 안 된다.

- prompt / routing / heuristic은 staged auto-promotion 가능
- contract / policy / core code는 human approval 필수
- destructive / security-sensitive change는 `L4`

### exit criteria

- 최소 일부 candidate는 human review 후 실제 runtime에 승격 가능
- 승격 후 metric regression이 감지되면 자동 rollback 가능
- self-improvement release가 일반 feature release와 같은 수준으로 추적 가능

## Phase 6. Self-Hosting on UCM

### 목적

UCM이 자기 자신을 대상으로 삼는 작업을 UCM 자신의 표준 workflow로 수행하게 만든다.

### 의미

이 단계부터 비로소 "UCM이 UCM을 만든다"는 표현이 실질적으로 맞기 시작한다.

### 해야 할 일

- UCM repo를 first-class workspace로 등록
- 자기개선 mission template 제공
- self-hosting benchmark pack 구성
- UCM core 전용 review checklist 구성
- self-hosting run에 대한 stricter policy ceiling 적용
- self-hosting 경로에서 full prompt replay 없이 artifact-addressed execution이 가능해야 함

### 이 단계에서 가능한 시나리오

- UCM이 반복 blocker를 줄이기 위해 scheduler heuristic 수정
- UCM이 review packet 품질 개선을 위해 artifact formatter 수정
- UCM이 provider saturation을 줄이기 위해 routing policy 수정
- UCM이 자기 role contract를 개선하고 replay로 검증

### 아직 금지할 것

- policy engine 자기 승인
- rollout guard 자기 완화
- approval bypass
- event/provenance store 비가역 변경의 자동 반영

### exit criteria

- UCM repo에 대한 self-improvement mission이 일반 mission과 같은 커널 위에서 실행된다
- 자기개선 run이 feature run과 분리된 evidence와 release path를 가진다
- self-hosting candidate가 benchmark와 review를 통과해 실제 반영된 사례가 누적된다

## Phase 7. Recursive Improvement

### 목적

개선 능력 자체가 개선되는 구조를 만든다. 여기서부터 하이퍼에이전트 논문과 가장 가깝다.

### 핵심 개념

이 단계에서는 아래가 모두 개선 대상이 된다.

- proposal generator
- candidate compiler
- benchmark selector
- replay prioritizer
- scheduler heuristic
- provider routing policy
- memory condensation policy

즉, 제품을 고치는 루프뿐 아니라 "어떻게 고칠지를 정하는 루프"도 수정 가능해진다.

### 필요한 추가 장치

- meta-benchmark
- heuristic lineage scoring
- transfer evaluation
- candidate selection policy comparison
- evaluation-on-evaluation audit

### 성공 기준

다음이 관측되어야 한다.

- 같은 시간/예산 안에 더 좋은 candidate를 더 자주 생성
- 초기 Mirror보다 학습된 Mirror가 held-out domain에서도 더 나은 개선 후보 생성
- 이전 실행에서 축적된 heuristic/memory가 다음 실행의 개선 속도를 높임
- 같은 품질을 더 적은 토큰과 더 높은 context locality로 달성

### exit criteria

- UCM 안에 "개선 능력" 자체를 측정하는 메트릭이 존재한다
- 이전 self-improvement run의 산출물이 다음 self-improvement run의 품질을 유의미하게 끌어올린다
- 최소 하나 이상의 meta-level component가 수작업 규칙보다 낫다는 근거가 축적된다

## 5. 단계 간 의존성

아래 의존성을 깨면 실패 가능성이 높다.

```text
Goal Lock
  -> Durable Provenance
  -> Mirror Runtime
  -> Candidate Pipeline
  -> Evaluation Harness
  -> Promotion Loop
  -> Self-Hosting
  -> Recursive Improvement
```

특히 다음 지름길은 금지하는 편이 맞다.

- replay harness 없이 auto-apply
- provenance store 없이 heuristic accumulation 주장
- human review 없이 policy/core change promotion
- self-hosting 전에 recursive improvement 주장

## 6. 우선순위

지금 시점의 우선순위는 아래가 맞다.

### 반드시 먼저

- Track A 안의 최소 조각
  - `learning_agent` 실제 run화
  - 구조화된 `improvement_proposal` 표준화
  - 얇은 proposal compiler 추가
  - run execution stats 추가
  - 한정된 replay 비교

### 그 다음

- Phase 1의 durable 확장
- Phase 4의 held-out 평가 확장
- Phase 5. Controlled Promotion Loop

### 마지막

- Phase 6. Self-Hosting on UCM
- Phase 7. Recursive Improvement

이 순서가 중요한 이유는, UCM의 본질이 "패치를 많이 만드는 시스템"이 아니라 "승격 가능한 개선을 축적하는 운영체제"이기 때문이다.

## 6.1 다음 구현 단위

가장 실용적인 다음 구현 단위는 아래 3개다.

1. `learning_agent`를 실제 run으로 추가하되, 출력은 구조화된 `improvement_proposal`로 제한한다.
2. `RunDetail`에 execution stats와 간단한 locality metric만 optional로 추가한다.
3. 일부 `improvement_proposal`을 실험 입력으로 바꾸는 얇은 proposal compiler와, 최근 실패 run 몇 개를 baseline/experiment로 비교하는 작은 replay 경로를 만든다.

이 세 개가 돌아가기 전에는 신규 대형 스토어, 범용 session lease 시스템, 모든 provider 대응을 하지 않는 편이 맞다.

## 7. 실패 시그널

아래가 보이면 로드맵이 잘못 가는 것이다.

- `learning_agent`가 계속 자유 문서만 만들고 구조화된 `improvement_proposal`로 수렴하지 않는다
- proposal compiler가 실제 실험 입력을 안정적으로 만들지 못한다
- self-improvement가 replay 없이 anecdote로만 평가된다
- candidate가 많아지는데 approval quality와 mission quality는 개선되지 않는다
- event/provenance가 약해서 왜 좋아졌는지 설명이 안 된다
- provider cost/latency를 무시한 채 "성능만" 최적화한다
- context locality가 계속 나빠져 self-improvement 루프의 토큰 비용이 감당 불가능해진다
- UCM 자기개선이 일반 제품 작업보다 더 위험한 비공식 루트로 처리된다

## 8. 1차 완료 판정

현재 프로그램의 1차 완료는 다음 질문에 모두 "예"라고 답할 수 있을 때다.

1. UCM repo의 implementation run에서 review 품질을 유지하거나 개선하면서 prompt token을 줄였는가?
2. human steering 빈도 또는 blocker 비율이 줄었는가?
3. `learning_agent`의 `improvement_proposal`이 작은 replay 비교로 검증 가능한가?
4. 실행 통계와 locality metric이 durable하게 남는가?

## 9. 장기 완료 판정

장기 연구 목표의 완료는 다음 질문에 모두 "예"라고 답할 수 있을 때다.

1. UCM은 자기 자신을 정식 workspace/mission 대상으로 다룰 수 있는가?
2. 자기개선 제안은 실제 candidate와 diff로 materialize 되는가?
3. candidate는 replay와 held-out benchmark로 평가되는가?
4. 검증된 candidate는 review, shadow, canary를 거쳐 실제 승격될 수 있는가?
5. 승격 후 결과는 rollback 가능하고 provenance가 완전한가?
6. 이전 self-improvement 산출물이 다음 self-improvement 품질을 높이는가?

여기까지 오면 "UCM이 UCM을 만들 수 있어야 한다"는 말은 비전 문구가 아니라, 런타임이 실제로 수행하는 운영 프로토콜이 된다.
