#!/usr/bin/env node
const { spawn, execFileSync } = require("child_process");
const { readFile, writeFile, mkdir, rm, cp } = require("fs/promises");
const fs = require("fs");
const path = require("path");
const os = require("os");
const net = require("net");

const {
  SOCK_PATH, PID_PATH, LOG_PATH, UCM_DIR, TASKS_DIR, SOURCE_ROOT,
  SOCKET_READY_TIMEOUT_MS, SOCKET_POLL_INTERVAL_MS, CLIENT_TIMEOUT_MS,
  parseTaskFile, cleanStaleFiles, readPid, isProcessAlive,
} = require("../lib/ucmd.js");
const { createSocketClient } = require("../lib/socket-client.js");

const DAEMON_DIR = path.join(UCM_DIR, "daemon");
const LOG_FOLLOW_INTERVAL_MS = (() => {
  const raw = Number(process.env.UCM_LOG_FOLLOW_INTERVAL_MS);
  if (!Number.isFinite(raw) || raw <= 0) return 1000;
  return Math.floor(raw);
})();

const USAGE = `ucm — Unified CLI

Usage:
  Forge (foreground pipeline):
    ucm forge <description> [options]         태스크 실행
    ucm forge --file <file.md> [options]      파일에서 태스크 실행
    ucm resume <id> [--from <stage>]          중단된 태스크 재실행
    ucm abort <id>                            실행 중인 태스크 중단

  Task management (daemon):
    ucm submit <file.md>                      태스크 파일 제출
    ucm submit --project <dir> --title "..."  인라인 태스크 제출 (stdin으로 본문)
    ucm start <task-id>                       pending 태스크 시작(큐 등록)
    ucm list [--status <s>] [--project <dir>] 태스크 목록
    ucm status [<task-id>]                    태스크/데몬 상태 조회
    ucm approve <task-id>                     태스크 승인 (merge)
    ucm reject <task-id> [--feedback "..."]   태스크 반려
    ucm cancel <task-id>                      태스크 취소
    ucm retry <task-id>                       실패한 태스크 재시도
    ucm delete <task-id>                      태스크 삭제
    ucm priority <task-id> <N>                우선순위 변경
    ucm gate approve <task-id>                스테이지 승인
    ucm gate reject <task-id>                 스테이지 반려
    ucm diff <task-id>                        변경사항 조회
    ucm logs <task-id> [--lines N]            로그 조회

  Analysis:
    ucm analyze [--project <dir>]             프로젝트 분석 및 제안 생성
    ucm research [--project <dir>]            프로젝트 리서치 및 전략 제안

  Proposals:
    ucm proposals [--status <s>]              제안 목록
    ucm proposal <approve|reject|up|down|eval> <id>  제안 관리

  Daemon control:
    ucm daemon start|stop                     데몬 시작/종료
    ucm pause                                 데몬 일시정지
    ucm resume                                데몬 재개 (인자 없이)
    ucm stats                                 통계 조회

  Maintenance:
    ucm gc [--days N]                         오래된 태스크 정리
    ucm observe [--status]                    수동 관찰 트리거

  Other:
    ucm init                                  초기 설정 및 환경 점검
    ucm chat                                  대화형 AI 관리 모드
    ucm ui [--port N] [--dev]                 대시보드 UI 서버 시작
    ucm dashboard                             브라우저에서 대시보드 열기
    ucm release                               릴리즈 배포 (~/.ucm/release/)

Options:
  --version              버전 출력
  --project <dir>      프로젝트 디렉토리 (기본: cwd)
  --pipeline <name>    파이프라인 (trivial|small|medium|large 또는 "stage1,stage2,...")
  --autopilot          사람 개입 없이 실행
  --background, --bg   daemon에 위임하여 백그라운드 실행
  --verbose, -v        에이전트 상세 출력 표시
  --budget <N>         최대 토큰 예산
  --from <stage>       resume 시 시작 stage
  --file <path>        태스크 파일 경로
  --status <s>         필터: pending, running, review, done, failed
  --title "..."        태스크 제목
  --priority <N>       우선순위 (기본: 0)
  --feedback "..."     반려 시 피드백
  --lines <N>          로그 출력 줄 수 (기본: 100)
  --days <N>           gc 대상 일 수 (기본: 30)
  --follow, -f         로그 follow 모드
  --watch, -w          watch 모드
  --port <N>           UI 서버 포트 (기본: 17172)
  --dev                프론트엔드 개발 모드
  --force              강제 실행
  --help               도움말`;

