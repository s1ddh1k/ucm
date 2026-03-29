# Cache-Local Execution Spec

기준일: 2026-03-30

## 0. 목적

이 문서는 UCM의 `Cache-Local Execution` 원칙을 실제 런타임/API/저장 구조 수준으로 내린 기술 스펙이다.

목표는 세 가지다.

1. 같은 mission/phase 맥락을 매 run마다 풀프롬프트로 다시 먹지 않게 만든다.
2. durable runtime과 provider session reuse를 함께 가져간다.
3. self-improvement 루프에서도 token, latency, cache locality를 공식 메트릭으로 다룬다.

이 문서는 현재 구현을 바로 바꾸는 패치가 아니라, 이후 타입/IPC/runtime/store 작업의 기준선이다.

이 스펙의 직접적인 1차 목적은 장기 플랫폼 완성이 아니라, 아래 제품 목표를 지원하는 것이다.

- UCM 자신의 repo에서 `implementation` run의 prompt token을 줄인다
- review 품질은 유지하거나 개선한다
- human steering과 blocker 재시도를 줄인다

## 1. 설계 목표

### 1.1 해결하려는 문제

현재 UCM은 상태 durability는 강하지만 context locality는 약하다.

- run마다 prompt를 새로 조립한다
- provider 세션을 대부분 ephemeral로 쓴다
- handoff가 transcript보다 artifact 중심으로 정규화되어 있지 않다
- 같은 repo/phase/objective를 여러 role이 반복해서 다시 설명받는다

이 구조는 self-improvement 루프를 붙일수록 비용이 커진다.

### 1.2 목표 상태

최종적으로 실행은 아래 순서를 따른다.

```text
stable prompt prefix
  + context bundle refs
  + delta context
  + current objective
  -> provider session / session lease
  -> artifact outputs
  -> next run reads refs, not full transcript
```

### 1.3 1차 성공 기준

이 스펙의 1차 성공은 아래면 충분하다.

- `implementation` run에서 full prompt replay 빈도가 줄어든다
- 같은 품질에서 `estimatedPromptTokens`가 줄어든다
- best-effort session reuse가 일부 run family에서 동작한다
- 이 변화가 기존 `mission/run/release` 흐름을 깨지 않는다

## 2. 비목표

이 스펙은 아래를 직접 정의하지 않는다.

- provider별 실제 KV cache 구현 세부
- OpenAI/Claude/Gemini별 wire protocol 차이
- 최종 benchmark scoring 공식
- self-improvement promotion policy 전체

여기서는 UCM 내부 인터페이스와 저장 구조만 정의한다.

## 2.1 실용적 적용 원칙

이 스펙은 최종 형태를 설명하지만, 구현은 아래 원칙으로 좁혀서 진행해야 한다.

- 처음부터 모든 타입, 테이블, IPC를 다 만들지 않는다
- 먼저 optional field와 in-memory 상태로 효과를 본다
- 하나의 run family에서 유의미한 개선이 확인되기 전에는 범용 abstraction으로 올리지 않는다
- 기존 `mission/run/release` 흐름을 깨지 않는 additive change만 먼저 허용한다
- 삭제가 쉬운 얇은 경로를 먼저 만들고, durable화는 나중에 한다

## 2.2 v1 범위

첫 적용 범위는 아래로 제한하는 것이 맞다.

- provider: `codex` 우선, 필요시 `claude`
- role: `implementation` run 우선
- phase: `Execution` 우선
- prompt assembly mode: `artifact_refs_with_delta` 한 종류 우선
- metric: `estimatedPromptTokens`, `reusedSession`, `localityScore` 정도만 우선

v1에서 하지 않을 것:

- 모든 role에 대한 session affinity
- verifier/reviewer까지 포함한 전면 확장
- 신규 대형 SQLite 테이블 전부 동시 도입
- prompt cache 전용 범용 엔진
- `learning_agent`나 candidate pipeline 전체를 이 문서 하나로 해결하려 하지 않음

