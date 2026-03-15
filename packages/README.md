# New Core Packages

이 디렉터리는 새 UCM 코어를 위한 시작점이다.

원칙:

- `legacy/` 코드를 import 하지 않는다.
- 현재 `ucm-desktop` 런타임을 직접 재사용하지 않는다.
- 새 코어의 표준 용어는 `Workspace`, `Mission`, `Run`, `Artifact`, `Release`, `Handoff`, `Steering`, `Note`, `Engine`, `Automation`, `Coordinator`를 따른다.

초기 패키지:

- `contracts/`: 새 코어의 공용 타입과 command/event 계약
- `domain/`: 상태 전이와 핵심 도메인 규칙
- `application/`: 런타임이 호출하는 순수 애플리케이션 로직
