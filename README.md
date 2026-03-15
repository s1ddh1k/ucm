# UCM

현재 제품 경로는 [ucm-desktop](./ucm-desktop) 입니다.
현재 제품 목표도 데스크톱 앱 하나에 집중합니다.

기존 UCM CLI, daemon, web, 연구용 자산은 [legacy](./legacy) 아래로 분리했고, 현재는 reference-only 아카이브로 취급합니다.

현재 구조 분석과 목표 아키텍처는 [docs/architecture-redesign.md](./docs/architecture-redesign.md) 에 정리했습니다.

데스크톱 런타임 상태는 `userData/runtime-state.db`에 저장되며, 내부적으로는 canonical snapshot + `workspace/mission/run/release/handoff` 인덱스 테이블을 함께 유지합니다.
공통 실행 계층은 `packages/execution`에 있고, provider session과 local workspace command를 같은 run session 모델로 처리합니다. workspace command는 run 단위 git worktree에서 실행됩니다.

빠른 실행:

```bash
npm run desktop:dev
```
