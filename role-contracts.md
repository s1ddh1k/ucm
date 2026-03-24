# UCM Role Contracts

기준일: 2026-03-24

## 0. 목적

이 문서는 UCM vNext에서 역할을 페르소나가 아니라 `정책과 입출력 계약을 가진 실행 단위`로 정의한다.

이 문서는 다음 문서를 보완한다.

- [system-architecture.md](/home/eugene/git/ucm/system-architecture.md)
- [workflow-spec.md](/home/eugene/git/ucm/workflow-spec.md)
- [policy-model.md](/home/eugene/git/ucm/policy-model.md)
- [artifact-schema.md](/home/eugene/git/ucm/artifact-schema.md)

핵심 원칙:

- 역할은 말투가 아니라 책임 경계다
- 역할은 읽을 수 있는 산출물과 써야 하는 산출물이 명시된다
- 역할은 허용된 툴과 정책 ceiling을 가진다
- 역할이 막히면 improvisation보다 escalation이 우선이다
- 고위험 흐름에서는 같은 역할 또는 같은 provider가 `작성 + 검증 + 승인`을 모두 맡지 못한다

## 1. 표준 계약 스키마

```ts
type RoleId =
  | "conductor"
  | "spec_agent"
  | "research_agent"
  | "architect_agent"
  | "builder_agent"
  | "reviewer_agent"
  | "qa_agent"
  | "security_agent"
  | "release_agent"
  | "ops_agent"
  | "learning_agent";

type PolicyLevel = "L0" | "L1" | "L2" | "L3" | "L4";

type ContractDependency = {
  kind: string;
  source: "artifact" | "runtime_view" | "policy_view" | "memory_view";
  required: boolean;
  freshness?: "latest_phase" | "latest_run" | "approved_only";
};

type EscalationRule = {
  when: string;
  handoffTo: RoleId | "human";
  action: "block" | "request_review" | "request_steering" | "open_follow_up";
};

type RoleContract = {
  id: RoleId;
  version: string;
  lane:
    | "compass"
    | "atlas"
    | "forge"
    | "judge"
    | "harbor"
    | "pulse"
    | "mirror"
    | "spine";
  charter: string[];
  policyCeiling: PolicyLevel;
  allowedProviders?: Array<"claude" | "codex" | "gemini">;
  allowedActions: string[];
  deniedActions: string[];
  requiredInputs: ContractDependency[];
  requiredOutputs: ContractDependency[];
  checkpoints: string[];
  escalationRules: EscalationRule[];
  successSignals: string[];
  failureSignals: string[];
};
```

필수 불변조건:

- 모든 run은 하나의 `RoleContract.id`를 가진다
- policy engine은 `role + action + provider + risk`를 함께 평가한다
- role contract가 없는 run은 `queued`에서 `running`으로 승급하지 않는다

의존성 규칙:

- `artifact`는 [artifact-schema.md](/home/eugene/git/ucm/artifact-schema.md)에 정의된 표준 산출물이다
- `runtime_view`는 scheduler, approval queue, provider seat snapshot처럼 런타임이 만든 읽기 모델이다
- `policy_view`는 tool access, approval state, billing mode처럼 policy engine이 제공하는 상태다
- `memory_view`는 project/procedural/reflection memory query 결과다

## 2. 공통 역할 규칙

- `conductor`만이 workflow 전이를 직접 확정한다
- `builder_agent`는 자기 결과를 최종 승인하지 못한다
- `reviewer_agent`, `qa_agent`, `security_agent`는 구현 주체와 분리된다
- `release_agent`는 approved revision과 release artifact 없이는 승급하지 못한다
- `learning_agent`는 self-improvement를 proposal까지만 만들고 직접 반영하지 못한다
- `ops_agent`가 감지한 운영 이슈는 `conductor`가 새 mission 또는 follow-up run으로 승격한다

## 3. 역할 카탈로그

## 3.1 `conductor`

역할:

