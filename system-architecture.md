# UCM vNext System Architecture

기준일: 2026-03-24

## 0. 문서 목적

이 문서는 UCM을 다음과 같이 재정의한다.

- 단일 AI 에이전트 앱이 아니라 `정책과 상태를 가진 자율 소프트웨어 공장 운영체제`
- 긴 대화 세션에 의존하는 툴이 아니라 `mission/run/deliverable` 중심의 durable runtime
- 코드 생성기가 아니라 `심의, 검증, 승급, 운영, 개선`을 통제하는 execution OS

특히 이 설계는 다음 현실 제약을 1급 객체로 다룬다.

- `Codex`, `Claude`, `Gemini`를 API가 아니라 `정액제 seat`로 사용한다.
- provider별 사용 한도는 `5시간 창`, `7일 창`, `일일 요청`, `동시 실행`, `surface별 공유 quota` 같은 제약을 가진다.
- 로그인 만료, 잘못된 인증 방식, PAYG fallback, 브라우저 연동, surface 간 allowance 공유가 실제 운영 품질을 좌우한다.

## 1. 설계 원칙

### 1.1 Mission-first

모든 실행은 대화가 아니라 `mission`을 중심으로 관리한다.

- 사용자의 목표는 `MissionDetail.goal`, `successCriteria`, `constraints`, `risks`로 구조화한다.
- 개별 모델 세션은 disposable 하며, 진짜 상태는 런타임 스토어에만 남긴다.
- `mission`이 상위 목표이고 `run`은 한정된 책임을 가진 작업 단위다.

### 1.2 Deliberation-before-execution

비사소한 구현은 바로 코딩으로 들어가지 않는다.

- 최소 2개 이상의 대안 생성
- 반대 관점 검토
- 검증 가능성 점검
- 결정 기록 생성

이 과정을 통과하지 못한 실행은 시작하지 않는다.

### 1.3 Evidence-is-progress

코드 양은 진척이 아니다. 다음만 진척으로 인정한다.

- 더 나은 명세
- 더 나은 결정 기록
- 더 나은 검증 증거
- 승인 가능한 deliverable revision

### 1.4 Provider-as-Operating-Constraint

LLM provider는 단순 모델 선택기가 아니라 실행 환경의 제약이다.

- quota
- auth
- billing mode
- concurrency
- surface 간 allowance 공유

이 제약은 scheduler와 policy가 직접 관리해야 한다.

### 1.5 Human override, policy enforcement

사람은 목표를 지정하고 고위험 결정을 승인한다. 실제 권한 집행은 policy engine이 한다.

## 2. 현재 UCM 커널

현재 UCM의 실질적 커널은 이미 `ucm-desktop` 런타임에 존재한다.

- `workspace`
- `mission`
- `agent`
- `run`
- `runEvent`
- `deliverable`
- `handoff`
- `budget`

핵심 구현 기준점:

- `ucm-desktop/src/main/runtime.ts`
- `ucm-desktop/src/main/runtime-policy.ts`
- `ucm-desktop/src/main/runtime-scheduler.ts`
- `ucm-desktop/src/main/runtime-state.ts`
- `ucm-desktop/src/shared/contracts.ts`

즉, vNext는 새 엔진을 처음부터 만드는 것이 아니라, 현재 커널 위에 아래 계층을 추가하는 작업이다.

- `Deliberation Mesh`
- `Provider OS`
- `Evidence Gate`
- `Heuristic Registry`
- `Goal Guard`

## 3. 상위 아키텍처

```text
User Intent
  ↓
Mission Intake
  ↓
Deliberation Mesh
  ↓
Decision Record + Acceptance Checks
  ↓
Run Scheduler
  ↓
Provider OS
  ↓
Execution Fabric
  ↓
Evidence Gate
  ↓
Deliverable + Handoff
  ↓
Runtime Ops / Improvement Loop
```

세 개의 평면으로 나눈다.

### 3.1 Control Plane

목표, 상태, 권한, 정책, 심의, provenance를 관리한다.

- Mission Kernel
- Policy Engine
- Deliberation Mesh
- Goal Guard
- Audit / Provenance Store

### 3.2 Provider Plane

정액제 seat와 quota를 운영체제처럼 관리한다.

