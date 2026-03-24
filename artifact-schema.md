# UCM Artifact Schema

기준일: 2026-03-24

## 0. 목적

이 문서는 UCM vNext에서 phase를 통과시키는 표준 산출물의 최소 스키마를 정의한다.

이 문서는 다음 문서를 보완한다.

- [workflow-spec.md](/home/eugene/git/ucm/workflow-spec.md)
- [evidence-and-release.md](/home/eugene/git/ucm/evidence-and-release.md)
- [storage-and-provenance.md](/home/eugene/git/ucm/storage-and-provenance.md)
- [role-contracts.md](/home/eugene/git/ucm/role-contracts.md)

핵심 원칙:

- phase는 상태 전이만으로 끝나지 않고 최소 산출물을 남겨야 한다
- 산출물은 요약과 본문을 분리할 수 있어야 한다
- 모든 산출물은 provenance를 가진다
- review/approval/completion은 artifact graph를 따라 검증 가능해야 한다

## 1. 공통 envelope

```ts
type ArtifactKind =
  | "spec_brief"
  | "acceptance_checks"
  | "success_metrics"
  | "research_dossier"
  | "evidence_log"
  | "risk_register"
  | "alternative_set"
  | "decision_record"
  | "architecture_record"
  | "adr_record"
  | "task_backlog"
  | "run_trace"
  | "patch_set"
  | "test_result"
  | "security_report"
  | "review_packet"
  | "evidence_pack"
  | "deliverable_revision"
  | "handoff_record"
  | "release_manifest"
  | "rollback_plan"
  | "incident_record"
  | "improvement_proposal";

type ArtifactEnvelope = {
  id: string;
  kind: ArtifactKind;
  missionId: string;
  runId?: string;
  phase:
    | "intake"
    | "deliberation"
    | "decision_freeze"
    | "execution"
    | "verification"
    | "review"
    | "promotion"
    | "ops"
    | "improvement";
  path: string;
  format: "json" | "yaml" | "md" | "jsonl" | "diff";
  summary: string;
  relatedArtifactIds?: string[];
  createdAt: string;
  createdBy: {
    actorType: "human" | "system" | "agent" | "policy_worker";
    actorId: string;
    roleId?: string;
    provider?: "claude" | "codex" | "gemini";
    seatId?: string;
  };
};
```

공통 규칙:

- `summary`는 UI와 review queue에 바로 노출 가능해야 한다
- 큰 body는 별도 파일로 두고 envelope는 index처럼 사용한다
- `relatedArtifactIds`로 upstream/downstream graph를 형성한다

## 2. 계획/설계 산출물

## 2.1 `spec_brief`

```ts
type SpecBrief = {
  title: string;
  problem: string;
  targetUsers: string[];
  jobsToBeDone: string[];
  goals: string[];
  nonGoals: string[];
  constraints: string[];
  openQuestions: string[];
};
```

## 2.2 `acceptance_checks`

```ts
type AcceptanceCheck = {
  id: string;
  description: string;
  blocking: boolean;
  verificationMethod: "test" | "review" | "metric" | "manual";
  severity: "must" | "should" | "nice_to_have";
};

type AcceptanceCheckSet = {
  checks: AcceptanceCheck[];
};
```

## 2.3 `success_metrics`

```ts
type SuccessMetrics = {
  metrics: Array<{
    name: string;
    target: string;
    measurementWindow?: string;
  }>;
};
```

## 2.4 `research_dossier`

```ts
type ResearchDossier = {
  question: string;
  findings: string[];
  sourceIds: string[];
  confidence: "low" | "medium" | "high";
  updatedAt: string;
};
```

## 2.5 `evidence_log`

```ts
type EvidenceLogEntry = {
  id: string;
  claim: string;
  source: string;
  capturedAt: string;
  confidence: "official" | "observed" | "inferred";
};
```

## 2.6 `risk_register`

```ts
type RiskRegister = {
  risks: Array<{
    id: string;
    summary: string;
    severity: "low" | "medium" | "high";
    mitigation?: string;
    ownerRole?: string;
  }>;
};
```

## 2.7 `alternative_set`

```ts
type AlternativeSet = {
  options: Array<{
    id: string;
    title: string;
    summary: string;
    pros: string[];
    cons: string[];
    estimatedCost?: string;
    estimatedRisk?: string;
  }>;
  rejectedOptionIds?: string[];
};
```

## 2.8 `decision_record`

현재 runtime의 `DecisionRecord`를 확장 가능한 기본형으로 유지한다.

```ts
type DecisionRecord = {
  id: string;
  category: "planning" | "technical" | "risk" | "approval" | "orchestration";
  summary: string;
  rationale: string;
};
```

추천 확장 필드:

- `chosenAlternativeId`
- `rejectedAlternativeIds`
- `relatedRiskIds`

## 2.9 `architecture_record`

```ts
type ArchitectureRecord = {
  systemContext: string;
  majorComponents: string[];
  criticalFlows: string[];
  constraints: string[];
};
```

## 2.10 `adr_record`

```ts
type AdrRecord = {
  title: string;
  status: "proposed" | "accepted" | "superseded";
  context: string;
  decision: string;
  consequences: string[];
};
```

## 2.11 `task_backlog`

```ts
type TaskBacklog = {
  tasks: Array<{
    id: string;
    title: string;
    objective: string;
    ownerRole?: string;
    dependsOn?: string[];
    expectedArtifacts?: ArtifactKind[];
  }>;
};
```

## 3. 실행/검증 산출물

## 3.1 `run_trace`

```ts
type RunTrace = {
  runId: string;
  objective: string;
  checkpoints: Array<{
    at: string;
    summary: string;
    toolCalls?: number;
    evidenceDelta?: number;
  }>;
};
```

