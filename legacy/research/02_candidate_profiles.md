# 후보별 상세 조사 (기능 명세 + 출처)

작성일: 2026-03-05 (KST)  
주의: 성능/비용 수치(예: 메모리, 부팅속도)는 각 프로젝트 README의 **자체 주장**이 섞여 있으므로, 벤치마크 재현 전에는 확정치로 쓰지 않는 것이 안전함.

---

## 1) OpenClaw

한줄 정의: 로컬 게이트웨이 중심의 멀티채널 개인 AI 비서/에이전트 오케스트레이터.

기능 명세 (공식 문서/README 기준):
1. Local-first Gateway: 세션/채널/툴/이벤트를 단일 제어면으로 운영.
2. 멀티채널 인박스: WhatsApp, Telegram, Slack, Discord 등 다수 채널 연동.
3. 멀티에이전트 라우팅: 채널/계정별로 에이전트를 분리해 워크스페이스 격리.
4. Pi runtime 연동: Pi 기반 에이전트를 RPC 모드로 실행.
5. 도구 체계: 브라우저 제어, 캔버스, 노드, cron, 세션 관련 도구 제공.
6. 보안 모델: `main` 세션과 그룹/채널 세션의 샌드박스 정책 분리, Docker 격리 옵션 제공.

공식 출처:
1. https://github.com/openclaw/openclaw
2. https://docs.openclaw.ai/concepts/features
3. https://docs.openclaw.ai/concepts/agent
4. https://docs.openclaw.ai/pi
5. https://github.com/openclaw/openclaw/blob/main/package.json

커뮤니티 출처:
1. https://news.hada.io/topic?id=26122
2. https://news.hada.io/topic?id=26260

---

## 2) Pi (pi-coding-agent / pi-mono)

한줄 정의: 최소 코어를 유지하고 확장(스킬/익스텐션/패키지)에 집중하는 터미널 코딩 하네스.

기능 명세:
1. 기본 툴셋: `read`, `write`, `edit`, `bash` 제공.
2. 멀티 프로바이더 인증: OAuth(`/login`)와 API key 기반 공급자 다수 지원.
3. 세션 트리/브랜칭/컴팩션: 장기 세션 관리와 컨텍스트 압축 기능 제공.
4. 확장 구조: 스킬, 프롬프트 템플릿, 익스텐션, 패키지로 기능 확장.
5. SDK/RPC 모드: 라이브러리 내장 및 stdin/stdout RPC 연동 가능.
6. 철학: 코어는 미니멀, 고급 기능은 외부 확장으로 위임.

공식 출처:
1. https://pi.dev
2. https://github.com/badlogic/pi-mono
3. https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent

OpenClaw 연계 출처:
1. https://docs.openclaw.ai/pi
2. https://github.com/openclaw/openclaw/blob/main/package.json

---

## 3) Claw-Empire (클로제국)

한줄 정의: AI 에이전트를 가상 소프트웨어 회사 조직으로 운영하는 픽셀 오피스 기반 오케스트레이션 UI.

기능 명세:
1. 다중 에이전트 대시보드: CLI/OAuth/API 연동 에이전트 통합 관리.
2. 오피스/부서 시뮬레이션: 부서 단위 협업, 회의, 작업 분배 가시화.
3. Kanban 워크플로: Inbox~Done 단계로 태스크 수명주기 관리.
4. 워크플로 팩: 개발/리포트/웹리서치/소설/영상사전기획/롤플레잉 등 프로파일 제공.
5. Git worktree 격리: 에이전트별 브랜치 격리 후 승인 머지 방식.
6. OpenClaw bridge: `$` 지시문을 `/api/inbox`로 전달하는 통합 흐름 제공.

공식 출처:
1. https://github.com/GreenSheep01201/claw-empire

커뮤니티 출처:
1. https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=1010290&page=1&search_head=120
2. https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=998516&page=1&search_head=120

---

## 4) CLI-JAW

한줄 정의: Web/Terminal/Telegram 인터페이스에서 다중 CLI 에이전트를 묶어 쓰는 개인 비서형 오케스트레이터.

기능 명세:
1. 다중 엔진 묶음: Claude/Codex/Gemini/OpenCode/Copilot CLI 통합 사용.
2. 자동 폴백: 한 엔진 실패 시 다음 엔진으로 대체 수행.
3. PABCD 파이프라인: Plan → Audit → Build → Check → Done 단계형 오케스트레이션.
4. 스킬 시스템: 활성/참조 스킬로 기능 주입(README 기준 100+).
5. MCP 동기화: MCP 설정을 여러 엔진에 공통 반영.
6. 멀티 인스턴스: 프로젝트별 홈 디렉토리/포트 분리 운영.
7. Docker 격리 옵션: 컨테이너 실행 경로 제공.

공식 출처:
1. https://github.com/lidge-jun/cli-jaw
2. https://lidge-jun.github.io/cli-jaw/windows.html

커뮤니티 출처:
1. https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=996034&page=1&search_head=120
2. https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=998580
3. https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=1007881&page=1&search_head=120

---

## 5) NanoBot

한줄 정의: Python 기반 경량 개인 에이전트/게이트웨이 프레임워크.