## 3. 핵심 개념

## 3.1 ContextRef

다음 run이 읽을 수 있는 정규화된 문맥 참조다.

```ts
type ContextRefKind =
  | "artifact"
  | "decision"
  | "deliverable_revision"
  | "mission_brief"
  | "phase_bundle"
  | "run_trace"
  | "steering_packet"
  | "heuristic_card"
  | "context_bundle";

type ContextRef = {
  id: string;
  kind: ContextRefKind;
  refId: string;
  missionId: string;
  runId?: string;
  freshness: "latest_phase" | "latest_run" | "pinned";
  summary: string;
  tokenEstimate?: number;
};
```

핵심 원칙:

- run은 transcript 전체가 아니라 `ContextRef[]`를 입력으로 받는다
- `summary`는 prompt inline에 들어갈 최소 설명이고, 본문은 artifact store에서 읽는다

## 3.2 DeltaContext

직전 실행 이후 바뀐 것만 담는 얇은 컨텍스트다.

```ts
type DeltaContext = {
  sinceRunId?: string;
  changedArtifactIds: string[];
  changedDecisionIds: string[];
  changedRiskIds?: string[];
  changedSteeringIds?: string[];
  summary: string;
};
```

## 3.3 ContextBundle

반복적으로 같이 쓰는 문맥 묶음이다.

```ts
type ContextBundle = {
  id: string;
  missionId: string;
  phaseId?: string;
  title: string;
  contextRefIds: string[];
  prefixHash: string;
  version: number;
  createdAt: string;
};
```

용도:

- phase 공통 prefix 고정
- replay / shadow run에서 동일 prefix 재현
- provider cache hit locality 향상

## 3.4 SessionLease

provider session을 런타임 객체로 다루기 위한 임대 단위다.

```ts
type SessionReusePolicy = "ephemeral" | "prefer_reuse" | "require_reuse";

type SessionLease = {
  id: string;
  provider: "claude" | "codex" | "gemini" | "local";
  workspaceId: string;
  missionId?: string;
  affinityKey?: string;
  sessionId?: string;
  status: "warm" | "busy" | "cooldown" | "expired";
  reusePolicy: SessionReusePolicy;
  prefixHash?: string;
  lastRunId?: string;
  lastUsedAt: string;
  expiresAt?: string;
};
```

원칙:

- `run continuity != provider session continuity`는 유지한다
- 하지만 session continuity가 가능할 때는 lease를 통해 재사용할 수 있어야 한다

## 3.5 CacheLocalityStats

토큰/지연/캐시 친화성을 측정하는 런타임 지표다.

```ts
type CacheLocalityStats = {
  promptPrefixHash?: string;
  contextRefCount: number;
  contextInlineCharCount: number;
  transcriptFallbackUsed: boolean;
  reusedSession: boolean;
  sessionLeaseId?: string;
  estimatedPromptTokens?: number;
  estimatedSavedTokens?: number;
  localityScore?: number;
};
```

## 4. 타입 변경안

## 4.1 `RunDetail`

현재 `RunDetail`에는 provider, terminal, artifacts는 있지만 context assembly 정보가 없다. 아래 필드를 추가한다.

```ts
type PromptAssemblyMode =
  | "full_replay"
  | "artifact_refs"
  | "artifact_refs_with_delta"
  | "session_resume";

type RunDetail = {
  // existing fields...
  phaseId?: string;
  contextRefs?: ContextRef[];
  deltaContext?: DeltaContext;
  contextBundleId?: string;
  promptAssemblyMode?: PromptAssemblyMode;
  sessionReusePolicy?: SessionReusePolicy;
  sessionAffinityKey?: string;
  contextVersion?: number;
  cacheLocality?: CacheLocalityStats;
};
```

의미:

