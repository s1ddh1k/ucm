# FactoryOS 설계서

## 0. 문서 목적

이 문서는 **사용자가 아이디어를 제시하면, 시스템이 알아서 리서치부터 설계, 구현, 검증, 릴리즈, 운영, 개선까지 수행하는 자율 소프트웨어 공장(Autonomous Software Factory)** 의 설계도를 정의한다.

대상 문제는 다음과 같다.

- 최근 등장한 OpenClaw, MiniClaw/NanoClaw/NullClaw 계열
- Ouroboros 같은 스펙 우선 + 진화형 루프
- gstack, Gastown, Claw-Empire 같은 멀티에이전트 팀 구조
- OpenHands, SWE-agent, Claude Code, Codex CLI, Cline, Aider 류의 코딩 에이전트
- 24/7 에이전트 런타임, 장기 작업, 자가개선 요구

이 문서에서는 위 흐름을 단일 툴로 복제하는 대신, **여러 종류의 에이전트와 런타임을 하나의 정책 기반 운영체제처럼 묶는 방식**을 제안한다.

문서상 시스템의 이름은 편의상 **FactoryOS** 라고 부른다.

---

## 1. 비전

### 1.1 최종 목표

사용자가 아이디어를 한 줄로 제시하면 FactoryOS는 아래를 수행한다.

1. 요구사항을 명확히 한다.
2. 시장/기술/코드/라이브러리/경쟁 제품 조사를 한다.
3. PRD, ADR, API 명세, 테스트 기준, 보안 모델을 작성한다.
4. 구현 계획을 세운다.
5. 실제 코드를 작성한다.
6. 테스트, QA, 보안 검증을 통과시킨다.
7. 배포한다.
8. 운영 지표를 수집한다.
9. 개선안을 도출한다.
10. 개선안을 다시 구현하고 검증한다.
11. 자기 자신의 실행 전략도 측정 가능한 범위에서 개선한다.

### 1.2 핵심 정의

FactoryOS는 “항상 켜진 긴 대화 세션”이 아니라 다음의 조합이다.

- **Durable Workflow 엔진**
- **격리된 작업 워커들**
- **정책 엔진**
- **이벤트/스케줄 기반 재각성 루프**
- **리서치/설계/구현/릴리즈/운영/개선용 전문 역할 에이전트 집합**

즉, 이 시스템은 채팅봇이 아니라 **자율 소프트웨어 제작 및 운영 플랫폼**이다.

---

## 2. 설계 원칙

### 2.1 Spec-first, Prompt-first 아님

자연어 요청을 바로 코드 생성으로 보내지 않는다.
먼저 다음을 구조화해야 한다.

- 사용자 목표
- 타깃 사용자
- 플랫폼
- 기술 제약
- 예산 제약
- 성능/품질 우선순위
- 법적/보안 제약
- 릴리즈 조건
- 성공 기준

즉, 모든 작업의 출발점은 긴 프롬프트가 아니라 **구조화된 계약 객체**다.

### 2.2 24/7 = Long Context 가 아니라 Durable State

항시 가동은 하나의 모델 세션을 오래 붙잡는 방식으로 구현하지 않는다.
대신 다음으로 구현한다.

- 이벤트 저장
- 상태 스냅샷 저장
- 짧게 살아있는 워커 실행
- 실패 시 재시작 가능
- 스케줄/웹훅/알림 기반 재개

### 2.3 모든 실행은 격리된 워크스페이스에서

각 작업은 반드시 별도 실행 공간을 사용한다.

- Git branch 또는 Git worktree 분리
- 컨테이너 또는 VM 분리
- 네트워크/파일/비밀정보 접근 범위 제한
- 태스크별 리소스 한도 부여

### 2.4 자가개선은 측정 가능한 범위에서만

자가개선은 “좋아 보이는 변경”이 아니라 반드시 아래와 연결되어야 한다.

- 성공률
- 테스트 통과율
- 수정 리드타임
- 비용 대비 성과
- 프로덕션 장애율
- 회귀 발생률