function tryOpenDashboard(url) {
  let cmd = null;
  let args = [];

  if (process.platform === "darwin") {
    cmd = "open";
    args = [url];
  } else if (process.platform === "win32") {
    cmd = "cmd";
    args = ["/c", "start", "", url];
  } else {
    cmd = "xdg-open";
    args = [url];
  }

  try {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {
      console.error(`브라우저를 자동으로 열지 못했습니다. 직접 접속하세요: ${url}`);
    });
    child.unref();
  } catch {
    console.error(`브라우저를 자동으로 열지 못했습니다. 직접 접속하세요: ${url}`);
  }
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = {};
  const positional = [];

  function failOption(message) {
    console.error(message);
    process.exit(1);
  }

  function readOptionValue(flag, { allowDashValue = false } = {}) {
    const value = args[i + 1];
    if (value === undefined || (!allowDashValue && value.startsWith("-"))) {
      failOption(`${flag} 옵션에는 값이 필요합니다.`);
    }
    i++;
    return value;
  }

  function readIntegerOption(flag, { min = null, max = null } = {}) {
    const raw = readOptionValue(flag, { allowDashValue: true });
    if (!/^-?\d+$/.test(raw)) {
      failOption(`${flag} 옵션은 정수여야 합니다: ${raw}`);
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value)) {
      failOption(`${flag} 옵션 값이 너무 큽니다: ${raw}`);
    }
    if (min !== null && value < min) {
      failOption(`${flag} 옵션은 ${min} 이상이어야 합니다: ${raw}`);
    }
    if (max !== null && value > max) {
      failOption(`${flag} 옵션은 ${max} 이하여야 합니다: ${raw}`);
    }
    return value;
  }

  let i = 0;
  for (; i < args.length; i++) {
    if (args[i] === "--help" || args[i] === "-h") {
      console.log(USAGE);
      process.exit(0);
    } else if (args[i] === "--version" || args[i] === "-V") {
      const pkg = require("../package.json");
      console.log(pkg.version);
      process.exit(0);
    } else if (args[i] === "--status") { opts.status = readOptionValue("--status"); }
    else if (args[i] === "--project") { opts.project = readOptionValue("--project"); }
    else if (args[i] === "--title") { opts.title = readOptionValue("--title"); }
    else if (args[i] === "--priority") { opts.priority = readIntegerOption("--priority"); }
    else if (args[i] === "--feedback") { opts.feedback = readOptionValue("--feedback"); }
    else if (args[i] === "--lines") { opts.lines = readIntegerOption("--lines", { min: 1 }); }
    else if (args[i] === "--score") { opts.score = readIntegerOption("--score"); }
    else if (args[i] === "--port") { opts.port = readIntegerOption("--port", { min: 1, max: 65535 }); }
    else if (args[i] === "--dev") { opts.dev = true; }
    // Forge-specific flags
    else if (args[i] === "--pipeline") { opts.pipeline = readOptionValue("--pipeline"); }
    else if (args[i] === "--autopilot") { opts.autopilot = true; }
    else if (args[i] === "--file") { opts.file = readOptionValue("--file"); }
    else if (args[i] === "--from") { opts.from = readOptionValue("--from"); }
    else if (args[i] === "--budget") { opts.budget = readIntegerOption("--budget", { min: 0 }); }
    else if (args[i] === "--days") { opts.days = readIntegerOption("--days", { min: 1 }); }
    else if (args[i] === "--follow" || args[i] === "-f") { opts.follow = true; }
    else if (args[i] === "--watch" || args[i] === "-w") { opts.watch = true; }
    else if (args[i] === "--background" || args[i] === "--bg") { opts.background = true; }
    else if (args[i] === "--verbose" || args[i] === "-v") { opts.verbose = true; }
    else if (args[i] === "--force") { opts.force = true; }
    else if (args[i].startsWith("-")) {
      console.error(`알 수 없는 옵션: ${args[i]}`);
      process.exit(1);
    } else {
      positional.push(args[i]);
    }
  }
  opts.command = positional[0];
  opts.positional = positional.slice(1);
  return opts;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) return resolve("");
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data.trim()));
    process.stdin.on("error", reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function splitLogLines(logText) {
  if (!logText || logText === "(no logs)") return [];
  const lines = String(logText).replace(/\r\n/g, "\n").split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function appendedLogLines(previousLines, nextLines) {
  if (previousLines.length === 0) return nextLines.slice();
  const maxOverlap = Math.min(previousLines.length, nextLines.length);
  for (let overlap = maxOverlap; overlap >= 0; overlap--) {
    let matched = true;
    for (let i = 0; i < overlap; i++) {
      if (previousLines[previousLines.length - overlap + i] !== nextLines[i]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return nextLines.slice(overlap);
    }
  }
  return nextLines.slice();
}

function isTaskActive(task) {
  const state = String(task?.state || task?.status || "").toLowerCase();
  return state === "pending" || state === "running" || state === "in_progress";
}

// ── Socket Communication ──

const socketRequest = createSocketClient(SOCK_PATH, CLIENT_TIMEOUT_MS);

async function ensureDaemon() {
  try {
    await socketRequest({ method: "stats", params: {} });
    return;
  } catch (e) {
    if (e.code !== "ECONNREFUSED" && e.code !== "ENOENT" && e.message !== "TIMEOUT") {
      throw e;
    }
  }

  // start daemon
  await cleanStaleFiles();
  await mkdir(DAEMON_DIR, { recursive: true });

  const ucmdPath = path.join(__dirname, "..", "lib", "ucmd.js");
  const logFd = fs.openSync(LOG_PATH, "a");
  const child = spawn(process.execPath, [ucmdPath, "start", "--foreground"], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  fs.closeSync(logFd);
  await writeFile(PID_PATH, String(child.pid));

  // wait for socket
  const deadline = Date.now() + SOCKET_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await socketRequest({ method: "stats", params: {} });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, SOCKET_POLL_INTERVAL_MS));
    }
  }

  throw new Error("daemon failed to start");
}

// ── Command Handlers ──

async function cmdSubmit(opts) {
  await ensureDaemon();

  const fileArg = opts.positional[0];

  if (fileArg) {
    // submit from file
    const content = await readFile(path.resolve(fileArg), "utf-8");
    const result = await socketRequest({
      method: "submit",
      params: { taskFile: content },
    });
    console.log(`submitted: ${result.id} — ${result.title}`);
    return;
  }

  // inline submit
  if (!opts.title) {
    console.error("--title 필수 (또는 태스크 파일 지정)");
    process.exit(1);
  }
  if (!opts.project) {
    console.error("--project 필수");
    process.exit(1);
  }

  const body = await readStdin();
  const result = await socketRequest({
    method: "submit",
    params: {
      title: opts.title,
      body,
      project: path.resolve(opts.project),
      priority: opts.priority,
    },
  });
  console.log(`submitted: ${result.id} — ${result.title}`);
}

async function cmdList(opts) {
  await ensureDaemon();

  const tasks = await socketRequest({
    method: "list",
    params: {
      status: opts.status,
      project: opts.project,
    },
  });

  if (tasks.length === 0) {
    console.log("(no tasks)");
    return;
  }

  // group by state
  const grouped = {};
  for (const task of tasks) {
    const state = task.state || task.status || "unknown";
    if (!grouped[state]) grouped[state] = [];
    grouped[state].push(task);
  }

  for (const [state, stateTasks] of Object.entries(grouped)) {
    console.log(`\n[${state}]`);
    for (const task of stateTasks) {
      const project = task.project ? ` (${path.basename(task.project)})` : "";
      const stage = task.currentStage && (state === "running" || state === "review")
        ? (task.stageGate ? ` ⏸ ${task.currentStage}` : ` → ${task.currentStage}`)
        : "";
      console.log(`  ${task.id}  ${task.title}${project}${stage}`);
    }
  }
}

