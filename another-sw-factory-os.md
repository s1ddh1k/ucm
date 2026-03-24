좋아. 다시 생각해서 내 결론을 먼저 말하겠다.

네가 만들려는 것은 “24/7 돌아가는 AI 한 마리”가 아니다. 정답은 상시 가동형 개인 에이전트(OpenClaw 류), 아이디어를 스펙으로 바꾸는 앞단(Ouroboros 류), 역할 분리된 소프트웨어 공장(gstack·Gastown·Claw‑Empire·Codex·Claude Code 류) 을 하나로 묶는 워크플로 운영체제다. OpenClaw는 gateway, hooks, cron, 격리 브라우저 같은 상시 운영 패턴을 보여주고, Ouroboros는 코딩 전에 질문과 평가를 통해 명세를 고정하는 spec-first 방식을 밀고 있다. gstack은 CEO/EM/디자이너/QA/보안/릴리즈 엔지니어처럼 역할을 분리하고, Gastown과 Claw‑Empire는 여러 에이전트를 병렬 worktree와 조직 구조로 운영한다.

질문에 넣은 MiniClaw·NanoClaw·NullClaw 계열은 공식 페이지 기준으로 공통적으로 경량성, 작은 코드베이스, 로컬 실행, 컨테이너/격리 중심 보안을 내세운다. 다만 프로젝트마다 문서 완성도와 검증 수준이 들쑥날쑥해서, 이번 설계서는 그들의 홍보 수치보다 “작고 이해 가능한 신뢰 경계” 라는 방향만 채택한다.

그리고 실제로 이것을 서비스로 만들려면, 단순한 프롬프트 묶음이 아니라 장기 실행, durable execution, 상태/메모리, 승인 후 재개, 서브에이전트, 병렬 작업공간 이 필요하다. LangGraph는 durable execution과 재개를, CrewAI는 Flow 위에 Crew를 얹는 구조를, OpenHands는 event-driven agent server와 risk-based confirmation을, Letta는 장기 실행과 메모리 중심 구조를, Codex와 Claude Code는 병렬 작업공간·서브에이전트·툴 사용 모델을 보여준다.

또 하나. 최근 에이전트 확산은 생산성 기대와 함께 보안, 권한 오남용, 추적성, 비용 문제를 같이 키우고 있다. OpenClaw 보안 문서도 “신뢰 경계”와 액세스 통제를 먼저 세우라고 강조하고, OpenAI/Anthropic의 computer-use 문서도 샌드박스와 인간 감독을 기본 전제로 둔다. 이 프로젝트의 목표는 “최대 자율성”이 아니라 감사 가능한 자율성 이어야 한다.

프로젝트 나침반 설계서 v1.0
아이디어 → 리서치 → 구현 → 릴리즈 → 운영 → 자가개선
1. 북극성

이 시스템의 한 줄 정의는 이렇다.

“사용자가 아이디어를 제시하면, 시스템이 스스로 명세를 만들고, 근거를 모으고, 구현 계획을 세우고, 병렬 작업공간에서 만들고, 테스트/보안/배포를 통과시켜 출시하고, 운영 데이터와 사용자 반응을 바탕으로 다음 개선까지 이어가는 자율 제품 공장.”

핵심은 AI가 똑똑한가가 아니다.
핵심은 흐름이 닫혀 있는가, 산출물이 남는가, 되돌릴 수 있는가, 스스로 다음 개선안을 생성하는가다.

2. 이 프로젝트의 정체성

이 프로젝트의 본체는 에이전트가 아니라 워크플로 엔진이다.

정확히는 아래 식으로 보는 게 맞다.

Autonomous Product Factory = Compass + Atlas + Forge + Judge + Harbor + Pulse + Mirror + Spine

Compass: 아이디어를 명세로 바꾸는 엔진
Atlas: 시장/기술/사용자/경쟁 리서치 엔진
Forge: 설계/계획/구현 엔진
Judge: 테스트/리뷰/보안/품질 게이트
Harbor: 릴리즈/배포/롤백 엔진
Pulse: 운영/관측/인시던트/피드백 엔진
Mirror: 회고/자가개선 엔진
Spine: 메모리/권한/정책/스케줄/감사 로그의 공통 기반
3. 범위와 비범위