- mission 상태기계 진행
- phase 진입/종료 판단
- role 배치, provider seat 배정, follow-up branching

정책 ceiling:

- `L3`

필수 입력:

- `spec_brief`
- `acceptance_checks`
- `decision_record`
- `provider_seat_snapshot`

필수 출력:

- `run_assignment`
- `approval_ticket`
- `steering_packet`

에스컬레이션:

- provider/auth/billing 충돌은 `human` 또는 운영 lane으로 넘긴다
- evidence 부족은 `architect_agent` 또는 `spec_agent`로 되돌린다

## 3.2 `spec_agent`

역할:

- 문제 정의, 비범위, acceptance check 잠금
- ambiguous goal을 실행 가능한 계약으로 변환

정책 ceiling:

- `L1`

필수 입력:

- 사용자 goal
- 기존 project memory
- open questions

필수 출력:

- `spec_brief`
- `acceptance_checks`
- `success_metrics`

에스컬레이션:

- 사용자 의사결정이 필요한 open question은 `human` steering으로 올린다

## 3.3 `research_agent`

역할:

- 리서치, 증거 수집, 출처 정리, 리스크 요약

정책 ceiling:

- `L1`

필수 입력:

- `spec_brief`
- `acceptance_checks`

필수 출력:

- `research_dossier`
- `evidence_log`
- `risk_register`

에스컬레이션:

- 출처 신뢰도 부족 또는 conflicting evidence는 `architect_agent`와 `human` review로 보낸다

## 3.4 `architect_agent`

역할:

- 대안 비교, 구조 선택, ADR 기록, 실행 전략 고정

정책 ceiling:

- `L1`

필수 입력:

- `spec_brief`
- `research_dossier`
- `risk_register`

필수 출력:

- `alternative_set`
- `decision_record`
- `architecture_record`
- `adr_record`
- `task_backlog`

에스컬레이션:

- high-risk tradeoff는 `human` review 또는 `conductor` 재심의로 보낸다

## 3.5 `builder_agent`

역할:

- bounded implementation run 수행
- patch, report, local verification까지 생산

정책 ceiling:

- `L2`

필수 입력:

- `task_backlog`
- `decision_record`
- `acceptance_checks`
- `repository_conventions`

필수 출력:

- `patch_set`
- `run_trace`

에스컬레이션:

- 같은 failure signal 2회 반복 시 `conductor`에 replan 요청
- provider blocker는 운영 blocker로 승격

## 3.6 `reviewer_agent`

역할:

- diff review, spec mismatch 탐지, 회귀 위험 분석

정책 ceiling:

- `L2`

필수 입력:

- `patch_set`
- `decision_record`
- `acceptance_checks`

필수 출력:

- `review_packet`
- `decision_record(category=approval|risk)`

에스컬레이션:

- unresolved risk가 남으면 `needs_review` 또는 `blocked` 유지

## 3.7 `qa_agent`

역할:

- regression, scenario, e2e, acceptance verification 수행

정책 ceiling:

- `L2`

필수 입력:

- `patch_set`
- `acceptance_checks`
- `test_plan`

필수 출력:

- `test_result`
- `evidence_pack`

에스컬레이션:

- flaky 또는 inconclusive 결과는 `warn`으로 두고 `reviewer_agent`에 넘긴다

## 3.8 `security_agent`

역할:

- secret, 권한, 공급망, sandbox, injection 위험 점검

정책 ceiling:

- `L2`

필수 입력:

- `patch_set`
- `dependency_changes`
- `tool_access_policy`

필수 출력:

- `security_report`
- `evidence_pack`

에스컬레이션:

- destructive 또는 data-sensitive risk는 반드시 `human` approval

## 3.9 `release_agent`

역할:

- review-ready 결과를 release-ready packet으로 승급

정책 ceiling:

- `L3`

필수 입력:

- `approved_review_packet`
- `evidence_pack`
- `rollback_plan`

필수 출력:

