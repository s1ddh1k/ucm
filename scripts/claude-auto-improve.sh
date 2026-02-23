#!/usr/bin/env bash
set -u -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_PROMPT_FILE="$SCRIPT_DIR/auto-improve-prompt.md"

usage() {
  cat <<'USAGE'
Usage: scripts/claude-auto-improve.sh [options]

Repeat `claude` CLI with an auto-improvement prompt. Designed for 24-hour
unattended operation — retries on rate limits with exponential backoff and
tolerates consecutive failures before stopping.

Options:
  -C, --cwd <dir>            Target project directory (default: current directory)
  -n, --max-iterations <N>   Maximum loop count (default: 9999)
  -s, --sleep <sec>          Sleep between runs in seconds (default: 1)
  -p, --prompt <text>        Custom prompt
  -f, --prompt-file <file>   Read prompt from a file instead of -p
                             (default: scripts/auto-improve-prompt.md)
  -l, --log-dir <dir>        Log directory (default: .claude-auto-improve-logs)
  -m, --model <model>        Model to use (default: not set, uses claude default)
      --max-turns <N>        Max agentic turns per iteration (default: not set)
      --allowedTools <tools> Comma-separated list of allowed tools
      --no-commit            Do not auto-commit changes
      --max-failures <N>     Consecutive non-limit failures before stopping (default: 5)
      --backoff-initial <s>  Initial rate-limit backoff in seconds (default: 60)
      --backoff-max <s>      Maximum rate-limit backoff in seconds (default: 1800)
  -h, --help                 Show this help

Examples:
  scripts/claude-auto-improve.sh
  scripts/claude-auto-improve.sh -C ~/git/ucm -n 50
  scripts/claude-auto-improve.sh -p "프론트엔드에서 개선점 1개를 찾아 수정하고 빌드 확인해"
  scripts/claude-auto-improve.sh -f scripts/ucm-phase3-frontend-prompt.txt -n 10
  scripts/claude-auto-improve.sh --max-turns 30 -m sonnet
USAGE
}

has_limit_error() {
  local file="$1"
  grep -q -i -E \
    'rate[ -]?limit|quota (exceeded|reached)|too many requests|429.*(rate|quota|usage)|usage limit|insufficient credit|credit(s)? (exhausted|depleted)|limit reached|token limit exceeded|요청 한도|한도 초과|쿼터 초과|overloaded' \
    "$file" 2>/dev/null
}

if ! command -v claude >/dev/null 2>&1; then
  echo "[error] claude CLI not found in PATH" >&2
  echo "        install: npm install -g @anthropic-ai/claude-code" >&2
  exit 127
fi

CWD="$(pwd)"
MAX_ITERATIONS=9999
SLEEP_SECONDS=1
LOG_DIR=".claude-auto-improve-logs"
MODEL=""
MAX_TURNS=""
ALLOWED_TOOLS=""
NO_COMMIT=false
MAX_CONSECUTIVE_FAILURES=5
BACKOFF_INITIAL=60
BACKOFF_MAX=1800
PROMPT=""
PROMPT_FILE=""

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
    -f|--prompt-file)
      PROMPT_FILE="${2:-}"
      shift 2
      ;;
    -l|--log-dir)
      LOG_DIR="${2:-}"
      shift 2
      ;;
    -m|--model)
      MODEL="${2:-}"
      shift 2
      ;;
    --max-turns)
      MAX_TURNS="${2:-}"
      shift 2
      ;;
    --allowedTools)
      ALLOWED_TOOLS="${2:-}"
      shift 2
      ;;
    --no-commit)
      NO_COMMIT=true
      shift
      ;;
    --max-failures)
      MAX_CONSECUTIVE_FAILURES="${2:-}"
      shift 2
      ;;
    --backoff-initial)
      BACKOFF_INITIAL="${2:-}"
      shift 2
      ;;
    --backoff-max)
      BACKOFF_MAX="${2:-}"
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

# Resolve prompt: explicit -p > explicit -f > default prompt file > fallback
if [[ -n "$PROMPT_FILE" ]]; then
  if [[ ! -f "$PROMPT_FILE" ]]; then
    echo "[error] prompt file not found: $PROMPT_FILE" >&2
    exit 2
  fi
  PROMPT="$(cat "$PROMPT_FILE")"
elif [[ -z "$PROMPT" ]]; then
  if [[ -f "$DEFAULT_PROMPT_FILE" ]]; then
    PROMPT="$(cat "$DEFAULT_PROMPT_FILE")"
    echo "[info] using default prompt file: $DEFAULT_PROMPT_FILE" >&2
  else
    PROMPT="현재 프로젝트를 분석해서 개선점 1개를 찾아 실제로 수정해. 변경 후 관련 테스트/검증을 실행하고 결과를 짧게 보고해."
  fi
fi

mkdir -p "$LOG_DIR"
START_TS="$(date +%Y%m%d-%H%M%S)"
RUN_LOG="$LOG_DIR/run-$START_TS.log"