async function cmdStart(opts) {
  await ensureDaemon();

  const taskId = opts.positional[0];
  if (!taskId) { console.error("task-id 필수: ucm start <task-id>"); process.exit(1); }

  const result = await socketRequest({ method: "start", params: { taskId } });
  console.log(`started: ${result.id} → ${result.status}`);
}

async function cmdStatus(opts) {
  await ensureDaemon();

  const taskId = opts.positional[0];
  if (!taskId) {
    // daemon status
    const status = await socketRequest({ method: "status", params: {} });
    console.log(`pid:          ${status.pid}`);
    console.log(`uptime:       ${formatUptime(status.uptime)}`);
    console.log(`status:       ${status.daemonStatus}`);
    if (status.pausedAt) console.log(`paused at:    ${status.pausedAt}`);
    if (status.pauseReason) console.log(`pause reason: ${status.pauseReason}`);
    console.log(`active tasks: ${status.activeTasks.length}`);
    console.log(`queue:        ${status.queueLength}`);
    console.log(`completed:    ${status.tasksCompleted}`);
    console.log(`failed:       ${status.tasksFailed}`);
    console.log(`total spawns: ${status.totalSpawns}`);
    return;
  }

  const task = await socketRequest({ method: "status", params: { taskId } });
  console.log(`id:       ${task.id}`);
  console.log(`title:    ${task.title}`);
  console.log(`status:   ${task.state || task.status}`);
  if (task.project) console.log(`project:  ${task.project}`);
  if (task.pipelineType) console.log(`pipeline: ${task.pipelineType}`);
  if (task.currentStage) {
    const stageLabel = task.stageGate ? `${task.currentStage} (⏸ awaiting approval)` : task.currentStage;
    console.log(`stage:    ${stageLabel}`);
  }
  if (task.created) console.log(`created:  ${task.created}`);
  if (task.startedAt) console.log(`started:  ${task.startedAt}`);
  if (task.completedAt) console.log(`done:     ${task.completedAt}`);
  if (task.priority) console.log(`priority: ${task.priority}`);

  // Token usage
  if (task.tokenUsage) {
    const tu = task.tokenUsage;
    const fmt = (n) => n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
    const input = tu.input || tu.inputTokens || 0;
    const output = tu.output || tu.outputTokens || 0;
    console.log(`tokens:   ${fmt(input)} in / ${fmt(output)} out (${fmt(input + output)} total)`);
  }

  // Stage history
  if (task.stageHistory && task.stageHistory.length > 0) {
    console.log(`\nstage history:`);
    for (const s of task.stageHistory) {
      const status = s.status === "pass" ? "✓" : s.status === "fail" ? "✗" : "·";
      const dur = s.durationMs ? ` (${(s.durationMs / 1000).toFixed(1)}s)` : "";
      const tokens = s.tokenUsage ? ` [${((s.tokenUsage.input || 0) + (s.tokenUsage.output || 0))} tok]` : "";
      console.log(`  ${status} ${s.stage}${dur}${tokens}`);
    }
  }

  // Next action hint
  const nextAction = getNextAction(task);
  if (nextAction) {
    console.log(`\nnext: ${nextAction}`);
  }
}

async function cmdApprove(opts) {
  await ensureDaemon();

  const taskId = opts.positional[0];
  if (!taskId) { console.error("task-id 필수"); process.exit(1); }

  const params = { taskId };
  if (opts.score !== undefined) params.score = opts.score;
  const result = await socketRequest({ method: "approve", params });
  console.log(`approved: ${result.id} → ${result.status}`);
}

async function cmdReject(opts) {
  await ensureDaemon();

  const taskId = opts.positional[0];
  if (!taskId) { console.error("task-id 필수"); process.exit(1); }

  const result = await socketRequest({
    method: "reject",
    params: { taskId, feedback: opts.feedback },
  });
  console.log(`rejected: ${result.id} → ${result.status}`);
}

async function cmdCancel(opts) {
  await ensureDaemon();

  const taskId = opts.positional[0];
  if (!taskId) { console.error("task-id 필수"); process.exit(1); }

  const result = await socketRequest({ method: "cancel", params: { taskId } });
  console.log(`cancelled: ${result.id}`);
}

async function cmdDiff(opts) {
  await ensureDaemon();

  const taskId = opts.positional[0];
  if (!taskId) { console.error("task-id 필수"); process.exit(1); }

  const diffs = await socketRequest({ method: "diff", params: { taskId } });
  for (const entry of diffs) {
    console.log(`\n=== ${entry.project} ===\n`);
    console.log(entry.diff);
  }
}

async function cmdLogs(opts) {
  await ensureDaemon();

  const taskId = opts.positional[0];
  if (!taskId) { console.error("task-id 필수"); process.exit(1); }

  const logs = await socketRequest({
    method: "logs",
    params: { taskId, lines: opts.lines },
  });
  console.log(logs);

  if (!opts.follow) return;

  let lastLines = splitLogLines(logs);
  while (true) {
    await sleep(LOG_FOLLOW_INTERVAL_MS);

    const [status, currentLogs] = await Promise.all([
      socketRequest({ method: "status", params: { taskId } }),
      socketRequest({ method: "logs", params: { taskId, lines: opts.lines } }),
    ]);

    const currentLines = splitLogLines(currentLogs);
    const newLines = appendedLogLines(lastLines, currentLines);
    if (newLines.length > 0) {
      process.stdout.write(newLines.join("\n") + "\n");
    }
    lastLines = currentLines;

    if (!isTaskActive(status)) break;
  }
}

async function cmdRetry(opts) {
  await ensureDaemon();
  const taskId = opts.positional[0];
  if (!taskId) { console.error("task-id 필수: ucm retry <task-id>"); process.exit(1); }
  const result = await socketRequest({ method: "retry", params: { taskId } });
  console.log(`retried: ${result.id} → ${result.status}`);
}