- `contextRefs`: 이 run이 읽은 외부 문맥
- `deltaContext`: 새로 바뀐 부분
- `contextBundleId`: phase 공통 문맥 묶음
- `promptAssemblyMode`: 어떤 방식으로 프롬프트를 만들었는지
- `sessionAffinityKey`: 같은 문맥 family를 식별
- `cacheLocality`: 실행 후 측정값

## 4.2 `ExecutionSessionSnapshot`

현재 세션 스냅샷은 transport 수준만 있다. 캐시/재사용 관점을 추가한다.

```ts
type ExecutionSessionSnapshot = {
  // existing fields...
  leaseId?: string;
  affinityKey?: string;
  reusable: boolean;
  prefixHash?: string;
  resumedFromLeaseId?: string;
};
```

## 4.3 `SpawnAgentRunInput`

실행 서비스는 아래 입력을 받아야 한다.

```ts
type SpawnAgentRunInput = {
  // existing fields...
  phaseId?: string;
  contextRefs?: ContextRef[];
  deltaContext?: DeltaContext;
  contextBundleId?: string;
  promptAssemblyMode?: PromptAssemblyMode;
  sessionReusePolicy?: SessionReusePolicy;
  sessionAffinityKey?: string;
};
```

## 4.4 `ProviderWindowSummary`

UI와 scheduler가 session reuse 가능성을 볼 수 있게 한다.

```ts
type ProviderWindowSummary = {
  // existing fields...
  warmLeaseCount?: number;
  affinityQueuedRuns?: number;
  cacheHotRuns?: number;
};
```

## 4.5 새 artifact contract kind

artifact schema에 아래 kind를 추가하는 것이 맞다.

- `context_bundle`
- `context_delta`
- `prompt_prefix_manifest`
- `session_checkpoint`
- `benchmark_result`
- `replay_input`

## 4.6 v1에서 실제로 먼저 추가할 필드

처음부터 전체 필드를 다 넣지 않는다. 아래만 먼저 추가하는 편이 맞다.

### `RunDetail`

- `contextBundleId?`
- `promptAssemblyMode?`
- `sessionReusePolicy?`
- `sessionAffinityKey?`
- `cacheLocality?`

### `ExecutionSessionSnapshot`

- `leaseId?`
- `affinityKey?`
- `reusable`

### `SpawnAgentRunInput`

- `contextBundleId?`
- `promptAssemblyMode?`
- `sessionReusePolicy?`
- `sessionAffinityKey?`

## 5. 저장 구조 변경안

## 5.1 `runtime_run_index` 추가 컬럼

기존 `runtime_run_index`에 아래 컬럼을 추가한다.

- `phase_id TEXT`
- `context_bundle_id TEXT`
- `prompt_assembly_mode TEXT`
- `session_reuse_policy TEXT`
- `session_affinity_key TEXT`
- `context_version INTEGER`
- `context_ref_count INTEGER`
- `prompt_prefix_hash TEXT`
- `reused_session INTEGER`
- `session_lease_id TEXT`
- `cache_locality_score REAL`
- `estimated_prompt_tokens INTEGER`
- `estimated_saved_tokens INTEGER`

이유:

- run list만 봐도 locality 품질을 관찰할 수 있어야 한다
- self-improvement 평가 시 token efficiency를 join 없이 빠르게 볼 수 있어야 한다

## 5.2 신규 테이블

### `runtime_context_ref_index`

```sql
CREATE TABLE runtime_context_ref_index (
  store_key TEXT NOT NULL,
  context_ref_id TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  run_id TEXT,
  kind TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  freshness TEXT NOT NULL,
  summary TEXT NOT NULL,
  token_estimate INTEGER,
  PRIMARY KEY (store_key, context_ref_id)
);
```

### `runtime_context_bundle_index`

```sql
CREATE TABLE runtime_context_bundle_index (
  store_key TEXT NOT NULL,
  bundle_id TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  phase_id TEXT,
  title TEXT NOT NULL,
  prefix_hash TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (store_key, bundle_id)
);
```

