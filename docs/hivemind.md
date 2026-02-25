# hivemind 아키텍처

## 설계 원칙

- **외부 의존성 제로**: Node.js 내장 모듈만 사용, npm install 불필요
- **단일 파일 유지**: mem.js 하나에 메모리 엔진 전체를 담아 배포·이해 용이
- **CommonJS 선택**: shebang + require.main 가드로 CLI/라이브러리 겸용

## 메모리 모델

- 에빙하우스 망각 곡선 기반 쇠퇴: `effectiveScore = baseScore * e^(-λt)`
- boost 명령으로 강화 (lastBoosted 갱신, boostCount 증가)
- 정반합 업데이트: 동일 주제 기억 발견 시 LLM이 기존+신규를 합성

## 검색 엔진

- **BM25**: title(x3), tags(x2), summary(x1) 가중치
- **keyword includes**: 정확한 키워드 포함 매칭
- **knowledge graph**: entity-relation triplets 기반 그래프 검색
- **RRF 3-way 결합**: Reciprocal Rank Fusion으로 세 검색 결과 통합

## 지식 그래프

- LLM 기반 엔티티/관계 자동 추출
- 트리플릿 구조: subject, predicate, object + types
- graph.jsonl 저장, GC 연동으로 쇠퇴된 기억의 트리플릿도 정리

## 데몬 (memd)

- Unix 소켓 IPC로 클라이언트-데몬 통신
- 세션 파일 스캔 → 큐 → 처리 파이프라인
- 자동 git commit, GC, auto-boost 주기 실행

## 요약 프롬프트

- P1(결정/이유) / P2(구현 세부) / P3(참고) 우선순위 분류
- SKIP 판정: 의미 없는 세션 자동 건너뛰기
- 대형 트랜스크립트는 파트 분할 후 개별 요약 → 통합

## UCM 통합 현황

### 읽기 경로 (Hivemind → UCM) — 동작함

| 위치 | 파일 | 방식 |
|------|------|------|
| Forge `implement` 스테이지 | `lib/forge/implement.js` | `search()` 호출, 관련 지식 컨텍스트 주입 |
| Forge `design` 스테이지 | `lib/forge/design.js` | `searchHivemind()` 호출 |
| Observer 제안 생성 | `lib/ucmd-observer.js` | `{{HIVEMIND_KNOWLEDGE}}` 템플릿 |

### 쓰기 경로 (UCM → Hivemind) — 부실함

| 위치 | 파일 | 문제 |
|------|------|------|
| Forge 완료 시 `learnToHivemind()` | `lib/forge/index.js:823-868` | 키워드 비어있음 `{}`, kind=`fleeting`(GC 대상), LLM 추출 안함 |

- store를 직접 import해서 hmd 데몬의 dedup/통합 파이프라인 우회
- `summary.md` 없으면 제텔 생성 안 됨

### kind 분류 버그

`lib/hivemind/extract.js:237-242`의 `typeToKind` 매핑이 전부 `"literature"`로 하드코딩:

```js
const typeToKind = {
  pattern: "literature",   // ← 전부 같은 값
  project: "literature",
  discovery: "literature",
  episode: "literature",
};
```

실제 제텔의 `memoryType` 필드에는 분류가 잘 되어있음 (discovery 1131, project 1060, pattern 647, episode 465). kind 매핑만 고치면 해결.

### 없는 것

1. **`ucm init` → hivemind 초기화**: `ucm init`에 hivemind 언급 없음, `hm init`을 별도 실행해야 함
2. **UCM 데몬 → hmd 자동 스폰**: `ucmd.js`에 hivemind 참조 0건
3. **오토파일럿 → 제텔 생성**: `lib/ucmd-refinement.js`의 autopilot 흐름에는 hivemind write가 연결되어 있지 않음
4. **태스크 실패 학습**: Forge 실패 시 제텔 생성 없음, 실패 패턴 유실
5. **Observer 쓰기**: 읽기만 하고 관찰/메트릭/교훈을 hivemind에 쓰지 않음

### 우선순위 제안

1. **typeToKind 매핑 수정** + 기존 3288개 제텔 kind 일괄 업데이트 (`extract.js:237-242`)
2. `ucm init`에 hivemind 초기화 통합
3. `learnToHivemind()` 키워드 추출 + kind 개선
4. 오토파일럿 제텔 생성 (아이템 완료/실패/릴리스)
5. UCM 데몬이 hmd 자동 스폰
