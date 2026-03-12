# Proposal Curation System -- 설계서

> 기반: `docs/proposal-curation-ideas.md` (요구사항 #1--#19)

---

## 목차

1. [시스템 개요](#1-시스템-개요)
2. [모드 시스템](#2-모드-시스템-stabilization--big-bet)
3. [다축 스코어링](#3-다축-스코어링)
4. [클러스터링](#4-제안-클러스터링)
5. [적응형 QnA 패키징](#5-적응형-qna-패키징)
6. [충돌 감지 & 안전 스케줄링](#6-충돌-감지--안전-스케줄링)
7. [이중 큐레이션 (AI + User)](#7-이중-큐레이션-ai--user)
8. [실행 피드백 루프](#8-실행-피드백-루프)
9. [Discard 히스토리](#9-discard-히스토리)
10. [상태 머신 & 제안 라이프사이클](#10-상태-머신--제안-라이프사이클)
11. [저장소 변경](#11-저장소-변경)
12. [설정 변경](#12-설정-변경)
13. [API & CLI 변경](#13-api--cli-변경)
14. [Web UI 변경](#14-web-ui-변경)
15. [마이그레이션](#15-마이그레이션)

---

## 1. 시스템 개요

```
Observer Cycle
  |
  v
제안 생성 (perspectives × 모드별 필터)
  |
  v
Dedup (hash) → Clustering (Jaccard + LLM) → Regulation → 다축 스코어링
  |
  v
status=proposed  ─── 패키징(QnA) ──→ status=packaged
  |                                       |
  v                                       v
승인 (approve)   ←────────────────────────+
  |
  v
Big Bet 체크리스트 (big_bet 모드일 때) → 충돌 감지 → 안전 스케줄링
  |
  v
Forge 파이프라인 실행
  |
  v
실행 결과 → 피드백 루프 → 스코어링 보정 + 모드 전환 기준 보정
```

---

## 2. 모드 시스템 (Stabilization / Big Bet)

### 2.1 모드 정의

| 모드 | 목적 | 허용 카테고리 | 차단 기본값 |
|------|------|-------------|-----------|
| **stabilization** | 복잡도 감소, 코드 정리 | bugfix, core, performance, test | architecture(신규), research(확장) |
| **big_bet** | 기능 확장, 전략적 실행 | 전체 | 없음 (체크리스트 필수) |

안정화 모드 목표 (#17, #18): "더 빼기 어려운 상태" 수렴 -- 분기 수, 의존성, 설정 표면적, 예외 경로 감소.

### 2.2 모드 상태

```javascript
// ~/.ucm/daemon/curation-mode.json
{
  mode: "stabilization" | "big_bet",
  since: ISO8601,
  forcedBy: "user" | "auto" | null,
  history: [
    {
      from: "big_bet",
      to: "stabilization",
      timestamp: ISO8601,
      triggeredBy: "auto" | "user",
      reason: "successRate dropped to 0.73 (threshold: 0.75)",
      criteria: { successRate, firstPassRate, openBugCount, complexityTrend, failingStageRate }
    }
  ]
}
```

### 2.3 전환 기준 (#2: 감이 아니라 명확한 기준)

**stabilization → big_bet (모든 조건 충족):**

| 기준 | 임계값 | 측정 방법 |
|------|--------|----------|
| successRate | >= 0.90 | `metrics.successRate` |
| firstPassRate | >= 0.80 | `loopMetrics.firstPassRate` |
| openBugCount | == 0 | `proposed` 중 category=bugfix 수 |
| minStabilizationDays | >= 7 | `now - mode.since` |
| complexityTrend | decreasing | 최근 3회 스냅샷 비교 |

**big_bet → stabilization (하나라도 충족):**

| 기준 | 임계값 |
|------|--------|
| successRate | < 0.75 |
| failingStageRate | > 0.30 (어떤 스테이지든) |
| openBugCount | > 5 |

### 2.4 모드별 제안 처리 (#1, #3, #19)

**Stabilization 모드:**
- 기능 확장 제안 → `modeEligibility: "big_bet"` 태그 후 `hold` 상태로 축적 (#3)
- bugfix/security/ops → 즉시 처리 (#19)
- 새 관점 `stabilization_analysis` 활성화: 중복 추상화, 죽은 코드, 과도한 분기, 제거 가능한 의존성 탐색

**Big Bet 모드:**
- 축적된 hold 제안들이 큐레이션 풀에 합류
- 체크리스트 통과 필수 (#11)

### 2.5 Big Bet 준비 체크리스트 (#11)

```javascript
{
  proposalId: "p-xxx",
  ready: boolean,
  checklist: {
    impactScope:     { passed: boolean, detail: "3 files, 2 modules" },
    rollbackPlan:    { passed: boolean, detail: "git revert viable" },
    dependencies:    { passed: boolean, detail: "none", blocking: [] },
    successCriteria: { passed: boolean, detail: "defined in proposal" },
    conflictFree:    { passed: boolean, detail: "no active conflicts" },
  },
  computedAt: ISO8601,
  promotable: boolean  // all checks pass + mode is big_bet
}
```

### 2.6 전환 로깅 (#9)

모든 전환 판단은 `curation-mode.json.history[]`에 기록:
- 트리거 조건 (어떤 기준이 초과/미달했는지)
- 기준 값 스냅샷
- 전환 주체 (auto/user)
- 사유 문자열

---

## 3. 다축 스코어링

### 3.1 축 정의 (#13)

| 축 | 필드명 | 측정 대상 | 범위 | 방향 |
|----|--------|----------|------|------|
| Impact | `impact` | 성공 시 개선 크기 | 0-100 | 높을수록 좋음 |
| Urgency | `urgency` | 시간 민감도, 장애/회귀 연관성 | 0-100 | 높을수록 좋음 |
| Uncertainty | `uncertainty` | 실패/회귀 위험 | 0-100 | **낮을수록** 좋음 |
| Execution Cost | `executionCost` | 토큰/시간/복잡도 비용 | 0-100 | **낮을수록** 좋음 |
| Context Fitness | `cwFitness` | 현재 모드/컨텍스트 적합성 | 0-100 | 높을수록 좋음 |

### 3.2 제안 메타데이터 확장

```yaml
# 기존 필드에 추가
scores:
  impact: 85
  urgency: 60
  uncertainty: 35
  executionCost: 20
  cwFitness: 90
scoreSource: "ai"          # ai | user | mixed
scoreVersion: 1
weightProfile: "default"
```

### 3.3 가중치 프로파일

```javascript
// config.scoring.profiles
{
  "default": {
    label: "Balanced",
    weights: { impact: 0.30, urgency: 0.25, uncertainty: -0.20, executionCost: -0.15, cwFitness: 0.10 }
  },
  "stabilization": {
    label: "안정화 중심",
    weights: { impact: 0.20, urgency: 0.35, uncertainty: -0.25, executionCost: -0.10, cwFitness: 0.10 }
  },
  "growth": {
    label: "확장 / Big Bet",
    weights: { impact: 0.40, urgency: 0.10, uncertainty: -0.10, executionCost: -0.15, cwFitness: 0.25 }
  },
  "quick-wins": {
    label: "빠른 성과",
    weights: { impact: 0.20, urgency: 0.15, uncertainty: -0.10, executionCost: -0.35, cwFitness: 0.20 }
  }
}
```

제약: 가중치 절대값 합 = 1.0, 각 가중치 [-1.0, 1.0]. 음수 가중치 = 해당 축이 랭킹을 깎음.

### 3.4 최종 랭크 계산

```
priority = clamp(0, 100, round(
  sum( scores[axis] * weights[axis] for axis in all_axes )
))
```

기존 `priority` 필드가 이 값으로 치환되므로, `listProposals()` 정렬 로직은 변경 없음.

### 3.5 프로파일 전환 시 일괄 재계산

활성 프로파일 변경 → `proposed`/`approved` 상태의 모든 제안 priority 재계산 (배치).

---

## 4. 제안 클러스터링

### 4.1 3계층 유사도 탐지 (#10)

| 계층 | 방법 | 비용 | 임계값 |
|------|------|------|--------|
| L1 | `dedupHash` 정확 일치 | 무료 | 1.0 |
| L2 | Jaccard 토큰 유사도 (title+problem+change) | O(n²), 매우 빠름 | >= 0.40 |
| L3 | LLM 판단 (L2 후보 쌍만) | 토큰 비용 | LLM 확인 |

같은 `category` 내에서만 클러스터링. 다른 카테고리 간 클러스터링 없음.

### 4.2 클러스터 데이터

```javascript
// ~/.ucm/proposals/clusters.json
{
  version: 1,
  clusters: {
    "cl-a1b2c3d4": {
      id: "cl-a1b2c3d4",
      representativeId: "p-xxxx",
      title: "Forge 파이프라인 에러 처리 개선",
      category: "bugfix",
      members: [
        { proposalId: "p-xxxx", role: "representative", relationship: null },
        { proposalId: "p-yyyy", role: "variant", relationship: "duplicate" },
        { proposalId: "p-zzzz", role: "variant", relationship: "complementary" },
      ],
      mergedScores: {
        impact: 88,        // max(members)
        urgency: 65,       // max(members)
        uncertainty: 30,   // min(members)
        executionCost: 25, // representative 값
        cwFitness: 85,     // representative 값
      },
      mergedPriority: 74,
    }
  },
  proposalToCluster: { "p-xxxx": "cl-a1b2c3d4", "p-yyyy": "cl-a1b2c3d4", ... }
}
```

### 4.3 실행 시점

1. Observer 사이클 후, curation 전
2. Curation 후 (멤버 변동 반영)
3. 수동: `proposal_cluster` 핸들러 (merge/split/recluster)

`proposed` 상태만 대상. `approved`/`rejected`/`implemented`는 제외.

### 4.4 UI 표현

리스트: 대표 제안에 "3 similar" 배지, 확장 토글로 variant 보기.
정렬: 클러스터 `mergedPriority` 기준.

---

## 5. 적응형 QnA 패키징

### 5.1 정보 차원 (#7, #15)

| 차원 | 가중치 | 최소 임계 | 소스 |
|------|--------|----------|------|
| problem_clarity | 1.0 | 0.6 | observer, user, codebase, hivemind |
| scope_definition | 1.0 | 0.5 | codebase, user |
| success_criteria | 1.0 | 0.5 | user, observer |
| risk_assessment | 0.8 | -- | codebase, observer, hivemind |
| implementation_approach | 0.6 | -- | codebase, hivemind, user |
| priority_justification | 0.5 | -- | observer, user |

신뢰도: `[0.0, 1.0]` 연속 스케일. 차원별 `entries[]`로 추적.

### 5.2 완료 조건

```
overallConfidence >= 0.7
AND problem_clarity >= 0.6
AND scope_definition >= 0.5
AND success_criteria >= 0.5
```

`overallConfidence = sum(dim.confidence * dim.weight) / sum(dim.weight)`

### 5.3 Pre-seeding (#15: 이미 확보한 컨텍스트 재질문 금지)

패키징 시작 시 자동 주입:
- Observer 데이터 → problem_clarity, scope, success_criteria
- 코드베이스 스캔 → scope_definition, implementation_approach
- Hivemind 검색 → risk_assessment, implementation_approach

Pre-seed 후 전형적 시작 신뢰도: 30-50%. 질문 수 12→5-7개로 감소.

### 5.4 질문 선택 알고리즘 (#15: 확신도 기반 질문 정책)

```
1. 신뢰도 < 임계값인 차원 중
2. confidence == 0인 차원 우선 (미탐색 최우선)
3. weight * (threshold - confidence) 내림차순
4. 타이브레이크: 사용 가능 소스 수 오름차순 (자동 채우기 어려운 것 먼저)
```

### 5.5 질문 예산 (안전 밸브)

```
base = 12
- floor(preseeded_confidence * 4)
+ (high_risk ? 3 : medium_risk ? 1 : 0)
clamped to [3, 20]
```

### 5.6 오토파일럿 전환 (#4)

기존 `switchToAutopilot()` 패턴 재사용:
- 인터랙티브 시작 → 중간에 오토파일럿 전환 가능
- AI가 남은 gap을 자율적으로 채움
- 결과: `packagingMode: "hybrid"` (시작이 interactive) 또는 `"autopilot"`

### 5.7 패키징된 제안 문서

기존 섹션 + 확장:

```markdown
## Problem        (필수, confidence >= 0.6)
## Scope          (필수, confidence >= 0.5)
  ### In Scope
  ### Out of Scope
## Success Criteria (필수, confidence >= 0.5)
## Risk Assessment  (선택)
## Implementation Approach (선택)
## Priority Justification  (자동 생성)
```

메타데이터에 추가: `packagedAt`, `packagingMode`, `overallConfidence`, `dimensionConfidence`, `questionsAsked`

---

## 6. 충돌 감지 & 안전 스케줄링

### 6.1 충돌 감지 (#12)

세 가지 신호:

| 신호 | 방법 | 심각도 |
|------|------|--------|
| 파일 겹침 | 제안 scope 파일 vs 활성 워크트리 `git diff --name-only` | high |
| 카테고리+모듈 충돌 | 같은 category + 같은 project | medium |
| Dedup 일치 | dedupHash 동일 | critical |

### 6.2 안전 삽입 지점 (#12: "다음 안전 지점" 예약)

| 지점 | 조건 | 대기 시간 |
|------|------|----------|
| between_stages | 현재 스테이지 완료 후 | 초 |
| between_subtasks | 현재 서브태스크의 implement-verify 루프 완료 | 분 |
| between_waves | 현재 wave 전체 완료 | 분~시간 |
| between_pipelines | 현재 파이프라인 전체 완료 | 시간 |

### 6.3 우선순위별 처리 규칙 (#4)

| 제안 유형 | 처리 |
|----------|------|
| security/bugfix + high risk | **즉시** -- 다음 스테이지 경계에서 삽입 |
| stabilization 모드 fix | 파일 충돌 없으면 즉시, 있으면 between_subtasks |
| 일반 기능 | **지연** -- 다음 안전 지점 |
| Big Bet / architecture | **지연** -- between_pipelines |
| 문서 | **즉시** -- 코드 충돌 불가 |

### 6.4 지연 큐

```javascript
// ~/.ucm/daemon/deferred-proposals.json
{
  entries: [{
    proposalId: "p-xxx",
    insertionPoint: "between_waves",
    blockedBy: { pipelineId: "forge-xxx", waveIndex: 2 },
    priority: 15,
    status: "deferred" | "ready" | "expired",
    expiresAt: ISO8601,  // 24h
  }]
}
```

---

## 7. 이중 큐레이션 (AI + User)

### 7.1 AI 제안 (#5)

- 패키징 완료 시 다축 점수 자동 계산
- 배치 큐레이션 시 우선순위 조정 추천: `{ id, delta, reason }`

### 7.2 User 오버라이드 (#5)

- 점수 직접 설정 또는 delta 조정
- `proposal_score` 핸들러: 축별 개별 조정
- 기존 `proposal_priority` 핸들러: 호환성 유지 (priority 직접 조정)

### 7.3 큐레이션 히스토리

제안 메타데이터에 `curationHistory[]`:

```javascript
{
  actor: "user" | "ai" | "system",
  action: "priority_up" | "priority_down" | "priority_override" | "score_adjust",
  previousValue: any,
  newValue: any,
  reason: string,
  timestamp: ISO8601,
}
```

별도 감사 로그: `~/.ucm/proposals/curation-log.jsonl` (append-only)

### 7.4 AI 학습 (#5)

- User 오버라이드 패턴을 다음 큐레이션 프롬프트에 주입
- "User가 bugfix 제안의 AI 낮은 우선순위를 73% 올렸음" 등 통계 포함
- Hivemind에 큐레이션 결과 + 실행 결과 기록 → 미래 참조

---

## 8. 실행 피드백 루프

### 8.1 피드백 레코드 (#16)

```javascript
// ~/.ucm/proposals/feedback.json
{
  records: [{
    proposalId, taskId, category, risk, project,
    scores: { impact, urgency, uncertainty, executionCost, cwFitness },
    verdict: "improved" | "regressed" | "neutral",
    evaluationScore: number,
    delta: { successRate, avgPipelineDurationMs, firstPassRate },
    executionDurationMs: number,
    executedAt: ISO8601,
  }],
  aggregates: {
    byCategory:     { bugfix: { total, improved, regressed, neutral, avgScore }, ... },
    byRisk:         { low: {...}, medium: {...}, high: {...} },
    byCategoryRisk: { "bugfix|low": {...}, ... },
    lastUpdated: ISO8601,
  }
}
```

### 8.2 스코어 보정 (#16: 다음 우선순위 계산에 반영)

```javascript
function calibrateScores(rawScores, proposal, aggregates) {
  const key = `${proposal.category}|${proposal.risk}`;
  const stats = aggregates.byCategoryRisk[key];
  if (!stats || stats.total < 3) return rawScores;  // 최소 3건 필요

  const calibrated = { ...rawScores };
  const successRate = stats.improved / stats.total;

  if (successRate < 0.40) calibrated.uncertainty = min(100, raw.uncertainty + 15);
  if (successRate > 0.70 && stats.total >= 5) calibrated.uncertainty = max(0, raw.uncertainty - 10);
  if (stats.avgScore < 0) calibrated.executionCost = min(100, raw.executionCost + 10);

  return calibrated;
}
```

### 8.3 감쇠 (Decay)

```
halfLife = 30 days
weight = 0.5^(ageDays / halfLife)
```

180일 초과 레코드 → 아카이브 (active aggregates에서 제외).

### 8.4 임계값 보정 추천

피드백에 기반한 추천 (자동 적용 아님, 사용자 승인 필요):
- medium risk 성공률 >= 60% + 5건 이상 → `maxRiskForAutoApprove: "medium"` 추천
- 전체 성공률 > 70% → `maxProposalsPerCycle` 증가 추천

---

## 9. Discard 히스토리

### 9.1 삭제 메타데이터 (#6, #14)

```javascript
// ~/.ucm/proposals/discard-history.json
{
  records: [{
    proposalId: "p-xxx",
    title: "...",
    category: "bugfix",
    risk: "medium",
    dedupHash: "abc123...",
    discardedAt: ISO8601,
    actor: "user" | "ai:curation" | "ai:regulator",
    reason: "duplicate" | "superseded" | "noise" | "conflict" | "manual" | "regulator",
    reasonDetail: "superseded by p-yyy",
  }]
}
```

### 9.2 보존 정책

- 보존 기간: `discard.retentionDays` (기본 90일)
- 최대 레코드: 500개
- 초과 시 가장 오래된 것부터 제거

### 9.3 재발 방지 (#14)

1. **Dedup 게이트**: `getExistingDedupHashes()`가 discard history의 hash도 포함
2. **Regulator 확장**: `regulateProposal()`에 새 규칙 -- 최근 discard된 제안과 같은 category + Jaccard >= 0.60이면 차단
3. **LLM 큐레이션 프롬프트에 discard 히스토리 주입**: 재생성 방지

---

## 10. 상태 머신 & 제안 라이프사이클

### 10.1 상태 다이어그램

```
                              +----------+
                              | raw_idea |
                              +----+-----+
                                   |
                    observer / user submit
                                   |
                                   v
                             +-----------+
                     +-------| proposed  |--------+
                     |       +-----+-----+        |
                     |             |               |
                  discard      package        approve (레거시)
                     |             |               |
                     v             v               |
              +-----------+  +-----------+         |
              | discarded |  | packaging |         |
              +-----------+  +-----+-----+         |
                    ^              |  |             |
                    |         hold |  | complete    |
                    |              v  v             |
                    |        +----------+          |
                    +--------| packaged |----------+
                    |        +----+-----+          |
                    |             |                 |
                  discard      approve              |
                                  |                 |
                                  v                 v
                            +-----------+     +-----------+
                            | approved  |<----+           |
                            +-----+-----+                 |
                                  |
                             promote
                                  |
                                  v
                          +--------------+
                          | implemented  |
                          +--------------+

                             +------+
                             | held |<--- packaging에서 일시정지
                             +--+---+
                                |
                             resume → packaging
```

### 10.2 상태 목록

```javascript
const PROPOSAL_STATUSES = [
  "proposed",     // 생성됨
  "packaging",    // QnA 패키징 중 (NEW)
  "packaged",     // 패키징 완료, 승인 대기 (NEW)
  "held",         // 패키징 일시정지 / Big Bet 대기 (NEW)
  "approved",     // 승인됨
  "rejected",     // 거절됨 (curation)
  "implemented",  // 구현 완료
];
// "discarded"는 영속 상태 아님 -- 즉시 삭제 + 메타데이터 기록
```

### 10.3 전이 조건

| From → To | 트리거 | 조건 |
|-----------|--------|------|
| proposed → packaging | `startPackaging()` | 제안 존재 |
| proposed → approved | `handleProposalApprove()` | 레거시 경로 (패키징 없이) |
| proposed → discarded | `handleProposalDiscard()` | 사용자 액션 |
| packaging → packaged | 패키징 엔진 완료 선언 | overallConfidence >= 0.7 + 필수 차원 충족 |
| packaging → held | 사용자 일시정지 | 세션 상태 보존 |
| held → packaging | `resumePackaging()` | 사용자 재개 |
| packaged → approved | 승인 | 사용자/자동 |
| approved → implemented | `promoteProposal()` | 태스크 생성 |

---

## 11. 저장소 변경

### 11.1 새 파일/디렉토리

```
~/.ucm/
  daemon/
    curation-mode.json          # 모드 상태 + 전환 이력
    deferred-proposals.json     # 지연 큐
  proposals/
    proposed/                   # (기존)
    approved/                   # (기존)
    rejected/                   # (기존)
    implemented/                # (기존)
    packaging/                  # NEW: 패키징 중
    packaged/                   # NEW: 패키징 완료
    held/                       # NEW: 보류
    clusters.json               # NEW: 클러스터 데이터
    feedback.json               # NEW: 실행 피드백
    discard-history.json        # NEW: 삭제 이력
    curation-log.jsonl          # NEW: 큐레이션 감사 로그
```

### 11.2 제안 YAML 확장

기존 필드 + 추가 (모두 선택적, 하위 호환):

```yaml
# NEW 필드
scores: { impact, urgency, uncertainty, executionCost, cwFitness }
scoreSource: "ai"
weightProfile: "default"
modeEligibility: "stabilization" | "big_bet" | "both"
clusterId: "cl-xxx" | null
packagedAt: ISO8601
packagingMode: "interactive" | "autopilot" | "hybrid"
overallConfidence: 0.82
dimensionConfidence: { ... }
questionsAsked: 5
curationHistory: [...]
```

---

## 12. 설정 변경

### 12.1 새 설정 섹션

```javascript
// DEFAULT_CONFIG에 추가
{
  curation: {
    defaultMode: "stabilization",
    autoTransition: true,
    transitionThresholds: {
      toBigBet: {
        successRate: 0.90,
        firstPassRate: 0.80,
        openBugCount: 0,
        minStabilizationDays: 7,
        complexityTrend: "decreasing",
      },
      toStabilization: {
        successRate: 0.75,
        failingStageRate: 0.30,
        openBugCount: 5,
      },
    },
    scoring: {
      enabled: true,
      autoScore: false,
      activeProfile: "default",
      profiles: { /* default, stabilization, growth, quick-wins */ },
    },
    clustering: {
      enabled: true,
      similarityThreshold: 0.40,
      maxClusterSize: 8,
      llmConfirmation: true,
    },
    conflicts: {
      enabled: true,
      autoCheck: false,
      deferOnHardConflict: true,
    },
    discard: {
      retentionDays: 90,
      maxRecords: 500,
    },
    bigBetChecklist: {
      requireAllPassing: true,
      autoCheck: true,
    },
    feedback: {
      enabled: true,
      autoRecord: true,
      halfLifeDays: 30,
      archiveAfterDays: 180,
      calibrationMinSamples: 3,
      weightAdjustRate: 0.1,
    },
  },
}
```

### 12.2 기존 설정 확장

```javascript
// observer 확장
observer: {
  perspectivesByMode: {
    stabilization: ["functionality", "quality", "stabilization_analysis"],
    big_bet: ["functionality", "ux_usability", "architecture", "quality", "docs_vision"],
  },
}

// automation 확장
automation: {
  autoCluster: false,
  autoScore: false,
  conflictCheck: false,
}

// regulator 확장
regulator: {
  modeAwareBlocking: true,
  stabilizationExceptions: ["bugfix"],
  blockRecentlyDiscarded: true,
  discardedWindowDays: 14,
}
```

---

## 13. API & CLI 변경

### 13.1 새 소켓 메서드

| 메서드 | 파라미터 | 설명 |
|--------|---------|------|
| `curation_mode` | `{}` | 현재 모드 + 전환 점수 + 기준값 |
| `curation_set_mode` | `{mode, reason}` | 강제 모드 전환 |
| `curation_weights` | `{weights?}` | 가중치 프로파일 get/set |
| `proposal_score` | `{proposalId, recompute?}` | 다축 점수 조회/재계산 |
| `proposal_score_set` | `{proposalId, scores}` | 축 점수 수동 설정 |
| `proposal_clusters` | `{status?, refresh?}` | 클러스터 목록 |
| `proposal_cluster_merge` | `{proposalIds, representativeId?}` | 수동 병합 |
| `proposal_cluster_split` | `{proposalId}` | 클러스터 이탈 |
| `proposal_conflicts` | `{proposalId}` | 충돌 감지 |
| `proposal_discard` | `{proposalId, reason, discardedBy}` | 메타데이터 보존 삭제 |
| `discard_history` | `{limit?, project?, reason?}` | 삭제 이력 조회 |
| `bigbet_checklist` | `{proposalId, recompute?}` | 준비 체크리스트 |
| `proposal_feedback` | `{proposalId, taskId, outcome}` | 실행 결과 기록 |
| `scoring_profile` | `{action, ...}` | 가중치 프로파일 CRUD |

### 13.2 새 CLI 명령

```bash
# 모드
ucm mode                                    # 현재 모드 표시
ucm mode set <stabilization|big_bet> --reason "..."  # 강제 전환
ucm mode criteria                           # 전환 기준 상세

# 스코어링
ucm proposal score <id>                     # 다축 점수 표시
ucm proposal score <id> --impact 9 --urgency 7  # 점수 오버라이드
ucm proposal weights                        # 가중치 프로파일 표시
ucm proposal weights --profile stabilization  # 프로파일 전환

# 클러스터링
ucm proposal clusters [--refresh]           # 클러스터 목록
ucm proposal cluster-merge <id1> <id2>      # 수동 병합
ucm proposal cluster-split <id>             # 이탈

# 충돌
ucm proposal conflicts <id>                 # 충돌 감지

# Discard
ucm proposal discard <id> --reason <reason> # 메타데이터 보존 삭제
ucm proposal history [--limit 20]           # 삭제 이력

# Big Bet 준비
ucm proposal readiness <id>                 # 체크리스트 실행
```

### 13.3 새 HTTP API

| Method | Path | 소켓 메서드 |
|--------|------|-----------|
| GET | `/api/curation/mode` | `curation_mode` |
| POST | `/api/curation/mode` | `curation_set_mode` |
| GET/POST | `/api/curation/weights` | `curation_weights` |
| GET | `/api/proposal/score/:id` | `proposal_score` |
| POST | `/api/proposal/score/:id` | `proposal_score_set` |
| GET | `/api/proposal/clusters` | `proposal_clusters` |
| POST | `/api/proposal/cluster/merge` | `proposal_cluster_merge` |
| POST | `/api/proposal/cluster/split/:id` | `proposal_cluster_split` |
| GET | `/api/proposal/conflicts/:id` | `proposal_conflicts` |
| POST | `/api/proposal/discard/:id` | `proposal_discard` |
| GET | `/api/proposal/discard-history` | `discard_history` |
| GET | `/api/proposal/readiness/:id` | `bigbet_checklist` |
| POST | `/api/proposal/feedback/:id` | `proposal_feedback` |

### 13.4 새 WebSocket 이벤트

| 이벤트 | 데이터 |
|--------|--------|
| `mode:changed` | `{previousMode, mode, reason, triggeredBy}` |
| `mode:transition_progress` | `{mode, transitionScore, criteria}` |
| `proposal:scored` | `{proposalId, scores, weightedRank}` |
| `proposal:clustered` | `{clusterCount, newClusters}` |
| `proposal:conflict_detected` | `{proposalId, conflictsWith, severity}` |
| `proposal:discarded` | `{proposalId, reason, discardedBy}` |
| `proposal:readiness_checked` | `{proposalId, ready, failedChecks}` |
| `proposal:feedback_recorded` | `{proposalId, verdict, scoringAdjusted}` |

---

## 14. Web UI 변경

### 14.1 새 컴포넌트

| 컴포넌트 | 위치 | 기능 |
|---------|------|------|
| `mode-indicator.tsx` | 레이아웃 헤더 | 현재 모드 배지 (blue=안정화, amber=big_bet) |
| `mode-detail-panel.tsx` | 모드 배지 클릭 시 | 기준 진행도, 수동 전환, 히스토리 |
| `score-radar.tsx` | 제안 카드/상세 | 5축 레이더 차트 |
| `cluster-view.tsx` | 제안 목록 | 아코디언 클러스터 뷰 |
| `readiness-checklist.tsx` | 제안 상세 | Big Bet 체크리스트 |
| `discard-history.tsx` | 제안 탭 | 삭제 이력 테이블 |
| `conflict-badge.tsx` | 제안 카드 | 충돌 수 배지 |

### 14.2 기존 뷰 수정

**Dashboard**: 모드 카드 추가 (전환 점수 진행바)

**Proposal List**:
- 뷰 모드 토글: flat(기존) / clustered(신규)
- 정렬: priority 외 weighted rank 추가
- 필터: mode-eligible 체크박스
- 카드에 score 미니 지표, 충돌 배지, 클러스터 표시

**Proposal Detail**:
- Scores 탭 (레이더 차트 + 축별 슬라이더)
- Conflicts 탭
- Readiness 탭 (big_bet 대상)
- Discard 버튼 (사유 선택기)

### 14.3 새 쿼리 훅

`web/src/queries/curation.ts`:
```
useCurationModeQuery, useSetCurationMode,
useCurationWeightsQuery, useSetCurationWeights,
useProposalScoreQuery, useSetProposalScore,
useProposalClustersQuery, useMergeCluster, useSplitCluster,
useProposalConflictsQuery,
useDiscardProposal, useDiscardHistoryQuery,
useBigBetChecklistQuery, useRecordProposalFeedback
```

### 14.4 새 타입

```typescript
type CurationMode = "stabilization" | "big_bet";

interface ProposalScores {
  impact: number; urgency: number; uncertainty: number;
  executionCost: number; cwFitness: number;
}

interface ProposalCluster {
  clusterId: string; representative: string; title: string;
  members: { proposalId: string; title: string; similarity: number }[];
  scores: ProposalScores; memberCount: number;
}

interface ReadinessChecklist {
  proposalId: string; ready: boolean;
  checklist: Record<string, { passed: boolean; detail: string; blocking?: string[] }>;
  promotable: boolean;
}
```

---

## 15. 마이그레이션

### Phase 1: Non-breaking 추가
- 새 디렉토리/파일은 최초 사용 시 lazy 생성
- 기존 제안의 `scores` 없으면 기존 `priority` 그대로 사용
- 모든 새 필드는 optional -- 기존 클라이언트 호환
- `PROPOSAL_STATUSES` 배열 확장 (기존 값 불변)

### Phase 2: 모드 초기화
- 데몬 첫 시작 시 `curation-mode.json` 없으면 `stabilization` 기본 생성
- 보수적 기본값이므로 기존 동작 변경 없음

### Phase 3: 기존 제안 스코어링
- `proposal_rescore` 핸들러로 LLM 일괄 스코어링 (수동 트리거)
- 또는 다음 observer 사이클에서 자연스럽게 스코어링

### Phase 4: 클러스터링 + 피드백
- `observer.clustering.enabled` 플래그로 opt-in (기본 true)
- 피드백은 `evaluateProposal()` 기존 호출에 자동 연동

---

## 요구사항 추적표

| # | 요구사항 | 설계 섹션 |
|---|---------|----------|
| 1 | 안정화/확장 모드 분리 | §2 |
| 2 | 감이 아닌 명확한 기준 | §2.3 |
| 3 | Big Bet 후보 축적/정제 | §2.4 |
| 4 | 오토파일럿 중 제안 추가 + 상황 기반 우선순위 | §5.6, §6.3 |
| 5 | AI+사용자 큐레이션 + 우선순위 조정 | §7 |
| 6 | discard = 완전 삭제 | §9.1 |
| 7 | 적응형 QnA, LLM 판단 기반 완료 | §5 |
| 8 | 요구사항 메모 (이 문서가 설계서) | 본 문서 |
| 9 | 전환 판단 근거 로깅 | §2.6 |
| 10 | 유사/중복 클러스터링 | §4 |
| 11 | Big Bet 최소 체크리스트 | §2.5 |
| 12 | 충돌 감지 + 안전 지점 예약 | §6 |
| 13 | 다축 점수 + 가중치 프로파일 | §3 |
| 14 | discard 시 최소 메타데이터 보존 | §9 |
| 15 | 확신도 기반 질문 정책 | §5.4 |
| 16 | 실행 결과 피드백 → 스코어링 보정 | §8 |
| 17 | 안정화 = "더 빼기 어려운 상태" | §2.1 |
| 18 | 완료 기준 = 복잡도 감소 | §2.3 |
| 19 | 안정화 중 기능 제안 기본 보류 | §2.4 |