### 2.5 권한은 에이전트가 아니라 정책이 가진다

에이전트는 결정을 제안할 수 있지만, 실제 권한 집행은 정책 엔진이 담당한다.

예를 들어 아래 항목은 무조건 정책 엔진이 제어한다.

- 프로덕션 배포
- 비밀정보 접근
- 외부 SaaS 키 사용
- 결제 연동
- 데이터 삭제
- 대규모 비용 유발 작업

---

## 3. 상위 아키텍처

```text
사용자 아이디어
   ↓
Intent & Interview Layer
   ↓
Research Mesh
   ↓
Spec Compiler
   ↓
Program Manager / Task Graph
   ↓
Worker Swarm
(Research / PM / Architect / Build / QA / Security / Release / SRE / Evolution)
   ↓
Verification Mesh
   ↓
Release Engine
   ↓
Runtime Operations
   ↓
Telemetry + Feedback Lake
   ↓
Improvement Lab
   ↺
```

### 3.1 시스템 성격

FactoryOS는 단일 에이전트가 아니라, 다음 세 층의 결합체다.

1. **Control Plane**: 오케스트레이션, 정책, 메모리, 추적
2. **Execution Plane**: 실제 작업을 수행하는 워커들
3. **Improvement Plane**: 성능 평가와 자가개선 실험실

---

## 4. 핵심 모듈 상세

## 4.1 Intent & Interview Layer

### 목적

사용자의 모호한 아이디어를 실행 가능한 계약으로 바꾼다.

### 입력

- 자유 형식 아이디어
- 첨부 문서, 링크, 예시
- 사용자의 추가 요구

### 출력

`IdeaContract`

```json
{
  "goal": "B2B SaaS용 AI 고객지원 자동화 플랫폼 구축",
  "users": ["운영자", "상담원", "최종 고객"],
  "platforms": ["web", "api"],
  "constraints": {
    "budget": "medium",
    "deadline": "8 weeks",
    "compliance": ["PII minimization"],
    "tech_preferences": ["TypeScript", "PostgreSQL"]
  },
  "success_metrics": [
    "first_response_time < 5s",
    "CSAT proxy >= baseline + 10%",
    "deployment success rate > 98%"
  ],
  "risk_class": "medium"
}
```

### 내부 역할

- Interviewer Agent
- Constraint Extractor
- Ambiguity Resolver
- Acceptance Criteria Writer

### 중요 규칙

- 추상적 요청을 바로 구현 태스크로 넘기지 않는다.
- 정보가 부족하면 시스템이 스스로 가정하되, 그 가정은 명시적으로 기록한다.
- 모든 가정은 추후 사용자가 덮어쓸 수 있어야 한다.

---

## 4.2 Research Mesh

### 목적

필요한 근거를 수집하고 “왜 이렇게 만들었는가”를 설명 가능한 상태로 저장한다.

### 조사 범위

- 문제 영역 조사
- 경쟁 제품 조사
- 라이브러리/프레임워크 조사
- GitHub 레퍼런스 조사
- API/SDK/문서 조사
- 가격/인프라 조사
- 법적/보안 제약 조사
- 유사 오픈소스 구조 분석

### 출력

`ResearchGraph`

```text
Node:
- repo
- article
- documentation
- benchmark
- package
- risk
- decision_evidence

Edge:
- supports
- contradicts
- depends_on
- supersedes
- relevant_to
```

### 설계 포인트

- 조사 결과는 단순 텍스트 요약이 아니라 출처가 연결된 그래프 형태로 저장한다.
- 이후 설계/구현 단계에서 특정 선택의 근거를 역추적할 수 있어야 한다.
- 신뢰도 점수와 최신성 점수를 분리한다.

### 내부 역할

- Web Researcher
- GitHub Researcher
- Package Analyst
- Market Analyst
- Risk Researcher

---

## 4.3 Spec Compiler

### 목적

리서치 결과와 사용자 계약을 소프트웨어 제작에 필요한 공식 문서 묶음으로 변환한다.

### 산출물

