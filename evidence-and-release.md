# UCM Evidence And Release

기준일: 2026-03-24

## 0. 목적

이 문서는 UCM에서 무엇이 review-ready이며, 무엇이 approval-ready이며, 무엇이 completion-ready인지 정의한다.

핵심 원칙:

- 코드 diff는 증거가 아니다
- review packet은 evidence를 요약한 전달물이다
- approval은 최신 revision에 대한 판단이다
- completion은 승인된 revision과 handoff가 있을 때만 가능하다

이 문서는 [workflow-spec.md](/home/eugene/git/ucm/workflow-spec.md), [policy-model.md](/home/eugene/git/ucm/policy-model.md), [runtime-state-machine.md](/home/eugene/git/ucm/runtime-state-machine.md)를 보완한다.

## 1. 핵심 객체

## 1.1 ArtifactRecord

현재 runtime 기준 artifact는 아래 타입을 가진다.

- `diff`
- `report`
- `test_result`
- `handoff`

vNext 원칙:

- 모든 artifact는 run에 귀속된다
- artifact는 provenance가 있어야 한다
- artifact는 evidence pack에 선택적으로 편입된다

## 1.2 Deliverable

deliverable은 사람이 검토하거나 승인하는 전달물이다.

현재 종류:

- `review_packet`
- `release_brief`
- `merge_handoff`
- `deployment_note`

현재 desktop runtime은 사실상 `review_packet`을 중심으로 동작한다.

## 1.3 DeliverableRevision

revision은 deliverable의 검토 단위다.

상태:

- `active`
- `approved`
- `superseded`

규칙:

- revision은 `basedOnArtifactIds`를 반드시 가진다
- 승인 가능한 건 `active` revision뿐이다
- 새 revision이 생성되면 이전 `active`는 `superseded`

## 1.4 EvidencePack

EvidencePack은 승급 근거를 구조화한 객체다.

```ts
type EvidenceCheck = {
  name: string;
  status: "pass" | "warn" | "fail";
  summary: string;
  artifactIds?: string[];
};

type EvidencePack = {
  id: string;
  missionId: string;
  runId: string;
  decision:
    | "insufficient"
    | "promote_to_review"
    | "promote_to_release_brief"
    | "promote_to_completion";
  checks: EvidenceCheck[];
  artifactIds: string[];
  riskSummary: string[];
  openQuestions: string[];
  generatedAt: string;
};
```

## 2. 승급 단계

## 2.1 Execution-ready

필수 조건:

- acceptance checks 정의
- active phase objective 연결
- provider seat healthy
- budget 여유

없으면 실행 금지다.

## 2.2 Review-ready

필수 조건:

- 최신 revision 존재
- 최소 1개 이상의 material artifact 존재
- evidence pack decision이 `promote_to_review`
- verifier 또는 동등한 review lane이 evidence를 확인

보통 조합:

- `diff + test_result + review_packet`
- `report + review_packet`

금지:

- diff만 있고 evidence 없음
- human steer 요청만 있고 검증 없음

## 2.3 Approval-ready

필수 조건:

- review-ready revision 존재
- approval queue에 올릴 active revision 존재
- policy가 approval lane을 허용
- same-provider self-approval 아님

현재 desktop flow와의 연결:

- `handoffDeliverableInState()`가 `review_requested`를 발생시킨다
- `approveDeliverableRevisionInState()`가 revision을 `approved`로 바꾸고 run을 `completed`로 만든다

## 2.4 Completion-ready

필수 조건:

- approved revision 존재
- 승인 revision을 가리키는 approved handoff 존재
- mission success criteria가 충족

completion은 단순히 test가 통과한 상태가 아니다.  
사람 또는 정책 승인까지 닫혀야 한다.

## 3. Evidence Gate 규칙

## 3.1 기본 규칙

- `no evidence, no promotion`
- `no acceptance checks, no non-trivial execution`
- `no verifier separation, no high-confidence review`
- `no latest revision, no approval`

## 3.2 체크 목록

최소 evidence check 예시:

- `acceptance_checks_defined`
- `latest_artifact_present`
- `tests_executed`
- `risk_reviewed`
- `decision_record_present`
- `deliverable_revision_current`
- `same_provider_self_approval_blocked`

## 3.3 상태별 gate