### `runtime_session_lease_index`

```sql
CREATE TABLE runtime_session_lease_index (
  store_key TEXT NOT NULL,
  lease_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  mission_id TEXT,
  affinity_key TEXT,
  session_id TEXT,
  status TEXT NOT NULL,
  reuse_policy TEXT NOT NULL,
  prefix_hash TEXT,
  last_run_id TEXT,
  last_used_at TEXT NOT NULL,
  expires_at TEXT,
  PRIMARY KEY (store_key, lease_id)
);
```

### `runtime_execution_metric_index`

```sql
CREATE TABLE runtime_execution_metric_index (
  store_key TEXT NOT NULL,
  run_id TEXT NOT NULL,
  estimated_prompt_tokens INTEGER,
  estimated_saved_tokens INTEGER,
  locality_score REAL,
  transcript_fallback_used INTEGER NOT NULL DEFAULT 0,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (store_key, run_id)
);
```

## 5.3 v1 저장 전략

처음 단계에서는 아래 전략이 더 현실적이다.

- `runtime_run_index`에 소수 컬럼만 추가
- execution stats는 JSON payload artifact로 먼저 저장
- `runtime_session_lease_index`는 처음에는 만들지 않고 in-memory lease registry로 시작
- `runtime_context_ref_index`, `runtime_context_bundle_index`는 두 번째 concrete use case가 생긴 뒤 도입

즉, v1은 "schema-first"가 아니라 "behavior-first"가 맞다.

## 6. IPC / Desktop API 변경안

현재 `run:*` IPC는 실행/터미널 제어만 다룬다. 캐시 친화적 실행을 위해 아래 API를 추가한다.

## 6.1 조회 API

```ts
run.getContextGraph(input: { runId: string }): Promise<{
  runId: string;
  contextRefs: ContextRef[];
  deltaContext: DeltaContext | null;
  contextBundle: ContextBundle | null;
}>;

run.getExecutionStats(input: { runId: string }): Promise<CacheLocalityStats | null>;

run.listSessionLeases(input?: {
  workspaceId?: string;
  provider?: RuntimeProvider;
}): Promise<SessionLease[]>;
```

## 6.2 제어 API

```ts
run.rebuildContextBundle(input: {
  missionId: string;
  phaseId?: string;
}): Promise<RunDetail[]>;

run.pinSessionAffinity(input: {
  runId: string;
  affinityKey?: string;
  reusePolicy?: SessionReusePolicy;
}): Promise<RunDetail | null>;

run.releaseSessionAffinity(input: {
  runId: string;
}): Promise<RunDetail | null>;
```

## 6.4 v1 API 최소안

처음에는 아래 두 개만 있어도 충분하다.

```ts
run.getExecutionStats(input: { runId: string }): Promise<CacheLocalityStats | null>;

run.pinSessionAffinity(input: {
  runId: string;
  affinityKey?: string;
  reusePolicy?: SessionReusePolicy;
}): Promise<RunDetail | null>;
```

`getContextGraph`, `listSessionLeases`, `rebuildContextBundle`는 실제 운영에서 필요성이 확인된 뒤 여는 편이 낫다.

## 6.3 self-improvement / benchmark API

```ts
run.getBenchmarkStats(input: { runId: string }): Promise<{
  estimatedPromptTokens?: number;
  localityScore?: number;
  transcriptFallbackUsed: boolean;
} | null>;
```

이 API는 나중에 self-improvement candidate가 "품질은 같지만 토큰을 더 적게 쓰는지"를 평가할 때 직접 사용한다.

## 7. RuntimeService 변경안

## 7.1 새 책임

`RuntimeService`는 아래 기능을 가져야 한다.