- Provider Seat Manager
- Quota Ledger
- Auth Lease Monitor
- Session Checkpoint Store
- Billing Guard

### 3.3 Execution Plane

실제 코딩, 리서치, 검증, 전달 run을 실행한다.

- Run Scheduler
- Worktree Manager
- Provider Adapters
- Evidence Builder
- Deliverable Promotion Gate

### 3.4 개념 책임 맵

`another-sw-factory-os.md`의 좋은 점은 시스템 책임을 사람이 이해하기 쉬운 작업선으로 쪼갠다는 데 있다.
UCM은 기존 `mission/run/deliverable/policy` 커널을 유지하되, 아래 개념 이름을 책임 맵으로 채택할 수 있다.

- `Compass`: mission intake, spec 정제, acceptance check 고정
- `Atlas`: 리서치, evidence 수집, risk register 갱신
- `Forge`: 설계, 작업 분해, 구현 run orchestration
- `Judge`: verification, review packet, 보안/품질 gate
- `Harbor`: handoff, release brief, staging/canary/release
- `Pulse`: 운영 이벤트, incident, 사용자 피드백, 비용/성능 이상 감시
- `Mirror`: retrospective, heuristic 갱신, self-improvement proposal
- `Spine`: policy, memory, provider ledger, scheduler, audit

중요한 점:

- 이 이름들은 `새 커널 객체`가 아니다
- UCM 런타임 내부 객체명은 계속 `mission/run/deliverable/evidence/policy`를 쓴다
- 위 이름들은 `역할 lane`과 `문서/대시보드 표현`에 쓰는 개념 레이어다

## 4. 주요 모듈

## 4.1 Mission Kernel

Mission Kernel은 현재 runtime의 중심이며, 다음 책임을 가진다.

- `mission` 생성 및 상태 관리
- `run` 생성, follow-up branching, reuse, queueing
- `deliverable revision` 생성과 승인
- `runEvent`, `lifecycleEvent` 축적
- 예산과 open risk 관리

추가 규칙:

- 모든 run은 `mission`에 귀속된다.
- 모든 run은 `title`, `objective`, `budgetClass`, `expected evidence`를 가진다.
- `mission`은 최소 하나의 `successCriteria`와 하나의 `active phase`를 가진다.

## 4.2 Deliberation Mesh

현재 UCM이 가장 보완해야 할 계층이다. 목적은 편향, 터널링, 가짜 진행을 줄이는 것이다.

### 역할

- `proposer_a`: 첫 제안
- `proposer_b`: 독립 대안
- `broadener`: 누락된 방향 강제 추가
- `skeptic`: 전제와 리스크 공격
- `verifier`: acceptance check와 evidence 요구
- `decider`: 선택지 비교 및 결정 기록 생성

### 출력

- `AlternativeSet`
- `DecisionRecord[]`
- `AcceptanceChecks`
- `OpenQuestions`

### 규칙

- trivial이 아닌 작업은 대안이 2개 미만이면 구현 금지
- proposer와 verifier는 같은 provider로 고정하지 않는다
- 같은 provider가 `제안 + 검증 + 승인`을 모두 맡지 못한다
- deliberation 산출물이 없으면 `run.status=queued`에서 `running`으로 승급하지 않는다

## 4.3 Provider OS

이 계층은 정액제 seat를 안정적으로 운영하기 위한 핵심이다.

### 책임

- 어떤 provider/surface를 어떤 run에 배정할지 결정
- quota 창을 추적
- 로그인 만료와 인증 오류를 감지
- subscription seat와 PAYG를 구분
- provider 창이 닫히기 전에 checkpoint를 저장

### 핵심 엔티티

```ts
type ProviderVendor = "codex" | "claude" | "gemini";
type ProviderSurface = "cli" | "ide" | "web" | "app" | "cloud";

type WindowBudget = {
  kind: "five_hour" | "seven_day" | "daily" | "per_minute" | "concurrency";
  scope: string;
  limit?: number;
  used?: number;
  resetAt?: string;
  confidence: "official" | "observed" | "inferred";
};

type ProviderSeat = {
  id: string;
  vendor: ProviderVendor;
  surface: ProviderSurface;
  billingMode: "subscription_only" | "allow_metered_fallback" | "metered_only";
  authState: "healthy" | "reauth_required" | "misconfigured";
  status: "ready" | "busy" | "cooldown" | "unavailable";
  sharedScopes: string[];
  windows: WindowBudget[];
  currentRunId?: string;
  lastHealthCheckAt?: string;
};
```