async function cmdDelete(opts) {
  await ensureDaemon();
  const taskId = opts.positional[0];
  if (!taskId) { console.error("task-id 필수: ucm delete <task-id>"); process.exit(1); }
  const result = await socketRequest({ method: "delete", params: { taskId } });
  console.log(`deleted: ${result.id}`);
}

async function cmdGateApprove(opts) {
  await ensureDaemon();
  const taskId = opts.positional[0];
  if (!taskId) { console.error("task-id 필수: ucm gate approve <task-id>"); process.exit(1); }
  const result = await socketRequest({ method: "stage_gate_approve", params: { taskId } });
  console.log(`gate approved: ${result.id}`);
}

async function cmdGateReject(opts) {
  await ensureDaemon();
  const taskId = opts.positional[0];
  if (!taskId) { console.error("task-id 필수: ucm gate reject <task-id>"); process.exit(1); }
  const result = await socketRequest({ method: "stage_gate_reject", params: { taskId, feedback: opts.feedback } });
  console.log(`gate rejected: ${result.id}`);
}

async function cmdPriority(opts) {
  await ensureDaemon();
  const taskId = opts.positional[0];
  const priority = parseInt(opts.positional[1]);
  if (!taskId || isNaN(priority)) { console.error("사용법: ucm priority <task-id> <value>"); process.exit(1); }
  const result = await socketRequest({ method: "update_priority", params: { taskId, priority } });
  console.log(`priority updated: ${result.id} → ${result.priority}`);
}

async function cmdPause() {
  await ensureDaemon();
  const result = await socketRequest({ method: "pause", params: {} });
  console.log(`daemon ${result.status}`);
}

async function cmdResume(opts) {
  // With task ID → forge task resume
  if (opts.positional[0]) {
    return cmdForgeResume(opts);
  }
  // Without ID → daemon resume
  await ensureDaemon();
  const result = await socketRequest({ method: "resume", params: {} });
  console.log(`daemon ${result.status}`);
}

async function cmdStats() {
  await ensureDaemon();
  const stats = await socketRequest({ method: "stats", params: {} });
  console.log(`pid:          ${stats.pid}`);
  console.log(`uptime:       ${formatUptime(stats.uptime)}`);
  console.log(`status:       ${stats.daemonStatus}`);
  console.log(`active tasks: ${stats.activeTasks.length}`);
  console.log(`queue:        ${stats.queueLength}`);
  console.log(`completed:    ${stats.tasksCompleted}`);
  console.log(`failed:       ${stats.tasksFailed}`);
  console.log(`total spawns: ${stats.totalSpawns}`);
}

async function cmdObserve(opts) {
  await ensureDaemon();

  if (opts.status) {
    const status = await socketRequest({ method: "observe_status", params: {} });
    console.log(`cycle:          ${status.cycle}`);
    console.log(`last run:       ${status.lastRunAt || "(never)"}`);
    console.log(`enabled:        ${status.observerConfig.enabled}`);
    console.log(`interval:       ${status.observerConfig.intervalMs / 1000}s`);
    console.log(`task trigger:   ${status.observerConfig.taskCountTrigger}`);
    if (status.latestSnapshot) {
      console.log(`\nlatest snapshot:`);
      console.log(`  timestamp:    ${status.latestSnapshot.timestamp}`);
      console.log(`  tasks:        ${status.latestSnapshot.taskCount ?? "-"}`);
      console.log(`  success rate: ${status.latestSnapshot.successRate != null ? (status.latestSnapshot.successRate * 100).toFixed(1) + "%" : "-"}`);
    }
    return;
  }

  console.log("running observer...");
  const result = await socketRequest({ method: "observe", params: {} });
  console.log(`cycle ${result.cycle}: ${result.proposalCount} proposal(s) created`);
  if (result.error) console.log(`error: ${result.error}`);
}

async function cmdProposals(opts) {
  await ensureDaemon();

  const proposals = await socketRequest({
    method: "proposals",
    params: { status: opts.status },
  });

  if (proposals.length === 0) {
    console.log("(no proposals)");
    return;
  }

  const grouped = {};
  for (const proposal of proposals) {
    const status = proposal.status || "unknown";
    if (!grouped[status]) grouped[status] = [];
    grouped[status].push(proposal);
  }

  for (const [status, statusProposals] of Object.entries(grouped)) {
    console.log(`\n[${status}]`);
    for (const proposal of statusProposals) {
      const priority = proposal.priority ? ` (priority: ${proposal.priority})` : "";
      const project = proposal.project ? ` → ${path.basename(proposal.project)}` : "";
      const verdict = proposal.evaluation?.verdict ? ` [${proposal.evaluation.verdict}]` : "";
      console.log(`  ${proposal.id}  [${proposal.category}/${proposal.risk}] ${proposal.title}${project}${priority}${verdict}`);
    }
  }
}

async function cmdProposal(opts) {
  await ensureDaemon();

  const subcommand = opts.positional[0];
  const proposalId = opts.positional[1];

  if (!subcommand || !proposalId) {
    console.error("usage: ucm proposal <approve|reject|up|down|eval> <id>");
    process.exit(1);
  }

  switch (subcommand) {
    case "eval": {
      const result = await socketRequest({
        method: "proposal_evaluate",
        params: { proposalId },
      });
      console.log(`proposal: ${result.proposalId} (${result.status})`);
      if (result.evaluation) {
        console.log(`verdict:  ${result.evaluation.verdict} (score: ${result.evaluation.score})`);
        const d = result.evaluation.delta;
        if (d) {
          if (d.successRate != null) console.log(`  successRate:  ${d.successRate > 0 ? "+" : ""}${(d.successRate * 100).toFixed(1)}%`);
          if (d.firstPassRate != null) console.log(`  firstPassRate: ${d.firstPassRate > 0 ? "+" : ""}${(d.firstPassRate * 100).toFixed(1)}%`);
          if (d.avgPipelineDurationMs != null) console.log(`  avgDuration:  ${d.avgPipelineDurationMs > 0 ? "+" : ""}${d.avgPipelineDurationMs}ms`);
        }
      } else {
        console.log("(no evaluation yet)");
      }
      break;
    }
    case "approve": {
      const result = await socketRequest({
        method: "proposal_approve",
        params: { proposalId },
      });
      console.log(`approved: ${result.proposalId}`);
      if (result.taskId) console.log(`task created: ${result.taskId}`);
      break;
    }
    case "reject": {
      const result = await socketRequest({
        method: "proposal_reject",
        params: { proposalId },
      });
      console.log(`rejected: ${result.proposalId}`);
      break;
    }
    case "up": {
      const result = await socketRequest({
        method: "proposal_priority",
        params: { proposalId, delta: 10 },
      });
      console.log(`${result.proposalId}: priority → ${result.priority}`);
      break;
    }
    case "down": {
      const result = await socketRequest({
        method: "proposal_priority",
        params: { proposalId, delta: -10 },
      });
      console.log(`${result.proposalId}: priority → ${result.priority}`);
      break;
    }
    default:
      console.error(`알 수 없는 서브커맨드: ${subcommand}`);
      console.error("usage: ucm proposal <approve|reject|up|down> <id>");
      process.exit(1);
  }
}

