# UCM Policy Model

기준일: 2026-03-24

## 0. 목적

이 문서는 UCM vNext에서 무엇을 자동 허용하고, 무엇을 막고, 무엇을 사람 승인으로 넘길지 정의한다.

UCM의 정책 모델은 다음 전제를 가진다.

- provider seat는 공짜 API가 아니다
- 코드 생성은 허용 대상이 아니라 검증 대상이다
- billing route 변경은 기능 변경만큼 위험하다
- 사람은 승인자이지 수동 오퍼레이터가 아니다

이 문서는 [system-architecture.md](/home/eugene/git/ucm/system-architecture.md), [workflow-spec.md](/home/eugene/git/ucm/workflow-spec.md), [runtime-state-machine.md](/home/eugene/git/ucm/runtime-state-machine.md)를 보완한다.

## 1. 정책이 다루는 영역

- execution start / resume / retry
- provider seat allocation
- subscription vs API billing route
- workspace command 실행
- network / filesystem / secret access
- verification 승급
- deliverable approval
- 운영 blocker 복구

## 2. 정책 평가 입력

정책은 최소 아래 입력을 본다.

```ts
type PolicyInput = {
  missionId: string;
  runId?: string;
  action:
    | "start_run"
    | "resume_run"
    | "retry_run"
    | "allocate_provider_seat"
    | "switch_billing_route"
    | "approve_deliverable"
    | "open_followup_run"
    | "execute_workspace_command"
    | "promote_review_packet";
  actorType: "system" | "human" | "policy_worker";
  riskLevel: "low" | "medium" | "high" | "critical";
  provider?: "codex" | "claude" | "gemini";
  surface?: "cli" | "ide" | "web" | "app" | "cloud";
  billingMode?: "subscription_only" | "allow_metered_fallback" | "metered_only";
  budgetClass?: "light" | "standard" | "heavy";
  seatHealth?: "healthy" | "reauth_required" | "misconfigured";
  evidenceReady?: boolean;
  acceptanceChecksDefined?: boolean;
  sameProviderSelfApproval?: boolean;
};
```

## 3. 정책 결정 출력

```ts
type PolicyDecision = {
  outcome: "allow" | "queue" | "deny" | "require_approval";
  reason: string;
  requiredApprovalKind?:
    | "human_review"
    | "billing_override"
    | "provider_reauth"
    | "risk_override";
  conditions?: string[];
};
```

## 4. 정책 레벨

## 4.1 L0 Read-only

허용:

- 문맥 조회
- 기존 artifact 읽기
- heuristic query
- provider health probe

금지:

- 파일 수정
- 실행
- quota 소비가 큰 deliberation

## 4.2 L1 Planning

허용:

- deliberation
- decision record 작성
- acceptance check 정의
- follow-up run 제안

금지:

- workspace command 실행
- provider billing route 변경

## 4.3 L2 Execution

허용:

- workspace 내 bounded command 실행
- artifact 생성
- review packet 갱신

조건:

- acceptance checks 정의 완료
- provider seat health 정상
- budget bucket 여유

## 4.4 L3 Verification / Promotion

허용:

- verification run 실행
- evidence pack 생성
- review packet 승급

조건:

- implementer와 verifier 분리
- evidence gate 통과
- same-provider self-approval 금지

## 4.5 L4 Human Approval Required

항상 승인 필요:

- deliverable final approval
- billing route override
- subscription_only 에서 API key fallback 허용
- provider reauth recovery after repeated failure
- destructive workspace command
- production-like deployment action

## 5. 기본 정책

## 5.1 Billing safety

UCM 기본값은 `subscription_only`다.

규칙:

- API key가 감지되면 자동 fallback 하지 않는다
- `billingMode=subscription_only`에서 API 경로가 열리면 `deny`
- 사람이 명시적으로 허용한 경우에만 `allow_metered_fallback`

## 5.2 Provider health safety

규칙:

- `seatHealth=reauth_required`면 `start_run/resume_run`은 `deny`
- `seatHealth=misconfigured`면 해당 seat 배정은 `deny`
- `seatHealth=healthy`지만 window가 닫혀 있으면 `queue`

## 5.3 Evidence safety

규칙:

- acceptance checks가 없으면 `start_run`은 trivial 작업 외 `deny`
- evidenceReady=false면 `promote_review_packet`은 `deny`
- diff artifact만 있고 test/evidence가 없으면 `approve_deliverable`은 `deny`

## 5.4 Bias safety

규칙:

- 같은 provider가 `제안 + 검증 + 승인`을 모두 맡으면 `deny`
- proposer와 verifier가 동일 provider인 경우 high-risk 작업은 `require_approval`
- alternative count < 2인 non-trivial 작업은 `deny`