### 중요한 설계 포인트

- quota는 숫자가 없더라도 객체로 저장한다
- 공식 숫자가 불명확한 경우 `confidence=observed`로 기록한다
- scheduler는 provider 가용성과 quota를 같이 본다
- auth 이상, quota 소진, fallback billing 전환은 모두 `blocked reason`으로 기록한다

## 4.4 Execution Fabric

각 run은 격리된 실행 단위다.

### 구성

- git worktree
- provider adapter
- terminal / batch / delegated task runner
- checkpoint writer
- artifact collector

### 규칙

- `run continuity != provider session continuity`
- provider 세션이 끊겨도 run은 살아 있어야 한다
- 실행 중 provider 창이 닫히면 마지막 checkpoint에서 다른 seat로 재스케줄할 수 있어야 한다
- 각 run은 최대 runtime, 최대 loop count, 최소 evidence delta 조건을 가진다

## 4.5 Evidence Gate

에이전트가 코드를 쏟아내는 문제를 막는 계층이다.

### 기본 객체

- `PatchSet`
- `TestResult`
- `ReviewPacket`
- `EvidencePack`
- `DeliverableRevision`

### 승급 규칙

- patch만 있고 test/evidence가 없으면 review 승급 금지
- `needs_review`는 evidence 기준을 만족할 때만 가능
- verifier와 implementer 분리
- 같은 run이 두 번 연속 `evidence delta == 0`이면 중단 후 deliberation으로 복귀

### 최소 EvidencePack 예시

```json
{
  "runId": "r-123",
  "checks": [
    { "name": "acceptance_checks_defined", "status": "pass" },
    { "name": "tests_executed", "status": "pass" },
    { "name": "risk_reviewed", "status": "pass" }
  ],
  "artifacts": ["diff", "test_result", "review_packet"],
  "decision": "promote_to_review"
}
```

## 4.6 Heuristic Registry

LLM 운용의 암묵지를 구조화한 저장소다.

### HeuristicCard

```ts
type HeuristicCard = {
  id: string;
  name: string;
  useWhen: string[];
  avoidWhen: string[];
  failureSignals: string[];
  counterHeuristics: string[];
  requiredEvidence: string[];
  examples: Array<{ outcome: "success" | "failure"; note: string }>;
};
```

### 예시

- `먼저 구현하지 말고 acceptance check를 먼저 고정`
- `작업이 막히면 같은 run에서 우기지 말고 blocker 전용 research run으로 분기`
- `코드가 늘어나는데 evidence가 늘지 않으면 잘못된 루프`

### 규칙

- heuristic은 프롬프트에 통째로 넣지 않는다
- 상황에 맞는 카드만 query해서 주입한다
- 실패가 누적되면 heuristic card를 갱신한다

## 4.7 Goal Guard

에이전트가 눈앞의 문제만 처리하고 상위 목표를 잃는 문제를 막는다.

### 점검 질문

- 지금 run이 active phase objective에 실제로 기여하는가
- 현재 변경이 success criteria를 줄이는가 늘리는가
- 새로운 open risk가 생겼는가
- evidence가 증가했는가
- 계획 재검토가 필요한가

### 강제 트리거

아래 중 하나면 `zoom-out checkpoint`를 생성한다.

- 20분 이상 실행
- 8회 이상 tool/action
- 2회 이상 실패 루프
- evidence 증가 없음
- open risk 감소 없음

## 4.8 Role Contracts

역할 분리는 페르소나 놀이가 아니라 권한과 책임 분리다.
각 역할은 프롬프트보다 먼저 계약을 가져야 한다.

최소 역할:

- `conductor`: 상태기계 진행, gate 판단, run 배치
- `spec_agent`: 목표 정의, acceptance check, 비범위 잠금
- `research_agent`: 근거 수집, 출처 기록, risk 정리
- `architect_agent`: 구조안, ADR, tradeoff 기록
- `builder_agent`: bounded implementation run 수행
- `reviewer_agent`: 회귀 위험, spec mismatch, diff review
- `qa_agent`: regression/e2e/scenario verification
- `security_agent`: 권한, secret, 공급망, sandbox 점검
- `release_agent`: handoff, deploy, rollback 준비
- `ops_agent`: incident triage, runtime anomaly 감시
- `learning_agent`: retrospective, heuristic/proposal 생성

