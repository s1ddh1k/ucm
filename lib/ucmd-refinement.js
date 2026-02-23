const crypto = require("crypto");
const path = require("path");
const { readFile, writeFile } = require("fs/promises");

const {
  computeCoverage, isFullyCovered,
  REFINEMENT_GREENFIELD, REFINEMENT_BROWNFIELD,
  buildRefinementPrompt, buildAutopilotRefinementPrompt,
  formatRefinedRequirements,
} = require("./qna-core.js");

const { TASKS_DIR, DEFAULT_CONFIG, TASK_STATES } = require("./ucmd-constants.js");
const { parseTaskFile, serializeTaskFile, expandHome } = require("./ucmd-task.js");

let deps = {};

function setDeps(d) { deps = d; }

const refinementSessions = new Map();
const refinementWaiters = new Map();

function isActiveSession(sessionId, session) {
  return refinementSessions.get(sessionId) === session;
}

function clearRefinementSession(sessionId, session) {
  if (!isActiveSession(sessionId, session)) return;
  const waiter = refinementWaiters.get(sessionId);
  if (waiter) {
    waiter.resolve(null);
    refinementWaiters.delete(sessionId);
  }
  refinementSessions.delete(sessionId);
}

function emitRefinementComplete(sessionId, session, extra = {}) {
  session.completed = true;
  session.currentQuestion = null;
  try {
    deps.broadcastWs("refinement:complete", {
      sessionId,
      coverage: session.coverage,
      decisions: session.decisions,
      ...extra,
    });
  } catch (e) {
    if (typeof deps.log === "function") {
      deps.log(`[refinement] complete broadcast failed: ${e.message}`);
    }
  }
}

function resolveRefinementAnswer(sessionId, answers) {
  const waiter = refinementWaiters.get(sessionId);
  if (waiter) waiter.resolve(answers);
}

function refinementLog(sessionId) {
  return (line) => deps.broadcastWs("refinement:log", { sessionId, line });
}

async function setRefinedFlag(taskId) {
  const maxAttempts = 6;
  const retryDelayMs = 50;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    for (const state of TASK_STATES) {
      const taskPath = path.join(TASKS_DIR, state, `${taskId}.md`);
      try {
        const content = await readFile(taskPath, "utf-8");
        const { meta, body } = parseTaskFile(content);
        meta.refined = true;
        await writeFile(taskPath, serializeTaskFile(meta, body));
        return true;
      } catch {}
    }
    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  return false;
}

async function scanRepoContext(projectPath, sessionId) {
  const prompt = `당신은 코드베이스를 요약하는 분석가입니다.
로컬 저장소를 **한 번만** 스캔하여 아래 형식으로 요약하세요. 과도하게 길게 쓰지 마세요.

## 출력 형식 (Markdown)
- Summary: 프로젝트 성격과 범위를 3~5문장으로 요약
- Tech Stack: 언어/프레임워크/빌드/테스트/배포 관련 핵심만 나열
- Key Files: README, 설정 파일, 주요 엔트리포인트 등 핵심 파일 목록
- Module/Area Candidates: 질문 선택지로 쓸 수 있는 모듈/폴더/파일 후보 8~15개

규칙:
- 근거가 되는 파일 경로를 괄호로 표시
- 추측은 "추정"으로 표시
- 결과는 한국어로 작성`;

  const config = deps.config();
  const cfg = config || DEFAULT_CONFIG;
  const result = await deps.spawnAgent(prompt, {
    cwd: projectPath,
    provider: cfg.provider || DEFAULT_CONFIG.provider,
    model: "sonnet",
    timeoutMs: 600000,
    taskId: "_refinement",
    stage: "scan-repo",
    onLog: refinementLog(sessionId),
  });
  deps.daemonState().stats.totalSpawns++;
  deps.markStateDirty();
  if (result.status === "done") return result.stdout || "";
  throw new Error(`repo scan failed: ${result.status}`);
}