최소 산출물은 다음과 같다.

1. **PRD**
2. **User Stories**
3. **Acceptance Tests**
4. **ADR** (아키텍처 결정 기록)
5. **API Spec / Event Schema**
6. **Threat Model**
7. **Observability Plan**
8. **Release Plan**
9. **Runbook 초안**

### 예시 디렉토리

```text
/specs
  /prd
  /adr
  /api
  /qa
  /security
  /release
  /runbooks
```

### 중요 규칙

- 구현 전에 acceptance test 초안을 반드시 만든다.
- 스펙은 살아있는 문서여야 하며, 코드와 동기화 상태를 추적해야 한다.
- 설계 변경 시 ADR이 자동 갱신되어야 한다.

---

## 4.4 Program Manager / Task Graph

### 목적

스펙을 실제 실행 가능한 작업 그래프로 분해한다.

### 출력

`TaskGraph`

```json
{
  "tasks": [
    {
      "task_id": "BE-001",
      "title": "인증 API 구현",
      "role": "backend_engineer",
      "depends_on": ["ARCH-002"],
      "workspace_id": "ws_backend_auth",
      "budget_tokens": 120000,
      "risk_level": "medium",
      "success_checks": [
        "unit_tests_pass",
        "integration_tests_pass",
        "security_scan_clean"
      ]
    }
  ]
}
```

### 설계 포인트

- 태스크는 반드시 입력/출력/의존성/검증 기준을 가진다.
- 태스크를 역할별로 분배하되 역할은 프롬프트 장식이 아니라 책임 경계여야 한다.
- 그래프는 재계획(replanning) 가능해야 한다.

### 내부 역할

- Program Manager Agent
- Dependency Planner
- Budget Allocator
- Risk Router

---

## 4.5 Worker Swarm

### 목적

실제 리서치, 코드 작성, 수정, 테스트, 문서화, 배포 준비를 수행한다.

### 권장 역할 세트

- Researcher
- Product Manager
- Architect
- Frontend Engineer
- Backend Engineer
- Data/Infra Engineer
- QA Engineer
- Security Officer
- Release Engineer
- SRE/Support Engineer
- Evolution Engineer

### 실행 단위

각 워커는 아래 단위를 가진다.

- 명확한 역할 설명
- 도구 접근 범위
- 예산
- 작업 공간
- 정책 레벨
- 메모리 접근 범위

### 워커 인터페이스 예시

```yaml
worker:
  id: backend_engineer_v1
  role: backend_engineer
  model_policy: code_heavy
  tools:
    - git
    - shell
    - test_runner
    - package_manager
  permissions:
    network: limited
    secrets: brokered
    deploy: denied
  workspace: isolated_container
```

### 핵심 설계 포인트

- 워커는 서로의 메모리를 무제한 공유하지 않는다.
- 공용 정보는 아티팩트와 이벤트 로그를 통해 공유한다.
- 코딩 워커와 배포 워커를 명확히 분리한다.

---

## 4.6 Verification Mesh

### 목적

에이전트가 만든 결과물을 검증하고 승급 여부를 결정한다.

### 검증 종류

- 빌드/타입체크/린트
- 단위 테스트
- 통합 테스트
- E2E 테스트
- 실제 브라우저 시나리오 검증
- API 계약 테스트
- 마이그레이션 검증
- 비밀정보 누출 검사
- 정적 보안 분석
- 라이선스 검사
- 성능 회귀 검사
- 접근성 검사
- 문서 동기화 검사

### 출력

`EvidencePack`

```json
{
  "artifact_id": "evp_20260323_001",
  "checks": [
    {"name": "unit_tests", "status": "pass"},
    {"name": "integration_tests", "status": "pass"},
    {"name": "secret_scan", "status": "pass"},
    {"name": "a11y", "status": "warn"}
  ],
  "coverage": 0.81,
  "latency_p95_ms": 420,
  "regressions": [],
  "decision": "promote_to_staging"
}
```

### 중요 규칙