function formatUptime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

// ── Release ──

async function cmdRelease(opts) {
  // 릴리즈 전 테스트 게이트
  console.log("릴리즈 전 테스트 실행...");
  try {
    execFileSync("node", [path.join(SOURCE_ROOT, "test", "ucm.test.js")], {
      cwd: SOURCE_ROOT, stdio: "inherit", timeout: 60000,
    });
    console.log("테스트 통과");
  } catch {
    console.error("테스트 실패 — 릴리즈 중단. --force로 건너뛸 수 있습니다.");
    if (!opts.force) process.exit(1);
  }

  console.log("React 대시보드 빌드...");
  try {
    execFileSync("npm", ["run", "build"], {
      cwd: path.join(SOURCE_ROOT, "web"),
      stdio: "inherit",
      timeout: 180000,
    });
    console.log("대시보드 빌드 통과");
  } catch {
    console.error("대시보드 빌드 실패 — 릴리즈 중단. --force로 건너뛸 수 있습니다.");
    if (!opts.force) process.exit(1);
  }

  const releaseDir = path.join(os.homedir(), ".ucm", "release");
  const releaseSockPath = path.join(os.homedir(), ".ucm", "daemon", "ucm.sock");

  console.log(`릴리즈 배포: ${releaseDir}`);

  // clean and recreate release dir
  await rm(releaseDir, { recursive: true, force: true });
  await mkdir(releaseDir, { recursive: true });

  // copy source directories and files
  const items = ["bin", "lib", "templates", "skill", "scripts", "web/dist", "package.json", "package-lock.json"];
  for (const item of items) {
    const src = path.join(SOURCE_ROOT, item);
    const dst = path.join(releaseDir, item);
    try {
      await cp(src, dst, { recursive: true });
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  console.log("파일 복사 완료");

  // npm install --production
  execFileSync("npm", ["install", "--production"], {
    cwd: releaseDir,
    stdio: "inherit",
  });
  console.log("npm install 완료");

  // shutdown existing release daemon if running
  try {
    await new Promise((resolve, reject) => {
      const conn = net.createConnection(releaseSockPath);
      conn.on("connect", () => {
        conn.write(JSON.stringify({ id: "shutdown", method: "shutdown", params: {} }) + "\n");
        conn.end();
        resolve();
      });
      conn.on("error", () => resolve());
      setTimeout(() => { conn.destroy(); resolve(); }, 2000);
    });
    // wait for old daemon to exit
    await new Promise((r) => setTimeout(r, 2000));
  } catch {}

  // start new daemon
  const daemonDir = path.join(os.homedir(), ".ucm", "daemon");
  await mkdir(daemonDir, { recursive: true });

  const logPath = path.join(daemonDir, "ucmd.log");
  const logFd = fs.openSync(logPath, "a");
  const ucmdPath = path.join(releaseDir, "lib", "ucmd.js");
  const child = spawn(process.execPath, [ucmdPath, "start", "--foreground"], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: { ...process.env, UCM_DIR: path.join(os.homedir(), ".ucm") },
  });
  child.unref();
  fs.closeSync(logFd);
  console.log(`데몬 시작 (pid: ${child.pid})`);

  // wait for socket ready
  const deadline = Date.now() + SOCKET_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const client = createSocketClient(releaseSockPath, 3000);
      await client({ method: "stats", params: {} });
      console.log("릴리즈 배포 완료");
      return;
    } catch {
      await new Promise((r) => setTimeout(r, SOCKET_POLL_INTERVAL_MS));
    }
  }

  console.log("릴리즈 배포 완료 (데몬 소켓 대기 초과)");
}

// ── Chat ──

async function cmdChat() {
  const TEMPLATES_DIR = path.join(__dirname, "..", "templates");
  const CHAT_DIR = path.join(UCM_DIR, "chat");
  const CHAT_NOTES_PATH = path.join(CHAT_DIR, "notes.md");

  const template = await readFile(path.join(TEMPLATES_DIR, "ucm-chat-system.md"), "utf-8");
  const systemPrompt = template
    .replace(/\{\{CWD\}\}/g, process.cwd())
    .replace("{{NOTES_PATH}}", CHAT_NOTES_PATH);

  const child = spawn("claude", ["--system-prompt", systemPrompt, "--dangerously-skip-permissions"], {
    stdio: "inherit",
  });

  await new Promise((resolve, reject) => {
    child.on("close", (code) => resolve(code));
    child.on("error", reject);
  });
}

// ── Forge Commands ──

function createQuestionHandler() {
  return async function onQuestion({ area, question, options }) {
    console.error(`\n  [${area}] ${question}`);
    for (let i = 0; i < options.length; i++) {
      console.error(`    ${i + 1}. ${options[i].label}`);
    }

    const readline = require("readline");
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    const answer = await new Promise((resolve) => {
      rl.question("  선택 (번호 또는 직접 입력): ", (ans) => {
        rl.close();
        resolve(ans.trim());
      });
    });

    const num = parseInt(answer);
    if (num >= 1 && num <= options.length) {
      return options[num - 1].label;
    }
    return answer;
  };
}