이 시스템이 해야 하는 일은 다음이다.

제품 아이디어를 질문으로 정제하고 명세로 잠근다.
웹/문서/코드/시장 자료를 조사해 근거를 축적한다.
구현 계획과 작업 그래프를 만든다.
병렬 worktree/샌드박스에서 코드를 작성하고 수정한다.
리뷰, 테스트, 보안 점검, UX 확인을 통과시킨다.
스테이징, 카나리, 배포, 롤백까지 책임진다.
운영 데이터와 사용자 피드백을 수집해 다음 개선안을 만든다.
프롬프트, 툴 사용 규칙, 평가셋, 워크플로 자체도 개선한다.

반대로 v1에서 하지 말아야 할 일은 명확하다.

처음부터 범용 멀티테넌트 “모든 사람의 모든 계정에 접속하는 에이전트”를 만들지 않는다.
처음부터 프로덕션에 무제한 쓰기 권한을 주지 않는다.
자기 자신의 정책 엔진/시크릿/배포 규칙을 무감독으로 바꾸게 하지 않는다.
대화만 믿고 상태를 넘기지 않는다. 항상 산출물 파일과 이벤트를 남긴다.
사람 승인 없이 결제, 인프라 삭제, 실사용자 데이터 변경, 대량 외부 발송을 하지 않는다.
4. 설계 원칙

이 프로젝트의 헌법은 아래 7개다.

명세가 코드보다 먼저다.
아이디어를 바로 구현하지 않는다. 먼저 문제 정의, 사용자, 성공 지표, 제약, 비범위를 고정한다.
흐름이 에이전트보다 위다.
에이전트는 작업자일 뿐이다. 누가 언제 어떤 단계에서 무엇을 할지는 상태기계가 정한다.
대화가 아니라 산출물이 단계를 통과한다.
각 단계는 대화 로그가 아니라 spec, research dossier, architecture, tasks, evals, release manifest 같은 버전드 산출물을 남긴다.
모든 실행은 격리된다.
작업은 worktree/컨테이너/전용 브라우저 프로필 안에서만 수행한다.
위험한 행동일수록 더 강한 게이트를 지난다.
읽기 < 샌드박스 실행 < 브랜치 쓰기 < 외부 시스템 쓰기 < 프로덕션/파괴적 행동 순으로 승인 강도를 높인다.
관측 가능한 자동화만 허용한다.
모든 에이전트 실행은 이벤트, 비용, 툴 호출, 변경 파일, 테스트 결과를 로그로 남긴다.
자가개선도 하나의 PR이다.
에이전트가 자기 자신을 고치더라도, 그건 “바로 반영”이 아니라 “개선안 생성 → 평가 → 카나리 → 승격” 흐름을 타야 한다.
5. 상위 아키텍처
사용자 아이디어
   ↓
Compass (질문/명세/성공조건)
   ↓
Atlas (리서치/증거/경쟁/기술검증)
   ↓
Forge (설계/작업분해/병렬구현)
   ↓
Judge (리뷰/테스트/보안/품질게이트)
   ↓
Harbor (스테이징/카나리/배포/롤백)
   ↓
Pulse (관측/피드백/인시던트/성능)
   ↓
Mirror (회고/개선가설/자가개선)
   ↺
Spine (메모리/정책/권한/스케줄/감사)
Compass — 명세 엔진

Compass의 목적은 “막연한 아이디어”를 “검증 가능한 작업 계약”으로 바꾸는 것이다.

출력은 최소한 아래를 포함해야 한다.

문제 정의
목표 사용자와 JTBD
성공 지표
비범위
핵심 제약
초기 가설
수용 기준(acceptance criteria)

Compass는 코드를 쓰지 않는다.
Compass가 잠그는 것은 spec.md와 acceptance.yaml이다.
이 단계가 없으면 나머지 자율성은 대부분 소음이 된다.

Atlas — 리서치 엔진

Atlas는 명세를 뒷받침하는 근거를 모은다.

해야 할 일:

시장/경쟁 조사
기술 스택 비교
유사 제품 UX 분석
오픈소스 참고 구조 분석
리스크 레지스터 작성
근거별 신뢰도/날짜/출처 기록