- 통과/실패뿐 아니라 증거물을 남긴다.
- 실패 원인은 자동으로 버그 태스크로 환원된다.
- 재현 가능한 검증 환경을 유지한다.

---

## 4.7 Release Engine

### 목적

검증을 통과한 결과물을 안전하게 릴리즈한다.

### 기본 흐름

```text
PR 생성
→ CI 통과
→ staging 배포
→ canary 배포
→ health check
→ 점진적 rollout
→ release note 자동 생성
→ 운영 모니터링
→ 이상 시 rollback
```

### 릴리즈 정책 예시

- 낮은 위험도: 자동 staging 배포 가능
- 중간 위험도: canary 후 자동 승급 가능
- 높은 위험도: 프로덕션 확장 시 승인 필요
- 치명적 위험도: 자동 배포 금지

### 출력물

- Release Notes
- Deployment Manifest
- Rollback Plan
- Runbook Update

---

## 4.8 Runtime Operations

### 목적

배포 이후 시스템이 계속 운영되고, 문제를 감지하고, 후속 작업을 생성하게 한다.

### 입력 이벤트

- 프로덕션 에러 증가
- 성능 저하
- 고객 피드백
- 신규 GitHub issue
- 크론 스케줄
- 비용 급등
- 보안 취약점 공지

### 처리 루프

```text
운영 이벤트 수신
→ 원인 분류
→ 관련 메트릭/로그/트레이스 수집
→ 개선 또는 핫픽스 태스크 생성
→ 워커 스웜 실행
→ 검증 후 배포
```

### 내부 역할

- Incident Triage Agent
- Observability Analyst
- SRE Worker
- Hotfix Builder

---

## 4.9 Memory & Provenance Layer

### 목적

시스템이 과거 맥락을 활용하되, 무질서한 장문 컨텍스트 대신 질의 가능한 구조화 상태를 사용하게 한다.

### 메모리 유형

#### 1) Artifact Store

문서와 결과물 저장

- PRD
- ADR
- API 문서
- 테스트 리포트
- 릴리즈 노트
- 포스트모템

#### 2) Event Store

누가 무엇을 했는지 시간 순서로 저장

- task.created
- task.started
- tool.called
- verification.failed
- deploy.promoted
- incident.opened

#### 3) Episodic Memory

과거 수행 궤적과 성공/실패 패턴 저장

- 어떤 유형의 버그가 자주 발생했는가
- 어떤 워커 조합이 성과가 좋았는가
- 어떤 프롬프트/전략이 실패했는가

#### 4) Procedural Memory

재사용 가능한 skill, playbook, adapter 저장

- “Next.js 앱 초기 생성” 스킬
- “GitHub Actions 파이프라인 생성” 스킬
- “Postgres migration rollback” 런북

### 중요 규칙

- 메모리는 기본적으로 append-only 이력이 있어야 한다.
- 고위험 변경은 provenance 추적이 가능해야 한다.
- 모델 프롬프트에 메모리를 그대로 던지지 말고, 질의 후 필요한 조각만 주입한다.

---

## 4.10 Improvement Lab

### 목적

제품 개선과 시스템 자기개선을 통제된 실험실에서 수행한다.

### 개선 대상

#### 자동 허용 가능

- 프롬프트 템플릿 개선
- 태스크 분해 전략 개선
- 모델 라우팅 정책 개선
- 테스트 생성 전략 개선
- 재시도 정책 개선

#### 조건부 허용

- 새 tool adapter 추가
- 워커 역할 재배치
- 메모리 질의 전략 변경

#### 엄격 심사

- 오케스트레이터 로직 수정
- 정책 엔진 룰 수정
- 자기 자신 코드 수정

#### 기본 금지 또는 사람 승인 전용

- 비밀정보 정책 변경
- 결제/과금 한도 변경
- 데이터 삭제 규칙 변경
- 프로덕션 무인 대량 배포 조건 완화

### 개선 루프

```text
문제 식별
→ 가설 수립
→ 후보 변경 생성
→ 벤치마크 실행
→ 기준선과 비교
→ 승급 또는 폐기
```