echo "[start] cwd=$CWD max_iterations=$MAX_ITERATIONS sleep=${SLEEP_SECONDS}s" | tee -a "$RUN_LOG"
echo "[start] model=${MODEL:-default} max_turns=${MAX_TURNS:-default}" | tee -a "$RUN_LOG"
echo "[start] max_failures=$MAX_CONSECUTIVE_FAILURES backoff=${BACKOFF_INITIAL}s..${BACKOFF_MAX}s" | tee -a "$RUN_LOG"
echo "[start] prompt: ${PROMPT:0:120}..." | tee -a "$RUN_LOG"

CONSECUTIVE_FAILURES=0
BACKOFF_CURRENT="$BACKOFF_INITIAL"

i=1
while [[ "$i" -le "$MAX_ITERATIONS" ]]; do
  echo "" | tee -a "$RUN_LOG"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" | tee -a "$RUN_LOG"
  echo "[iter:$i/$MAX_ITERATIONS] $(date '+%H:%M:%S') start" | tee -a "$RUN_LOG"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" | tee -a "$RUN_LOG"

  OUT_FILE="$LOG_DIR/iter-${START_TS}-${i}.out.log"

  # Build claude command
  CLAUDE_CMD=(claude -p --output-format text)

  if [[ -n "$MODEL" ]]; then
    CLAUDE_CMD+=(--model "$MODEL")
  fi

  if [[ -n "$MAX_TURNS" ]]; then
    CLAUDE_CMD+=(--max-turns "$MAX_TURNS")
  fi

  if [[ -n "$ALLOWED_TOOLS" ]]; then
    CLAUDE_CMD+=(--allowedTools "$ALLOWED_TOOLS")
  fi

  # --dangerously-skip-permissions: run without approval prompts (like codex --dangerously-bypass-approvals-and-sandbox)
  CLAUDE_CMD+=(--dangerously-skip-permissions)

  set +e
  (
    cd "$CWD"
    printf '%s\n' "$PROMPT" | "${CLAUDE_CMD[@]}" 2>&1
  ) | tee "$OUT_FILE" | tee -a "$RUN_LOG"
  EXIT_CODE=${PIPESTATUS[0]}
  set -e

  if [[ "$EXIT_CODE" -ne 0 ]]; then
    if has_limit_error "$OUT_FILE"; then
      echo "" | tee -a "$RUN_LOG"
      echo "[rate-limit] detected at iteration $i, backing off ${BACKOFF_CURRENT}s..." | tee -a "$RUN_LOG"
      sleep "$BACKOFF_CURRENT"
      # Exponential backoff, capped at BACKOFF_MAX
      BACKOFF_CURRENT=$(( BACKOFF_CURRENT * 2 ))
      if [[ "$BACKOFF_CURRENT" -gt "$BACKOFF_MAX" ]]; then
        BACKOFF_CURRENT="$BACKOFF_MAX"
      fi
      continue
    fi
    CONSECUTIVE_FAILURES=$((CONSECUTIVE_FAILURES + 1))
    echo "" | tee -a "$RUN_LOG"
    echo "[fail] claude exited non-zero (code=$EXIT_CODE) at iteration $i (failures: $CONSECUTIVE_FAILURES/$MAX_CONSECUTIVE_FAILURES)" | tee -a "$RUN_LOG"
    echo "       check: $OUT_FILE" | tee -a "$RUN_LOG"
    if [[ "$CONSECUTIVE_FAILURES" -ge "$MAX_CONSECUTIVE_FAILURES" ]]; then
      echo "[stop] max consecutive failures reached ($MAX_CONSECUTIVE_FAILURES)" | tee -a "$RUN_LOG"
      exit 1
    fi
    # Brief cooldown before retry on non-limit failure
    sleep "$((SLEEP_SECONDS + 5))"
    i=$((i + 1))
    continue
  fi

  # Success — reset failure counters
  CONSECUTIVE_FAILURES=0
  BACKOFF_CURRENT="$BACKOFF_INITIAL"

  # Auto-commit if changes were made
  if [[ "$NO_COMMIT" == false ]]; then
    (
      cd "$CWD"
      if ! git diff --quiet HEAD 2>/dev/null || [[ -n "$(git ls-files --others --exclude-standard 2>/dev/null)" ]]; then
        echo "[iter:$i] committing changes..." | tee -a "$RUN_LOG"
        git add -A
        git commit -m "auto-improve: iteration $i

Automated improvement by claude-auto-improve.sh" --no-verify 2>&1 | tee -a "$RUN_LOG"
      else
        echo "[iter:$i] no changes to commit" | tee -a "$RUN_LOG"
      fi
    )
  fi

  echo "[iter:$i] done" | tee -a "$RUN_LOG"
  i=$((i + 1))

  if [[ "$i" -le "$MAX_ITERATIONS" ]]; then
    sleep "$SLEEP_SECONDS"
  fi

done

echo "" | tee -a "$RUN_LOG"
echo "[stop] max iterations reached: $MAX_ITERATIONS" | tee -a "$RUN_LOG"
exit 0
