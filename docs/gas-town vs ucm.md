# Gas Town vs UCM 비교

> 2025.02 기준. UCM s1ddh1k/ucm 최신 (React 대시보드, Stage Approval Gate, 멀티 프로바이더 등 반영)

## 한 줄 요약

| | Gas Town | UCM |
|---|---|---|
| 정체성 | 멀티 에이전트 스워밍 오케스트레이터 | 결정적 파이프라인 소프트웨어 팩토리 |
| 비유 | 공장장 + 작업반장 + 노동자 떼 | 자동화된 제조 라인 + 품질검사실 |

## 철학 차이

### Gas Town: 처리량 우선, 혼돈 허용

- "대부분 되고, 일부 유실" — 생선을 통에 던지는 비유
- 비결정적 멱등성: 경로는 랜덤이나 결과는 수렴
- 에이전트에게 자율성 부여, 실패 시 재투입
- 사용자 = Product Manager, 아이디어만 던짐

### UCM: 품질 우선, 결정적 게이트

- 12가지 결정적 하네스로 품질 보장
- Stage Approval Gate로 단계별 수동/자동 승인 선택
- 실패 시 반복 루프 (최대 3회) + 적응형 조기 중단
- Observer → Regulator → 자율 개선 루프
- 사용자 = 설계자 겸 최종 승인자

## 아키텍처 비교

### 에이전트 모델

| 측면 | Gas Town | UCM |
|------|----------|-----|
| 에이전트 수 | 20~30 동시 | 최대 3 동시 (UCM_MAX_CONCURRENT) |
| 에이전트 수명 | 영속 아이덴티티 (Bead) | 스테이지별 임시 LLM spawn |
| 역할 분화 | 7가지 전문 역할 | 10가지 스테이지 역할 + Observer + Autopilot |
| 세션 관리 | GUPP 핸드오프, 자동 재시작 | 타임아웃 + 재시도 + resumeFrom 재개 |
| 병렬화 | 스워밍 (N개 polecat) | RSA (N개 LLM, 수렴/발산) + subtask DAG 병렬 |
| LLM 프로바이더 | Claude Code만 | Claude, Codex, Gemini (스테이지별 모델 선택) |

### 작업 표현

| 측면 | Gas Town | UCM |
|------|----------|-----|
| 원자 단위 | Bead (Git JSON) | Task 파일 (~/.ucm/tasks/) |
| 워크플로 | Molecule (Bead 체인, 튜링 완전) | Pipeline (10 스테이지, 조건부 루프) |
| 템플릿 | Formula (TOML) → Protomolecule | Pipeline 프리셋 (trivial/small/medium/large) |
| 조합성 | 높음 (Formula 조합, 루프, 게이트) | 중간 (커스텀 파이프라인 문자열, RSA 내장) |
| 분해 | Epic (자식 Bead, 병렬 기본) | decompose 스테이지 (TaskDag, 병렬 subtask) |
| 저장소 | Git (Beads JSONL) | 파일시스템 (~/.ucm/) + atomic write |

### 상태 관리

| 측면 | Gas Town | UCM |
|------|----------|-----|
| 영속성 | Git 커밋 | 파일시스템 + JSON (atomic write) |
| 에이전트 상태 | Agent Bead + Hook Bead | Forge resumeFrom + artifact 체인 |
| 진행 추적 | Molecule 단계 체크 | Task 상태 + stageHistory + 토큰 추적 |
| 복구 | GUPP — 새 세션이 Hook에서 이어받음 | resumeFrom (특정 스테이지에서 재개 가능) |
| 임시 상태 | Wisp (Git 미기록, 소각) | 없음 (모든 상태 영구 저장) |

### 품질 보장

| 측면 | Gas Town | UCM |
|------|----------|-----|
| 머지 전략 | Refinery (지능적 1:1 머지) | Worktree → approve → merge (lock 기반) |
| 코드 리뷰 | Formula 조합 가능 (Rule of Five) | Polish 스테이지 (4 렌즈 멀티 리뷰) |
| 테스트 | Convoy 완료 시 | Verify 스테이지 (루프, 최대 3회) |
| 브라우저 검증 | 없음 | ux-review (Chrome DevTools MCP, 멀티 프로바이더) |
| 게이트 | Molecule 게이트 bead | Stage Approval Gate (스테이지별 수동/자동 설정) |
| 드리프트 감지 | 없음 (비결정적 허용) | drift-detector (계획 vs 실행 비교) |
| 스펙 준수 | 없음 | EARS 스펙 → verify 시 준수 확인 |

### 자율 운영

| 측면 | Gas Town | UCM |
|------|----------|-----|
| 자가 치유 | Deacon → Boot → Witness 계층적 하트비트 | watchdog (ucm-watchdog.js) |
| 자기 개선 | 없음 (사용자가 설계) | Observer (5 관점 분석) → Regulator → Forge |
| 자율 실행 | Convoy + 스워밍 (밤새 가능) | Autopilot 세션 (planning → execution → review → release) |
| 안전장치 | 없음 (사용자 신뢰) | Regulator (위험도/충돌 차단), selfImprove 설정 |