### 핵심 규칙

- 본 시스템과 분리된 샌드박스에서만 실험한다.
- 자기개선은 항상 성능 지표와 연결되어야 한다.
- 개선이 성공해도 바로 전면 반영하지 않고 점진 승급한다.

---

## 5. 제어 평면(Control Plane) 설계

## 5.1 주요 서비스

### 5.1.1 Orchestrator

모든 workflow를 실행하고 상태를 관리한다.

기능:
- workflow 시작/중지/재개
- 태스크 스케줄링
- 재계획 수행
- 실패 복구
- 인간 승인 포인트 연결

### 5.1.2 Policy Engine

행위 허용 여부를 결정한다.

예시 정책:
- 이 워커는 네트워크 접근 가능 여부
- staging 배포는 자동 허용 여부
- production deploy 는 위험도와 시간대 기준 승인 필요 여부
- secret broker 접근 가능한 role 목록

### 5.1.3 Tool Gateway

도구 접근을 중개한다.

지원 대상 예시:
- Git
- GitHub
- 패키지 레지스트리
- 브라우저 자동화
- CI 서버
- 클라우드 API
- 문서 저장소
- 모니터링/로그 시스템

### 5.1.4 Secret Broker

비밀정보를 직접 워커에 주지 않고 대행 사용하게 한다.

예시:
- 배포 서명 키
- 클라우드 토큰
- SaaS API 키

### 5.1.5 Audit & Provenance Service

모든 고위험 행위를 기록한다.

---

## 6. 실행 평면(Execution Plane) 설계

## 6.1 작업 단위

모든 작업은 아래 구조를 따른다.

```json
{
  "task_id": "TASK-123",
  "type": "code_change",
  "role": "backend_engineer",
  "inputs": ["spec://api/auth.md", "repo://service/auth"],
  "workspace": "container://ws_backend_auth",
  "constraints": {
    "max_runtime_sec": 1800,
    "network": "limited",
    "secrets": "broker_only"
  },
  "expected_outputs": [
    "git_diff",
    "tests_added",
    "implementation_notes"
  ]
}
```

## 6.2 격리 모델

권장 우선순위는 다음과 같다.

1. Git worktree 분리
2. 컨테이너 분리
3. 네트워크 정책 분리
4. 파일시스템 sandbox 분리
5. 자격증명 브로커 분리

## 6.3 실패 복구

실패는 크게 네 종류로 분류한다.

- 도구 실패
- 모델 실패
- 환경 실패
- 논리 실패

각 실패는 아래 방식으로 다르게 처리한다.

- 도구 실패: 재시도 또는 대체 도구 사용
- 모델 실패: 다른 모델/전략 재시도
- 환경 실패: 워크스페이스 재생성
- 논리 실패: 스펙 재검토 또는 태스크 재분해

---

## 7. 데이터 모델

## 7.1 핵심 엔티티

### IdeaContract

사용자 요구사항의 구조화 표현

### ResearchGraph

리서치 근거 그래프

### SpecBundle

공식 산출물 묶음

### TaskGraph

실행 그래프

### Workspace

격리된 실행 환경

### EvidencePack

검증 결과 묶음

### ReleaseRecord

릴리즈 기록

### Incident

운영 이슈

### ImprovementExperiment

자가개선 실험 기록

## 7.2 예시 관계

```text
IdeaContract
  └─ produces → ResearchGraph
        └─ compiles_into → SpecBundle
              └─ expands_into → TaskGraph
                    └─ runs_in → Workspace
                    └─ generates → EvidencePack
                          └─ promotes → ReleaseRecord
                                └─ emits → Telemetry
                                      └─ triggers → ImprovementExperiment
```

---

## 8. 정책 계층 설계

## 8.1 권한 레벨

### L0 — Read-only

허용:
- 리서치
- 문서 초안 작성
- 로컬 분석

### L1 — Build

허용:
- 코드 수정
- 테스트 실행
- 브랜치 생성
- PR 생성

### L2 — Pre-release