function createEventHandler(opts) {
  const pipelineStart = Date.now();
  let stageIndex = 0;

  function elapsed() {
    const sec = Math.round((Date.now() - pipelineStart) / 1000);
    if (sec < 60) return `${sec}s`;
    return `${Math.floor(sec / 60)}m${sec % 60}s`;
  }

  const STAGE_EST = {
    intake: "~1-5min", clarify: "~3-10min", specify: "~3-15min", decompose: "~3-10min",
    design: "~5-20min", implement: "~10-45min", verify: "~5-20min", polish: "~10-60min", integrate: "~5-20min", deliver: "~1-5min",
  };

  return (event, data) => {
    if (event === "stage:start") {
      stageIndex++;
      const est = STAGE_EST[data.stage] || "";
      console.error(`\n── [${elapsed()}] ${data.stage} (step ${stageIndex})${est ? " " + est : ""} ──`);
    } else if (event === "stage:complete") {
      const sec = Math.round(data.durationMs / 1000);
      console.error(`  ${data.status} (${sec}s)`);
    } else if (event === "gate:result") {
      console.error(`  [${data.gate}] ${data.result} (iteration ${data.iteration})`);
    } else if (event === "subtask:start") {
      console.error(`\n  >> subtask: ${data.subtaskId} — ${data.title}`);
    } else if (event === "subtask:complete") {
      console.error(`  << subtask: ${data.subtaskId} ${data.status}`);
    } else if (event === "agent:output") {
      const chunk = data.chunk || "";
      if (opts.verbose) {
        console.error(`  ${chunk.slice(0, 200)}`);
      } else if (chunk.startsWith("[tool]") || chunk.startsWith("[") || chunk.startsWith("---")) {
        console.error(`  ${chunk.slice(0, 120)}`);
      }
    } else if (event === "warning:budget") {
      console.error(`\n  !! budget ${data.percent}%: ${data.used}/${data.budget} tokens`);
    } else if (event === "notice:budget") {
      console.error(`  [budget] ${data.percent}%: ${data.used}/${data.budget} tokens`);
    } else if (event === "pipeline:error") {
      console.error(`\n[${elapsed()}] error: ${data.error}`);
    } else if (event === "pipeline:complete") {
      console.error(`\n[${elapsed()}] complete: ${data.status}`);
    }
  };
}

async function cmdForge(opts) {
  let input;
  if (opts.file) {
    input = await readFile(path.resolve(opts.file), "utf-8");
  } else if (opts.positional.length > 0) {
    input = opts.positional.join(" ");
  } else {
    console.error("태스크 설명 필수: ucm forge \"설명\" 또는 ucm forge --file <file.md>");
    process.exit(1);
  }

  const project = opts.project ? path.resolve(opts.project) : process.cwd();

  if (opts.pipeline && !["trivial", "small", "medium", "large"].includes(opts.pipeline)) {
    if (opts.pipeline.includes(",")) {
      const { STAGE_ARTIFACTS } = require("../lib/core/constants");
      const validStages = new Set(Object.keys(STAGE_ARTIFACTS));
      const stages = opts.pipeline.split(",").map((s) => s.trim());
      const invalid = stages.filter((s) => !validStages.has(s));
      if (invalid.length > 0) {
        console.error(`유효하지 않은 stage: ${invalid.join(", ")}`);
        process.exit(1);
      }
    } else {
      console.error(`유효하지 않은 파이프라인: ${opts.pipeline}`);
      process.exit(1);
    }
  }

  console.error(`forge: "${input.slice(0, 80)}..."`);
  console.error(`project: ${project}`);
  if (opts.pipeline) console.error(`pipeline: ${opts.pipeline}`);
  if (opts.autopilot) console.error(`mode: autopilot`);

  // --background: daemon에 위임하여 백그라운드 실행
  if (opts.background) {
    try {
      await ensureDaemon();
      const result = await socketRequest({
        method: "forge",
        params: {
          input,
          project,
          pipeline: opts.pipeline,
          autopilot: opts.autopilot,
          tokenBudget: opts.budget || 0,
        },
      });
      console.log(result.taskId);
      console.error("background task started. Use `ucm status <id>` or `ucm logs <id>` to monitor.");
      return;
    } catch (e) {
      console.error(`daemon 위임 실패, foreground로 실행합니다: ${e.message}`);
    }
  }

  const { forge } = require("../lib/forge/index");

  const { DEFAULT_TOKEN_BUDGET } = require("../lib/core/constants");
  const dag = await forge(input, {
    project,
    pipeline: opts.pipeline,
    autopilot: opts.autopilot,
    tokenBudget: opts.budget || DEFAULT_TOKEN_BUDGET,
    onEvent: createEventHandler(opts),
    onQuestion: opts.autopilot ? null : createQuestionHandler(),
  });

  // 토큰 사용량 표시
  if (dag.tokenUsage && (dag.tokenUsage.input > 0 || dag.tokenUsage.output > 0)) {
    console.error(`\ntokens: ${dag.tokenUsage.input} in / ${dag.tokenUsage.output} out`);
  }

  console.log(dag.id);
}

async function cmdForgeResume(opts) {
  const taskId = opts.positional[0];

  const project = opts.project ? path.resolve(opts.project) : process.cwd();

  console.error(`resume: ${taskId}`);
  if (opts.from) console.error(`from: ${opts.from}`);

  // --background: daemon에 위임하여 백그라운드 실행
  if (opts.background) {
    try {
      await ensureDaemon();
      const result = await socketRequest({
        method: "resume",
        params: {
          taskId,
          project,
          fromStage: opts.from,
          autopilot: opts.autopilot,
          tokenBudget: opts.budget || 0,
        },
      });
      console.log(result.taskId);
      console.error("background resume started. Use `ucm status <id>` or `ucm logs <id>` to monitor.");
      return;
    } catch (e) {
      console.error(`daemon 위임 실패, foreground로 실행합니다: ${e.message}`);
    }
  }

  const { resume } = require("../lib/forge/index");

  const { DEFAULT_TOKEN_BUDGET } = require("../lib/core/constants");
  const dag = await resume(taskId, {
    project,
    fromStage: opts.from,
    autopilot: opts.autopilot,
    tokenBudget: opts.budget || DEFAULT_TOKEN_BUDGET,
    onEvent: createEventHandler(opts),
    onQuestion: opts.autopilot ? null : createQuestionHandler(),
  });

  if (dag.tokenUsage && (dag.tokenUsage.input > 0 || dag.tokenUsage.output > 0)) {
    console.error(`\ntokens: ${dag.tokenUsage.input} in / ${dag.tokenUsage.output} out`);
  }

  console.log(dag.id);
}

