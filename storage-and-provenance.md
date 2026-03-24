# UCM Storage And Provenance

기준일: 2026-03-24

## 0. 목적

이 문서는 UCM vNext에서 무엇을 어디에 저장하고, 어떤 이력을 append-only로 남기며, 무엇을 runtime snapshot으로 다룰지 정의한다.

핵심 원칙:

- 모델 컨텍스트는 상태 저장소가 아니다
- snapshot과 event log는 분리한다
- approval, billing, auth, quota는 provenance 대상이다
- heuristic과 운영 경험은 queryable memory로 남겨야 한다

## 1. 현재 상태

현재 `ucm-desktop`은 단일 JSON snapshot에 가깝다.

- `runtime-state.json`
- `RuntimeStore`
- `MemoryRuntimeStore`

이 구조는 MVP에는 충분하지만, 아래 문제를 가진다.

- event replay가 어렵다
- provider seat 이력 추적이 어렵다
- approval / billing / auth 변경 감사를 남기기 어렵다
- heuristic과 runtime state가 분리되지 않는다

따라서 vNext는 `snapshot + event log + domain stores`로 나눈다.

## 2. 저장 계층

## 2.1 Runtime Snapshot Store

역할:

- 현재 UI가 읽는 최신 상태 제공
- 빠른 hydrate
- 앱 재시작 시 즉시 복구

예시 파일:

```text
~/.ucm-desktop/runtime/runtime-state.json
```

포함:

- active workspace / mission / run
- mission summaries
- latest run summaries
- provider seat latest view
- approval queue latest view

비포함:

- 장기 append-only event 전체
- 오래된 terminal transcript 전체
- heuristic history 전체

## 2.2 Event Store

역할:

- 상태 전이의 원인을 append-only로 기록
- replay, audit, analytics 지원

예시 파일:

```text
~/.ucm-desktop/runtime/events/YYYY/MM/DD/runtime-events.jsonl
```

레코드 예시:

```json
{
  "id": "evt-123",
  "ts": "2026-03-24T01:23:45.000Z",
  "kind": "run.blocked",
  "missionId": "m-1",
  "runId": "r-1",
  "previousState": "running",
  "nextState": "blocked",
  "reason": "provider_reauth_required",
  "provider": "claude",
  "seatId": "claude-cli-main"
}
```

## 2.3 Artifact Store

역할:

- patch, report, test output, review packet body 저장

예시 구조:

```text
~/.ucm-desktop/artifacts/
  missions/<missionId>/
    runs/<runId>/
      artifacts/<artifactId>.json
      evidence/<evidencePackId>.json
      revisions/<revisionId>.json
```

규칙:

- 큰 payload는 snapshot에 넣지 않는다
- snapshot에는 summary와 id만 둔다
- artifact 원본은 별도 저장소에 둔다

## 2.4 Provider Ledger

역할:

- Codex / Claude / Gemini seat 건강도, quota 관측치, auth 이력 저장

예시 구조:

```text
~/.ucm-desktop/providers/
  seats.json
  ledger.jsonl
```

포함:

- seat inventory
- current auth state
- observed window resets
- denial / cooldown / reauth events
- billing mode changes

## 2.5 Approval Store

역할:

- approval ticket, review decision, billing override 추적

예시 구조:

```text
~/.ucm-desktop/approvals/
  tickets.json
  decisions.jsonl
```

## 2.6 Heuristic Store

역할:

- heuristic card 저장
- 성공/실패 예 누적
- context query 지원

예시 구조:

```text
~/.ucm-desktop/heuristics/
  cards/
    <heuristicId>.json
  events.jsonl
```

## 2.7 Terminal Transcript Store

역할:

- 긴 terminal output를 snapshot에서 분리
- 필요 시 review와 debugging에 사용

예시 구조:

```text
~/.ucm-desktop/transcripts/
  <sessionId>.log
```

## 2.8 Memory Layers

메모리는 한 덩어리 저장소가 아니라 성격이 다른 층으로 나눈다.

### Working Memory

- 현재 run의 즉시 컨텍스트
- 휘발성이 강하고 snapshot 친화적
- 자동 기록 가능

### Project Memory

- 프로젝트 요구사항, 규칙, ADR, 도메인 요약
- 비교적 안정적이며 검증 후 승격한다

### Evidence Memory

- 리서치 출처, 실험 결과, 운영 관측치
- append-friendly 하며 provenance가 중요하다

### Procedural Memory

- 스킬, 런북, heuristic, failure pattern
- 성공/실패 사례를 누적하되 query 가능해야 한다

### Reflection Memory

- retrospective, postmortem, improvement proposal, replay 결과
- runtime state와 분리해서 장기 축적한다

쓰기 규칙:

- `Working`과 `Evidence`는 자동 기록 가능
- `Project`와 `Procedural`은 검증/승격 후 반영
- `Policy`와 `Security` 관련 기억은 human approval 없이는 승격하지 않는다

## 3. 저장 단위 정의

## 3.1 Snapshot

특징:

- mutable
- latest view
- 빠른 읽기용

예시:

- active mission
- provider window summary
- review queue summary

## 3.2 Event

특징:

- append-only
- immutable
- why를 남김

예시:

- `run.started`
- `run.blocked`
- `provider.quota_exhausted`
- `provider.reauth_required`
- `deliverable.revision_approved`
- `billing.override_requested`

## 3.3 Artifact

특징:

- run 산출물
- evidence source
- summary와 body 분리 가능

## 3.4 Memory Item

특징:

- heuristic, failure pattern, successful pattern
- runtime state와 분리

## 4. Provenance 필수 필드

고위험 또는 중요한 레코드는 아래 필드를 가진다.