function extractJsonFromText(text) {
  // 1) code fence
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch {}
  }
  // 2) first { ... } block (greedy brace matching)
  const braceStart = text.indexOf("{");
  if (braceStart !== -1) {
    let depth = 0;
    for (let i = braceStart; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}") { depth--; if (depth === 0) {
        try { return JSON.parse(text.slice(braceStart, i + 1)); } catch {}
        break;
      }}
    }
  }
  // 3) raw text
  return JSON.parse(text.trim());
}

async function generateNextQuestion(sessionId) {
  const session = refinementSessions.get(sessionId);
  if (!session) return;
  if (session.mode !== "interactive") return;

  const coverage = computeCoverage(session.decisions, session.expectedAreas);
  session.coverage = coverage;

  if (isFullyCovered(coverage)) {
    emitRefinementComplete(sessionId, session);
    return;
  }

  deps.broadcastWs("refinement:status", { sessionId, status: "질문 생성 중..." });

  const prompt = buildRefinementPrompt(session.decisions, session.description, {
    isBrownfield: session.isBrownfield,
    coverage,
    repoContext: session.repoContext,
  });

  const config = deps.config();
  const cfg = config || DEFAULT_CONFIG;
  const result = await deps.spawnAgent(prompt, {
    cwd: session.projectPath || undefined,
    provider: cfg.provider || DEFAULT_CONFIG.provider,
    model: "sonnet",
    timeoutMs: 600000,
    taskId: "_refinement",
    stage: `refinement-q-${session.decisions.length + 1}`,
    onLog: refinementLog(sessionId),
  });
  deps.daemonState().stats.totalSpawns++;
  deps.markStateDirty();
  if (!isActiveSession(sessionId, session)) return;
  if (session.mode !== "interactive") return;

  if (result.status !== "done") {
    deps.broadcastWs("refinement:error", { sessionId, error: "question generation failed" });
    clearRefinementSession(sessionId, session);
    return;
  }

  let parsed;
  try {
    parsed = extractJsonFromText(result.stdout || "");
  } catch (e) {
    session._parseRetries = (session._parseRetries || 0) + 1;
    if (session._parseRetries < 2) {
      deps.log("[refinement] JSON parse failed, retrying question generation...");
      return generateNextQuestion(sessionId);
    }
    session._parseRetries = 0;
    deps.broadcastWs("refinement:error", { sessionId, error: `JSON parse failed: ${e.message}` });
    clearRefinementSession(sessionId, session);
    return;
  }
  session._parseRetries = 0;

  if (parsed.done) {
    session.coverage = computeCoverage(session.decisions, session.expectedAreas);
    if (!isFullyCovered(session.coverage)) {
      session._doneRetries = (session._doneRetries || 0) + 1;
      if (session._doneRetries < 2) {
        deps.log("[refinement] premature done before coverage complete, retrying question generation...");
        return generateNextQuestion(sessionId);
      }
      session._doneRetries = 0;
      deps.broadcastWs("refinement:error", {
        sessionId,
        error: "model reported done before refinement coverage was complete",
      });
      clearRefinementSession(sessionId, session);
      return;
    }
    session._doneRetries = 0;
    if (parsed.pipeline) session.pipeline = parsed.pipeline;
    emitRefinementComplete(sessionId, session, { pipeline: session.pipeline });
    return;
  }

  const normalizedArea = typeof parsed.area === "string" ? parsed.area.trim() : "";
  const hasValidArea = normalizedArea
    && Object.prototype.hasOwnProperty.call(session.expectedAreas || {}, normalizedArea);
  if (!parsed.question || !parsed.options || !hasValidArea) {
    session._retries = (session._retries || 0) + 1;
    if (session._retries < 2) {
      deps.log("[refinement] invalid question format, retrying...");
      return generateNextQuestion(sessionId);
    }
    session._retries = 0;
    deps.broadcastWs("refinement:error", { sessionId, error: "invalid question format after retry" });
    clearRefinementSession(sessionId, session);
    return;
  }
  session._retries = 0;
  session._doneRetries = 0;

  parsed.area = normalizedArea;
  session.currentQuestion = parsed;
  deps.broadcastWs("refinement:question", {
    sessionId,
    round: session.decisions.length + 1,
    question: parsed.question,
    options: parsed.options,
    area: parsed.area,
    coverage,
  });
}