## 5.5 Governor safety

규칙:

- budget bucket exhausted면 follow-up run 생성 `deny`
- maxOpenRuns 초과면 follow-up run 생성 `deny`
- exclusive rule run이 열려 있으면 상충 run 생성 `deny`

## 6. provider별 정책 특이사항

## 6.1 Codex

- exact cap이 문서에 항상 노출되지 않더라도 user-observed window를 정책 입력으로 쓴다
- `cli`, `ide`, `web`, `cloud` allowance 공유 여부는 `sharedScope`로만 판정한다
- API key 사용 이력이 있는 환경은 subscription seat와 명시적으로 분리한다

정책:

- unknown quota 상태이면 long-running implementation run은 `require_approval` 또는 보수적 `queue`
- observed denial이 연속되면 seat status를 `cooldown` 또는 `unavailable`로 격하

## 6.2 Claude

- `ANTHROPIC_API_KEY`가 존재하면 billing mode 충돌 검사 필수
- 5시간 / 7일 usage window는 policy 입력으로 취급
- `/status` 조회가 가능하면 window 상태를 갱신

정책:

- review, skepticism, design lane을 우선 배정하되 weekly cap이 낮으면 planning workload를 Gemini로 분산
- repeated auth/account mismatch는 `require_approval(provider_reauth)`

## 6.3 Gemini

- CLI/Code Assist combined quota를 shared scope로 처리
- web/app surface는 별도 scope
- `GOOGLE_CLOUD_PROJECT` 필요 여부에 따라 seat를 분리

정책:

- breadth search, alternative generation, summarization을 기본 lane으로 허용
- auth error exit code `41`은 `deny + provider_reauth`
- turn limit exit code `53`은 `queue` 또는 checkpoint split

## 7. 주요 정책 표

| Action | 기본 결과 | 조건 |
|---|---|---|
| `start_run` | `allow` | acceptance checks 정의, seat healthy, budget available |
| `resume_run` | `allow` | blocked reason 해소, seat healthy |
| `retry_run` | `require_approval` | 동일 failure pattern 2회 이상이면 재시도보다 재계획 우선 |
| `allocate_provider_seat` | `allow` | shared scope 충돌 없음, seat ready |
| `switch_billing_route` | `deny` | 기본값. 사람 승인 시만 override |
| `approve_deliverable` | `require_approval` | evidence ready + reviewer authority 필요 |
| `open_followup_run` | `allow` | governor 통과 시 |
| `execute_workspace_command` | `allow` | bounded command, workspace policy 통과 |
| `promote_review_packet` | `allow` | evidence gate 통과 시 |

## 8. Approval ticket 모델

```ts
type ApprovalTicket = {
  id: string;
  kind: "human_review" | "billing_override" | "provider_reauth" | "risk_override";
  missionId: string;
  runId?: string;
  summary: string;
  createdAt: string;
  status: "open" | "approved" | "rejected" | "expired";
  decisionReason?: string;
};
```

승인 ticket가 필요한 경우:

- 최종 deliverable 승인
- billing route 변경
- seat misconfiguration 복구 후 재개
- 동일 패턴 재시도 강행

## 9. 운영 이벤트 정책

아래는 단순 로그가 아니라 policy event다.

- provider quota exhausted
- provider reauth required
- API key unexpectedly detected
- alternate seat unavailable
- evidence gate failure
- repeated loop failure

정책 반응:

- `quota exhausted` → `queue` 또는 alternate seat 탐색
- `reauth required` → `deny + approval ticket`
- `API key unexpectedly detected` → `deny + billing_override ticket`
- `evidence gate failure` → `deny + deliberation reopen`

## 10. 불변조건

- `subscription_only` seat는 자동으로 metered path로 전환되지 않는다
- approval 없는 final deliverable promotion은 불가
- same-provider self-approval은 불가
- governor 차단은 무시되지 않는다
- blocked reason 없는 blocked run은 불가

## 11. 현재 구현에 필요한 확장

우선순위:

- `ProviderWindowSummary` 일반화
- `PolicyDecision` 타입 추가
- `ApprovalTicket` 저장소 추가
- `blockedReason` metadata 표준화
- `billingMode`를 run/seat 수준에 도입

추천 모듈:

```text
ucm-desktop/src/main/
  runtime-policy-engine.ts
  runtime-approval.ts
  runtime-provider-billing.ts
```

## 12. 요약

UCM 정책 모델의 핵심은 단순 allow/deny가 아니다.

- 실행 가능성
- 증거 충족 여부
- provider seat 건전성
- billing 안전성
- 사람 승인 필요성

이 다섯 축을 동시에 판단해야 한다.