각 역할은 반드시 아래 계약을 가진다.

- `charter`: 무엇을 책임지는가
- `allowedTools`: 어떤 툴/권한 레벨까지 허용되는가
- `inputs`: 읽을 수 있는 표준 산출물
- `outputs`: 반드시 남겨야 하는 산출물
- `escalationRules`: 실패 또는 고위험 상황에서 누구에게 넘기는가

규칙:

- 같은 역할이 `작성 + 검증 + 최종 승인`을 모두 맡지 않는다
- 역할 계약은 런타임 외부 파일로 버전 관리한다
- 역할별 tool scope는 policy engine이 최종 집행한다

## 4.9 Operating Modes

UCM은 하나의 실행기지만 운영 모드는 세 가지로 구분된다.

### Interactive Mode

- 사용자와 짧게 왕복하면서 `Compass`와 `Atlas`를 돌린다
- 목적은 질문, 범위 조정, acceptance lock, steering 반영이다
- 긴 구현보다 spec/research 산출물 생산에 우선권을 둔다

### Batch Build Mode

- `Forge`, `Judge`, `Harbor`가 주도한다
- worktree 생성, 구현, 테스트, review packet, release brief까지 이어진다
- 사람은 승인과 예외 처리에만 개입한다

### Daemon Mode

- `Pulse`와 `Mirror`가 주도한다
- 운영 이벤트, cron, incident, backlog refresh, self-improvement proposal을 다룬다
- 상시 실행이더라도 고위험 action은 policy/human gate를 건너뛰지 못한다

## 4.10 Service Boundaries

초기 구현은 모노레포여도 되지만 경계는 분명해야 한다.

- `control-plane`: mission, run, state machine, approvals, event orchestration
- `worker-runtime`: code runner, browser runner, test runner, worktree lifecycle
- `memory-service`: project/evidence/procedural/reflection memory 저장과 query
- `policy-service`: tool access, approval, billing guard, secret mediation
- `artifact-store`: spec, research, ADR, eval, release artifact 저장
- `operator-ui`: 상태 확인, 승인, steering, incident, retrospective 확인

실행 원칙:

- v1은 `1 API + desktop runtime + code runner + browser runner` 정도로 시작한다
- 경계가 먼저 존재해야 이후 daemon, remote worker, multi-repo 확장이 가능하다

## 5. Provider별 제약 모델

이 절은 설계상 반드시 반영해야 하는 provider 특성을 정리한다.

## 5.1 Codex

공식적으로 확인되는 사항:

- Codex는 ChatGPT Plus, Pro, Business, Enterprise/Edu에 포함된다.
- Codex usage는 plan에 따라 다르며 작업 크기, 장기 실행, surface에 따라 소모량이 달라진다.
- API key로 Codex CLI를 쓰던 환경이라면 `codex logout` 후 subscription login으로 전환해야 한다.
- ChatGPT의 파일 업로드, 이미지, 음성 제한은 Codex와 별도다.

UCM 설계 반영:

- `surface=cli|ide|web|app|cloud`를 분리하되 allowance 공유 scope를 가질 수 있어야 한다
- 정확한 숫자가 벤더 문서에 항상 노출되지 않으므로 `observed quota window`를 저장해야 한다
- 사용자에게 보이는 `5시간` 또는 `주간` cap이 있더라도 이를 상수로 박지 말고, seat별 관측값으로 저장해야 한다
- `subscription_only` 모드에서는 API key 경로를 차단해야 한다
- cloud delegation은 local pair session보다 다른 allowance를 가질 수 있으므로 같은 bucket으로 단정하지 않는다

## 5.2 Claude

공식적으로 확인되는 사항:

