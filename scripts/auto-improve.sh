#!/usr/bin/env bash
set -u -o pipefail

# mise로 설치된 도구(bun 등)를 비대화형 셸에서도 사용 가능하게 활성화
if command -v mise >/dev/null 2>&1; then
  eval "$(mise activate bash)"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROMPTS_DIR="$SCRIPT_DIR/prompts"
ORIG_CWD="$(pwd)"

# ── usage ──

usage() {
  cat <<'USAGE'
Usage: scripts/auto-improve.sh [options] [PROMPT_NUMBER]

Unified auto-improvement loop for codex and claude.
Repeats AI agent execution with a selected prompt until rate-limited,
max iterations reached, or consecutive failures exceeded.

Backend:
  --codex                    Use OpenAI Codex (default if codex is found)
  --claude                   Use Anthropic Claude Code
  Auto-detected if only one is installed.

Prompt Selection:
  PROMPT_NUMBER              Select a numbered prompt (e.g. 1, 02, 6)
  --list                     List all available prompts
  -p, --prompt <text>        Custom inline prompt
  -f, --prompt-file <file>   Read prompt from a file

  If no prompt is specified and stdin is a terminal, an interactive menu
  is shown. Otherwise falls back to the default prompt file.

Options:
  -C, --cwd <dir>            Target project directory (default: current directory)
  -n, --max-iterations <N>   Maximum loop count (default: 999)
  -s, --sleep <sec>          Sleep between runs in seconds (default: 1)
  -l, --log-dir <dir>        Log directory (default: .auto-improve-logs)
  -m, --model <model>        Model to use (default: backend default)
      --max-turns <N>        Max agentic turns per iteration (claude only)
      --allowedTools <tools> Comma-separated allowed tools (claude only)
      --no-commit            (deprecated, no-op)
      --max-failures <N>     Consecutive non-limit failures before stopping (default: 5)
      --max-rate-retries <N> Max rate-limit retries before stopping (default: 20)
      --backoff-initial <s>  Initial rate-limit backoff in seconds (default: 60)
      --backoff-max <s>      Maximum rate-limit backoff in seconds (default: 1800)
      --idle-timeout <s>     Kill agent if no output for this many seconds (default: 120)
  -h, --help                 Show this help

Examples:
  scripts/auto-improve.sh --list              # list prompts
  scripts/auto-improve.sh 1                   # prompt #01, auto-detect backend
  scripts/auto-improve.sh --claude 3 -n 10    # claude, prompt #03, 10 iterations
  scripts/auto-improve.sh --codex 2 -m o3     # codex, prompt #02, o3 model
  scripts/auto-improve.sh -p "커스텀 프롬프트" # inline prompt
USAGE
}

# ── prompt listing ──

list_prompts() {
  echo "Available prompts (scripts/prompts/):"
  echo ""
  local f num name title
  for f in "$PROMPTS_DIR"/[0-9]*.md; do
    [[ -f "$f" ]] || continue
    num=$(basename "$f" | grep -o '^[0-9]*')
    name=$(basename "$f" .md | sed 's/^[0-9]*-//')
    # first line comment: <!-- title: ... -->
    title=$(head -1 "$f" | sed -n 's/^<!-- *//;s/ *-->$//;p')
    [[ -z "$title" ]] && title=$(basename "$f" .md | sed 's/^[0-9]*-//')
    printf "  %s  %-24s  %s\n" "$num" "$name" "$title"
  done
  echo ""
}

resolve_prompt_by_number() {
  local num
  num=$(printf '%02d' "$((10#$1))")
  local match
  match=$(ls "$PROMPTS_DIR"/${num}-*.md 2>/dev/null | head -1)
  if [[ -z "$match" ]]; then
    echo "[error] prompt #${num} not found in $PROMPTS_DIR" >&2
    list_prompts >&2
    exit 2
  fi
  echo "$match"
}