## 3.2 `patch_set`

현재 runtime의 `ArtifactRecord(type=diff)`에 대응한다.

```ts
type PatchSet = {
  files: Array<{
    path: string;
    summary?: string;
    patch: string;
  }>;
};
```

## 3.3 `test_result`

현재 runtime의 `ArtifactRecord(type=test_result)`에 대응한다.

```ts
type TestResult = {
  suite: string;
  outcome: "pass" | "warn" | "fail";
  summary: string;
  commands?: string[];
};
```

## 3.4 `security_report`

```ts
type SecurityReport = {
  outcome: "pass" | "warn" | "fail";
  findings: string[];
  requiredApprovals?: string[];
};
```

## 3.5 `review_packet`

```ts
type ReviewPacket = {
  summary: string;
  selectedApproach: string;
  artifactIds: string[];
  evidencePackIds: string[];
  openRisks: string[];
  requestedAction: "review" | "approve" | "steer";
};
```

## 3.6 `evidence_pack`

현재 runtime의 `EvidencePack`을 기본형으로 쓴다.

```ts
type EvidenceCheck = {
  name: string;
  status: "pass" | "warn" | "fail";
  summary: string;
  artifactIds?: string[];
};

type EvidencePack = {
  id: string;
  decision: "insufficient" | "promote_to_review" | "promote_to_completion";
  checks: EvidenceCheck[];
  artifactIds: string[];
  generatedAtLabel: string;
};
```

추천 확장 필드:

- `missionId`
- `runId`
- `riskSummary`
- `openQuestions`

## 4. 승급/운영 산출물

## 4.1 `deliverable_revision`

현재 runtime의 `DeliverableRevisionRecord`를 envelope로 감싼다.

```ts
type DeliverableRevisionEnvelope = {
  deliverableId: string;
  revisionId: string;
  revision: number;
  summary: string;
  status: "active" | "approved" | "superseded";
  basedOnArtifactIds: string[];
  evidencePackIds: string[];
};
```

## 4.2 `handoff_record`

현재 runtime의 `HandoffRecord`를 사용한다.

```ts
type HandoffRecord = {
  id: string;
  deliverableRevisionId: string;
  channel: "inbox" | "export" | "share";
  target?: string;
  createdAtLabel: string;
  status: "active" | "approved" | "superseded";
};
```

## 4.3 `release_manifest`

```ts
type ReleaseManifest = {
  versionLabel: string;
  artifactIds: string[];
  environment: string;
  rollbackPlanId: string;
  checklist: string[];
};
```

## 4.4 `rollback_plan`

```ts
type RollbackPlan = {
  steps: string[];
  triggers: string[];
  ownerRole?: string;
};
```

## 4.5 `incident_record`

```ts
type IncidentRecord = {
  id: string;
  severity: "sev4" | "sev3" | "sev2" | "sev1";
  summary: string;
  signals: string[];
  relatedArtifactIds?: string[];
};
```

## 4.6 `improvement_proposal`

```ts
type ImprovementProposal = {
  id: string;
  scope: "product" | "prompt" | "workflow" | "policy" | "routing";
  hypothesis: string;
  expectedImpact: string;
  requiredEvals: string[];
};
```

## 5. 경로 규약

mission 단위 저장 경로는 아래를 기본으로 한다.

```text
artifacts/missions/<missionId>/
  spec/
  research/
  design/
  plan/
  runs/<runId>/
  evals/
  release/
  ops/
  improvements/
  memory/
  policies/
```

파일명 규칙:

- human-facing narrative는 `.md`
- structured contract는 `.json` 또는 `.yaml`
- append log는 `.jsonl`
- patch는 `.diff`

## 6. phase 통과 최소 조합

- `Mission Intake` 종료:
  - `spec_brief`
  - `acceptance_checks`
- `Deliberation` 종료:
  - `research_dossier`
  - `alternative_set`
  - `decision_record`
- `Execution` 종료:
  - `run_trace`
  - `patch_set` 또는 `report`
- `Verification` 종료:
  - `test_result`
  - `evidence_pack`
- `Review / Promotion` 종료:
  - `review_packet`
  - `deliverable_revision`
  - `handoff_record`

## 7. 현재 코드와의 연결점

이미 존재하는 타입:

- `DecisionRecord`
- `EvidencePack`
- `ArtifactRecord`
- `DeliverableRevisionRecord`
- `HandoffRecord`
- `RunDetail`

직접 연결되는 위치:

- `ucm-desktop/src/shared/contracts.ts`
- `ucm-desktop/src/main/runtime-run-helpers.ts`
- `ucm-desktop/src/main/runtime-evidence.ts`
- `ucm-desktop/src/renderer/app.tsx`

우선 필요한 확장:

- `AlternativeSet` 타입 추가
- `AcceptanceCheckSet` 타입 추가
- artifact envelope/provenance 저장 추가
- review packet body와 summary 분리
- release / incident / improvement artifact kind 추가

## 8. 구현 순서

1. 기존 `ArtifactRecord`에 `kind/path/provenance`를 얹을 수 있는 envelope 도입
2. `acceptance_checks`, `alternative_set`, `review_packet` 스키마 추가
3. revision과 evidence를 직접 연결
4. release/ops/improvement artifacts 확장

## 9. 요약

UCM에서 산출물은 단순 파일 덤프가 아니라 workflow의 계약이다.

- 누가 만들었는지 추적 가능해야 하고
- 다음 phase가 그대로 읽을 수 있어야 하며
- review, approval, replay가 artifact graph만으로 재구성 가능해야 한다