```ts
type ProvenanceFields = {
  createdAt: string;
  createdBy: {
    actorType: "human" | "system" | "provider" | "policy_worker";
    actorId: string;
  };
  missionId?: string;
  runId?: string;
  provider?: "codex" | "claude" | "gemini";
  seatId?: string;
  sourceEventId?: string;
  sourceEventKind?: string;
  relatedArtifactIds?: string[];
};
```

## 5. provider seat 저장 모델

```ts
type ProviderSeatRecord = {
  id: string;
  vendor: "codex" | "claude" | "gemini";
  surface: "cli" | "ide" | "web" | "app" | "cloud";
  accountLabel: string;
  billingMode: "subscription_only" | "allow_metered_fallback" | "metered_only";
  authState: "healthy" | "reauth_required" | "misconfigured";
  status: "ready" | "busy" | "cooldown" | "unavailable";
  sharedScopes: string[];
  windows: Array<{
    kind: "five_hour" | "seven_day" | "daily" | "per_minute" | "concurrency";
    limit?: number;
    used?: number;
    resetAt?: string;
    confidence: "official" | "observed" | "inferred";
  }>;
  lastObservedAt: string;
};
```

추가 규칙:

- `sharedScopes`는 surface 간 allowance 공유를 표현한다
- quota 숫자가 없더라도 window 존재는 저장한다
- 관측 기반 reset 시각은 append-only ledger에도 남긴다

## 6. Evidence / Revision 연결 모델

revision은 artifact와 evidence를 같이 참조해야 한다.

```ts
type RevisionEnvelope = {
  revisionId: string;
  missionId: string;
  runId: string;
  deliverableId: string;
  basedOnArtifactIds: string[];
  evidencePackIds: string[];
  approvalTicketId?: string;
};
```

이렇게 해야 review packet이 단순 summary text가 아니라 검증 가능한 envelope가 된다.

## 7. Storage layout 제안

```text
~/.ucm-desktop/
  runtime/
    runtime-state.json
    events/
      YYYY/
        MM/
          DD/
            runtime-events.jsonl
  artifacts/
    missions/
      <missionId>/
        runs/
          <runId>/
            artifacts/
            evidence/
            revisions/
  providers/
    seats.json
    ledger.jsonl
  approvals/
    tickets.json
    decisions.jsonl
  heuristics/
    cards/
    events.jsonl
  transcripts/
    <sessionId>.log
```

operator-friendly artifact tree는 mission 단위로 아래 형태를 권장한다.

```text
~/.ucm-desktop/artifacts/
  missions/
    <missionId>/
      spec/
        brief.md
        acceptance.yaml
        success-metrics.yaml
      research/
        dossier.md
        evidence.jsonl
        risks.md
      design/
        architecture.md
        alternatives.md
        adr/
      plan/
        backlog.json
      runs/
        <runId>/
          trace.json
          artifacts/
          patches/
          evidence/
          review/
      evals/
        regression/
        security/
      release/
        manifest.yaml
        notes.md
        rollback-plan.md
      ops/
        incidents/
        postmortem.md
      improvements/
        proposal.md
      memory/
        project.md
        reflection.md
      policies/
        tool-access.yaml
```

의도:

- runtime ledger와 사람이 읽는 artifact tree를 함께 유지한다
- phase별 책임 산출물이 어디에 쌓이는지 예측 가능해야 한다
- review, replay, audit, handoff가 경로 규약만으로도 동작할 수 있어야 한다

## 8. Retention 정책

## 8.1 Snapshot

- 마지막 상태만 유지
- corruption 대비 backup 1~3개 유지 가능

## 8.2 Event logs

- append-only 유지
- 월 단위 압축 가능
- 삭제 대신 archive 우선

## 8.3 Transcripts

- 크기가 크므로 rotation 필요
- summary만 snapshot에 남기고 full log는 파일로 둔다

## 8.4 Heuristic / failure history

- 장기 보존
- 오래된 예시는 archive 가능하되 card summary는 유지

## 9. Query 패턴

저장 구조는 아래 query를 지원해야 한다.

- 현재 active mission은 무엇인가
- 왜 이 run이 blocked 상태가 되었는가
- 이 approval은 어떤 evidence와 연결되는가
- Claude seat가 언제부터 reauth_required였는가
- 최근 7일 동안 어떤 heuristic failure가 반복되었는가

## 10. 구현 단계

## 10.1 Phase 1

- 기존 `runtime-state.json` 유지
- event log JSONL 추가
- provider ledger JSON 추가

## 10.2 Phase 2

- artifact/evidence/revision 외부 파일화
- approval store 추가
- transcript store 분리

## 10.3 Phase 3

- heuristic store 추가
- replay / audit query 도구 추가
- snapshot rehydration 고도화

## 11. 현재 코드와의 연결점

직접 연결되는 위치:

- `ucm-desktop/src/main/runtime-store.ts`
- `ucm-desktop/src/main/runtime.ts`
- `ucm-desktop/src/main/runtime-run-helpers.ts`
- `ucm-desktop/src/main/runtime-mutations.ts`
- `ucm-desktop/src/main/execution-service.ts`

우선 필요한 코드 작업:

- `RuntimeStore`에 append-only event writer 추가
- terminal transcript를 별도 파일에 저장
- provider seat snapshot과 ledger 추가
- artifact body 외부 저장 지원

## 12. 요약

UCM은 durable runtime을 지향하므로 저장 구조도 단순 JSON 한 장으로 끝나면 안 된다.

- latest state는 snapshot
- 이유와 이력은 event log
- 실행 산출물은 artifact store
- 정액제 seat 제약은 provider ledger
- 승인과 override는 approval store
- 암묵지는 heuristic store

이렇게 분리되어야 provider cap, auth 문제, review 이력, self-improvement까지 모두 추적 가능해진다.
