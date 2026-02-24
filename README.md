# UCM — Ultimate Click Machine

AI 에이전트 오케스트레이션 시스템. 소프트웨어 작업을 파이프라인 단계별로 분해하여 AI가 자동으로 수행한다. 요구사항 정리부터 설계, 구현, 검증, 머지까지 전 과정을 자동화한다.

## 빠른 시작

```bash
# 설치
cd ~/git/ucm && npm install && npm link

# 대시보드 (http://localhost:17172)
ucm ui

# CLI로 작업 시작
ucm forge "로그인 API에 rate limiting 추가" --project ~/git/myapp

# 상태 확인 → 리뷰 → 승인
ucm list
ucm diff <taskId>
ucm approve <taskId>
```

## 아키텍처

```
Browser (Dashboard)
     ↕ HTTP + WebSocket
ucm-ui-server (port 17172)
     ↕ Unix Socket
ucmd (Daemon)
     ↕
ForgePipeline ──→ Git Worktree (격리 실행)
     │
     ├── intake → 복잡도 분류, 파이프라인 자동 결정
     ├── clarify → 요구사항 정제
     ├── specify → 요구사항 명세
     ├── decompose → 대규모 작업 분해
     ├── design → 설계
     ├── implement → 코드 작성 (AI Agent)
     ├── verify → 테스트 + 리뷰 (최대 3회 반복)
     ├── ux-review → 프론트엔드 사용성 점검
     ├── polish → 다관점 코드 품질 개선
     ├── integrate → 하위 태스크 병합
     └── deliver → 결과 정리, 리뷰 대기
```

## 파이프라인

| 파이프라인 | 단계 | 용도 |
|-----------|------|------|
| **trivial** | implement → verify → deliver | 오타, 한 줄 수정 |
| **small** | design → implement → verify → deliver | 함수 추가 |
| **medium** | clarify → specify → design → implement → verify → ux-review → polish → deliver | 일반 기능 |
| **large** | clarify → specify → decompose → design → implement → verify → ux-review → polish → integrate → deliver | 대규모 작업 |

## CLI 명령어

| 명령어 | 설명 |
|--------|------|
| `ucm forge "<설명>" --project <dir>` | 새 작업 시작 |
| `ucm list` | 태스크 목록 |
| `ucm status <id>` | 태스크 상세 상태 |
| `ucm diff <id>` | 변경사항 확인 |
| `ucm logs <id>` | 실행 로그 |
| `ucm approve <id>` | 리뷰 승인 (머지) |
| `ucm reject <id> --feedback "..."` | 반려 (피드백 반영 재작업) |
| `ucm resume <id>` | 중단된 작업 재개 |
| `ucm ui` | 웹 대시보드 |
| `ucm dashboard` | 브라우저에서 대시보드 열기 |
| `ucm submit/start` | 데몬 큐 제출 및 실행 시작 |
| `ucm analyze` | 프로젝트 분석 및 제안 생성 |
| `ucm research` | 프로젝트 리서치 및 전략 제안 |
| `ucm daemon start/stop` | 데몬 관리 |
| `ucm pause/resume/stats` | 데몬 일시정지/재개/통계 |
| `ucm merge-queue` | 머지 큐 상태/재시도/스킵 |
| `ucm observe [--status]` | 수동 관찰 트리거/상태 확인 |
| `ucm chat` | 대화형 AI 관리 모드 |

전체 명령/옵션은 `ucm --help`를 기준으로 한다.

## 독립 도구

| 도구 | 설명 |
|------|------|
| `rsa` | Recursive Self-Aggregation — N개 병렬 실행 + 취합 |
| `qna` | 템플릿 기반 설계 Q&A |
| `spec` | EARS 요구사항 명세 생성 |
| `prl` | 병렬 프롬프트 실행 |
| `hm` / `hmd` | Hivemind 지식 메모리 관리/데몬 |

## Stage Approval Gate

각 스테이지 완료 후 사용자 승인을 받을 수 있는 게이트 기능. Settings에서 스테이지별로 auto-approve를 끄면 해당 스테이지에서 승인 대기한다.

```
✓ clarify ─ ✓ specify ─ ✓ design ─ ⏸ implement ─ ○ verify ─ ○ deliver
                                     ↑ 승인 대기 (amber)
```

기본값은 모든 스테이지 자동 통과 (기존 동작 유지).

## LLM 프로바이더

| 프로바이더 | CLI | 용도 |
|-----------|-----|------|
| `claude` | `claude` | 코드 에이전트 (기본), 브라우저 에이전트 |
| `codex` | `codex` | 코드/브라우저 에이전트 (브라우저 기본) |
| `gemini` | `gemini` | 브라우저 에이전트 |

## 개발

```bash
bash scripts/setup-dev.sh         # 개발 환경 설정
npm test                           # 테스트 실행
cd web && npm run dev              # 프론트엔드 HMR
ucm-dev daemon stop && ucm-dev daemon start   # 개발 데몬
```

릴리즈 전 최소 검증:

```bash
node test/core.test.js
cd web && npm run build
cd ucm-desktop && bun run build
```

## 문서

| 문서 | 설명 |
|------|------|
| [User Guide](docs/user-guide.md) | 설치, CLI, 대시보드, 워크플로 |
| [Architecture](docs/architecture.md) | 시스템 아키텍처, 데몬, Forge, Stage Gate |
| [Development](docs/development.md) | 프로젝트 구조, 모듈 맵, 테스트 |
| [HiveMind](docs/hivemind.md) | 지식 메모리 시스템 |
| [Changelog](CHANGELOG.md) | 릴리즈 변경 이력 |
| [전체 문서 목록](docs/README.md) | 모든 문서 인덱스 |

## 데이터 디렉토리

```
~/.ucm/
├── config.json          # 설정
├── daemon/              # 소켓, PID, 로그
├── tasks/               # pending/running/review/done/failed
├── forge/               # TaskDag
├── artifacts/           # 스테이지 산출물
├── worktrees/           # Git worktree
├── proposals/           # 개선 제안서
└── logs/                # 실행 로그
```