- `buildContextEnvelope(runId)`
- `resolveContextRefs(missionId, runId, phaseId)`
- `buildDeltaContext(runId, previousRunId?)`
- `allocateSessionLease(run)`
- `releaseSessionLease(runId)`
- `recordExecutionStats(runId, stats)`
- `rebuildContextBundle(missionId, phaseId?)`

## 7.1.1 v1 최소 책임

처음에는 아래만 구현해도 된다.

- `buildLightweightContextBundle(runId)`
- `allocateEphemeralAffinity(run)`
- `recordExecutionStats(runId, stats)`

## 7.2 `maybeStartAgentExecutionInState` 변경

현재는 `objective`, `steeringContext`, `providerPreference` 정도만 넘긴다. 아래 입력 조립이 추가돼야 한다.

```ts
executionService.spawnAgentRun({
  missionId,
  runId,
  agent,
  objective,
  providerPreference,
  contextRefs,
  deltaContext,
  contextBundleId,
  promptAssemblyMode,
  sessionReusePolicy,
  sessionAffinityKey,
  ...
});
```

## 7.3 `completeAgentRunInState` 변경

완료 시 아래를 같이 기록한다.

- 사용한 `promptAssemblyMode`
- `reusedSession` 여부
- `estimatedPromptTokens`
- `estimatedSavedTokens`
- `localityScore`
- `transcriptFallbackUsed`

## 8. ExecutionService 변경안

## 8.1 prompt assembly 분리

현재 `buildPrompt()`는 단일 문자열을 바로 만든다. 이를 아래처럼 나눠야 한다.

```ts
type PromptEnvelope = {
  stablePrefix: string;
  inlineContext: string;
  deltaContext: string;
  objective: string;
  suffix: string;
  prefixHash: string;
};
```

필요 메서드:

- `buildStablePrefix(input)`
- `buildInlineContextRefs(input.contextRefs)`
- `buildDeltaContext(input.deltaContext)`
- `buildPromptEnvelope(input)`

## 8.2 session reuse 우선순위

실행 순서는 아래가 되어야 한다.

1. `require_reuse`면 같은 `sessionAffinityKey` lease 탐색
2. 없으면 `prefer_reuse` warm lease 탐색
3. 없으면 새 session 생성
4. 실패 시 `artifact_refs_with_delta` 모드로 downgrade
5. 그래도 길면 summarize/re-anchor

### v1 축소안

처음에는 이 전체 우선순위를 다 구현하지 않는다.

1. `sessionReusePolicy=ephemeral`가 기본
2. 특정 run family만 `prefer_reuse`
3. 같은 affinity key의 warm session이 있으면 재사용
4. 없으면 그냥 새 session

`require_reuse`와 downgrade path는 실제 필요가 생길 때 추가한다.

## 8.3 provider adapter 요구사항

adapter는 아래 capability를 노출하는 편이 맞다.

```ts
type ProviderCapabilities = {
  supportsPersistentSession: boolean;
  supportsPromptCachingHints: boolean;
  supportsResumeToken: boolean;
};
```

`BaseProviderAdapter`에 최소 아래 훅을 추가하는 안을 권장한다.

- `getCapabilities()`
- `buildCacheHint?(prefixHash: string)`
- `resumeCommand?(lease: SessionLease, envelope: PromptEnvelope)`

## 9. Provider broker 변경안

현재 broker는 provider별 단순 busy/queued만 본다. 아래 점수가 추가돼야 한다.

```ts
score =
  provider_ready_score
  + session_affinity_score
  + prefix_hash_match_score
  - token_cost_penalty
  - risk_penalty
```

### 새 선택 규칙

- 같은 mission/phase/objective family는 같은 affinity key를 우선 배정
- verifier, reviewer처럼 독립성이 필요한 lane은 affinity score를 낮춤
- self-improvement candidate replay는 baseline/candidate 모두 같은 prefix policy를 강제

### v1 축소안

초기 broker는 점수식 전체를 도입하지 않아도 된다.

- `running provider count`
- `same affinity key warm session exists`
- `provider is preferred`