- Claude와 Claude Code usage는 shared subscription이다.
- session-based usage limit은 5시간 단위로 리셋된다.
- Pro는 `all-models weekly cap`이 있고 7일 후 리셋된다.
- Max는 `all-models weekly cap`과 `Sonnet-only weekly cap` 두 개가 있고 둘 다 session 시작 7일 후 리셋된다.
- Claude Code에서 `/status`로 남은 allocation을 확인할 수 있다.
- `ANTHROPIC_API_KEY`가 설정되어 있으면 subscription 대신 API billing이 사용될 수 있다.
- 잘못된 계정 선택 시 `/logout`, `claude update`, 터미널 재시작 후 다시 로그인해야 한다.

UCM 설계 반영:

- `five_hour`와 `seven_day` window는 1급 객체
- `billingMode=subscription_only`일 때 API key 존재를 misconfiguration으로 처리
- verification, design review, skepticism lane에 Claude를 우선 배정할 수 있지만 주간 cap을 고려해야 한다
- `/status` 파싱 또는 health probe로 window 상태를 갱신해야 한다

## 5.3 Gemini

공식적으로 확인되는 사항:

- Google AI Pro 사용자에게 Gemini CLI와 Gemini Code Assist가 제공된다.
- Gemini Code Assist agent mode와 Gemini CLI의 quota는 combined usage다.
- Gemini Code Assist / CLI 공식 quota는 AI Pro 기준 `120 req/min`, `1500 req/day`, AI Ultra 기준 `120 req/min`, `2000 req/day`다.
- Google AI Pro 혜택 문서상 capacity는 availability에 따라 달라질 수 있으며 보장되지 않는다.
- Gemini Apps web은 별도의 model/feature limit 체계를 가진다.
- Gemini CLI는 Google login, API key, Vertex 등 여러 인증 경로를 가진다.
- Gemini CLI troubleshooting 문서에서 auth error는 exit code `41`, turn limit는 exit code `53`으로 정의된다.

UCM 설계 반영:

- `cli/code_assist`는 shared scope로 묶어야 한다
- `web app` 사용량은 별도 scope로 분리한다
- breadth search, summarization, alternative generation lane에 Gemini를 우선 배정할 수 있다
- auth 방식이 바뀌면 seat identity가 달라지므로 별도 seat로 본다
- `GOOGLE_CLOUD_PROJECT`가 필요한 조직 license와 개인 Google login을 구분해야 한다

## 6. 상태 기계

## 6.1 Mission 상태

기존 상태를 유지한다.

- `queued`
- `running`
- `review`
- `blocked`
- `completed`

추가 규칙:

- active run이 `blocked`면 mission은 `blocked` 우선
- 승인 가능한 deliverable이 생기면 mission은 `review`
- success criteria를 만족한 승인 revision이 handoff 되면 `completed`

## 6.2 Run 상태

기존 상태를 유지하되 원인을 세분화한다.

- `queued`
- `running`
- `blocked`
- `needs_review`
- `completed`

`blocked`의 사유는 구조화한다.

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

## 6.3 Deliverable 상태

기존 revision 체계를 유지한다.

- `active`
- `approved`
- `superseded`

추가 규칙:

- revision은 항상 기반 artifact id를 포함해야 한다
- approval은 human 또는 policy-controlled reviewer만 가능하다
- implementer run이 자기 revision을 최종 승인하지 못한다

## 7. 런타임 규칙

### 7.1 구현 전 규칙

- acceptance checks가 없으면 비사소한 구현 금지
- 대안 비교가 2개 미만이면 구현 금지
- provider seat가 `healthy`가 아니면 실행 금지

### 7.2 실행 중 규칙

- 같은 패턴의 실패가 2회 반복되면 replan
- coding activity는 evidence 증가를 동반해야 한다
- session cap 근접 시 checkpoint를 강제 저장한다
- quota가 바닥나면 같은 provider로 무한 재시도하지 않는다

### 7.3 검증 규칙

- diff artifact가 생기면 verification follow-up을 기본 생성
- review packet은 최신 evidence를 묶어 deliverable revision으로 생성
- review-ready event가 나와도 evidence gate를 통과하지 못하면 `needs_review`로 올리지 않는다

### 7.4 운영 규칙

- auth 만료, quota exhaustion, billing conflict는 모두 운영 이벤트다
- 운영 이벤트는 단순 로그가 아니라 `runEvent`와 `lifecycleEvent`로 남긴다
- provider 상태 변경은 UI에서 mission 진척과 함께 보여야 한다