### 지식 시스템

| 측면 | Gas Town | UCM |
|------|----------|-----|
| 기억 | Beads (이슈로서의 기억) | Hivemind (Zettelkasten + FTS5 + BM25 + 시간 감쇠) |
| 교훈 학습 | Git 히스토리에 축적 | lesson-inject (태그 매칭 + 지수 감쇠) |
| 컨텍스트 주입 | 없음 | context-prefetch + convention-inject + iteration-history |
| 지식 공유 | Beads 메일 | Hivemind daemon (세션 자동 추출, 중복 제거) |

### UI/UX

| 측면 | Gas Town | UCM |
|------|----------|-----|
| 주 UI | tmux | React + Vite + TypeScript 웹 대시보드 |
| 실시간 | gt nudge (tmux send-keys) | WebSocket (stage:*, task:*, daemon:* 이벤트) |
| 대시보드 | Charmbracelet TUI (Convoy 트리) | 칸반 보드, 파이프라인 스텝퍼, 타임라인, 분석 |
| 터미널 | tmux 세션 직접 접근 | xterm.js 내장 터미널 |
| 명령 팔레트 | 없음 | Command Palette (Cmd+K) |
| 프로젝트 관리 | Rig (gt rig add) | 멀티 프로젝트 워크스페이스 내비게이션 |

## 동작 방식 비교: "Rate Limiting 추가" 태스크

### Gas Town 경로

```
1. Mayor에게 "rate limiting 추가해" 말함
2. Mayor → bead 생성 → gt sling → polecat 3마리 스워밍
3. Polecat A: API 미들웨어 구현
   Polecat B: Redis 기반 구현
   Polecat C: 인메모리 구현
4. 각각 MR 제출 → Merge Queue
5. Refinery가 3개 MR 중 최선을 지능적 머지
6. Witness 확인 → Convoy 착지 → Mayor 알림
7. 사용자: "좋아" 또는 "Redis로 가자" → 재작업
```

### UCM 경로

```
1. ucm forge "rate limiting 추가" --project ~/api
2. Intake: 복잡도 medium 분류
3. Clarify: 프로젝트 스캔 → "어떤 전략? 제한 단위? 응답 형태?" Q&A
   → [Stage Gate: design 수동 승인 설정 시 여기서 대기]
4. Specify: EARS 스펙 생성, 7가지 검증 기준 통과
5. Design: 코드베이스 분석 (context-prefetch), 아키텍처 문서 생성
   → [Stage Gate: implement 수동 승인 설정 시 여기서 대기]
6. Implement: 설계 따라 구현 (worktree 격리, convention-inject)
7. Verify: 테스트 실행, 실패 시 재구현 (최대 3회, adaptive-loop)
8. UX Review: Chrome DevTools로 브라우저 테스트
9. Polish: 코드 품질/보안/설계/테스트 4렌즈 리뷰
10. Deliver: 웹 대시보드에서 diff 확인 → approve → main 머지
```

## 강점 비교

### Gas Town이 UCM보다 나은 점

1. **처리량**: 20~30 에이전트 동시 — 대규모 백로그를 하루 만에 소화
2. **에이전트 영속성**: Agent Bead + GUPP로 세션 간 끊김 없는 작업 연속
3. **워크플로 조합성**: Formula → Protomolecule → Molecule 3계층 조합
4. **Merge Queue**: 다수 에이전트의 동시 변경을 Refinery가 지능적 통합
5. **메시징**: Beads 기반 에이전트 간 비동기 통신 (메일, 이벤트)
6. **핸드오프**: "let's hand off"로 자연스러운 세션 전환, gt seance로 전임자 소통

### UCM이 Gas Town보다 나은 점

1. **품질 보장**: 12 하네스 + Stage Approval Gate + drift-detector + EARS 스펙
2. **접근성**: 단일 에이전트로 시작 가능, React 웹 대시보드
3. **구조화된 설계**: Clarify → Specify → Design 순차적 정제, 요구사항 추적 가능
4. **브라우저 검증**: Chrome DevTools MCP로 ux-review 자동화
5. **자기 개선 루프**: Observer (5 관점) → Regulator → Forge → 학습
6. **지식 시스템**: Hivemind (Zettelkasten + FTS5 + BM25 + 시간 감쇠 + 자동 추출)
7. **비용 효율**: 스테이지별 모델 최적화 (sonnet/opus/haiku), 멀티 프로바이더
8. **안전성**: Regulator, Sandbox, atomic write, Stage Gate, 인간 승인
9. **Autopilot**: 구조화된 자율 실행 (planning → execution → review → release)

## 근본적 트레이드오프