async function cmdAbort(opts) {
  const taskId = opts.positional[0];
  if (!taskId) { console.error("task-id 필수: ucm abort <id>"); process.exit(1); }

  const { TaskDag } = require("../lib/core/task");
  const dag = await TaskDag.load(taskId);
  if (dag.status !== "in_progress") {
    console.error(`중단 불가: 현재 상태 ${dag.status}`);
    process.exit(1);
  }

  // worktree 정리
  const { removeWorktrees, loadWorkspace } = require("../lib/core/worktree");
  try {
    const workspace = await loadWorkspace(taskId);
    if (workspace) {
      await removeWorktrees(taskId, workspace.projects);
    }
  } catch {}

  dag.status = "aborted";
  dag.warnings.push("manually aborted by user");
  await dag.save();
  console.log(`aborted: ${taskId}`);
}

async function cmdGc(opts) {
  const { gcTasks } = require("../lib/core/worktree");
  const maxAgeDays = opts.days || 30;
  console.error(`cleaning up tasks older than ${maxAgeDays} days...`);
  const cleaned = await gcTasks({ maxAgeDays });
  if (cleaned.length === 0) {
    console.log("(nothing to clean)");
  } else {
    for (const id of cleaned) {
      console.log(`  removed: ${id}`);
    }
    console.log(`cleaned ${cleaned.length} task(s)`);
  }
}

async function cmdAnalyze(opts) {
  await ensureDaemon();
  const project = opts.project ? path.resolve(opts.project) : process.cwd();
  console.error(`analyzing ${path.basename(project)}...`);
  const result = await socketRequest({
    method: "analyze_project",
    params: { project },
  });
  if (result.error) {
    console.error(`error: ${result.error}`);
    return;
  }
  console.log(`${result.proposalCount} proposals created for ${result.project}`);
  if (result.proposals && result.proposals.length > 0) {
    for (const p of result.proposals) {
      console.log(`  ${p.id}  [${p.category}/${p.risk}]  ${p.title}`);
    }
  }
}

async function cmdResearch(opts) {
  await ensureDaemon();
  const project = opts.project ? path.resolve(opts.project) : process.cwd();
  console.error(`researching ${path.basename(project)}...`);
  const result = await socketRequest({
    method: "research_project",
    params: { project },
  });
  if (result.error) {
    console.error(`error: ${result.error}`);
    return;
  }
  console.log(`${result.proposalCount} proposals created`);
}

async function cmdDaemon(opts) {
  const subcommand = opts.positional[0];
  if (subcommand === "start") {
    await ensureDaemon();
    console.log("daemon started");
  } else if (subcommand === "stop") {
    try {
      await socketRequest({ method: "shutdown", params: {} });
      console.log("daemon stopped");
    } catch {
      console.log("daemon not running");
    }
  } else {
    console.error("usage: ucm daemon <start|stop>");
  }
}

function getNextAction(dag) {
  const state = dag.state || dag.status;
  if (dag.stageGate) return `ucm gate approve ${dag.id}  또는  ucm gate reject ${dag.id}`;
  switch (state) {
    case "pending": return `ucm start ${dag.id}`;
    case "running":
    case "in_progress": return `ucm logs ${dag.id}  (진행 중)`;
    case "review": return `ucm approve ${dag.id}  또는  ucm reject ${dag.id} --feedback "..."`;
    case "rejected": return `ucm resume ${dag.id}`;
    case "failed": return `ucm retry ${dag.id}  또는  ucm resume ${dag.id} --from ${dag.currentStage || "implement"}`;
    default: return null;
  }
}

// ── Init ──

async function cmdInit() {
  console.log("UCM — Unified Code Manager");
  console.log("Initializing...\n");

  // Prerequisites check
  console.log("Prerequisites:");

  let claudeOk = false;
  try {
    execFileSync("which", ["claude"], { stdio: "pipe" });
    claudeOk = true;
  } catch {}
  console.log(`  ${claudeOk ? "\u2713" : "\u2717"} claude CLI ${claudeOk ? "found" : "not found — install from https://docs.anthropic.com/en/docs/claude-code"}`);

  const apiKeyOk = !!process.env.ANTHROPIC_API_KEY;
  console.log(`  ${apiKeyOk ? "\u2713" : "\u2717"} ANTHROPIC_API_KEY ${apiKeyOk ? "set" : "not set — export ANTHROPIC_API_KEY=sk-..."}`);

  console.log("");

  // Create directories
  const dirs = [
    path.join(TASKS_DIR, "pending"),
    path.join(TASKS_DIR, "running"),
    path.join(TASKS_DIR, "review"),
    path.join(TASKS_DIR, "done"),
    path.join(TASKS_DIR, "failed"),
    path.join(UCM_DIR, "daemon"),
    path.join(UCM_DIR, "forge"),
    path.join(UCM_DIR, "artifacts"),
    path.join(UCM_DIR, "logs"),
    path.join(UCM_DIR, "proposals", "proposed"),
    path.join(UCM_DIR, "proposals", "approved"),
    path.join(UCM_DIR, "proposals", "rejected"),
    path.join(UCM_DIR, "proposals", "implemented"),
    path.join(UCM_DIR, "autopilot"),
    path.join(UCM_DIR, "snapshots"),
    path.join(UCM_DIR, "worktrees"),
    path.join(UCM_DIR, "lessons"),
  ];

  for (const dir of dirs) {
    await mkdir(dir, { recursive: true });
  }
  console.log(`Directories created: ${UCM_DIR}`);

  // Create default config
  const configPath = path.join(UCM_DIR, "config.json");
  if (!fs.existsSync(configPath)) {
    await writeFile(configPath, "{}\n");
    console.log("Default config created: config.json");
  } else {
    console.log("Config already exists: config.json");
  }

  console.log("\n--- Getting Started ---\n");
  console.log("  1. Start daemon:        ucm daemon start");
  console.log("  2. Submit a task:        ucm submit task.md");
  console.log("  3. Start the task:       ucm start <task-id>");
  console.log("  4. Open dashboard:       ucm dashboard");
  console.log("  5. Check status:         ucm status");
  console.log("");

  if (!claudeOk || !apiKeyOk) {
    console.log("\u26A0 Please resolve the prerequisite issues above before using UCM.");
  } else {
    console.log("Ready to go! Run `ucm daemon start` to begin.");
  }
}

