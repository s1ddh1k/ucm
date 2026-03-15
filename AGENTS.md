# UCM 프로젝트 구조

## 구성요소

```
Desktop (ucm-desktop/) 현재 제품 경로, Electron 런타임 + React UI
    ↕ packages/*
Packages (packages/)  contracts/domain/application 코어
    ↕ shared execution
Execution (packages/execution/) provider/local shell/worktree 실행 엔진
    ↕ reference-only
Legacy (legacy/)      과거 CLI/daemon/web/연구용 자산 아카이브

Hivemind / Forge      legacy 안의 참고 구현. 새 코드에서는 직접 import 금지
```

## 통신 경로

- **Desktop renderer ↔ main**: Electron IPC
- **Desktop main ↔ packages/application**: in-process 호출
- **Desktop main ↔ packages/execution**: shared run/session/worktree execution
- **Legacy CLI/Web/Daemon**: 참고용으로만 유지, 현재 활성 제품 경로 아님

## 데이터 디렉토리

- Electron `userData/runtime-state.db` — 데스크톱 런타임 저장소
  - `runtime_state_store`: canonical snapshot
  - `runtime_workspace_index`
  - `runtime_mission_index`
  - `runtime_run_index`
  - `runtime_release_index`
  - `runtime_handoff_index`
- legacy `~/.ucm/`, `~/.hivemind/` — 참고 대상
- `~/.hivemind/` — 지식 저장소 (zettel/, index/, archive/)

## 포트

| 용도 | 포트 | 비고 |
|------|------|------|
| Legacy Web UI | 17172 | reference-only |
| Desktop dev server | 17173 | `npm run desktop:dev` |

## 테스트

```bash
cd ucm-desktop && npm run build         # 데스크톱 빌드
cd ucm-desktop && npm run test:runtime  # main/runtime 테스트
cd ucm-desktop && npm run test:smoke    # Electron 스모크 테스트
```

## 작업 시 참고

- 현재 제품 작업은 `ucm-desktop/`과 `packages/`를 기준으로 진행한다
- 현재 제품 목표는 데스크톱 앱 하나이며, web/cli 재활성화는 범위 밖으로 본다
- `legacy/*` 코드는 읽기 전용 참고 자료로만 사용한다
- 저장소 변경 시 snapshot과 SQLite index projection을 같이 고려한다
- 실행 변경 시 `packages/execution`과 `runtime_run_index` projection을 함께 본다
- 런타임 변경은 `test:runtime`과 `test:smoke`까지 확인한다