허용:
- staging 배포
- canary 배포
- 릴리즈 노트 작성
- 문서 갱신

### L3 — Production Controlled

조건부 허용:
- 점진적 production rollout
- 인프라 변경
- 마이그레이션 실행

### L4 — Human-only or Explicit Approval

기본 제한:
- 비밀정보 정책 변경
- 데이터 삭제 정책 변경
- 과금 한도 확대
- 대규모 destructive action

## 8.2 정책 평가 예시

```yaml
policy:
  action: deploy.production.expand_rollout
  allow_if:
    - risk_score < 0.35
    - canary_error_rate < threshold
    - p95_latency_delta < threshold
    - change_type != schema_breaking
  else:
    require_human_approval: true
```

---

## 9. 릴리즈 및 운영 루프 설계

## 9.1 이상적인 자동 흐름

```text
아이디어 수신
→ 인터뷰 및 계약 구조화
→ 리서치
→ 스펙 작성
→ 작업 그래프 생성
→ 구현
→ 검증
→ staging 배포
→ canary
→ production
→ 관측
→ 개선안 도출
→ 반복
```

## 9.2 운영 중 자동 개선 트리거

다음 이벤트가 들어오면 자동 루프를 시작한다.

- 장애 알림
- 전환율 하락
- 사용성 문제 피드백
- 보안 공지
- 비용 초과
- 신규 의존성 취약점
- 경쟁 제품 기능 출시 감지

## 9.3 포스트모템 자동화

심각 장애 발생 시 시스템은 자동으로 아래를 작성한다.

- 장애 요약
- 타임라인
- 근본 원인 후보
- 영향을 받은 서비스/기능
- 완화 조치
- 재발 방지 액션 아이템

---

## 10. 자가개선 설계

## 10.1 자가개선의 범위

FactoryOS가 자가개선을 수행할 수 있는 대상은 두 가지다.

1. **제품 개선**
   - 더 좋은 기능
   - 더 좋은 UX
   - 더 좋은 성능
   - 더 낮은 비용

2. **시스템 개선**
   - 더 좋은 태스크 분해
   - 더 좋은 모델 선택
   - 더 좋은 테스트 생성
   - 더 좋은 회귀 감지

## 10.2 자가개선 방안

### 방법 A: Prompt Evolution

- 여러 프롬프트 템플릿 생성
- 벤치마크 태스크에 실행
- 성능 비교
- 우수 템플릿 채택

### 방법 B: Tool Routing Optimization

- 어떤 태스크에 어떤 도구/모델 조합이 잘 맞는지 학습
- 비용 대비 성능 최적화

### 방법 C: Planner Mutation

- TaskGraph 분해 전략의 후보군 생성
- 성공률과 처리 시간 비교

### 방법 D: Code-level Self-Modification

- 오케스트레이터나 워커 코드를 바꾸는 후보를 생성
- 분리된 샌드박스에서 벤치마크
- 충분한 증거가 있을 때만 승급

## 10.3 자가개선의 안전장치

- 본체와 완전히 분리된 실험 환경 사용
- 기준선 대비 성능 향상이 명확해야 함
- 롤백 가능해야 함
- 정책 레벨 상향은 자가변경 금지
- 고위험 영역은 사람 승인 필요

---

## 11. 권장 기술 스택

## 11.1 Control Plane

- Python 또는 TypeScript 기반 오케스트레이터
- Durable Workflow 엔진
- Postgres
- Object Storage
- 이벤트 버스

## 11.2 Agent / Tool 표준

- MCP 기반 도구 연결
- 필요 시 A2A 형태 에이전트 간 통신 계층
- Git/GitHub/Browser/CI/Cloud adapter

## 11.3 Execution

- Git worktree
- Docker 또는 유사 격리 런타임
- 테스트 전용 ephemeral environment

## 11.4 CI/CD

- GitHub Actions
- GitOps 배포 계층
- staging/canary/production 분리

## 11.5 Observability

- Metrics
- Logs
- Traces
- Error monitoring
- Release correlation

---

## 12. 저장소 구조 제안