// ── Main ──

async function main() {
  const opts = parseArgs(process.argv);

  if (!opts.command) {
    console.log(USAGE);
    process.exit(1);
  }

  switch (opts.command) {
    // Forge commands
    case "forge": await cmdForge(opts); break;
    case "abort": await cmdAbort(opts); break;
    case "gc": await cmdGc(opts); break;
    case "analyze": await cmdAnalyze(opts); break;
    case "research": await cmdResearch(opts); break;
    // Task management (daemon)
    case "submit": await cmdSubmit(opts); break;
    case "start": await cmdStart(opts); break;
    case "list": await cmdList(opts); break;
    case "status": await cmdStatus(opts); break;
    case "approve": await cmdApprove(opts); break;
    case "reject": await cmdReject(opts); break;
    case "cancel": await cmdCancel(opts); break;
    case "retry": await cmdRetry(opts); break;
    case "delete": await cmdDelete(opts); break;
    case "gate": {
      const sub = opts.positional.shift();
      if (sub === "approve") await cmdGateApprove(opts);
      else if (sub === "reject") await cmdGateReject(opts);
      else { console.error("사용법: ucm gate <approve|reject> <task-id>"); process.exit(1); }
      break;
    }
    case "priority": await cmdPriority(opts); break;
    case "diff": await cmdDiff(opts); break;
    case "logs": await cmdLogs(opts); break;
    // Daemon control
    case "daemon": await cmdDaemon(opts); break;
    case "pause": await cmdPause(); break;
    case "resume": await cmdResume(opts); break;
    case "stats": await cmdStats(); break;
    // Proposals & observe
    case "observe": await cmdObserve(opts); break;
    case "proposals": await cmdProposals(opts); break;
    case "proposal": await cmdProposal(opts); break;
    // Other
    case "init": await cmdInit(); break;
    case "chat": await cmdChat(); break;
    case "ui": {
      const { startUiServer } = require("../lib/ucm-ui-server.js");
      await startUiServer(opts);
      break;
    }
    case "dashboard": {
      try {
        await ensureDaemon();
      } catch (e) {
        console.error(`daemon 시작 실패: ${e.message}`);
        console.error("hint: `ucm daemon start`로 수동 시작하세요.");
        process.exit(1);
      }
      const { startUiServer } = require("../lib/ucm-ui-server.js");
      const port = opts.port || Number(process.env.UCM_UI_PORT) || 17172;
      await startUiServer({ port, dev: opts.dev });
      tryOpenDashboard(`http://localhost:${port}`);
      break;
    }
    case "release": await cmdRelease(opts); break;
    default:
      console.error(`알 수 없는 커맨드: ${opts.command}`);
      console.log(USAGE);
      process.exit(1);
  }
}

const ERROR_HINTS = {
  "ECONNREFUSED": "데몬이 실행 중이지 않습니다. `ucm daemon start`로 시작하세요.",
  "ENOENT": "파일 또는 경로를 찾을 수 없습니다. 프로젝트 경로를 확인하세요.",
  "RATE_LIMITED": "API 요청 제한에 도달했습니다. 잠시 후 자동 재시도됩니다.",
  "task not found": "태스크를 찾을 수 없습니다. `ucm list`로 태스크 목록을 확인하세요.",
  "token budget exceeded": "토큰 예산을 초과했습니다. `ucm resume <id> --budget <더큰값>`으로 재시도하세요.",
  "worktree locked": "다른 작업이 진행 중입니다. `ucm list --status in_progress`로 확인하세요.",
  "daemon failed to start": "데몬 시작에 실패했습니다. 로그를 확인하세요: ~/.ucm/daemon/ucmd.log",
  "missing required artifacts": "이전 stage의 산출물이 없습니다. `ucm resume <id> --from <이전stage>`로 재시도하세요.",
  "merge conflict": "머지 충돌이 발생했습니다. worktree에서 수동 해결 후 `ucm resume <id> --from integrate`하세요.",
  "merge failed": "머지에 실패했습니다. `ucm diff <id>`로 변경사항을 확인하세요.",
  "spawn error": "LLM CLI를 실행할 수 없습니다. claude 또는 codex가 설치되어 있는지 확인하세요.",
  "unknown pipeline": "파이프라인 이름이 올바르지 않습니다. trivial|small|medium|large 또는 커스텀(stage1,stage2,...)을 사용하세요.",
  "unknown provider": "지원하지 않는 provider입니다. claude 또는 codex를 사용하세요.",
  "concurrent task limit": "동시 실행 가능한 태스크 수를 초과했습니다. UCM_MAX_CONCURRENT 환경변수로 조정할 수 있습니다.",
};

main().catch(async (e) => {
  const msg = e.message || String(e);
  const hint = Object.entries(ERROR_HINTS).find(([key]) => msg.includes(key));
  if (hint) {
    console.error(`error: ${msg}\nhint: ${hint[1]}`);
  } else {
    console.error(`error: ${msg}`);
  }

  // 실패 시 복구 안내 — taskId를 추출하여 next action 제안
  const taskIdMatch = msg.match(/forge-\d{8}-[a-f0-9]+/);
  if (taskIdMatch) {
    try {
      const { TaskDag } = require("../lib/core/task");
      const dag = await TaskDag.load(taskIdMatch[0]);
      const next = getNextAction(dag);
      if (next) console.error(`next: ${next}`);
    } catch {}
  }

  process.exit(1);
});
