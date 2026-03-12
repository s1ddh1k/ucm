# UCM Desktop IA

## 목적

이 문서는 `ucm-desktop`의 현재 정보 구조를 정리하고, 1차 탐색 체계를 사용자 작업 기준으로 재구성한 기준안을 남긴다.

대상은 데스크톱 앱 렌더러 내비게이션과 각 화면의 책임 분리다.

## 진단 요약

기존 구조는 도메인 개념은 풍부했지만 탐색 구조는 그 개념을 그대로 반영하지 못했다.

- 내비게이션에 있는 `Memory`, `Settings`가 실제 독립 정보 공간으로 구현되지 않았다.
- `Run` 화면에 실행, 개입, 검토, 전달 책임이 한꺼번에 몰려 있었다.
- 전역 탐색과 현재 mission/run 컨텍스트 전환 규칙이 분리되어 있지 않았다.
- 일부 전역 설정이 사이드바 카드에 섞여 있어 분류 기준이 흐려졌다.

## IA 원칙

1. 1차 탐색은 객체가 아니라 사용자 작업 기준으로 나눈다.
2. 한 화면은 하나의 주 질문에 답해야 한다.
3. 전역 설정은 언제나 예측 가능한 한 위치에 둔다.
4. 실행 중 관찰과 사람 검토는 별도 표면으로 분리한다.
5. 메뉴 레이블과 실제 화면 책임이 일치해야 한다.

## 1차 탐색 구조

```text
UCM Desktop
├─ Home
├─ Monitor
├─ Plan
├─ Execute
├─ Review
└─ Settings
```

## 화면 책임

### Home

앱 진입점이다.

- active workspace 확인
- mission 시작
- mission 재개
- 템플릿 진입

### Monitor

관찰 전용 메인 콘솔이다.

- agent 상태
- 병목
- review 대기
- run graph
- provider pressure

핵심 질문:

- 지금 어디가 막혔는가?
- 누가 일하고 있고 누가 기다리는가?
- 사람이 바로 봐야 하는 것은 무엇인가?

### Plan

mission 정의와 계획 구조화 화면이다.

- goal
- success criteria
- constraints
- phases
- team structure
- risks

핵심 질문:

- 무엇을 성공으로 볼 것인가?
- 어떤 제약 아래에서 일하는가?
- 어떤 팀 구조로 실행할 것인가?

### Execute

현재 run의 실행 표면이다.

- changed files
- patch surface
- run lineage
- execution trace
- terminal trace
- artifact trace
- steering
- emergency stop

핵심 질문:

- 지금 실행이 무엇을 바꾸고 있는가?
- 실행 흐름은 어디서 갈라졌는가?
- 사람이 개입해야 한다면 어디로 해야 하는가?

### Review

검증과 승인 표면이다.

- test results
- decision evidence
- approval queue
- deliverables
- handoff history

핵심 질문:

- 무엇이 검증되었는가?
- 무엇을 승인하면 되는가?
- 어떤 revision이 전달 가능한가?

### Settings

전역 환경 설정 표면이다.

- language
- providers
- runtime defaults
- notifications
- workspace-level environment overview

## 현재 구현 적용 범위

이번 정렬 작업은 아래까지 적용한다.

1. 렌더러 1차 메뉴를 `Home / Monitor / Plan / Execute / Review / Settings`로 변경
2. 기존 `Run` 정보를 `Execute`와 `Review`로 분리
3. `Settings`를 실제 독립 화면으로 구현
4. 사이드바에서 전역 언어 설정을 제거하고 `Settings`로 이동
5. 실체 없는 `Memory` 메뉴는 제거

## 후속 작업

아직 남아 있는 후속 작업은 다음과 같다.

- `Execute` 내부에 `Trace / Artifacts / Intervention` 2차 탭 추가
- `Review` 내부에 `Verify / Approve / Handoff` 2차 탭 추가
- `Settings`를 읽기 전용 카드가 아니라 편집 가능한 설정 폼으로 확장
- `Memory`를 독립 메뉴로 되살릴지, `Plan`과 `Review`의 보조 패널로 둘지 결정
- 트리 테스트 기준의 사용자 검증 수행