Atlas의 산출물은 research_dossier.md, evidence.jsonl, risks.md다.
이 시스템은 근거 없는 자신감이 아니라 근거가 붙은 제안을 생성해야 한다.

Forge — 설계/구현 엔진

Forge는 스펙과 리서치를 기반으로 실제 제품을 만든다.

Forge는 다음 순서로 움직인다.

아키텍처 결정
ADR 생성
작업 분해
worktree/브랜치 생성
구현 에이전트 배정
병렬 실행
충돌 해결
PR 생성

핵심은 병렬성과 격리를 함께 가져가는 것이다.
한 작업 = 한 worktree = 한 실행 컨텍스트가 원칙이다.

Judge — 검증 엔진

Judge는 단순 테스트 러너가 아니다. 이 프로젝트의 진짜 안전장치다.

Judge가 막아야 하는 것:

테스트 실패
보안 회귀
성능/비용 악화
UX 붕괴
명세 불일치
증거 없는 아키텍처 변경
설명 불가능한 자가개선

Judge는 자동화되어야 하지만, 특정 위험 이상에서는 인간 승인을 받을 수 있어야 한다.

Harbor — 릴리즈 엔진

Harbor는 “머지”가 아니라 “출시”를 책임진다.

포함 범위:

스테이징 배포
데이터 마이그레이션 계획
카나리/점진 배포
릴리즈 노트 생성
롤백 플랜 보장
배포 후 헬스체크
Pulse — 운영 엔진

출시 후부터가 진짜 시작이다. Pulse는 아래를 담당한다.

로그/메트릭/트레이스 수집
사용자 피드백 분류
오류/성능/비용 이상 탐지
인시던트 초안 작성
백로그에 개선안 공급
Mirror — 자가개선 엔진

Mirror는 제품만 고치지 않는다. 프로세스 자체도 고친다.

개선 대상은 4종류다.

제품 개선
프롬프트/스킬 개선
워크플로/정책 개선
모델 라우팅/비용 구조 개선

Mirror의 출력은 항상 proposal 형태여야 한다.
즉, 자가개선은 제안과 실험이지 즉시 반영이 아니다.

Spine — 공통 기반

Spine은 위 모든 것을 받치는 공통 계층이다.

프로젝트 메모리
역할 정의
권한 정책
스케줄러
감사 로그
비용 예산
이벤트 버스
산출물 저장소
비밀 관리
6. 실행 흐름(state machine)

이 시스템은 자유 대화가 아니라 아래 상태기계로 움직여야 한다.