async function handleRefinementAnswer(sessionId, answer) {
  const session = refinementSessions.get(sessionId);
  if (!session) return;
  if (session.completed === true) return;
  if (session.mode !== "interactive") return;
  if (!session.currentQuestion) return;

  const normalizedValue = typeof answer?.value === "string"
    ? answer.value.trim()
    : answer?.value == null ? "" : String(answer.value).trim();
  if (!normalizedValue) throw new Error("refinement answer value required");

  const decision = {
    area: session.currentQuestion?.area || answer.area || "기타",
    question: answer.questionText || session.currentQuestion?.question || "",
    answer: normalizedValue,
    reason: answer.reason || "",
  };
  session.decisions.push(decision);
  session.currentQuestion = null;

  const coverage = computeCoverage(session.decisions, session.expectedAreas);
  session.coverage = coverage;
  deps.broadcastWs("refinement:progress", {
    sessionId,
    round: session.decisions.length,
    decision,
    coverage,
  });

  await generateNextQuestion(sessionId);
}

function buildAutopilotPrompt(session) {
  return buildAutopilotRefinementPrompt(session);
}

async function runAutopilotRefinement(sessionId) {
  const session = refinementSessions.get(sessionId);
  if (!session) return;

  const config = deps.config();
  const cfg = config || DEFAULT_CONFIG;
  const requiredCoverageRounds = Object.values(session.expectedAreas || {})
    .reduce((sum, count) => sum + (Number.isFinite(count) ? Math.max(0, count) : 0), 0);
  const maxRounds = Math.max(15, requiredCoverageRounds);
  let parseFailures = 0;
  const maxParseFailures = Math.max(5, maxRounds);

  for (let round = 0; round < maxRounds; round++) {
    if (!refinementSessions.has(sessionId)) return;
    if (session.mode !== "autopilot") return;

    const coverage = computeCoverage(session.decisions, session.expectedAreas);
    session.coverage = coverage;

    if (isFullyCovered(coverage)) {
      emitRefinementComplete(sessionId, session);
      return;
    }

    deps.broadcastWs("refinement:status", { sessionId, status: `자동 분석 중... (${round + 1}단계)` });

    const prompt = buildAutopilotPrompt(session);
    const result = await deps.spawnAgent(prompt, {
      cwd: session.projectPath || undefined,
      provider: cfg.provider || DEFAULT_CONFIG.provider,
      model: "sonnet",
      timeoutMs: 600000,
      taskId: "_refinement",
      stage: `refinement-auto-${round + 1}`,
      onLog: refinementLog(sessionId),
    });
    deps.daemonState().stats.totalSpawns++;
    deps.markStateDirty();
    if (!isActiveSession(sessionId, session)) return;
    if (session.mode !== "autopilot") return;

    if (result.status !== "done") {
      deps.broadcastWs("refinement:error", { sessionId, error: `autopilot round ${round + 1} failed` });
      clearRefinementSession(sessionId, session);
      return;
    }

    let parsed;
    try {
      parsed = extractJsonFromText(result.stdout || "");
    } catch (e) {
      parseFailures += 1;
      deps.log(`[refinement] JSON parse failed at round ${round + 1}, retrying...`);
      if (parseFailures > maxParseFailures) {
        deps.broadcastWs("refinement:error", {
          sessionId,
          error: "autopilot JSON parse failed repeatedly",
        });
        clearRefinementSession(sessionId, session);
        return;
      }
      round -= 1; // parse failure should not consume coverage round budget
      continue;
    }
    parseFailures = 0;

    if (parsed.done) {
      session.coverage = computeCoverage(session.decisions, session.expectedAreas);
      if (!isFullyCovered(session.coverage)) {
        deps.log(`[refinement] autopilot reported done before full coverage at round ${round + 1}, continuing...`);
        continue;
      }
      if (parsed.pipeline) session.pipeline = parsed.pipeline;
      emitRefinementComplete(sessionId, session, { pipeline: session.pipeline });
      return;
    }

    const normalizedArea = typeof parsed.area === "string" ? parsed.area.trim() : "";
    const normalizedQuestion = typeof parsed.question === "string" ? parsed.question.trim() : "";
    const normalizedAnswer = typeof parsed.answer === "string" ? parsed.answer.trim() : "";
    const hasValidArea = normalizedArea
      && Object.prototype.hasOwnProperty.call(session.expectedAreas || {}, normalizedArea);
    if (normalizedArea && !hasValidArea) {
      deps.broadcastWs("refinement:error", {
        sessionId,
        error: "invalid autopilot answer area",
      });
      clearRefinementSession(sessionId, session);
      return;
    }

    if (!normalizedQuestion || !normalizedAnswer || !normalizedArea) {
      continue;
    }

    const decision = {
      area: normalizedArea,
      question: normalizedQuestion,
      answer: normalizedAnswer,
      reason: parsed.reason || "",
      requirement: parsed.requirement || "",
    };
    session.decisions.push(decision);

    const updatedCoverage = computeCoverage(session.decisions, session.expectedAreas);
    session.coverage = updatedCoverage;

    deps.broadcastWs("refinement:progress", {
      sessionId,
      round: session.decisions.length,
      decision,
      coverage: updatedCoverage,
    });
  }

  session.coverage = computeCoverage(session.decisions, session.expectedAreas);
  if (isFullyCovered(session.coverage)) {
    emitRefinementComplete(sessionId, session);
    return;
  }
  deps.broadcastWs("refinement:error", {
    sessionId,
    error: "autopilot reached max rounds before refinement coverage was complete",
  });
  clearRefinementSession(sessionId, session);
}