```text
factoryos/
  apps/
    orchestrator/
    policy-engine/
    tool-gateway/
    release-engine/
    runtime-ops/
    improvement-lab/
  workers/
    researcher/
    pm/
    architect/
    frontend-engineer/
    backend-engineer/
    qa/
    security/
    sre/
  packages/
    core-types/
    event-schema/
    memory/
    telemetry/
    secrets/
    sandbox/
    task-graph/
  specs/
    system/
    examples/
  runbooks/
  infra/
    ci/
    deploy/
    monitoring/
  benchmarks/
  experiments/
  docs/
```

---

## 13. 대표 워크플로우

## 13.1 신규 제품 생성 워크플로우

```text
1. 아이디어 수신
2. 인터뷰 실행
3. IdeaContract 생성
4. 리서치 실행
5. SpecBundle 생성
6. TaskGraph 생성
7. 구현 워커 병렬 실행
8. Verification Mesh 통과
9. staging 배포
10. canary 배포
11. production 배포
12. 운영 지표 수집
13. 개선 루프 시작
```

## 13.2 버그 수정 워크플로우

```text
1. 운영 알림 또는 이슈 수신
2. 관련 로그/트레이스/최근 변경점 수집
3. 재현 테스트 생성
4. 수정 태스크 생성
5. 격리된 워크스페이스에서 패치 구현
6. 검증 통과
7. canary 배포
8. 증상 해소 여부 확인
9. 포스트모템 작성
```

## 13.3 자기개선 워크플로우

```text
1. 성능 병목 감지
2. 개선 가설 생성
3. 후보 변경 N개 생성
4. 벤치마크 실행
5. 기준선과 비교
6. 우수 후보만 staging 승급
7. 장기 관찰 후 본체 반영
```

---

## 14. 모니터링 및 성공 지표

## 14.1 제품 지표

- 활성 사용자
- 전환율
- 응답 시간
- 오류율
- 이탈률
- 기능 사용률

## 14.2 개발 공장 지표

- idea-to-release lead time
- 테스트 통과율
- PR 생성 성공률
- 자동 수정 성공률
- 재시도율
- 실패 원인 분포
- 릴리즈 실패율

## 14.3 자가개선 지표

- baseline 대비 성공률 향상
- 비용당 처리량 향상
- 회귀 감소율
- incident rate 감소율

---

## 15. 위험 요소와 방어 전략

## 15.1 대표 위험

### 요구사항 오해

방어:
- 인터뷰 단계 강화
- acceptance criteria 선작성
- 주요 가정 명시

### 잘못된 리서치 근거

방어:
- 출처 저장
- 신뢰도/최신성 스코어 분리
- 상충 근거 표시

### 코드 품질 저하

방어:
- 테스트 우선
- EvidencePack 필수화
- 회귀 검증 자동화

### 비밀정보 유출

방어:
- secret broker
- 저장소 스캔
- 최소 권한 원칙
- 네트워크 egress 제어

### 위험한 자가개선

방어:
- 샌드박스 실험실 분리
- 정책 엔진 변경 금지
- 성능 개선 증거 없으면 폐기

### 무한 루프 및 비용 폭주

방어:
- 태스크별 예산/시간 한도
- workflow stop condition
- 비용 기반 circuit breaker

---

## 16. 구현 단계 로드맵

## Phase 1 — Single-repo Autopilot

목표:
- 한 저장소 기준으로 아이디어 → PR → 테스트 → staging 까지 자동화

포함 범위:
- 인터뷰어
- 리서치어
- 스펙 생성기
- 코드 워커
- QA 워커
- 기본 릴리즈 엔진

## Phase 2 — Multi-role Factory

목표:
- 역할 기반 워커 분리
- worktree 격리
- 보안/릴리즈/SRE 워커 추가

포함 범위:
- TaskGraph 고도화
- 증거 기반 승급
- 정책 엔진 강화

## Phase 3 — 24/7 Runtime

목표:
- Git 이벤트, 장애 알림, 사용자 피드백으로 자율 각성