기능 명세:
1. 경량 코드베이스 지향: README에서 소형 코어를 핵심 가치로 제시.
2. 멀티 채널 연결: Telegram/Discord/WhatsApp/Slack/Email 등 채널 지원.
3. MCP 연동: stdio/HTTP 모드 MCP 서버 연결 지원.
4. 주기 작업: `HEARTBEAT.md` 기반 반복 태스크 실행 흐름 제공.
5. 보안 옵션: workspace 제한(`restrictToWorkspace`) 등 설정 가능.
6. OAuth/Provider 연동: Codex/Copilot 포함 다양한 모델 공급자 설정 경로 제공.

공식 출처:
1. https://github.com/HKUDS/nanobot
2. https://pypi.org/project/nanobot-ai/

커뮤니티 출처:
1. https://news.hada.io/topic?id=26341

---

## 6) NanoClaw

한줄 정의: Claude Code 중심으로 최소 코드/컨테이너 격리를 강조한 개인용 assistant 런타임.

기능 명세:
1. 단일 프로세스 구조: 복잡한 마이크로서비스 대신 단순 구조 지향.
2. 컨테이너 격리: 그룹별 파일시스템/컨텍스트를 컨테이너 단위로 분리.
3. 멀티 채널: WhatsApp/Telegram/Discord/Slack/Gmail 등 스킬 기반 추가.
4. 예약 작업: 반복 실행 태스크를 그룹 컨텍스트와 결합.
5. 스킬 중심 확장: 기능 직접 탑재보다 Claude 스킬로 설치/변환하는 모델 채택.
6. 코드 기반 커스터마이징: 설정 파일 최소화, 포크/코드 수정 전제.

공식 출처:
1. https://github.com/qwibitai/nanoclaw

커뮤니티 출처:
1. https://news.hada.io/topic?id=26337

---

## 7) ZeroClaw

한줄 정의: Rust 기반 저자원/이식성 중심의 OpenClaw 계열 재구현 프로젝트.

기능 명세:
1. Rust 단일 바이너리 지향: 저메모리/빠른 시작을 핵심 가치로 제시.
2. 모듈 스왑 구조: provider/channel/tool/memory/tunnel을 trait 기반으로 교체 가능하도록 설계.
3. 보안 강조: 페어링/샌드박스/allowlist/workspace 스코핑을 핵심 특성으로 제시.
4. 리서치 단계 우선: 응답 전 정보 수집/검증 단계를 강조.
5. 공식 저장소 고지: 임퍼소네이션 경고와 공식 repo 식별 문구 명시.

공식 출처:
1. https://github.com/zeroclaw-labs/zeroclaw
2. https://www.zeroclaw.dev/

커뮤니티 출처:
1. https://news.hada.io/topic?id=26883

검증 메모:
1. 성능 비교표 수치는 프로젝트 자체 벤치마크 주장으로, 제3자 검증 전 확정 지표로 사용 금지.

---

## 8) IronClaw

한줄 정의: Rust + WASM sandbox + PostgreSQL 기반의 보안/운영성 강화형 에이전트 런타임.

기능 명세:
1. WASM 샌드박스: 비신뢰 도구를 capability 기반으로 격리 실행.
2. 멀티 채널/게이트웨이: REPL, HTTP webhook, WASM 채널, 웹 게이트웨이 제공.
3. 루틴/하트비트: cron/event/webhook 기반 백그라운드 자동화.
4. 동적 도구 확장: WASM 플러그인 + MCP 연동.
5. 영속 메모리: PostgreSQL + pgvector 기반 하이브리드 검색 제시.
6. OpenClaw heritage 명시: Rust 재구현 프로젝트로 포지셔닝.

공식 출처:
1. https://github.com/nearai/ironclaw

커뮤니티 출처:
1. https://news.hada.io/topic?id=26883

---

## 9) PicoClaw

한줄 정의: Go 단일 바이너리 기반의 초경량 개인 assistant/gateway 구현.

기능 명세:
1. 저자원 지향: 소형 메모리/빠른 시작/저비용 하드웨어 배치를 핵심 가치로 제시.
2. 채널 지원: Telegram/Discord/WhatsApp/LINE/WeCom 등 연동 경로 제공.
3. 보안 샌드박스: `restrict_to_workspace=true` 기본 + 위험 명령 차단 규칙 명시.
4. 스케줄러: cron 도구 기반 리마인더/반복 작업 수행.
5. 모델 중심 설정: `vendor/model` 규약으로 멀티 프로바이더 확장 구성.
6. 배포 유연성: 사전컴파일 바이너리/소스 빌드/도커 실행 경로 지원.

공식 출처:
1. https://github.com/sipeed/picoclaw
2. https://picoclaw.ai/

커뮤니티 출처:
1. https://news.hada.io/topic?id=26883

검증 메모:
1. 비용/속도/메모리 비교 수치는 README 자기 보고 값이므로 동일 환경 재현 필요.

---

## 커뮤니티 교차 확인 (요약)

1. GeekNews `topic?id=26883` 페이지 본문/댓글 계열에서 `nanoclaw`, `nanobot`, `zeroclaw`, `ironclaw`, `picoclaw`, `openclaw` 동시 언급 확인.
2. 특이점이 온다 갤러리에서 `CLI-JAW`, `클로제국` 릴리즈/업데이트 글 다수 확인.

출처:
1. https://news.hada.io/topic?id=26883
2. https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=1010290&page=1&search_head=120
3. https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=998516&page=1&search_head=120
4. https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=996034&page=1&search_head=120
5. https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=998580
6. https://gall.dcinside.com/mgallery/board/view/?id=thesingularity&no=1007881&page=1&search_head=120