async function startRefinement(params = {}) {
  const { title, description, body, project, pipeline, mode } = params;
  const normalizedTitle = typeof title === "string" ? title.trim() : "";
  if (!normalizedTitle) throw new Error("title required");
  const normalizedDescriptionInput = typeof description === "string"
    ? description.trim()
    : description == null ? "" : String(description).trim();
  const normalizedBodyInput = typeof body === "string"
    ? body.trim()
    : body == null ? "" : String(body).trim();
  const normalizedDescription = normalizedDescriptionInput || normalizedBodyInput;
  const normalizedMode = mode === "autopilot" ? "autopilot" : "interactive";
  const sessionId = crypto.randomBytes(8).toString("hex");
  const isBrownfield = !!project;
  const projectPath = project ? path.resolve(expandHome(project)) : null;

  const session = {
    sessionId,
    mode: normalizedMode,
    projectPath,
    isBrownfield,
    expectedAreas: isBrownfield ? REFINEMENT_BROWNFIELD : REFINEMENT_GREENFIELD,
    decisions: [],
    coverage: {},
    repoContext: null,
    title: normalizedTitle,
    description: normalizedDescription,
    pipeline: pipeline || undefined,
    currentQuestion: null,
    completed: false,
  };

  refinementSessions.set(sessionId, session);
  deps.log(`refinement started: ${sessionId} (mode=${session.mode}, brownfield=${isBrownfield})`);

  try {
    deps.broadcastWs("refinement:started", { sessionId, mode: session.mode });
  } catch (e) {
    deps.log(`[refinement] started broadcast failed: ${e.message}`);
  }

  const runRefinement = async () => {
    if (isBrownfield) {
      try {
        deps.broadcastWs("refinement:status", { sessionId, status: "코드베이스 분석 중..." });
        session.repoContext = await scanRepoContext(projectPath, sessionId);
      } catch (e) {
        deps.log(`refinement scan error: ${e.message}`);
      }
    }

    if (session.mode === "interactive") {
      await generateNextQuestion(sessionId);
    } else {
      await runAutopilotRefinement(sessionId);
    }
  };

  runRefinement().catch((e) => {
    deps.log(`refinement error: ${e.message}`);
    if (isActiveSession(sessionId, session)) {
      const waiter = refinementWaiters.get(sessionId);
      if (waiter) {
        waiter.resolve(null);
        refinementWaiters.delete(sessionId);
      }
      refinementSessions.delete(sessionId);
    }
    deps.broadcastWs("refinement:error", { sessionId, error: e.message });
  });

  return { sessionId };
}