IDEA_RECEIVED
아이디어 수신. 입력을 프로젝트로 등록한다.
DISCOVERY
Compass가 질문을 던져 문제 정의를 정제한다.
SPEC_LOCKED
spec.md, acceptance.yaml, success_metrics.yaml이 생성되면 잠근다.
RESEARCHED
Atlas가 근거를 수집하고 research_dossier.md를 만든다.
ARCH_DECIDED
Forge가 architecture.md와 adr/*.md를 만든다.
TASKS_QUEUED
작업을 tasks.json 또는 issue/board 형태로 분해한다.
BUILDING
구현 에이전트가 병렬 worktree에서 코드를 작성한다.
VERIFIED
Judge가 테스트/리뷰/보안/UX/성능 게이트를 통과시킨다.
RELEASE_CANDIDATE
Harbor가 배포 패키지, 마이그레이션, 롤백 플랜을 만든다.
CANARY / RELEASED
소규모 노출 후 전체 배포한다.
OBSERVING
Pulse가 실제 데이터와 피드백을 수집한다.
IMPROVEMENT_PROPOSED
Mirror가 다음 개선안 또는 자기개선안을 만든다.

이 구조를 택하는 이유는, 최근 툴들이 보여준 것처럼 장기 실행형 시스템은 중간에 멈추고, 승인받고, 다시 이어서 실행할 수 있어야 현실적으로 운영되기 때문이다. Flow/Crew 분리, durable execution, event-driven loop, long-running memory는 이 문제를 푸는 핵심 패턴이다.

7. 역할 조직

역할은 많을수록 좋은 게 아니라, 책임과 권한이 분리될수록 좋다. gstack의 전문 역할 분리, Claude Code의 subagents, OpenClaw류의 AGENTS.md/bootstrap 파일 구조는 이 점에서 좋은 힌트를 준다. 역할은 대화 속 페르소나가 아니라 파일로 버전 관리되는 계약이어야 한다.

최소 역할 조직은 이렇게 가면 된다.

Conductor
전체 상태기계를 소유한다. 직접 코딩보다 배치와 게이트를 책임진다.
Spec Agent
문제 정의와 수용 기준을 만든다.
Research Agent
경쟁, 시장, 기술, 문서를 조사하고 증거를 남긴다.
Product Agent
우선순위, 범위, 일정, KPI를 관리한다.
Architect Agent
시스템 구조와 ADR을 결정한다.
Builder Agents
실제 코드를 구현한다. 한 작업당 한 worktree를 쓴다.
Reviewer Agent
코드 리뷰, 변경 요약, 회귀 위험 분석을 한다.
QA Agent
E2E, 회귀, 시나리오 테스트를 수행한다.
Security Agent
권한, 시크릿, 공급망, 주입 위험을 검사한다.
Release Agent
배포, 릴리즈 노트, 롤백 준비를 담당한다.
Ops Agent
모니터링, 알람, 인시던트 triage를 담당한다.
Learning Agent
회고와 개선 가설을 만든다.

각 역할은 반드시 다음 네 가지를 가진다.

역할 헌장(charter)
허용 툴 목록
입력/출력 산출물 규격
실패 시 에스컬레이션 규칙
8. 산출물 중심 설계

각 단계가 남겨야 하는 표준 산출물은 최소 이 정도다.

spec/brief.md
spec/acceptance.yaml
research/dossier.md
research/evidence.jsonl
design/architecture.md
design/adr/*.md
plan/backlog.json
runs/<run_id>/trace.json
evals/regression/
release/manifest.yaml
release/notes.md
ops/postmortem.md
improvements/proposal.md
memory/project.md
policies/tool_access.yaml

중요한 건 산출물이 다음 단계의 입력이 된다는 점이다.
예를 들어 Builder는 대화 로그를 읽고 일하지 않는다. task, acceptance, ADR, repo conventions를 읽고 일한다.

9. 메모리 구조

장기 실행형 시스템은 메모리를 한 덩어리로 두면 망한다. Letta 계열이 보여주듯, 메모리는 적극적으로 관리되는 계층이어야 하고, LangGraph류 durable execution처럼 실행 상태도 재개 가능해야 한다.

메모리는 5층으로 나눠라.

Working Memory
현재 런의 즉시 컨텍스트. 짧고 휘발성이다.
Project Memory
이 프로젝트의 요구사항, 규칙, ADR, 코딩 스타일, 도메인 지식.
Evidence Memory
리서치 출처, 실험 결과, 경쟁 분석, 운영 데이터.
Procedural Memory
“이런 작업은 이렇게 푼다”는 스킬과 런북.
Reflection Memory
무엇이 실패했고 무엇이 잘 먹혔는지에 대한 회고.

쓰기 규칙도 나눠야 한다.

Working/Evidence는 자동 기록 가능
Project/Procedural은 검증 후 승격
Policy/Security 관련 기억은 인간 승인 필요
10. 보안, 권한, 신뢰 경계

보안 모델은 단순하다.
한 프로젝트 = 한 trust boundary = 한 메모리 공간 = 한 시크릿 스코프다.

OpenClaw 보안 문서가 강조하듯, 지능보다 먼저 권한을 통제해야 한다. OpenHands도 액션 리스크와 확인 흐름을 분리하고, OpenClaw는 전용 브라우저 프로필과 신뢰 경계를 분명히 둔다. computer-use 계열도 샌드박스와 감독이 전제다.

툴 권한은 5단계로 나눠라.

T0 읽기 전용
웹 검색, 문서 읽기, 로그 조회, 코드 읽기
T1 샌드박스 실행
테스트 실행, 빌드, 린트, 코드 생성
T2 저장소 쓰기
브랜치 생성, 파일 수정, 커밋, PR 작성
T3 외부 시스템 쓰기
이슈 생성, 스테이징 배포, 피드백 응답, 비파괴적 API 변경
T4 고위험/파괴적 권한
프로덕션 배포, 데이터 삭제, 결제, 시크릿 변경, 인프라 변경

원칙은 명확하다.

T0/T1은 자동
T2는 프로젝트 정책에 따라 자동 또는 조건부 자동
T3는 기본 승인 필요
T4는 항상 승인 필요

추가로 반드시 넣어야 할 방어선이 있다.

Untrusted content quarantine
웹/이메일/외부 문서를 바로 툴 가능한 에이전트에게 주지 않는다.
Dedicated browser profile
브라우저 자동화는 프로젝트 전용 프로필로 분리한다.
Secrets broker
모델에게 비밀 값을 직접 넘기지 않고, 일회성 토큰/프록시로 중개한다.
Budget guard
토큰 비용, 클라우드 비용, 실행 횟수 상한을 둔다.
Kill switch
반복 실패, 비정상 외부 호출, 정책 위반, 비용 폭주 시 즉시 중단한다.

브라우저/데스크톱 제어는 마지막 수단이어야 한다.
우선순위는 API > 구조화된 CLI > Playwright/DOM 자동화 > computer-use 순으로 잡는 것이 맞다. 공식 문서들도 computer-use를 별도의 행동 루프와 샌드박스/감독 전제 하에 다룬다.

11. 자가개선 설계

여기가 이 프로젝트의 핵심 차별점이다.

자가개선은 두 종류를 섞지 말아야 한다.

제품 개선
기능 추가, 버그 수정, UX 개선
공장 개선
프롬프트, 역할 정의, 스킬, 평가셋, 정책, 모델 라우팅 개선

이 시스템에서 자가개선은 아래 규칙을 따른다.

모든 개선은 먼저 가설이 된다.
가설은 예상 효과를 가진 proposal로 기록된다.
proposal은 branch/worktree에서 구현된다.
구현은 offline eval + historical replay + shadow run을 통과해야 한다.
그 다음 카나리를 거쳐서만 승격된다.
실패하면 자동 롤백한다.

즉, 이 시스템의 자가개선 원칙은 한 문장이다.

“자가개선도 하나의 PR이다.”

이 문장이 중요하다.
자가개선이란 “자기 자신을 몰래 바꾸는 능력”이 아니라, 자기 자신에 대한 개선안을 더 빨리 만들고 검증하는 능력이다.

절대 자동화하지 말아야 할 자기변경 대상은 다음이다.

시크릿 정책
승인 정책
배포 권한
비용 한도
평가기의 기준선 자체
감사 로그 삭제 규칙
12. 운영 모드

이 시스템은 세 가지 모드로 돌아가야 한다.

1) Interactive Mode

사용자와 대화하면서 Compass/Atlas가 움직이는 모드다.
문제 정의, 질문, 우선순위, 피드백 반영에 쓴다.

2) Batch Build Mode

Forge/Judge/Harbor가 주도하는 모드다.
브랜치 생성, 구현, 테스트, PR, 스테이징까지 자동 수행한다.

3) Daemon Mode

Pulse/Mirror가 주도하는 상시 모드다.
OpenClaw 계열이 보여준 hooks/cron/이벤트 기반 자동화처럼, 예약 작업과 이벤트 트리거를 통해 운영/회고/개선을 지속한다.

13. 권장 기술 기준선

현재 시점 기준으로는 새 시스템을 오래 가져갈 수 있는 인터페이스 위에 올리는 게 중요하다. OpenAI 쪽은 Responses API와 Agents SDK를 중심축으로 밀고 있고, Assistants API는 2026년 8월 26일 sunset 일정이 문서화되어 있다. 도구 연결은 MCP를 기본 인터페이스로 잡는 편이 이식성이 좋다. LangGraph는 durable execution에 강하고, CrewAI는 Flow를 상위 제어 계층으로 두는 모델이 선명하며, OpenHands는 코드 에이전트 서버로 현실적이다. Codex와 Claude Code 계열은 병렬 작업공간, 서브에이전트, PR/액션 자동화의 좋은 참고 구현이다. pi-mono 계열은 런타임·코딩 에이전트·UI·배포 레이어를 분리하는 계층적 분해 예시로 볼 만하다.

내 권장안은 이렇다.

오케스트레이터: LangGraph 또는 자체 상태기계
에이전트 런타임: Responses API/Agents SDK 또는 OpenHands 기반
툴 버스: MCP 우선
코드 실행기: Docker 기반 ephemeral worker + git worktree
브라우저 런타임: Playwright 우선, computer-use 보조
메모리/메타데이터: Postgres + vector index + object storage
이벤트/큐: Redis Streams 또는 Postgres queue
관측성: OpenTelemetry + 실행 trace 저장
CI/CD: GitHub Actions + preview/staging/canary
정책 엔진: 간단한 YAML 정책에서 시작, 이후 OPA류로 확장

중요한 건 특정 벤더에 묶이지 않는 것이다.
이 프로젝트는 모델이 아니라 공장 운영체제를 만드는 일이기 때문이다.

14. 초기 서비스 경계

처음부터 마이크로서비스를 너무 잘게 쪼갤 필요는 없지만, 경계는 분명해야 한다.

control-plane
프로젝트, 런, 상태기계, 승인, 이벤트를 관리
worker-runtime
코드 실행, 브라우저 실행, 테스트 실행
memory-service
프로젝트 메모리, 증거, 회고, 스킬 저장
policy-service
툴 권한, 승인 규칙, 예산, 시크릿 접근 제어
artifact-store
spec, research, ADR, eval, release manifest 저장
operator-ui
사람의 감독, 승인, 상태 확인, 회고 확인

초기에는 이걸 모노레포 + 1개 API + 2종 워커로 시작하는 게 맞다.

예시 구조:

/apps/control-plane
/apps/operator-ui
/workers/code-runner
/workers/browser-runner
/packages/agents
/packages/workflows
/packages/policies
/packages/schemas
/packages/memory
/evals
/prompts
/projects
15. 구현 우선순위

이 프로젝트는 욕심을 줄이고 세로로 완성해야 한다.

Phase 1 — Compass + Atlas

목표: 아이디어를 spec과 research로 바꾸는 앞단 완성
완료 기준:

대화형 명세 생성
출처 달린 리서치 도시에
성공 지표/비범위/수용 기준 잠금
리스크 레지스터 작성
Phase 2 — Forge + Judge (repo-local)

목표: 한 저장소에서 브랜치 생성 → 구현 → 테스트 → PR까지 자동화
완료 기준:

task → worktree 매핑
병렬 구현 에이전트
테스트/리뷰/보안 게이트
PR 자동 생성
Phase 3 — Harbor

목표: 스테이징/카나리/롤백 포함 릴리즈 자동화
완료 기준:

release manifest
preview/staging 배포
카나리 체크
롤백 자동화
Phase 4 — Pulse

목표: 출시 후 데이터를 기반으로 다시 개선할 수 있게 만들기
완료 기준:

오류/성능/비용/피드백 수집
인시던트 triage
개선 backlog 생성
Phase 5 — Mirror

목표: 제품 개선과 공장 개선을 분리해 자가개선 루프 완성
완료 기준:

prompt/skill/policy/model-routing proposal 생성
replay eval
shadow run
canary promotion
16. 첫 버전의 현실적인 제약

v1은 이렇게 좁혀야 한다.

단일 사용자
단일 Git 제공자
단일 저장소 또는 소수 저장소
단일 배포 타깃
웹앱 또는 API 서비스 한 종류
프로덕션은 승인형
자가개선은 프롬프트/스킬/작업 분배부터 시작

이 제약을 두지 않으면, 네가 만드는 것은 제품이 아니라 끝없는 플랫폼 작업이 된다.

17. 최종 판단

이 프로젝트의 본질은 “AI가 쉬지 않고 일한다”가 아니다.
본질은 아이디어를 명세로, 명세를 코드로, 코드를 릴리즈로, 릴리즈를 운영 데이터로, 운영 데이터를 다음 개선으로 잇는 닫힌 루프다.

그래서 네가 만들어야 할 것은 초지능 한 마리가 아니라,

“명세-증거-작업공간-검증-릴리즈-관측-학습을 묶는 자율 제품 공장 운영체제” 다.

다음 턴에서는 이 설계서를 바로 구현 가능한 리포 구조, 서비스 API, 상태 전이, DB 스키마 수준으로 쪼개서 1차 기술 명세로 내려가면 된다.
