# UCM 실전 검증 시나리오

현재 구현(`ucm --help`, `lib/core/constants.js`) 기준의 릴리즈 검증 체크리스트.

## 사전 준비

```bash
# UI 서버 시작 (필요 시 데몬 자동 시작)
ucm ui

# 또는 CLI 전용으로 데몬 수동 시작
ucm daemon start
```

- 테스트용 git 저장소를 1개 준비한다(예: `~/git/sample-app`).
- `submit`으로 등록한 태스크는 자동 실행되지 않는다. `start`가 필요하다.
- 파이프라인 이름은 `trivial|small|medium|large`만 사용한다.

## Level 1 — 기본 파이프라인

### S1. `trivial` 파이프라인

**실행**:
- `ucm forge "README 오타 수정" --pipeline trivial --project ~/git/sample-app`

**확인 포인트**:
- [ ] 스테이지 순서가 `implement → verify → deliver`
- [ ] 완료 후 상태가 `review` 또는 `done`으로 전환
- [ ] `ucm diff <id>`에서 실제 코드 변경 확인 가능

### S2. `small` 파이프라인

**실행**:
- `ucm forge "간단한 유틸 함수 추가" --pipeline small --project ~/git/sample-app`

**확인 포인트**:
- [ ] `design → implement → verify → deliver` 순서 실행
- [ ] `summary.md`, `verify.json` 아티팩트 생성

### S3. `medium` 파이프라인

**실행**:
- `ucm forge "로그인 API rate limiting 추가" --pipeline medium --project ~/git/sample-app`

**확인 포인트**:
- [ ] `clarify/specify/design/implement/verify/ux-review/polish/deliver` 순서 실행
- [ ] clarify 질문/답변 결과가 `decisions.md`에 반영

### S4. `large` 파이프라인

**실행**:
- `ucm forge --file ./epic.md --pipeline large --project ~/git/sample-app`

**확인 포인트**:
- [ ] `decompose`, `integrate` 스테이지 실행
- [ ] `tasks.json`(분해 결과), `integrate-result.json` 생성

## Level 2 — 태스크 라이프사이클

### S5. Submit/Start/Status

**실행**:
- `ucm submit ./task.md --project ~/git/sample-app`
- `ucm start <task-id>`
- `ucm status <task-id>`

**확인 포인트**:
- [ ] `pending → running` 상태 전이 확인
- [ ] `ucm list --status running`에서 조회 가능

### S6. Reject/Retry/Delete

**실행**:
- 리뷰 상태에서 `ucm reject <task-id> --feedback "테스트 보강 필요"`
- 실패 상태에서 `ucm retry <task-id>`
- 완료/실패 상태에서 `ucm delete <task-id> --force`

**확인 포인트**:
- [ ] reject 피드백이 재실행 컨텍스트에 반영
- [ ] retry 후 `pending`으로 복귀
- [ ] delete 제약(done/failed) 동작 확인

### S7. Cancel/Abort/Priority

**실행**:
- `running` 상태에서 `ucm abort <task-id>`
- `pending` 상태에서 `ucm priority <task-id> 10`

**확인 포인트**:
- [ ] abort 시 실행 중 파이프라인 중단
- [ ] pending 태스크 우선순위 변경 반영

## Level 3 — 운영 기능

### S8. Stage Approval Gate

**실행**:
- `~/.ucm/config.json`의 `stageApproval.design=false` 설정 후 데몬 재시작
- 태스크 실행 후 `ucm gate approve <task-id>` 또는 `ucm gate reject <task-id> --feedback "..."`

**확인 포인트**:
- [ ] 해당 스테이지에서 승인 대기 상태로 멈춤
- [ ] approve/reject로 다음 단계 또는 실패 처리

### S9. Merge Queue

**실행**:
- `ucm merge-queue`
- `ucm merge-queue retry <task-id>`
- `ucm merge-queue skip <task-id>`

**확인 포인트**:
- [ ] 큐 상태 출력
- [ ] retry/skip 명령의 상태 전이 확인

### S10. Automation/Observer

**실행**:
- `ucm auto`
- `ucm auto set autoPropose on`
- `ucm observe --status`

**확인 포인트**:
- [ ] automation 토글 변경 반영
- [ ] observer 상태 조회 가능

## Level 4 — Refinement API

### S11. Interactive + Autopilot

**실행**:
- UI의 Refinement 기능으로 세션 시작
- 필요 시 API 호출

```bash
curl -s -X POST http://localhost:17172/api/refinement/autopilot \
  -H 'content-type: application/json' \
  -d '{"sessionId":"<session-id>"}'
```

**확인 포인트**:
- [ ] 질문/응답 진행 이벤트가 UI에 반영
- [ ] autopilot 전환 시 남은 항목 자동 완성

## Level 5 — 복구/릴리즈

### S12. 데몬 재시작 복구

**실행**:
- running 태스크 도중 데몬 중지 후 재시작
- `ucm daemon stop && ucm daemon start`

**확인 포인트**:
- [ ] 상태 파일 기준으로 태스크 복구 동작
- [ ] 재실행/재개 가능 여부 확인

### S13. 릴리즈 최소 검증

**실행**:

```bash
npm run release:check
```

**확인 포인트**:
- [ ] `node test/core.test.js` 통과
- [ ] `web` 빌드 성공
- [ ] `ucm-desktop` 빌드 성공
- [ ] `npm pack --dry-run` 성공

## 권장 실행 순서

1. S1 → S3 (기본 파이프라인)
2. S5 → S7 (상태 전이)
3. S8 → S10 (운영 제어)
4. S11 (Refinement)
5. S12 → S13 (복구/릴리즈)