### `running -> needs_review`

허용 조건:

- `EvidencePack.decision=promote_to_review`
- latest revision이 active
- approval packet 생성 가능

### `needs_review -> completed`

허용 조건:

- approved revision 존재
- approval event 존재
- mission completion policy 통과

### `blocked -> running`

허용 조건:

- blocker 해소
- 필요한 steering/evidence 누적
- 같은 실패 패턴 반복 금지

## 4. Evidence delta

run이 실제로 진척 중인지 확인하기 위한 지표다.

### 증가로 인정되는 것

- 새로운 acceptance check 정의
- 새 `DecisionRecord`
- 새 `ArtifactRecord`
- 새 `EvidenceCheck(pass|warn)`
- 새 `DeliverableRevision`
- open risk 감소

### 증가로 인정되지 않는 것

- terminal output만 증가
- 동일 patch 재생성
- 같은 blocker 반복 보고
- revision summary만 wording 변경

### governor 규칙

- 2회 연속 evidence delta 0이면 deliberation 재개
- 1회라도 risk 증가 + evidence delta 0이면 즉시 zoom-out checkpoint

## 5. Review packet 규칙

review packet은 사람이 빠르게 판단할 수 있어야 한다.

필수 섹션:

- 목표와 phase
- 현재 선택안과 이유
- 최신 artifact 요약
- test / verification 결과
- open risk
- 필요한 승인 또는 steer

현재 desktop UI의 Review 화면과 맞추면 아래가 기본 축이다.

- summary
- verification signal
- delivery packet
- approval queue
- deliverable history

## 6. Approval 규칙

## 6.1 승인 가능한 주체

- human reviewer
- future policy-controlled reviewer

## 6.2 금지 규칙

- implementer가 자기 revision 최종 승인 금지
- proposer/provider와 reviewer/provider가 동일한 경우 high-risk approval 금지
- superseded revision 승인 금지

## 6.3 승인 결과

승인 시:

- revision -> `approved`
- 해당 handoff -> `approved`
- run -> `completed`
- run event `completed(source=approval)`
- mission은 completion 판단으로 이동

거절 시:

- 현재 revision 유지 또는 supersede
- 새 deliberation / execution / verification run 생성 가능
- rejection reason은 decision record로 저장

## 7. Release abstraction

현재 desktop runtime은 deployment까지 구현하지 않았지만, 구조는 미리 잡아둔다.

승급 계층:

```text
review_packet
  → release_brief
  → merge_handoff
  → deployment_note
```

각 단계는 이전 단계의 approved evidence를 가져야 한다.

### `review_packet -> release_brief`

조건:

- code/test evidence 충분
- release risk 요약 존재
- rollback note 존재

### `release_brief -> merge_handoff`

조건:

- merge 조건 충족
- branch/worktree provenance 존재
- integration risk 확인

### `merge_handoff -> deployment_note`

조건:

- release policy 통과
- environment checklist 충족
- 운영 모니터링 포인트 정의

## 8. Evidence storage 규칙

- evidence pack은 append-only로 저장
- 각 evidence check는 artifact id를 참조 가능해야 한다
- revision과 evidence pack은 직접 연결 가능해야 한다
- approval decision은 review packet summary가 아니라 structured decision으로 남긴다

## 9. 현재 코드와의 연결점

직접 연결되는 구현 지점:

- `ucm-desktop/src/main/runtime-run-helpers.ts`
- `ucm-desktop/src/main/runtime-mutations.ts`
- `ucm-desktop/src/main/runtime-conductor.ts`
- `ucm-desktop/src/renderer/app.tsx`

가장 먼저 필요한 확장:

- `EvidencePack` 타입 추가
- revision 생성 시 evidence reference 저장
- approval 시 evidence completeness 검증
- review UI에서 `active revision` 외에 `evidence status` 노출

## 10. 구현 우선순위

1. `EvidencePack` 타입과 저장 추가
2. review promotion 전 evidence gate 구현
3. approval 전에 gate 검증 추가
4. review UI에 evidence summary 표시
5. future release deliverable kinds 확장

## 11. 요약

UCM에서 review와 completion은 감각으로 판단하면 안 된다.

- artifact
- evidence pack
- active revision
- approval
- handoff

이 다섯 단계가 구조화되어야 한다.
