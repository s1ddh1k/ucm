# Gas Town 분석

Steve Yegge의 AI 에이전트 오케스트레이션 시스템 (2025.12, Go)

## 핵심 정체성

- Beads(Git 기반 이슈 트래커) 위에 구축된 멀티 에이전트 오케스트레이션 시스템
- Claude Code 인스턴스 20~30개를 동시에 관리
- tmux를 주 UI로 사용
- 100% 바이브 코딩, 17일 만에 75k LoC, 2000 커밋

## 아키텍처

### 계층 구조

```
Town (본부, Go 바이너리 gt)
├── Mayor (컨시어지, 비서실장)
├── Deacon (데몬 비콘, 순찰 루프)
│   ├── Boot the Dog (5분마다 Deacon 상태 확인)
│   └── Dogs (Deacon의 개인 crew, town 레벨 잡무)
│
└── Rig (프로젝트 = git 저장소)
    ├── Witness (polecat 감시, 장애 해결)
    ├── Refinery (Merge Queue 처리, 지능적 머지)
    ├── Polecats (임시 작업자, 스워밍)
    └── Crew (장기 아이덴티티, 사용자 직접 관리)
```

### 역할별 특성

| 역할 | 범위 | 수명 | 관리자 |
|------|------|------|--------|
| Mayor | Town | 영속 | 사용자 |
| Deacon | Town | 영속(순찰 루프) | 데몬 |
| Dogs | Town | 임시 | Deacon |
| Witness | Rig | 영속(순찰 루프) | Deacon |
| Refinery | Rig | 영속(순찰 루프) | Witness |
| Polecats | Rig | 임시(MR 후 소멸) | Witness |
| Crew | Rig | 장기 | 사용자 |

## MEOW 스택 (Molecular Expression of Work)

작업 표현의 진화 과정:

```
Bead (원자 단위: 이슈)
  ↓
Epic (자식 있는 Bead, 병렬 기본)
  ↓
Molecule (순서화된 워크플로, 임의 형태, 루프/게이트)
  ↓
Protomolecule (템플릿, 변수 치환으로 인스턴스화)
  ↓
Formula (TOML 소스, 매크로 확장 → protomolecule → molecule)
```

### Bead

- Git에 저장되는 JSON 이슈 (한 줄에 하나)
- ID, 설명, 상태, 담당자 보유
- Rig bead (프로젝트 작업) + Town bead (오케스트레이션) 2계층
- 접두사 기반 교차 rig 라우팅 (예: "bd-", "wy-")
- 고정 bead: Role Bead, Agent Bead, Hook — 닫히지 않음

### Molecule

- Bead 체인으로 구성된 워크플로
- 루프, 게이트 지원, 튜링 완전
- 에이전트 충돌/재시작 시에도 생존 (Git에 영속)
- 수용 기준(acceptance criteria)으로 자체 수정 가능

### Wisp (임시 Bead)

- DB에는 존재하지만 JSONL/Git에 미기록
- 순찰/오케스트레이션 워크플로용
- 실행 후 소각(burn), 선택적으로 한 줄 요약으로 압축

### Formula

- TOML 형식의 워크플로 소스
- protomolecule로 "조리(cook)" → molecule로 인스턴스화
- 조합 가능 (예: Rule of Five — 5회 다른 관점 검토)
- Mol Mall (마켓플레이스) 계획 중

## 핵심 원리

### GUPP (Gastown Universal Propulsion Principle)

> Hook에 작업이 있으면, 반드시 실행해야 한다.

- 에이전트 ≠ 세션. 세션은 가축, 에이전트는 영속적 Bead
- 각 에이전트의 Hook(고정 bead)에 molecule을 "sling"
- 세션 충돌/종료 시에도 새 세션이 hook의 작업을 이어받음
- 실제로는 Claude Code의 예의바른 특성상 Nudge 필요 (gt nudge)

### NDI (Nondeterministic Idempotence, 비결정적 멱등성)

- 경로는 비결정적이나 결과는 보장 (에이전트를 계속 투입하는 한)
- 에이전트, Hook, Molecule 모두 Git에 영속 → 내구성 보장
- Temporal의 결정적 리플레이와 대조적 접근

### 핸드오프 (gt handoff)

- "let's hand off"로 우아한 세션 전환
- 작업자가 자신에게 작업을 보내고 → 세션 재시작
- GUPP를 통해 새 세션이 자동으로 이어받음

### gt seance (조상과 대화)

- /resume으로 전임자 세션을 부활시켜 인수인계 정보 확인
- 세션 간 컨텍스트 유실 문제 해결

## 워크플로

### Convoy (작업 주문 단위)

- 모든 sling된 작업을 감싸는 추적 단위 = 기능/티켓
- 여러 스워밍이 하나의 Convoy를 "공격" 가능
- Charmbracelet TUI 대시보드에 표시

### Sling (작업 분배)

```
gt sling <작업> → polecat (또는 다른 작업자)
  ↓
작업자의 Hook에 걸림
  ↓
GUPP에 의해 자동 실행
  ↓
완료 시 Convoy 착지 알림
```

### Patrol (순찰)

- Refinery: 프리플라이트 → MQ 처리 → 포스트플라이트
- Witness: polecat 상태 확인 → refinery 확인 → rig 플러그인 실행
- Deacon: town 플러그인 → 핸드오프 프로토콜 → 작업자 정리
- 지수적 백오프: 작업 없으면 점점 긴 휴식

### Merge Queue

- Refinery가 전담
- 한 번에 하나씩 지능적 머지
- 스워밍 중 베이스라인 변경 대응 (재구상/재구현)
- 작업 유실 불허, 에스컬레이션 허용

## Kubernetes 비교

| 개념 | Gas Town | Kubernetes |
|------|----------|------------|
| 질문 | "끝났는가?" | "실행 중인가?" |
| 최적화 | 완료(completion) | 가동 시간(uptime) |
| 컨트롤 플레인 | Mayor + Deacon | scheduler + controller |
| 노드 | Rig | Node |
| 로컬 에이전트 | Witness | kubelet |
| 작업 단위 | Polecat | Pod |
| 진실의 원천 | Beads (Git) | etcd |
| 작업자 | 인증됨 (CV 체인) | 익명 가축 |

## 강점

1. **Git 기반 내구성**: 에이전트, Hook, Molecule 전부 Git에 영속
2. **우아한 성능 저하**: 부분적으로 끄거나 tmux 없이도 동작
3. **셀프 핸드오프**: 세션 재시작이 자연스러운 워크플로의 일부
4. **조합 가능한 워크플로**: Formula → protomolecule → molecule
5. **자율 운영**: Deacon → Witness → Polecat 계층적 하트비트
6. **메시징 시스템**: Beads 기반 메일/이벤트

## 약점

1. **높은 진입 장벽**: Stage 6~7 이상만 대상
2. **비용**: 여러 Claude Code 계정 필요
3. **혼돈 내성 필요**: 버그 중복 수정, 설계 유실 일상적
4. **성숙도**: 17일차 코드, 안정성 미검증
5. **Beads 종속**: 별도 이슈 트래커 필수
6. **100% 바이브 코딩**: 저자 본인도 코드를 본 적 없음