```
Gas Town                              UCM
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
처리량 ◄──────────────────────────► 품질
혼돈 허용 ◄───────────────────────► 결정적
에이전트 수 (20~30) ◄────────────► 에이전트 깊이 (10 스테이지)
스워밍 ◄──────────────────────────► 파이프라인
Git 영속 ◄────────────────────────► 파일시스템 (atomic write)
비싸고 빠름 ◄─────────────────────► 저렴하고 꼼꼼
tmux (파워유저) ◄─────────────────► 웹 대시보드 (접근성)
Claude Code 전용 ◄───────────────► 멀티 프로바이더
```

## UCM 개선 제안

Gas Town에서 영감을 받아 UCM에 적용할 수 있는 개선 사항.
UCM의 최신 상태(resumeFrom, Stage Approval Gate, Autopilot 등)를 고려하여 이미 해결된 부분은 제외.

### 1. Merge Queue — 병렬 태스크 지능적 통합 (높은 우선순위)

**현재 상태**: UCM은 최대 3 concurrent 태스크를 지원하고 worktree로 격리하지만, 완료된 태스크들의 머지는 개별 approve로 처리. 같은 파일을 수정한 태스크들이 충돌할 수 있음.

**Gas Town 영감**: Refinery가 Merge Queue를 관리하며 한 번에 하나씩 지능적 머지. 충돌 시 변경 의도를 파악해 재구현.

**UCM 적용안**:
- deliver 스테이지 후 Merge Queue에 enqueue
- 순차 머지, 충돌 시 LLM으로 3-way merge 시도
- 실패 시 원래 태스크의 design 기반으로 재구현
- `ucmd-merge-queue.js` 모듈

**가치**: concurrency를 안전하게 올릴 수 있어 처리량 증가

### 2. 에이전트 영속성 강화 (중간 우선순위)

**현재 상태**: resumeFrom으로 특정 스테이지부터 재개 가능. 하지만 스테이지 내부에서 충돌하면 해당 스테이지 처음부터 재시작.

**Gas Town 영감**: Agent Bead + Hook → molecule의 정확한 지점에서 재개

**UCM 적용안**:
- implement 스테이지 중간 체크포인트: 커밋된 파일 목록과 남은 작업을 `checkpoint.json`에 기록
- LLM spawn 시 체크포인트 컨텍스트 주입 ("이미 완료된 부분: X, 남은 부분: Y")
- worktree의 git 상태 자체가 자연스러운 체크포인트 역할

**가치**: 긴 implement 스테이지의 안정성 향상

### 3. Convoy — 작업 그룹 추적 (중간 우선순위)

**현재 상태**: decompose로 subtask를 만들 수 있지만, 독립 태스크들의 논리적 그룹핑은 없음.

**Gas Town 영감**: Convoy = 여러 태스크를 감싸는 배달 추적 단위

**UCM 적용안**:
- Task 메타데이터에 `convoy` 필드 추가
- `ucm forge "인증 리팩토링" --convoy auth-v2`
- 웹 대시보드에 Convoy별 진행 표시 (기존 칸반에 그룹 레이어)
- Observer가 Convoy 단위로 분석 → 전체 완료 시 릴리스 제안

**가치**: 대규모 작업의 추적성, Autopilot과 결합 시 강력

### 4. 워크플로 조합 (낮은 우선순위)

**현재 상태**: 4가지 파이프라인 프리셋 + 커스텀 문자열. Stage Approval Gate로 유연성 개선됨.

**Gas Town 영감**: Formula → Protomolecule → Molecule 3계층 조합, 루프/게이트/분기

**UCM 적용안**:
- 파이프라인을 YAML로 정의 가능하게 확장
- 조건부 분기 (예: verify 실패 시 design으로 점프)
- 사용자 정의 스테이지 플러그인 (외부 스크립트 실행)
- `~/.ucm/pipelines/` 에 재사용 가능한 파이프라인 저장

**가치**: 프로젝트별 특화 워크플로, 하지만 현재 프리셋으로도 대부분 커버

### 5. 계층적 자가 치유 강화 (낮은 우선순위)

**현재 상태**: ucm-watchdog.js가 존재하지만 기본적인 수준.

**Gas Town 영감**: Deacon → Boot (5분 헬스체크) → Witness → Polecat 다단계 치유

**UCM 적용안**:
- watchdog → 데몬 상태 헬스체크 (메모리, 큐 정체, 좀비 프로세스)
- 태스크 실패 시 자동 재시도 정책 (max 2회, 지수 백오프)
- Autopilot 세션 자동 복구 (세션 상태 파일 기반)
- launchd plist로 데몬 자동 재시작

**가치**: 무인 운영 안정성, Autopilot 장기 실행에 필수

## 결론

Gas Town은 **처리량과 스워밍**에서 UCM을 압도하지만, UCM은 **품질 보장, 자기 개선, 접근성**에서 우위.

UCM에 가장 가치 있는 Gas Town 아이디어는 **Merge Queue**다. worktree 격리가 이미 있으므로, 지능적 머지 레이어만 추가하면 concurrency를 안전하게 올릴 수 있다. 이것이 UCM의 "에이전트 수" 축을 Gas Town 방향으로 확장하는 가장 현실적인 경로.
