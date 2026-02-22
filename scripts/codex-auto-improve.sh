#!/usr/bin/env bash
set -u -o pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/codex-auto-improve.sh [options]

Repeat `codex exec` with an auto-improvement prompt until a usage limit is detected
or max iterations is reached.

Options:
  -C, --cwd <dir>            Target project directory (default: current directory)
  -n, --max-iterations <N>   Maximum loop count (default: 9999)
  -s, --sleep <sec>          Sleep between runs in seconds (default: 1)
  -p, --prompt <text>        Custom prompt
  -l, --log-dir <dir>        Log directory (default: .codex-auto-improve-logs)
  -h, --help                 Show this help

Examples:
  scripts/codex-auto-improve.sh
  scripts/codex-auto-improve.sh -C ~/git/ucm -n 50
  scripts/codex-auto-improve.sh -p "프로젝트에서 개선점 1개 찾아 수정하고 테스트까지 수행해"
USAGE
}

has_limit_error() {
  local file="$1"
  rg -i -n \
    -e '\brate[ -]?limit( exceeded| reached)?\b' \
    -e '\bquota( exceeded| reached)?\b' \
    -e 'too many requests' \
    -e '\b429\b.*(too many requests|rate limit|quota|usage)' \
    -e 'usage limit( exceeded| reached)?' \
    -e 'insufficient credit(s)?' \
    -e 'credit(s)? (exhausted|depleted)' \
    -e 'limit reached' \
    -e 'token limit exceeded' \
    -e '요청 한도' \
    -e '한도 초과' \
    -e '쿼터 초과' \
    "$file" >/dev/null 2>&1
}

has_limit_error_in_stdout_events() {
  local file="$1"
  rg -i -n \
    -e '"type":"error".*(rate[ -]?limit|usage limit|quota|too many requests|429|insufficient credit|limit reached)' \
    -e '^(error|fatal).*(rate[ -]?limit|usage limit|quota|too many requests|429|insufficient credit|limit reached)' \
    "$file" >/dev/null 2>&1
}

if ! command -v codex >/dev/null 2>&1; then
  echo "[error] codex command not found in PATH" >&2
  exit 127
fi

CWD="$(pwd)"
MAX_ITERATIONS=9999
SLEEP_SECONDS=1
LOG_DIR=".codex-auto-improve-logs"
PROMPT="현재 프로젝트를 분석해서 개선점 1개를 찾아 실제로 수정해. 변경 후 관련 테스트/검증을 실행하고 결과를 짧게 보고해."

while [[ $# -gt 0 ]]; do
  case "$1" in
    -C|--cwd)
      CWD="${2:-}"
      shift 2
      ;;
    -n|--max-iterations)
      MAX_ITERATIONS="${2:-}"
      shift 2
      ;;
    -s|--sleep)
      SLEEP_SECONDS="${2:-}"
      shift 2
      ;;
    -p|--prompt)
      PROMPT="${2:-}"
      shift 2
      ;;
    -l|--log-dir)
      LOG_DIR="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[error] unknown option: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if ! [[ "$MAX_ITERATIONS" =~ ^[0-9]+$ ]] || [[ "$MAX_ITERATIONS" -le 0 ]]; then
  echo "[error] --max-iterations must be a positive integer" >&2
  exit 2
fi

if ! [[ "$SLEEP_SECONDS" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
  echo "[error] --sleep must be a non-negative number" >&2
  exit 2
fi

if [[ ! -d "$CWD" ]]; then
  echo "[error] directory not found: $CWD" >&2
  exit 2
fi

mkdir -p "$LOG_DIR"
START_TS="$(date +%Y%m%d-%H%M%S)"
RUN_LOG="$LOG_DIR/run-$START_TS.log"

echo "[start] cwd=$CWD max_iterations=$MAX_ITERATIONS sleep=${SLEEP_SECONDS}s" | tee -a "$RUN_LOG"

i=1
while [[ "$i" -le "$MAX_ITERATIONS" ]]; do
  echo "" | tee -a "$RUN_LOG"
  echo "[iter:$i] codex exec start" | tee -a "$RUN_LOG"

  OUT_FILE="$LOG_DIR/iter-${START_TS}-${i}.out.log"
  ERR_FILE="$LOG_DIR/iter-${START_TS}-${i}.err.log"

  set +e
  printf '%s\n' "$PROMPT" | codex exec \
    --ephemeral \
    --dangerously-bypass-approvals-and-sandbox \
    --json \
    --cd "$CWD" \
    - \
    > >(tee "$OUT_FILE" | tee -a "$RUN_LOG") \
    2> >(tee "$ERR_FILE" >&2 | tee -a "$RUN_LOG" >&2)
  EXIT_CODE=$?
  set -e

  if [[ "$EXIT_CODE" -ne 0 ]]; then
    if has_limit_error "$ERR_FILE" || has_limit_error_in_stdout_events "$OUT_FILE"; then
      echo "[stop] usage limit detected at iteration $i" | tee -a "$RUN_LOG"
      exit 0
    fi
    echo "[stop] codex exited non-zero (code=$EXIT_CODE) at iteration $i" | tee -a "$RUN_LOG"
    echo "       check: $OUT_FILE / $ERR_FILE" | tee -a "$RUN_LOG"
    exit "$EXIT_CODE"
  fi

  echo "[iter:$i] done" | tee -a "$RUN_LOG"
  i=$((i + 1))

  if [[ "$i" -le "$MAX_ITERATIONS" ]]; then
    sleep "$SLEEP_SECONDS"
  fi

done

echo "[stop] max iterations reached: $MAX_ITERATIONS" | tee -a "$RUN_LOG"
exit 0
