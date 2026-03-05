# 설계

## 목적

AI 에이전트가 소프트웨어 프로젝트의 목적을 달성하도록 반복 실행하는 시스템.

## 형태

Electrobun 데스크톱 앱. 시스템은 루프 컨트롤러다. 오케스트레이션하지 않는다. 루프를 돌리고, 에이전트를 스폰하고, JSON 결과를 파싱해서 다음 행동을 결정한다. 나머지는 전부 에이전트에게 맡긴다.

## 원칙

- **최고 품질**: 요구사항 만족이 끝이 아니다. 테스트, 아키텍처, 코드 품질 모두 최고 수준이어야 한다. 설계안에 오류가 있으면 설계 그대로 구현하지 않고 더 나은 방향으로 고친다.
- **반복**: 목적 달성까지 루프한다. 단계를 강제하지 않는다.
- **병렬**: 에이전트에게 프롬프트로 위임한다. 시스템이 오케스트레이션하지 않는다.
- **자율성**: 무엇을 어떤 순서로 할지 에이전트가 판단한다.

## 흐름

두 단계로 구성된다.

### 1단계: 태스크 확정

사용자와 대화하면서 목적을 파악한다. 기술 스택이나 구현 방법을 묻지 않는다. "무엇을 만들고 싶은지", "누가 쓰는지", "어떤 문제를 풀려는지" 수준의 질문만 한다. 기술적 결정은 에이전트가 최고 품질로 알아서 한다.

```
루프 {
  LLM이 프로젝트를 보고 목적에 대해 질문/제안 → 사용자 답변
  목적이 명확해지면 → 태스크로 정리 → 사용자에게 확인
  사용자가 승인하면 종료, 아니면 계속 대화
}
```

목적은 추상적일 수도, 구체적일 수도 있다. 시스템은 동일하게 동작한다.
- "electrobun으로 소프트웨어를 자율적으로 작성하는 desktop app을 만들어줘"
- "claude와 codex 모두 사용할 수 있게 해줘"

### 2단계: 태스크 실행

확정된 태스크를 실제로 만든다. git worktree에서 격리 실행한다.

```
루프 {
  에이전트 스폰 (cwd: worktree, 프롬프트: 태스크) → 작업 → 커밋
  에이전트 스폰 (cwd: worktree, 프롬프트: 태스크) → 검증 → 통과/실패
  통과하면 머지하고 종료
}
```

매 반복이 새 인스턴스이므로 이전 판단에 편향되지 않는다. 실패 시 다음 반복에 실패 이유를 넘기지 않는다. 코드를 유지할지 롤백할지도 검증 에이전트가 판정한다.

통과 후 사용자 승인을 거친다 (auto-approve 옵션으로 생략 가능).

## 에이전트 핸드오프

에이전트 간 핸드오프는 구조화된 JSON으로 한다. 검증 에이전트는 통과/실패, 유지/롤백 등의 판정을 JSON으로 출력하고 시스템이 이를 파싱해서 다음 행동을 결정한다.

## 에이전트 호출

Claude CLI, Codex CLI 모두 지원한다. 설정으로 선택한다. 둘 다 멀티 에이전트 기능이 있으므로 병렬 실행은 프롬프트에 "필요하면 병렬로 진행해라"로 위임한다.

### 스폰 방식

프롬프트는 stdin으로 전달하고, stdout을 파싱한다.

```javascript
const child = spawn(cmd, args, {
  cwd,
  stdio: ["pipe", "pipe", "pipe"],
  env: sanitizedEnv,  // 화이트리스트 기반 환경변수 필터링
  detached: true,     // 부모 종료 시 자식이 따라 죽지 않도록
});
child.stdin.end(prompt);
```

### Claude CLI 플래그

```bash
claude -p \
  --dangerously-skip-permissions \
  --no-session-persistence \
  --output-format stream-json \
  --verbose \
  --model <model>
```

- `-p`: stdin에서 프롬프트를 읽는다
- `--output-format stream-json`: JSONL(줄 단위 JSON)로 출력. `type: "result"` 이벤트에 최종 결과와 토큰 사용량이 들어있다
- `--verbose`: stream-json일 때 필수

### Codex CLI 플래그

```bash
codex exec \
  --ephemeral \
  --dangerously-bypass-approvals-and-sandbox \
  --json \
  --model <model> \
  --cd <cwd> \
  -
```

- `exec`: 실행 서브커맨드
- `--ephemeral`: 세션 저장 안 함
- `-`: stdin에서 프롬프트를 읽는다 (항상 마지막)
- `--cd`: 작업 디렉토리 (Claude는 spawn의 cwd로 설정, Codex는 플래그로 전달)
- 모델에 reasoning effort 레벨(`minimal`/`low`/`medium`/`high`/`xhigh`)을 쓰면 `-c model_reasoning_effort=<level>`로 전달

### 주의사항

- **프로세스 종료**: SIGTERM → 1.2초 대기 → SIGKILL. 프로세스 그룹(`-pid`)과 프로세스 자신 모두에 보내야 한다
- **루프 감지**: 동일한 tool call이 3회 연속 반복되면 에이전트를 kill한다
- **Rate limit**: stderr에서 `rate.limit|429|quota|overloaded` 패턴을 감지하고 지수 백오프로 재시도한다 (5초 → 10초 → 20초 → 40초)
- **출력 크기**: stdout 버퍼를 50MB로 제한한다 (초과 시 앞부분 버림)
- **JSON 추출**: LLM 응답에서 JSON을 꺼낼 때 마크다운 코드블록 → 직접 파싱 → 괄호 위치 탐색 순서로 시도한다
- **타임아웃**: idle(stdout 무응답)과 hard(절대 시간) 두 종류. stdout 데이터 수신 시 idle 타이머를 리셋한다
- **환경변수**: `process.env` 전체를 넘기지 않는다. 아래 화이트리스트만 필터링해서 넘긴다
  - 정확히 일치: `PATH`, `HOME`, `USER`, `SHELL`, `LANG`, `TERM`, `HOSTNAME`, `LOGNAME`, `EDITOR`, `VISUAL`, `DISPLAY`, `TMPDIR`, `TMP`, `TEMP`, `GOPATH`, `GOROOT`, `CARGO_HOME`, `RUSTUP_HOME`, `JAVA_HOME`, `ANDROID_HOME`, `VIRTUAL_ENV`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, `ALL_PROXY`
  - 접두사 일치: `LC_*`, `NODE_*`, `NPM_*`, `NVM_*`, `GIT_*`, `XDG_*`, `SSH_*`, `GPG_*`, `CONDA_*`, `PYENV_*`, `DBUS_*`, `GEMINI_*`, `GOOGLE_*`

## 루프 탈출

- 최대 반복 횟수를 설정한다
- 네트워크 단절, API 제한 등 불의의 상황에서도 탈출한다

## 중단과 재개

에러, 정전, 호출 한도 등으로 멈출 수 있다. 에이전트는 작업 중간중간 git commit으로 마일스톤을 남긴다. 재개 시 마지막 커밋에서 이어간다.
