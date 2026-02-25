# Changelog

이 프로젝트의 주요 변경사항은 이 문서에 기록한다.

형식은 Keep a Changelog를 따르고, 버전 표기는 Semantic Versioning을 따른다.

## [Unreleased]

### Changed
- 문서의 CLI/릴리즈 안내를 현재 구현(`ucm --help`, `npm run release:check`)과 일치하도록 정리했다.
- Autopilot 제어 예시에서 제거된 `ucm socket ...` 명령을 UI 서버 API 호출 예시로 교체했다.
- `worktree locked` 오류 힌트의 상태 필터를 `running`으로 수정했다.
- `docs/user-guide.md`, `docs/development.md`, `docs/architecture.md`, `docs/hivemind.md`에서 제거된 `ucmd-autopilot.js`/`--autopilot`/`/api/autopilot/*` 참조를 현재 구조(`automation`, `refinement/autopilot`)로 정합화했다.
- `release:check`에 `npm pack --dry-run` 검증 단계를 추가해 빌드 후 패키징 가능 여부까지 확인하도록 강화했다.
- `docs/hivemind.md`를 현재 코드 구조(`hm/hmd`, `~/.hivemind` 디렉토리, Forge/Observer 연동, hmd auto-spawn 조건) 기준으로 재작성했다.
- `docs/verification-scenarios.md`를 현행 파이프라인(`trivial/small/medium/large`)과 운영 명령(`gate`, `merge-queue`, `auto`, `observe`) 기준으로 갱신했다.
- `docs/vision.md`, `docs/README.md`의 구버전 autopilot/시나리오 설명을 현재 아키텍처 표현으로 정리했다.

## [0.2.0] - 2026-02-24

### Note
- 이 버전은 changelog 도입 시점의 기준 베이스라인이다.
