# Hivemind 아키텍처

## 개요

Hivemind는 UCM의 지식 메모리 계층이다. 세션/문서에서 지식을 추출해 제텔(Zettel)로 저장하고, 검색 결과를 Forge/Observer 프롬프트에 주입한다.

핵심 구성은 다음 4가지다.
- `lib/hivemind/store.js`: 디렉토리/파일 저장소, 제텔 CRUD
- `lib/hivemind/indexer.js`: SQLite FTS 인덱스 로드/갱신
- `lib/hivemind/search.js`: BM25 + 키워드 결합 검색
- `lib/hivemind/daemon.js`: 소스 스캔, 큐 처리, 주기 작업(GC/통합/커밋)

## CLI 명령

실제 명령 표면은 `hm --help`, `hmd --help` 기준이다.

### `hm` (지식 메모리 CLI)

```bash
hm init
hm search <query>
hm add [--title <t>] [--file]
hm show <id>
hm list [--kind <k>] [--limit N]
hm link <id1> <id2>
hm ingest [--adapter <name>]
hm gc [--dry-run]
hm reindex
hm stats
hm delete <id>
hm restore <id>
hm context
hm config [validate]
hm config provider [name]
hm docs add <dir>
hm docs remove <dir>
hm docs list
```

### `hmd` (백그라운드 데몬)

```bash
hmd start [--foreground]
hmd stop
hmd status
hmd log [--lines N]
```

## 데이터 디렉토리

기본 루트는 `~/.hivemind/` 이다.

```text
~/.hivemind/
├── config.json
├── zettel/     # 활성 제텔
├── archive/    # 보관 제텔 (GC/정리)
├── index/      # 검색 인덱스(SQLite)
├── sources/    # 어댑터 처리 상태
├── daemon/     # pid/socket/log
└── adapters/   # 사용자 어댑터
```

`ucm init`은 UCM 디렉토리와 함께 Hivemind 기본 디렉토리도 생성한다. 다만 `hmd`를 정상 운영하려면 먼저 `hm init`으로 설정 파일(`~/.hivemind/config.json`)을 준비해야 한다.

## 처리 파이프라인

`hmd`는 어댑터(claude/codex/document)에서 입력을 읽고 다음 순서로 처리한다.

1. 입력 수집 및 큐 적재
2. LLM 기반 추출(`extract.js`)
3. dedup/정리 처리(`lifecycle.js`)
4. 제텔 저장 + 인덱스 반영

주기 작업도 함께 수행한다.
- GC: 쇠퇴 점수 기반 보관 처리
- Consolidation: literature 묶음을 permanent 노트로 통합
- Dedup/Cleanup: 유사 항목 정리, 바디 정규화
- Git commit: 주기적 저장소 커밋

## UCM 통합 지점

### 읽기 경로 (Hivemind → UCM)

- `lib/forge/design.js`: 설계 단계 프롬프트에 검색 결과 주입
- `lib/forge/implement.js`: 구현 단계 프롬프트에 검색 결과 주입
- `lib/ucmd-observer.js`: 관찰/제안 템플릿에 지식 컨텍스트 주입

### 쓰기 경로 (UCM → Hivemind)

- `lib/forge/index.js`의 `learnToHivemind()`가 파이프라인 종료 후 `summary.md`를 permanent 제텔로 저장

## 운영 시 주의사항

- `hm init` 이전에는 `hmd` 자동 스폰이 건너뛰어진다 (`ucmd.js`에서 config 존재 여부 확인).
- Forge 학습 쓰기는 `summary.md`가 없으면 생략된다(실패/중단 태스크는 학습 누락 가능).
- `hm`은 데몬 소켓이 없을 때 일부 명령을 파일 저장소 fallback으로 처리한다.