이 세 가지만으로도 충분히 실용적인 개선이 가능하다.

## 10. Prompt assembly 규칙

## 10.1 기본 규칙

프롬프트는 아래 순서를 따른다.

1. stable system prefix
2. role prefix
3. phase bundle summary
4. context ref summaries
5. delta context
6. objective
7. response format

## 10.2 금지 규칙

다음은 기본 경로로 허용하지 않는다.

- 최근 transcript 전체 inline 삽입
- repo 전체 요약을 run마다 재생성
- 같은 phase artifact를 여러 role에 장문으로 반복 전달

## 10.3 transcript fallback

아래 조건에서만 transcript fallback을 허용한다.

- artifact extraction 실패
- debugging session 명시 요청
- human override

fallback이 발생하면 `cacheLocality.transcriptFallbackUsed=true`를 기록해야 한다.

## 11. UI 반영안

데스크톱 UI에는 최소 아래가 보여야 한다.

- run별 `PromptAssemblyMode`
- `reusedSession`
- `contextRefCount`
- `localityScore`
- `estimatedPromptTokens`
- `estimatedSavedTokens`

추가 화면:

- Context Graph 패널
- Session Lease 패널
- Cache Locality 히스토리 차트

## 12. self-improvement와의 연결

이 스펙은 단순한 비용 절감 기능이 아니다. self-improvement roadmap과 직접 연결된다.

- Track A에서는 먼저 implementation run의 token-heavy failure pattern을 줄이는 데 집중한다
- 이후 candidate 평가에는 `cache_locality_score`, `tokens_per_successful_run`이 들어가야 한다
- self-hosting 단계에서는 "같은 품질을 더 적은 토큰으로 달성"하는 변경도 승격 후보가 된다

즉 cache locality는 infra 최적화가 아니라 self-improvement 대상이다.

## 13. 단계별 적용 순서

### Step A. 타입과 저장소

- `RunDetail`
- `ExecutionSessionSnapshot`
- `SpawnAgentRunInput`
- 기존 index 최소 컬럼 추가

### Step B. context bundle과 context ref

- artifact-addressed context 생성
- delta context 생성
- transcript fallback 계측

### Step C. session lease

- warm session registry
- affinity key
- reuse policy

이 단계는 처음에는 in-memory로만 구현한다.

### Step D. scheduler/broker

- affinity-aware scheduling
- verifier 독립성 예외 규칙

### Step E. UI / benchmark

- locality metrics 노출
- candidate 평가 메트릭 연결

## 13.1 현실적인 첫 배포

가장 유지보수 가능한 첫 배포는 아래 정도다.

1. `implementation` run만 대상으로 한다.
2. prompt assembly를 `artifact_refs_with_delta` 한 종류만 연다.
3. `cacheLocality`를 run completion 시 계산해 artifact 또는 snapshot에 기록한다.
4. affinity key는 자동 생성하되, warm session reuse는 best-effort로만 적용한다.
5. 효과가 확인되면 그다음에만 durable lease/table/UI를 붙인다.

## 14. 완료 조건

이 스펙의 1차 구현 완료는 다음이 성립하면 충분하다.

1. `implementation` run이 full replay 대신 `artifact_refs_with_delta` 경로를 사용할 수 있다.
2. execution 결과에 `CacheLocalityStats`가 남는다.
3. 일부 run family에서 best-effort session reuse가 가능하다.
4. replay 비교에서 token 절감과 품질 유지 여부를 같이 볼 수 있다.

장기 완료는 다음이 성립해야 한다.

1. run이 `contextRefs`와 `deltaContext`를 공식 입력으로 가진다.
2. provider session을 `SessionLease`로 추적할 수 있다.
3. replay와 benchmark가 token/locality 메트릭을 포함한다.
4. transcript fallback이 예외 경로가 된다.
5. self-improvement candidate가 캐시 locality 개선으로도 승격될 수 있다.