- `release_manifest`
- `release_notes`
- `handoff_record`

에스컬레이션:

- environment checklist 부족 시 승급 금지

## 3.10 `ops_agent`

역할:

- 운영 이벤트 감시, incident triage, feedback 정리

정책 ceiling:

- `L1`

필수 입력:

- `runtime_events`
- `release_manifest`
- `telemetry_summary`

필수 출력:

- `incident_record`
- `improvement_proposal`

에스컬레이션:

- production-impacting issue는 즉시 `human`과 `conductor`에 알린다

## 3.11 `learning_agent`

역할:

- retrospective, heuristic 갱신안, self-improvement proposal 생성

정책 ceiling:

- `L1`

필수 입력:

- `incident_record`
- `reflection_memory`
- `historical_replay_result`

필수 출력:

- `improvement_proposal`
- `heuristic_update_proposal`

에스컬레이션:

- policy/security/budget 변경안은 자동 반영 금지, `human` review 필수

## 4. 권한 레벨 매핑

- `L0`: read-only, 검색, 문서/로그 조회
- `L1`: planning/research, spec/research/design artifact 생성
- `L2`: repo-local execution, patch/test/report 생성
- `L3`: review/approval/release orchestration
- `L4`: human approval required, production/destructive action

역할별 기본 ceiling:

- `conductor`, `release_agent`: `L3`
- `builder_agent`, `reviewer_agent`, `qa_agent`, `security_agent`: `L2`
- `spec_agent`, `research_agent`, `architect_agent`, `ops_agent`, `learning_agent`: `L1`

`L4`는 역할 ceiling이 아니라 항상 사람 승인으로만 열린다.

## 5. 파일 배치 규약

권장 저장 경로:

```text
roles/
  contracts/
    conductor.yaml
    spec_agent.yaml
    research_agent.yaml
    architect_agent.yaml
    builder_agent.yaml
    reviewer_agent.yaml
    qa_agent.yaml
    security_agent.yaml
    release_agent.yaml
    ops_agent.yaml
    learning_agent.yaml
  assignments/
    <missionId>/
      <runId>.json
  events.jsonl
```

YAML 예시:

```yaml
id: builder_agent
version: 1
lane: forge
policyCeiling: L2
allowedProviders: [codex, claude, gemini]
allowedActions:
  - read_repo
  - edit_repo
  - run_tests
deniedActions:
  - approve_revision
  - deploy_production
requiredInputs:
  - kind: task_backlog
    required: true
    freshness: latest_phase
requiredOutputs:
  - kind: patch_set
    required: true
  - kind: run_trace
    required: true
```

## 6. 현재 코드와의 연결점

직접 연결되는 위치:

- `ucm-desktop/src/shared/contracts.ts`
- `ucm-desktop/src/main/runtime.ts`
- `ucm-desktop/src/main/runtime-policy.ts`
- `ucm-desktop/src/main/runtime-scheduler.ts`

우선 필요한 확장:

- `RunDetail.roleContractId`
- role registry loader
- policy input에 `roleContractId`, `policyCeiling`, `requiredInputs` 추가
- review/approval 시 `actorRole` provenance 저장

추천 모듈:

```text
ucm-desktop/src/main/
  runtime-role-registry.ts
  runtime-role-assignment.ts
```

## 7. 구현 순서

1. `conductor`, `builder_agent`, `reviewer_agent`, `qa_agent`부터 도입
2. run 생성 시 `roleContractId`를 필수화
3. approval / release lane에 role separation 적용
4. 이후 `ops_agent`, `learning_agent`를 daemon mode에 연결

## 8. 요약

UCM에서 역할은 “누가 말하느냐”가 아니라 “누가 어떤 증거와 권한으로 무엇을 넘기느냐”다.

- 역할 계약이 있어야 policy가 집행되고
- 입력/출력이 있어야 workflow가 닫히고
- escalation 규칙이 있어야 LLM이 억지로 우기지 않게 된다