random_prompt_file() {
  local files=()
  for f in "$PROMPTS_DIR"/[0-9]*.md; do
    [[ -f "$f" ]] && files+=("$f")
  done
  if [[ ${#files[@]} -eq 0 ]]; then
    echo "[error] no prompt files found in $PROMPTS_DIR" >&2
    exit 2
  fi
  local idx=$(( RANDOM % ${#files[@]} ))
  echo "${files[$idx]}"
}

interactive_prompt_menu() {
  if [[ ! -t 0 ]]; then
    # stdin is not a terminal — pick random
    random_prompt_file
    return
  fi
  echo "" >&2
  list_prompts >&2
  printf "Select prompt number (or q to quit): " >&2
  read -r choice
  [[ "$choice" == "q" || "$choice" == "Q" ]] && exit 0
  if ! [[ "$choice" =~ ^[0-9]+$ ]]; then
    echo "[error] invalid choice: $choice" >&2
    exit 2
  fi
  resolve_prompt_by_number "$choice"
}

# ── require option value ──

require_arg() {
  if [[ $# -lt 3 ]] || [[ "$3" -lt 2 ]]; then
    echo "[error] $1 requires a value" >&2
    exit 2
  fi
}

# ── rate limit detection ──

has_limit_error() {
  local file="$1"
  [[ -f "$file" ]] || return 1
  grep -q -i -E \
    'rate[ -]?limit|quota (exceeded|reached)|too many requests|429.*(rate|quota|usage)|usage limit|insufficient credit|credit(s)? (exhausted|depleted)|limit reached|token limit exceeded|요청 한도|한도 초과|쿼터 초과|overloaded' \
    "$file" 2>/dev/null
}

# ── codex JSONL line processor ──
# Processes a single JSONL line. Uses global CODEX_TURN_TS for state.

CODEX_TURN_TS=""

parse_codex_line() {
  local line="$1"
  [[ -z "$line" ]] && return

  local parsed RS=$'\x1e'
  parsed=$(printf '%s' "$line" | jq -r '
    [
      (.type // "-"),
      (.thread_id // "-"),
      (.item.type // "-"),
      (.item.command // "-"),
      (.item.exit_code // "-" | tostring),
      (.item.aggregated_output // "" | length | tostring),
      (.usage.input_tokens // "-" | tostring),
      (.usage.output_tokens // "-" | tostring),
      (.usage.cached_input_tokens // "-" | tostring)
    ] | join("\u001e")
  ' 2>/dev/null) || return

  local evt_type tid item_type item_cmd item_exit item_out_len tok_in tok_out tok_cached
  IFS="$RS" read -r evt_type tid item_type item_cmd item_exit item_out_len tok_in tok_out tok_cached <<< "$parsed"
  [[ "$tid" == "-" ]] && tid=""
  [[ "$item_cmd" == "-" ]] && item_cmd=""
  [[ "$item_exit" == "-" ]] && item_exit=""
  [[ "$tok_in" == "-" ]] && tok_in=""
  [[ "$tok_out" == "-" ]] && tok_out=""
  [[ "$tok_cached" == "-" ]] && tok_cached=""

  local text cmd elapsed
  case "$evt_type" in
    thread.started)
      printf '\033[2m[session]\033[0m %s\n' "$tid"
      ;;
    turn.started)
      CODEX_TURN_TS=$(date +%s)
      printf '\033[2m[turn]\033[0m thinking...\n'
      ;;
    item.started)
      if [[ "$item_type" == "command_execution" && -n "$item_cmd" ]]; then
        cmd=$(printf '%s' "$item_cmd" | sed -E "s|^/[^ ]*/[a-z]+ +-[a-z]+ +['\"]?||; s|['\"]$||")
        [[ ${#cmd} -gt 120 ]] && cmd="${cmd:0:117}..."
        printf '\033[33m  ▶ %s\033[0m\n' "$cmd"
      fi
      ;;
    item.completed)
      case "$item_type" in
        agent_message)
          text=$(printf '%s' "$line" | jq -r '.item.text // empty' 2>/dev/null)
          if [[ -n "$text" ]]; then
            printf '\n\033[1;32m── agent ─────────────────────────────\033[0m\n'
            printf '%s\n' "$text"
            printf '\033[1;32m──────────────────────────────────────\033[0m\n\n'
          fi
          ;;
        command_execution)
          cmd=$(printf '%s' "$item_cmd" | sed -E "s|^/[^ ]*/[a-z]+ +-[a-z]+ +['\"]?||; s|['\"]$||")
          [[ ${#cmd} -gt 120 ]] && cmd="${cmd:0:117}..."
          if [[ "$item_exit" == "0" ]]; then
            printf '\033[32m  ✓ %s\033[0m' "$cmd"
          else
            printf '\033[31m  ✗ %s\033[0m' "$cmd"
          fi
          [[ "$item_out_len" -gt 0 ]] 2>/dev/null && printf '  \033[2m(%s chars)\033[0m' "$item_out_len"
          printf '\n'
          if [[ "$item_exit" != "0" && -n "$item_exit" ]]; then
            printf '%s' "$line" | jq -r '.item.aggregated_output // empty' 2>/dev/null | head -8 | sed 's/^/       /'
          fi
          ;;
        reasoning)
          text=$(printf '%s' "$line" | jq -r '.item.text // empty' 2>/dev/null | head -1)
          if [[ -n "$text" ]]; then
            [[ ${#text} -gt 100 ]] && text="${text:0:97}..."
            printf '\033[2m[think] %s\033[0m\n' "$text"
          fi
          ;;
        error)
          text=$(printf '%s' "$line" | jq -r '.item.message // empty' 2>/dev/null)
          printf '\033[31m[error] %s\033[0m\n' "$text"
          ;;
      esac
      ;;
    turn.completed)
      elapsed=""
      if [[ -n "$CODEX_TURN_TS" ]]; then
        elapsed="$(( $(date +%s) - CODEX_TURN_TS ))s"
      fi
      if [[ -n "$tok_in" ]]; then
        printf '\033[2m[tokens] in=%s out=%s' "$tok_in" "$tok_out"
        [[ -n "$tok_cached" ]] && printf ' cached=%s' "$tok_cached"
        [[ -n "$elapsed" ]] && printf ' elapsed=%s' "$elapsed"
        printf '\033[0m\n'
      fi
      ;;
    error)
      text=$(printf '%s' "$line" | jq -r '.message // empty' 2>/dev/null)
      printf '\033[31m[error] %s\033[0m\n' "$text"
      ;;
  esac
}

# ── poll file for new lines ──
# Runs in current shell — no persistent pipes, no buffering issues.
# Agent writes to file in background; we poll and process new lines here.

wait_and_stream() {
  local file="$1" donefile="$2" mode="${3:-raw}"
  local last=0 total line
  local idle_start
  idle_start=$(date +%s)

  while [[ ! -f "$donefile" ]]; do
    total=$(wc -l < "$file" 2>/dev/null | tr -d ' ') || total=0
    if [[ "$total" -gt "$last" ]]; then
      while IFS= read -r line; do
        if [[ "$mode" == "jsonl" ]]; then
          parse_codex_line "$line"
        else
          printf '%s\n' "$line"
        fi
      done < <(awk -v s="$((last + 1))" -v e="$total" 'NR>=s && NR<=e' "$file")
      last=$total
      idle_start=$(date +%s)
    else
      local now
      now=$(date +%s)
      if [[ $((now - idle_start)) -ge "$IDLE_TIMEOUT" ]]; then
        echo "[timeout] no output for ${IDLE_TIMEOUT}s, killing agent" | tee -a "$RUN_LOG"
        [[ -n "$CHILD_PID" ]] && kill "$CHILD_PID" 2>/dev/null
        return 1
      fi
    fi
    sleep 0.2
  done

  # Final flush — agent is done, process any remaining lines
  sleep 0.1
  total=$(wc -l < "$file" 2>/dev/null | tr -d ' ') || total=0
  if [[ "$total" -gt "$last" ]]; then
    while IFS= read -r line; do
      if [[ "$mode" == "jsonl" ]]; then
        parse_codex_line "$line"
      else
        printf '%s\n' "$line"
      fi
    done < <(awk -v s="$((last + 1))" 'NR>=s' "$file")
  fi
}

# ── signal handling ──

CHILD_PID=""
cleanup() {
  local exit_code=$?
  [[ -n "$CHILD_PID" ]] && kill "$CHILD_PID" 2>/dev/null
  # clean up sentinel files
  rm -f "$LOG_DIR"/*.done 2>/dev/null
  if [[ -n "${RUN_LOG:-}" && -f "${RUN_LOG:-}" ]]; then
    echo "" >> "$RUN_LOG"
    echo "[stop] interrupted (signal) at iteration ${i:-?}" >> "$RUN_LOG"
  fi
  echo ""
  echo "[stop] interrupted at iteration ${i:-?}"
  exit "$exit_code"
}
trap cleanup INT TERM

# ── detect backend ──

HAS_CODEX=false
HAS_CLAUDE=false
command -v codex >/dev/null 2>&1 && HAS_CODEX=true
command -v claude >/dev/null 2>&1 && HAS_CLAUDE=true

# ── defaults ──

BACKEND=""
CWD="$(pwd)"
MAX_ITERATIONS=999
SLEEP_SECONDS=1
LOG_DIR=".auto-improve-logs"
MODEL=""
MAX_TURNS=""
ALLOWED_TOOLS=""
MAX_CONSECUTIVE_FAILURES=5
MAX_RATE_RETRIES=20
BACKOFF_INITIAL=60
BACKOFF_MAX=1800
IDLE_TIMEOUT=120
PROMPT=""
PROMPT_FILE=""
PROMPT_NUMBER=""
PROMPT_FIXED=""

# ── parse args ──

while [[ $# -gt 0 ]]; do
  case "$1" in
    --codex)     BACKEND=codex; shift ;;
    --claude)    BACKEND=claude; shift ;;
    --list)      list_prompts; exit 0 ;;
    --no-commit) shift ;; # deprecated, no-op
    -C|--cwd)
      require_arg "$1" "${2:-}" "$#"
      CWD="$2"; shift 2 ;;
    -n|--max-iterations)
      require_arg "$1" "${2:-}" "$#"
      MAX_ITERATIONS="$2"; shift 2 ;;
    -s|--sleep)
      require_arg "$1" "${2:-}" "$#"
      SLEEP_SECONDS="$2"; shift 2 ;;
    -p|--prompt)
      require_arg "$1" "${2:-}" "$#"
      PROMPT="$2"; shift 2 ;;
    -f|--prompt-file)
      require_arg "$1" "${2:-}" "$#"
      PROMPT_FILE="$2"; shift 2 ;;
    -l|--log-dir)
      require_arg "$1" "${2:-}" "$#"
      LOG_DIR="$2"; shift 2 ;;
    -m|--model)
      require_arg "$1" "${2:-}" "$#"
      MODEL="$2"; shift 2 ;;
    --max-turns)
      require_arg "$1" "${2:-}" "$#"
      MAX_TURNS="$2"; shift 2 ;;
    --allowedTools)
      require_arg "$1" "${2:-}" "$#"
      ALLOWED_TOOLS="$2"; shift 2 ;;
    --max-failures)
      require_arg "$1" "${2:-}" "$#"
      MAX_CONSECUTIVE_FAILURES="$2"; shift 2 ;;
    --max-rate-retries)
      require_arg "$1" "${2:-}" "$#"
      MAX_RATE_RETRIES="$2"; shift 2 ;;
    --backoff-initial)
      require_arg "$1" "${2:-}" "$#"
      BACKOFF_INITIAL="$2"; shift 2 ;;
    --backoff-max)
      require_arg "$1" "${2:-}" "$#"
      BACKOFF_MAX="$2"; shift 2 ;;
    --idle-timeout)
      require_arg "$1" "${2:-}" "$#"
      IDLE_TIMEOUT="$2"; shift 2 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      if [[ "$1" =~ ^[0-9]+$ ]]; then
        PROMPT_NUMBER="$1"; shift
      else
        echo "[error] unknown option: $1" >&2
        usage; exit 2
      fi
      ;;
  esac
done

# ── resolve backend ──

if [[ -z "$BACKEND" ]]; then
  if $HAS_CODEX && $HAS_CLAUDE; then
    echo "[info] both codex and claude found, defaulting to codex (use --claude to override)" >&2
    BACKEND=codex
  elif $HAS_CODEX; then
    BACKEND=codex
  elif $HAS_CLAUDE; then
    BACKEND=claude
  else
    echo "[error] neither codex nor claude found in PATH" >&2
    exit 127
  fi
fi

if [[ "$BACKEND" == "codex" ]] && ! $HAS_CODEX; then
  echo "[error] codex not found in PATH" >&2; exit 127
fi
if [[ "$BACKEND" == "claude" ]] && ! $HAS_CLAUDE; then
  echo "[error] claude not found in PATH" >&2; exit 127
fi
if [[ "$BACKEND" == "codex" ]]; then
  if ! command -v jq >/dev/null 2>&1; then
    echo "[error] jq not found in PATH (required for codex JSONL parsing)" >&2; exit 127
  fi
fi

# ── validation ──

if ! [[ "$MAX_ITERATIONS" =~ ^[0-9]+$ ]] || [[ "$MAX_ITERATIONS" -le 0 ]]; then
  echo "[error] --max-iterations must be a positive integer" >&2; exit 2
fi
if ! [[ "$SLEEP_SECONDS" =~ ^[0-9]+$ ]]; then
  echo "[error] --sleep must be a positive integer" >&2; exit 2
fi
if [[ ! -d "$CWD" ]]; then
  echo "[error] directory not found: $CWD" >&2; exit 2
fi

# ── resolve prompt: -p > -f > number > interactive > default ──

if [[ -n "$PROMPT_FILE" ]]; then
  if [[ ! -f "$PROMPT_FILE" ]]; then
    echo "[error] prompt file not found: $PROMPT_FILE" >&2; exit 2
  fi
  PROMPT="$(cat "$PROMPT_FILE")"
  PROMPT_FIXED=1
  echo "[info] prompt: $PROMPT_FILE (fixed)" >&2
elif [[ -n "$PROMPT" ]]; then
  PROMPT_FIXED=1
  echo "[info] prompt: inline (fixed)" >&2
elif [[ -n "$PROMPT_NUMBER" ]]; then
  PROMPT_FILE=$(resolve_prompt_by_number "$PROMPT_NUMBER")
  PROMPT="$(cat "$PROMPT_FILE")"
  PROMPT_FIXED=1
  echo "[info] prompt: $PROMPT_FILE (fixed)" >&2
else
  # 첫 iteration은 여기서 랜덤, 이후는 루프 안에서 매번 랜덤
  PROMPT_FILE=$(random_prompt_file)
  PROMPT="$(cat "$PROMPT_FILE")"
  echo "[info] prompt: random (changes each iteration)" >&2
fi

if [[ -z "$PROMPT" ]]; then
  echo "[error] prompt is empty" >&2; exit 2
fi

# ── setup logging (absolute paths) ──

mkdir -p "$LOG_DIR"
LOG_DIR="$(cd "$LOG_DIR" && pwd)"
START_TS="$(date +%Y%m%d-%H%M%S)-$$"
RUN_LOG="$LOG_DIR/run-$START_TS.log"

echo "[start] backend=$BACKEND cwd=$CWD" | tee -a "$RUN_LOG"
echo "[start] max_iterations=$MAX_ITERATIONS sleep=${SLEEP_SECONDS}s model=${MODEL:-default}" | tee -a "$RUN_LOG"
echo "[start] max_failures=$MAX_CONSECUTIVE_FAILURES max_rate_retries=$MAX_RATE_RETRIES idle_timeout=${IDLE_TIMEOUT}s" | tee -a "$RUN_LOG"
echo "[start] prompt: ${PROMPT:0:120}..." | tee -a "$RUN_LOG"

# ── backend-specific runner functions ──
# Agent runs in background writing to file; foreground polls for new lines.
# No persistent pipes — eliminates all buffering issues across platforms.

run_codex() {
  local out_file="$1"
  local donefile="$out_file.done"
  local cmd=(codex exec --json --ephemeral --dangerously-bypass-approvals-and-sandbox --cd "$CWD")
  [[ -n "$MODEL" ]] && cmd+=(-m "$MODEL")

  > "$out_file"
  rm -f "$donefile"
  CODEX_TURN_TS=""

  # Run codex in background; sentinel file signals completion
  (
    set +e
    printf '%s\n' "$PROMPT" | "${cmd[@]}" - >> "$out_file" 2>&1
    echo $? > "$donefile"
  ) &
  CHILD_PID=$!

  # Stream output in foreground — poll-based, no pipes
  if ! wait_and_stream "$out_file" "$donefile" jsonl; then
    wait "$CHILD_PID" 2>/dev/null
    rm -f "$donefile"
    CHILD_PID=""
    cat "$out_file" >> "$RUN_LOG"
    return 1
  fi

  wait "$CHILD_PID" 2>/dev/null
  local ec=0
  [[ -f "$donefile" ]] && ec=$(<"$donefile")
  rm -f "$donefile"
  CHILD_PID=""
  cat "$out_file" >> "$RUN_LOG"
  return "$ec"
}

run_claude() {
  local out_file="$1"
  local donefile="$out_file.done"
  local cmd=(claude -p --output-format text --dangerously-skip-permissions)
  [[ -n "$MODEL" ]]         && cmd+=(--model "$MODEL")
  [[ -n "$MAX_TURNS" ]]     && cmd+=(--max-turns "$MAX_TURNS")
  [[ -n "$ALLOWED_TOOLS" ]] && cmd+=(--allowedTools "$ALLOWED_TOOLS")

  > "$out_file"
  rm -f "$donefile"

  # Run claude in background; sentinel file signals completion
  (
    set +e
    cd "$CWD" && printf '%s\n' "$PROMPT" | "${cmd[@]}" >> "$out_file" 2>&1
    echo $? > "$donefile"
  ) &
  CHILD_PID=$!

  # Stream output in foreground — poll-based, no pipes
  if ! wait_and_stream "$out_file" "$donefile" raw; then
    wait "$CHILD_PID" 2>/dev/null
    rm -f "$donefile"
    CHILD_PID=""
    cat "$out_file" >> "$RUN_LOG"
    return 1
  fi

  wait "$CHILD_PID" 2>/dev/null
  local ec=0
  [[ -f "$donefile" ]] && ec=$(<"$donefile")
  rm -f "$donefile"
  CHILD_PID=""
  cat "$out_file" >> "$RUN_LOG"
  return "$ec"
}

# ── main loop ──

CONSECUTIVE_FAILURES=0
RATE_RETRIES=0
BACKOFF_CURRENT="$BACKOFF_INITIAL"

i=1
while [[ "$i" -le "$MAX_ITERATIONS" ]]; do
  echo "" | tee -a "$RUN_LOG"
  # 번호 지정 없으면 매 iteration마다 랜덤 프롬프트 선택
  if [[ -z "$PROMPT_NUMBER" && -z "$PROMPT_FIXED" ]]; then
    PROMPT_FILE=$(random_prompt_file)
    PROMPT="$(cat "$PROMPT_FILE")"
    local_prompt_name=$(basename "$PROMPT_FILE" .md)
  else
    local_prompt_name="${PROMPT_FILE:+$(basename "$PROMPT_FILE" .md)}"
  fi

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" | tee -a "$RUN_LOG"
  echo "[iter:$i/$MAX_ITERATIONS] $(date '+%H:%M:%S') $BACKEND ${local_prompt_name:+[$local_prompt_name]}" | tee -a "$RUN_LOG"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" | tee -a "$RUN_LOG"

  OUT_FILE="$LOG_DIR/iter-${START_TS}-${i}.log"

  set +e
  "run_${BACKEND}" "$OUT_FILE"
  EXIT_CODE=$?
  set -e

  if [[ "$EXIT_CODE" -ne 0 ]]; then
    if has_limit_error "$OUT_FILE"; then
      RATE_RETRIES=$((RATE_RETRIES + 1))
      echo "" | tee -a "$RUN_LOG"
      echo "[rate-limit] detected (retry $RATE_RETRIES/$MAX_RATE_RETRIES), backing off ${BACKOFF_CURRENT}s..." | tee -a "$RUN_LOG"
      if [[ "$RATE_RETRIES" -ge "$MAX_RATE_RETRIES" ]]; then
        echo "[stop] max rate-limit retries reached ($MAX_RATE_RETRIES)" | tee -a "$RUN_LOG"
        exit 1
      fi
      sleep "$BACKOFF_CURRENT"
      BACKOFF_CURRENT=$(( BACKOFF_CURRENT * 2 ))
      [[ "$BACKOFF_CURRENT" -gt "$BACKOFF_MAX" ]] && BACKOFF_CURRENT="$BACKOFF_MAX"
      continue
    fi

    CONSECUTIVE_FAILURES=$((CONSECUTIVE_FAILURES + 1))
    echo "" | tee -a "$RUN_LOG"
    echo "[fail] $BACKEND exit=$EXIT_CODE iter=$i (failures: $CONSECUTIVE_FAILURES/$MAX_CONSECUTIVE_FAILURES)" | tee -a "$RUN_LOG"
    echo "       log: $OUT_FILE" | tee -a "$RUN_LOG"

    if [[ "$CONSECUTIVE_FAILURES" -ge "$MAX_CONSECUTIVE_FAILURES" ]]; then
      echo "[stop] max consecutive failures reached ($MAX_CONSECUTIVE_FAILURES)" | tee -a "$RUN_LOG"
      exit 1
    fi
    sleep "$((SLEEP_SECONDS + 5))"
    i=$((i + 1))
    continue
  fi

  # success — reset failure counters
  CONSECUTIVE_FAILURES=0
  RATE_RETRIES=0
  BACKOFF_CURRENT="$BACKOFF_INITIAL"

  # warn if agent left uncommitted changes
  (
    cd "$CWD"
    if ! git diff --quiet HEAD 2>/dev/null || [[ -n "$(git ls-files --others --exclude-standard 2>/dev/null)" ]]; then
      echo "[iter:$i] WARNING: uncommitted changes remain" | tee -a "$RUN_LOG"
    fi
  )

  echo "[iter:$i] done" | tee -a "$RUN_LOG"
  i=$((i + 1))

  if [[ "$i" -le "$MAX_ITERATIONS" ]]; then
    sleep "$SLEEP_SECONDS"
  fi
done

echo "" | tee -a "$RUN_LOG"
echo "[stop] max iterations reached: $MAX_ITERATIONS" | tee -a "$RUN_LOG"
exit 0