async function switchToAutopilot(sessionId) {
  const session = refinementSessions.get(sessionId);
  if (!session) throw new Error("session not found");
  if (session.completed === true) throw new Error("refinement already complete");
  if (session.mode === "autopilot") throw new Error("refinement already in autopilot mode");

  session.mode = "autopilot";
  session.currentQuestion = null;

  const waiter = refinementWaiters.get(sessionId);
  if (waiter) {
    waiter.resolve(null);
    refinementWaiters.delete(sessionId);
  }

  try {
    deps.broadcastWs("refinement:mode_changed", { sessionId, mode: "autopilot" });
  } catch (e) {
    deps.log(`[refinement] mode_changed broadcast failed: ${e.message}`);
  }

  runAutopilotRefinement(sessionId).catch((e) => {
    deps.log(`refinement autopilot error: ${e.message}`);
    clearRefinementSession(sessionId, session);
    deps.broadcastWs("refinement:error", { sessionId, error: e.message });
  });
}

async function finalizeRefinement(sessionId) {
  const session = refinementSessions.get(sessionId);
  if (!session) throw new Error("session not found");
  if (session.finalizing === true) throw new Error("refinement finalization in progress");
  if (session.completed !== true) throw new Error("refinement not complete");
  session.coverage = computeCoverage(session.decisions, session.expectedAreas);
  if (!isFullyCovered(session.coverage)) throw new Error("refinement not complete");

  session.finalizing = true;
  try {
    const formatted = formatRefinedRequirements(session.decisions);
    const body = (session.description ? session.description + "\n\n" : "") + formatted;
    const result = await deps.submitTask(session.title, body, {
      project: session.projectPath,
      pipeline: session.pipeline,
    });

    const refinedMarked = await setRefinedFlag(result.id);
    if (!refinedMarked) {
      deps.log("refinement: failed to set refined flag: task file not found");
    }

    const waiter = refinementWaiters.get(sessionId);
    if (waiter) {
      waiter.resolve(null);
      refinementWaiters.delete(sessionId);
    }

    refinementSessions.delete(sessionId);
    deps.log(`refinement finalized: ${sessionId} → task ${result.id}`);
    try {
      deps.broadcastWs("refinement:finalized", { sessionId, taskId: result.id });
    } catch (broadcastError) {
      deps.log(`refinement finalized broadcast error: ${broadcastError.message}`);
    }
    return { taskId: result.id };
  } catch (e) {
    session.finalizing = false;
    throw e;
  }
}

function cancelRefinement(sessionId) {
  const session = refinementSessions.get(sessionId);
  if (!session) throw new Error("session not found");
  if (session.finalizing === true) throw new Error("refinement finalization in progress");

  const waiter = refinementWaiters.get(sessionId);
  if (waiter) {
    waiter.resolve(null);
    refinementWaiters.delete(sessionId);
  }

  refinementSessions.delete(sessionId);
  deps.log(`refinement cancelled: ${sessionId}`);
  try {
    deps.broadcastWs("refinement:cancelled", { sessionId });
  } catch (e) {
    deps.log(`refinement cancelled broadcast error: ${e.message}`);
  }
  return { sessionId, status: "cancelled" };
}

module.exports = {
  setDeps,
  resolveRefinementAnswer,
  startRefinement,
  handleRefinementAnswer,
  switchToAutopilot,
  finalizeRefinement,
  cancelRefinement,
};