## 8. 저장소 구조 제안

루트 기준으로 아래 문서를 단계적으로 추가한다.

```text
/system-architecture.md
/workflow-spec.md
/runtime-state-machine.md
/policy-model.md
/evidence-and-release.md
/storage-and-provenance.md
/role-contracts.md
/artifact-schema.md
```

코드 모듈은 아래 순서로 확장한다.

```text
ucm-desktop/src/main/
  runtime-provider-broker.ts
  runtime-auth-monitor.ts
  runtime-deliberation.ts
  runtime-evidence.ts
  runtime-heuristics.ts
  runtime-goal-guard.ts
```

## 9. 구현 우선순위

### Phase 1: Provider OS

가장 먼저 해야 한다.

- provider seat 모델 추가
- quota ledger 추가
- auth health check 추가
- billing guard 추가
- 현재 `ProviderWindowSummary`를 `codex/claude/gemini`로 일반화

이 단계가 없으면 정액제 기반 운영이 계속 불안정하다.

### Phase 2: Evidence Gate

- run별 expected evidence 정의
- evidence delta 계산
- zero-evidence loop 차단
- review promotion gate 도입

### Phase 3: Deliberation Mesh

- proposer / skeptic / verifier 기반 회의 run 추가
- `AlternativeSet`과 `AcceptanceChecks` 저장
- 구현 전 필수 게이트화

### Phase 4: Heuristic Registry + Goal Guard

- heuristic card 저장과 query
- zoom-out checkpoint
- mission objective drift 감시

## 10. MVP 기준

첫 번째 현실적 MVP는 아래까지다.

- 사용자의 goal을 mission으로 구조화
- 구현 run 전에 짧은 deliberation 수행
- Codex / Claude / Gemini seat 상태 표시
- quota/auth/billing 충돌을 blocked reason으로 기록
- evidence 없는 coding loop 차단
- deliverable revision 승인 흐름 유지

제외 범위:

- 완전 무인 production deploy
- 고위험 self-modification
- provider별 모든 비공개 quota 수치의 완전 자동 추론

## 11. 요약

UCM vNext의 핵심은 더 강한 단일 에이전트를 붙이는 것이 아니다.

- `상태`를 모델 세션 밖으로 끄집어내고
- `정액제 seat 제약`을 운영체제 수준에서 다루고
- `심의`를 구현 전에 강제하고
- `증거` 없이는 승급하지 못하게 하며
- `휴리스틱과 목표 점검`을 구조화하는 것이다

이 방향이 맞아야 UCM은 "코드를 계속 쏟아내는 앱"이 아니라 "정책과 상태를 가진 자율 소프트웨어 공장 운영체제"가 된다.

## 12. 참고 자료

아래 자료를 기준으로 provider 제약을 반영했다.

- OpenAI Help: `Using Codex with your ChatGPT plan`  
  https://help.openai.com/en/articles/11369540-using-codex-with-your-chatgpt-plan/
- Anthropic Help: `Using Claude Code with your Pro or Max plan`  
  https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan
- Anthropic Help: `What is the Pro plan?`  
  https://support.claude.com/en/articles/8325606-what-is-claude-pro
- Anthropic Help: `What is the Max plan?`  
  https://support.claude.com/en/articles/11049741-what-is-the-max-plan
- Anthropic Help: `Troubleshoot Claude error messages`  
  https://support.claude.com/en/articles/12466728-understanding-claude-error-messages
- Anthropic Docs: `Claude Code Identity and Access Management`  
  https://code.claude.com/docs/en/team
- Google One Help: `Use Google AI Pro benefits`  
  https://support.google.com/googleone/answer/14534406
- Google Developers: `Gemini Code Assist quotas and limits`  
  https://developers.google.com/gemini-code-assist/resources/quotas
- Gemini CLI docs: `Authentication`  
  https://github.com/google-gemini/gemini-cli/blob/main/docs/get-started/authentication.md
- Gemini CLI docs: `Troubleshooting guide`  
  https://github.com/google-gemini/gemini-cli/blob/main/docs/resources/troubleshooting.md
- Google Help: `Gemini Apps limits & upgrades for Google AI subscribers`  
  https://support.google.com/gemini/answer/16275805
