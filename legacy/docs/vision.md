# UCM Vision

## 목적

UCM(Ultimate Click Machine)은 소프트웨어 변경 요청을 파이프라인으로 구조화해 반복 가능한 방식으로 처리하는 AI 에이전트 오케스트레이션 시스템이다.

핵심 목표는 다음과 같다.
- 요구사항 정제부터 구현/검증/전달까지의 흐름 표준화
- 데몬 기반 태스크 큐로 장시간 작업 안정화
- 검증/승인/자동화 설정을 통한 운영 안전성 확보
- 실행 지식을 Hivemind에 누적해 다음 작업 품질 개선

## 운영 루프

```text
Intake → Clarify/Specify → Design → Implement → Verify → Deliver
                     ↘ (large) Decompose / Integrate
```

그리고 데몬 레벨에서 다음 루프가 함께 돈다.

```text
Observer → Proposal/Curation → Forge 실행 → 결과 반영 → 반복
```

## 시스템 구성

```text
bin/ucm.js           통합 CLI
lib/ucmd.js          데몬(큐/상태/자동화/복구)
lib/forge/           스테이지 실행 엔진
lib/ucm-ui-server.js Dashboard HTTP+WS 서버
web/                 React 대시보드
lib/hivemind/        지식 추출/검색/저장
```

## 현재 동작 원칙

- 태스크는 `pending/running/review/done/failed` 상태로 관리된다.
- 스테이지 게이트는 `stageApproval` 설정으로 자동/수동 승인을 제어한다.
- Observer/Automation은 config 토글(`automation.*`)로 제어한다.
- Merge Queue는 승인 후 통합 안정성을 높이기 위한 별도 큐다.
- Hivemind는 design/implement/observer에서 읽고, Forge 완료 시 쓰기 학습을 수행한다.

## 안전장치

1. 격리 실행: git worktree 기반으로 원본 저장소를 보호한다.
2. 게이트 제어: 수동 승인 스테이지를 통해 위험 변경을 제어한다.
3. 복구 경로: 재시작/재시도/재개(`retry`, `resume`, `abort`)를 제공한다.
4. 릴리즈 검증: `npm run release:check`로 core test + 빌드 + pack 검증을 강제한다.

## 방향성

1. 제안 품질 고도화: Observer/Curation 품질 신호 강화
2. 운영 자동화 정밀화: 프로젝트별 자동화 정책 세분화
3. Hivemind 활용도 확대: 실패/성공 패턴 회수율 개선
4. 릴리즈 신뢰성 강화: 문서-CLI-빌드 결과 일관성 유지
