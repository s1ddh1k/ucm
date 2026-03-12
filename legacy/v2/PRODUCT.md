# V2 Product Definition

## 북극성

사용자가 로컬 코드베이스에 대해 목표를 입력하면, 시스템이 격리된 환경에서 반복 실행을 통해 검토 가능한 변경과 검증 근거를 만들고, 사용자는 마지막 승인만 하면 된다.

## 제품이 해결해야 하는 문제

기존 AI 코딩 도구는 한 번의 프롬프트로 초안을 만드는 데는 강하지만, 실제 프로젝트에서는 아래가 부족하다.

- 목표를 코드 변경으로 안정적으로 수렴시키는 반복 실행
- 작업 중단 후 재개
- 원본 브랜치를 오염시키지 않는 격리 실행
- 사람이 승인할 수 있는 최종 diff와 검증 근거

V2는 이 문제를 해결하는 "자율 코딩 실행기"다. 운영 대시보드나 자율 백로그 시스템이 아니라, 한 번의 목표를 끝내는 앱이 우선이다.

## 대상 사용자

- 로컬 코드베이스를 직접 가진 개인 개발자
- 소규모 팀에서 AI가 실제 변경을 끝내주길 원하는 사용자
- 대규모 자율 운영 시스템보다 "한 작업을 끝까지 해내는 실행기"를 원하는 사용자

## 핵심 Job To Be Done

1. 목표를 명확한 Goal Contract로 확정한다.
2. 격리된 worktree에서 실행한다.
3. 구현과 검증을 반복한다.
4. 통과 근거와 diff를 제시한다.
5. 승인하면 main 브랜치에 머지한다.

## Goal Contract

V2의 모든 실행은 아래 계약을 기준으로 한다.

- `goal`: 무엇을 바꾸는가
- `context`: 누가 왜 필요한가
- `acceptance`: 완료를 어떻게 확인하는가
- `constraints`: 피해야 할 것, 지켜야 할 것, 환경 제약

이 계약은 설계 문서가 아니라 실행 계약이다. 길고 복잡한 spec보다 짧고 강한 계약이 우선이다.

## 제품 원칙

- 기본 루프는 짧아야 한다: `goal -> execute -> verify -> review`
- 시스템은 안전과 상태를 책임지고, 세부 구현 전략은 에이전트에 맡긴다
- 고정 파이프라인보다 적응형 루프를 선호한다
- 문서 산출물보다 merge 가능한 결과가 중요하다
- 운영 기능은 코어 실행기 위에 얹는다

## Non-Goals

현재 V2의 1차 목표가 아닌 것:

- 자율 개선 플랫폼
- 프로젝트 단위 제안 큐레이션
- 분석 대시보드
- 조직용 멀티 프로젝트 운영면
- 모든 작업에 대해 고정된 stage 파이프라인 강제

## Core Loop

1. Goal Intake
2. Goal Contract 확정
3. Worktree 생성
4. Execute
5. Verify
6. Retry or Review
7. Merge
8. Cleanup / Resume support

필요할 때만 아래 보조 기능을 호출한다.

- `clarify`: 목표가 모호할 때
- `specify`: acceptance가 약할 때
- `decompose`: 작업 범위가 클 때
- `ux-review`: UI 변경일 때
- `polish`: 반복 실패나 위험 diff일 때

## Forge와의 관계

V2는 제품 코어다. Forge는 제품 그 자체가 아니라 capability source다.

V2가 가져와야 할 것:

- worktree 격리
- approval / reject / resume 흐름
- 로그와 상태 관리
- provider abstraction
- verify / ux-review / polish 같은 선택형 보조 모듈

V2가 당장 가져오지 않아도 되는 것:

- proposal / observer / analytics
- 큐레이션 모드
- 과한 artifact 체계
- 고정형 full pipeline orchestration

## 성공 지표

- 목표 하나가 merge-ready diff까지 도달하는 비율
- 첫 승인 가능한 결과까지 걸리는 시간
- 사람 개입 횟수
- 중단 후 재개 성공률
- verify 반복 후 최종 merge 성공률

## 현재 우선순위

1. Goal Contract 품질 강화
2. resume / recovery 명확화
3. review UX 강화
4. app build/test 경로 안정화
5. adaptive tools 도입

## 구현 방향

- 런타임 중심은 `controller + phase1 + phase2`
- UI는 `goal / run / review` 중심
- 앱은 "한 작업을 끝내는 경험"을 최우선으로 설계
- 운영 기능은 코어 엔진이 충분히 안정된 뒤 별도 레이어로 확장