포함 범위:
- 운영 루프
- 포스트모템 자동화
- 핫픽스 자동화

## Phase 4 — Improvement Lab

목표:
- 제품 개선 및 시스템 자기개선 실험실 구축

포함 범위:
- 프롬프트/도구/플래너 진화
- 벤치마크 기반 승급
- 제한적 self-modification

---

## 17. MVP 정의

초기 MVP는 아래 수준을 권장한다.

### 입력

- 사용자의 한 줄 아이디어
- 기술 스택 선호
- 배포 대상

### 자동 수행 범위

- 리서치 요약
- PRD 초안
- 기본 아키텍처
- 저장소 초기화
- 코어 기능 구현
- 테스트 생성
- CI 구성
- staging 배포

### 제외 범위

- 완전 무인 production 대규모 rollout
- 고위험 자기수정
- 결제/파괴적 데이터 변경 자동화

이 범위를 넘어갈수록 정책과 관측 체계가 먼저 성숙해야 한다.

---

## 18. 예시: 사용자의 아이디어가 들어왔을 때

예시 요청:

> “AI가 영업팀의 콜 로그를 분석해서 다음 액션을 제안하는 SaaS를 만들고 싶다.”

FactoryOS의 처리 예시는 다음과 같다.

1. Interview Layer가 타깃 시장, 입력 데이터, 개인정보 범위, 배포 채널, 필수 통합 CRM 등을 질문/가정으로 정리한다.
2. Research Mesh가 경쟁 제품, 통화 요약 모델, CRM 연동 방식, 보안 요구사항을 조사한다.
3. Spec Compiler가 PRD, 데이터 흐름, API 설계, 개인정보 최소화 원칙, acceptance test를 작성한다.
4. Program Manager가 frontend/backend/data/QA/security 태스크 그래프를 만든다.
5. Worker Swarm이 병렬 구현한다.
6. Verification Mesh가 테스트, 보안, 성능, 문서 동기화를 검사한다.
7. Release Engine이 staging → canary → production 순으로 승급한다.
8. Runtime Ops가 실제 사용 로그를 읽어 “어떤 추천 액션이 클릭되는가”를 측정한다.
9. Improvement Lab이 추천 품질을 높이는 개선 실험을 돌린다.

---

## 19. 최종 정리

FactoryOS의 본질은 다음 한 문장으로 요약된다.

> **항상 켜진 단일 AI 비서를 만드는 것이 아니라, 정책 엔진이 경계조건을 정하고, 스펙 엔진이 의미를 고정하고, 조직 엔진이 일을 쪼개고, 격리된 워커들이 실행하고, 검증/배포 계층이 품질을 통제하고, 개선 실험실이 측정 가능한 범위에서만 시스템과 제품을 진화시키는 자율 소프트웨어 공장 OS를 만든다.**

즉, 이 프로젝트의 핵심은 “더 똑똑한 한 명의 에이전트”가 아니라 다음이다.

- 더 좋은 상태 관리
- 더 좋은 정책
- 더 좋은 실행 격리
- 더 좋은 증거 기반 승급
- 더 좋은 개선 루프

이 구조를 제대로 만들면 사용자가 아이디어만 던져도 시스템이 **리서치 → 설계 → 구현 → 검증 → 릴리즈 → 운영 → 개선**의 전체 사이클을 사실상 자동으로 수행할 수 있다.

---

## 20. 다음 구현 문서 후보

이 설계서 다음 단계로 바로 이어질 수 있는 문서는 아래와 같다.

1. `system-architecture.md` — 서비스 간 인터페이스와 배포 구조
2. `db-schema.md` — 핵심 테이블/이벤트 스키마
3. `agent-prompts.md` — 역할별 시스템 프롬프트 초안
4. `workflow-spec.md` — durable workflow 상태 전이 정의
5. `security-policy.md` — 권한, 비밀정보, 배포 승인 규칙
6. `repo-bootstrap.md` — 실제 모노레포 초기 구조와 파일 트리
7. `benchmark-plan.md` — 자가개선용 평가 세트

