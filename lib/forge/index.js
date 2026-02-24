const { EventEmitter } = require("node:events");
const path = require("node:path");
const { mkdir } = require("node:fs/promises");
const { TaskDag, generateForgeId } = require("../core/task");
const {
  initArtifacts,
  createWorktrees,
  loadWorkspace,
  getWorktreeCwd,
  removeWorktrees,
  loadArtifact,
  saveArtifact,
} = require("../core/worktree");
const {
  FORGE_PIPELINES,
  STAGE_TIMEOUTS,
  STAGE_ARTIFACTS,
  FORGE_DIR,
} = require("../core/constants");
const RESUMABLE_DAG_STATUSES = new Set([
  "failed",
  "rejected",
  "aborted",
  "in_progress",
]);

class ForgePipeline extends EventEmitter {
  constructor({
    taskId,
    input,
    project,
    pipeline,
    autoApprove = false,
    onQuestion,
    resumeFrom,
    tokenBudget,
    stageApproval,
  } = {}) {
    super();
    if (
      !resumeFrom &&
      !taskId &&
      (!input || (typeof input === "string" && !input.trim()))
    ) {
      throw new Error("input required: task request must not be empty");
    }
    this.taskId = taskId || generateForgeId();
    this.input = input;
    this.project = project;
    this.pipeline = pipeline;
    this.autoApprove = autoApprove;
    this.onQuestion = onQuestion || null;
    this.resumeFrom = resumeFrom || null;
    this.tokenBudget = tokenBudget || 0;
    this.stageApproval = stageApproval || {};
    this._pendingGate = null;
    this.dag = null;
    this.stages = [];
    this.worktreeCwd = null;
    this.aborted = false;
  }

  emit(event, data) {
    return super.emit(event, { taskId: this.taskId, ...data });
  }

  async run() {
    const forgeDir = path.join(FORGE_DIR, this.taskId);
    await mkdir(forgeDir, { recursive: true });

    // resume 모드: 기존 DAG 로드
    if (this.resumeFrom) {
      this.dag = await TaskDag.load(this.taskId);
      this.pipeline = this.dag.pipeline;
    } else {
      this.dag = new TaskDag({
        id: this.taskId,
        status: "in_progress",
        pipeline: this.pipeline,
      });
    }

    this.dag.startedAt = this.dag.startedAt || new Date().toISOString();
    this.emit("pipeline:start", { pipeline: this.pipeline, input: this.input });

    try {
      if (this.resumeFrom) {
        // resume: 기존 workspace에서 worktree 복원
        await this.restoreWorktree();
        this.dag.status = "in_progress";
        await this.dag.save();
      } else if (this.pipeline) {
        // pipeline 미리 지정 → intake skip, artifact 초기화
        await initArtifacts(this.taskId, this.input || "");
      }

      const complexity = this.pipeline || (await this.runIntake());
      let stages;
      if (FORGE_PIPELINES[complexity]) {
        stages = FORGE_PIPELINES[complexity];
      } else if (typeof complexity === "string" && complexity.includes(",")) {
        stages = complexity.split(",").map((s) => s.trim());
        if (!stages.includes("deliver")) stages.push("deliver");
      } else {
        throw new Error(`unknown pipeline: ${complexity}`);
      }
      this.stages = stages;

      this.dag.pipeline = complexity;
      await this.dag.save();

      // worktree 생성 (아직 없으면)
      if (this.project && !this.worktreeCwd) {
        await this.setupWorktree();
      }

      // resume 모드: resumeFrom 이전 stage는 skip
      let skipping = !!this.resumeFrom;

      let subtaskStagesRan = false;
      for (const stageName of stages) {
        if (this.aborted) break;

        if (skipping) {
          if (stageName === this.resumeFrom) {
            skipping = false;
          } else {
            continue;
          }
        }

        // subtask가 있으면 design/implement/verify/ux-review/polish를 runSubtaskStages로 한 번만 실행
        if (
          (stageName === "design" ||
            stageName === "implement" ||
            stageName === "verify" ||
            stageName === "ux-review" ||
            stageName === "polish") &&
          this.dag.tasks.length > 0
        ) {
          if (!subtaskStagesRan) {
            await this.runSubtaskStages();
            subtaskStagesRan = true;
          }
          continue;
        }

        await this.runStage(stageName);

        // Stage gate: wait for approval if configured
        if (stageName !== "deliver" && stageName !== "intake") {
          await this.waitForStageGate(stageName);
        }
      }

      if (skipping) {
        throw new Error(
          `resume stage "${this.resumeFrom}" not found in pipeline: ${stages.join(", ")}`,
        );
      }

      if (!this.aborted) {
        // hivemind에 학습 축적
        await this.learnToHivemind();

        // deliver가 설정한 status를 존중 (auto_merged → done, review → review 유지)
        const finalStatus =
          this.dag.status === "auto_merged" ? "done" : this.dag.status;
        this.dag.status = finalStatus;
        this.dag.completedAt = new Date().toISOString();
        // deliver의 최종 status를 stageHistory에 보충 기록
        const lastStage =
          this.dag.stageHistory[this.dag.stageHistory.length - 1];
        if (lastStage && lastStage.stage === "deliver") {
          lastStage.finalStatus = finalStatus;
        }
        await this.dag.save();
        this.emit("pipeline:complete", { status: finalStatus });
      }
    } catch (error) {
      // If abort() already set status to "aborted", preserve it — don't overwrite to "failed"
      if (!this.aborted) {
        this.dag.status = "failed";
        this.emit("pipeline:error", { error: error.message });

        // Preserve failed-task worktrees so users can inspect diffs/logs before retry/delete.
        this.emit("agent:output", {
          stage: "worktree",
          chunk: "[worktree] preserved after failure for diff/review",
        });
      }
      this.dag.warnings.push(error.message);
      try {
        await this.dag.save();
      } catch (saveErr) {
        this.emit("agent:output", {
          stage: "save",
          chunk: `[forge] failed to save DAG after error: ${saveErr.message}`,
        });
      }

      throw error;
    }

    return this.dag;
  }

  async runIntake() {
    const startTime = Date.now();
    this.emit("stage:start", { stage: "intake", model: null });

    try {
      const intake = require("./intake");
      const result = await intake.run(this.input, {
        project: this.project,
        taskId: this.taskId,
        onLog: (line) =>
          this.emit("agent:output", { stage: "intake", chunk: line }),
      });

      const durationMs = Date.now() - startTime;
      this.pipeline = result.complexity;
      this.dag.title = result.title;
      const tokenUsage = result.tokenUsage || null;
      this.dag.recordStage("intake", "pass", durationMs, tokenUsage);
      if (tokenUsage) {
        this.dag.addTokenUsage(tokenUsage.input, tokenUsage.output);
      }
      this.emit("stage:complete", {
        stage: "intake",
        durationMs,
        status: "pass",
      });
      return result.complexity;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this.dag.recordStage("intake", "fail", durationMs, null);
      try {
        await this.dag.save();
      } catch (saveErr) {
        this.emit("agent:output", {
          stage: "save",
          chunk: `[forge] failed to save DAG after intake error: ${saveErr.message}`,
        });
      }
      this.emit("stage:complete", {
        stage: "intake",
        durationMs,
        status: "fail",
      });
      throw error;
    }
  }

  async setupWorktree() {
    const projects = [
      {
        name: path.basename(this.project),
        path: this.project,
        role: "primary",
      },
    ];
    const workspace = await createWorktrees(this.taskId, projects);
    const wtPath = workspace.projects?.[0]?.path;
    if (!wtPath) {
      throw new Error("worktree created but no project path returned");
    }
    this.worktreeCwd = wtPath;
    this.emit("agent:output", {
      stage: "worktree",
      chunk: `[worktree] created at ${this.worktreeCwd}`,
    });
  }

  async restoreWorktree() {
    if (!this.project) return;
    const workspace = await loadWorkspace(this.taskId);
    if (workspace) {
      this.worktreeCwd = getWorktreeCwd(this.taskId, workspace.projects);
    } else {
      // workspace가 정리되었으면 새로 생성
      await this.setupWorktree();
    }
  }

  async checkRequiredArtifacts(stageName) {
    const stageArtifacts = STAGE_ARTIFACTS[stageName];
    if (!stageArtifacts || stageArtifacts.requires.length === 0) return;

    // Only check artifacts that are produced by stages in the current pipeline.
    // this.stages keeps the resolved stage list (supports custom CSV pipelines).
    const pipelineStages =
      Array.isArray(this.stages) && this.stages.length > 0
        ? this.stages
        : FORGE_PIPELINES[this.dag?.pipeline] ||
          (typeof this.dag?.pipeline === "string" &&
          this.dag.pipeline.includes(",")
            ? this.dag.pipeline
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : []);
    const producedByPipeline = new Set();
    for (const s of pipelineStages) {
      const sa = STAGE_ARTIFACTS[s];
      if (!sa) continue;
      for (const artifact of sa.produces) {
        producedByPipeline.add(artifact);
      }
    }

    const missing = [];
    for (const artifact of stageArtifacts.requires) {
      if (!producedByPipeline.has(artifact)) continue;
      try {
        await loadArtifact(this.taskId, artifact);
      } catch (e) {
        if (e.code !== "ENOENT")
          this.emit("agent:output", {
            stage: stageName,
            chunk: `[forge] loadArtifact error (${artifact}): ${e.message}`,
          });
        missing.push(artifact);
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `missing required artifacts for ${stageName}: ${missing.join(", ")}`,
      );
    }
  }

  async runStage(stageName, { subtask } = {}) {
    if (this.aborted) throw new Error("pipeline aborted");

    this.dag.currentStage = stageName;
    await this.dag.save();

    await this.checkRequiredArtifacts(stageName);

    const timeouts = STAGE_TIMEOUTS[stageName] || {
      idle: 5 * 60_000,
      hard: 20 * 60_000,
    };
    const startTime = Date.now();

    this.emit("stage:start", { stage: stageName, model: null });

    // implement/verify는 worktree에서, design은 worktree (또는 원본)에서 실행
    const stageProject = this.worktreeCwd || this.project;

    try {
      const stageModule = require(`./${stageName}`);
      const result = await stageModule.run({
        taskId: this.taskId,
        dag: this.dag,
        project: stageProject,
        autoApprove: this.autoApprove,
        subtask,
        timeouts,
        tokenBudget: this.tokenBudget,
        onQuestion: this.onQuestion,
        onLog: (line) =>
          this.emit("agent:output", { stage: stageName, chunk: line }),
      });

      // Result-based stage gates: some stages report pass/fail in return value
      // instead of throwing. Convert those failures into pipeline failures.
      if (stageName === "verify" && result?.passed === false) {
        throw new Error(
          `verify gate failed: ${(result.feedback || "verification failed").slice(0, 1000)}`,
        );
      }
      if (
        stageName === "ux-review" &&
        result?.passed === false &&
        !result?.skipped
      ) {
        throw new Error(
          `ux-review gate failed: ${(result.feedback || "ux review failed").slice(0, 1000)}`,
        );
      }

      const durationMs = Date.now() - startTime;
      const stageTokenUsage = result?.tokenUsage || null;
      this.dag.recordStage(stageName, "pass", durationMs, stageTokenUsage);

      // 토큰 사용량 누적 (stage가 tokenUsage를 반환하면)
      if (stageTokenUsage) {
        this.dag.addTokenUsage(stageTokenUsage.input, stageTokenUsage.output);
      }

      await this.dag.save();
      this.emit("stage:complete", {
        stage: stageName,
        durationMs,
        status: "pass",
      });

      // 토큰 예산 경고 및 초과 체크
      if (this.tokenBudget > 0) {
        const used = this.dag.totalTokens();
        const percent = Math.round((used / this.tokenBudget) * 100);
        if (used > this.tokenBudget) {
          this.dag.warnings.push(
            `token budget exceeded: ${used}/${this.tokenBudget}`,
          );
          this.emit("warning:budget", {
            used,
            budget: this.tokenBudget,
            percent,
          });
          throw new Error(`token budget exceeded: ${used}/${this.tokenBudget}`);
        } else if (percent >= 90) {
          this.emit("warning:budget", {
            used,
            budget: this.tokenBudget,
            percent,
          });
        } else if (percent >= 70) {
          this.emit("notice:budget", {
            used,
            budget: this.tokenBudget,
            percent,
          });
        }
      }

      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      this.dag.recordStage(stageName, "fail", durationMs, null);
      this.dag.currentStage = null;
      try {
        await this.dag.save();
      } catch (saveErr) {
        this.emit("agent:output", {
          stage: "save",
          chunk: `[forge] failed to save DAG after ${stageName} error: ${saveErr.message}`,
        });
      }
      this.emit("stage:complete", {
        stage: stageName,
        durationMs,
        status: "fail",
      });
      throw error;
    }
  }

  async runSubtaskStages() {
    const waves = this.dag.getWaves();
    for (const wave of waves) {
      if (this.aborted) break;

      // resume 시 이미 완료된 subtask는 스킵
      const pending = wave.filter((id) => {
        const t = this.dag.tasks.find((t) => t.id === id);
        return t && t.status !== "done";
      });

      if (pending.length === 0) continue;

      for (const subtaskId of pending) {
        this.dag.updateTaskStatus(subtaskId, "in_progress");
      }
      await this.dag.save();

      // subtask는 순차 실행 (같은 worktree를 공유하므로 병렬 시 git 충돌 발생)
      for (const subtaskId of pending) {
        if (this.aborted) break;

        const subtask = this.dag.tasks.find((t) => t.id === subtaskId);
        if (!subtask) {
          this.dag.warnings.push(`subtask not found: ${subtaskId}`);
          continue;
        }

        this.emit("subtask:start", { subtaskId, title: subtask.title });

        try {
          await this.runStage("design", { subtask });
          await this.waitForStageGate("design");
          if (this.aborted) break;

          await this.runImplementVerifyLoop(subtask);
          if (this.aborted) break;

          // ux-review/polish가 파이프라인에 있으면 subtask에도 실행
          const pipelineKey = this.dag.pipeline;
          const pipelineStages =
            FORGE_PIPELINES[pipelineKey] ||
            (typeof pipelineKey === "string" && pipelineKey.includes(",")
              ? pipelineKey.split(",").map((s) => s.trim())
              : []);
          if (pipelineStages.includes("polish")) {
            if (this.aborted) break;
            await this.runStage("polish", { subtask });
            await this.waitForStageGate("polish");
          }

          this.dag.updateTaskStatus(subtaskId, "done");
          await this.dag.save();
          this.emit("subtask:complete", {
            subtaskId,
            title: subtask.title,
            status: "done",
          });
        } catch (error) {
          if (this.aborted) break; // don't mark subtask as failed on abort
          this.dag.updateTaskStatus(subtaskId, "failed");
          this.dag.warnings.push(
            `subtask ${subtaskId} failed: ${error.message}`,
          );
          try {
            await this.dag.save();
          } catch (saveErr) {
            this.emit("agent:output", {
              stage: "save",
              chunk: `[forge] failed to save DAG after subtask ${subtaskId} error: ${saveErr.message}`,
            });
          }
          this.emit("subtask:complete", {
            subtaskId,
            title: subtask.title,
            status: "failed",
          });
        }
      }

      // Reset unprocessed subtasks from "in_progress" back to "pending" (e.g. after abort)
      for (const subtaskId of pending) {
        const t = this.dag.tasks.find((t) => t.id === subtaskId);
        if (t && t.status === "in_progress") {
          this.dag.updateTaskStatus(subtaskId, "pending");
        }
      }

      await this.dag.save();
    }

    // Fail pipeline if any subtask failed — don't proceed to deliver with partial work
    if (this.dag.anyFailed()) {
      const failed = this.dag.tasks.filter((t) => t.status === "failed");
      const ids = failed.map((t) => t.id).join(", ");
      throw new Error(`${failed.length} subtask(s) failed: ${ids}`);
    }
  }

  async runImplementVerifyLoop(subtask) {
    const maxIterations = 3;
    let feedback = null;
    const iterationHistory = []; // Track iteration context for AI learning

    // reject 피드백이 있으면 첫 iteration에 주입
    if (this.resumeFrom === "implement") {
      try {
        feedback = await loadArtifact(this.taskId, "rejection-feedback.md");
      } catch (e) {
        if (e.code !== "ENOENT")
          this.emit("agent:output", {
            stage: "implement",
            chunk: `[forge] loadArtifact error (rejection-feedback.md): ${e.message}`,
          });
      }
    }

    // On resume, load previous verify iteration feedback to avoid repeating same mistakes
    if (this.resumeFrom && !feedback) {
      const subtaskSuffix = subtask ? `-${subtask.id}` : "";
      for (let i = maxIterations; i >= 1; i--) {
        try {
          const raw = await loadArtifact(
            this.taskId,
            `verify-iter-${i}${subtaskSuffix}.json`,
          );
          const data = JSON.parse(raw);
          if (data.feedback && !data.passed) {
            feedback = data.feedback;
            this.emit("agent:output", {
              stage: "implement",
              chunk: `[forge] loaded previous verify feedback from iteration ${i}`,
            });
            break;
          }
        } catch {
          // artifact not found, try previous iteration
        }
      }
    }

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      if (this.aborted) break;
      this.emit("gate:iteration", {
        stage: "implement",
        iteration,
        maxIterations,
      });

      // Build iteration context from previous attempts
      let iterationContext = null;
      if (iterationHistory.length > 0) {
        iterationContext =
          `\n\n## 이전 시도 이력 (${iterationHistory.length}회 실패)\n\n` +
          iterationHistory
            .map(
              (h, i) =>
                `### 시도 ${i + 1}\n- 실패 유형: ${h.failureType}\n- 피드백: ${h.feedback?.slice(0, 500) || "없음"}`,
            )
            .join("\n\n") +
          `\n\n**중요**: 이전과 같은 접근 방식을 반복하지 마세요. 다른 전략을 시도하세요.`;
      }

      const implStart = Date.now();
      this.emit("stage:start", { stage: "implement", model: null });

      // Combine feedback with iteration context
      const combinedFeedback =
        [feedback, iterationContext].filter(Boolean).join("\n") || null;

      let implResult;
      try {
        const implement = require("./implement");
        implResult = await implement.run({
          taskId: this.taskId,
          dag: this.dag,
          project: this.worktreeCwd || this.project,
          autoApprove: this.autoApprove,
          subtask,
          feedback: combinedFeedback,
          timeouts: STAGE_TIMEOUTS.implement,
          onLog: (line) =>
            this.emit("agent:output", { stage: "implement", chunk: line }),
        });
      } catch (error) {
        const implDuration = Date.now() - implStart;
        this.dag.recordStage("implement", "fail", implDuration, null);
        try {
          await this.dag.save();
        } catch (saveErr) {
          this.emit("agent:output", {
            stage: "save",
            chunk: `[forge] failed to save DAG after implement error: ${saveErr.message}`,
          });
        }
        this.emit("stage:complete", {
          stage: "implement",
          durationMs: implDuration,
          status: "fail",
        });
        throw error;
      }

      const implDuration = Date.now() - implStart;
      const implTokenUsage = implResult?.tokenUsage || null;
      this.dag.recordStage("implement", "pass", implDuration, implTokenUsage);
      if (implTokenUsage) {
        this.dag.addTokenUsage(implTokenUsage.input, implTokenUsage.output);
      }
      await this.dag.save();
      this.emit("stage:complete", {
        stage: "implement",
        durationMs: implDuration,
        status: "pass",
      });
      await this.waitForStageGate("implement");

      if (this.aborted) break;

      const verifyStart = Date.now();
      this.emit("stage:start", { stage: "verify", model: null });

      let verifyResult;
      try {
        const verify = require("./verify");
        verifyResult = await verify.run({
          taskId: this.taskId,
          dag: this.dag,
          project: this.worktreeCwd || this.project,
          subtask,
          timeouts: STAGE_TIMEOUTS.verify,
          onLog: (line) =>
            this.emit("agent:output", { stage: "verify", chunk: line }),
        });
      } catch (verifyError) {
        const verifyDuration = Date.now() - verifyStart;
        this.dag.recordStage("verify", "fail", verifyDuration, null);
        try {
          await this.dag.save();
        } catch (saveErr) {
          this.emit("agent:output", {
            stage: "save",
            chunk: `[forge] failed to save DAG after verify error: ${saveErr.message}`,
          });
        }
        this.emit("stage:complete", {
          stage: "verify",
          durationMs: verifyDuration,
          status: "fail",
        });
        this.emit("agent:output", {
          stage: "verify",
          chunk: `[verify] crashed: ${verifyError.message}`,
        });

        // Treat as a failed verify — allow retry on next iteration
        iterationHistory.push({
          iteration,
          failureType: "verify_crash",
          feedback: verifyError.message?.slice(0, 1000) || null,
        });
        feedback = `verify crashed: ${verifyError.message}`;
        continue;
      }

      const verifyDuration = Date.now() - verifyStart;
      const verifyTokenUsage = verifyResult?.tokenUsage || null;
      const verifyStatus = verifyResult.passed ? "pass" : "fail";
      this.dag.recordStage(
        "verify",
        verifyStatus,
        verifyDuration,
        verifyTokenUsage,
      );
      if (verifyTokenUsage) {
        this.dag.addTokenUsage(verifyTokenUsage.input, verifyTokenUsage.output);
      }
      await this.dag.save();
      this.emit("stage:complete", {
        stage: "verify",
        durationMs: verifyDuration,
        status: verifyStatus,
      });
      await this.waitForStageGate("verify");

      this.emit("gate:result", {
        gate: "verify",
        result: verifyStatus,
        iteration,
      });

      // 각 iteration 결과를 artifact로 저장
      const subtaskSuffix = subtask ? `-${subtask.id}` : "";
      await saveArtifact(
        this.taskId,
        `verify-iter-${iteration}${subtaskSuffix}.json`,
        JSON.stringify(
          {
            iteration,
            passed: verifyResult.passed,
            feedback: verifyResult.feedback,
            report: verifyResult.report,
          },
          null,
          2,
        ),
      );

      if (this.aborted) break;

      if (verifyResult.passed) {
        // ux-review가 파이프라인에 있으면 verify 통과 후 실행
        const pipelineKey = this.dag.pipeline;
        const pipelineStages =
          FORGE_PIPELINES[pipelineKey] ||
          (typeof pipelineKey === "string" && pipelineKey.includes(",")
            ? pipelineKey.split(",").map((s) => s.trim())
            : []);
        if (pipelineStages.includes("ux-review")) {
          const uxResult = await this.runStage("ux-review", { subtask });
          await this.waitForStageGate("ux-review");
          if (uxResult && !uxResult.passed && !uxResult.skipped) {
            this.emit("gate:result", {
              gate: "ux-review",
              result: "fail",
              iteration,
            });
            iterationHistory.push({
              iteration,
              failureType: "ux-review",
              feedback: uxResult.feedback?.slice(0, 1000) || null,
            });
            feedback = uxResult.feedback;
            continue;
          }
        }
        return;
      }

      // Record iteration history for next attempt
      iterationHistory.push({
        iteration,
        failureType: verifyResult.feedback?.includes("테스트 실패")
          ? "test_failure"
          : "review_issues",
        feedback: verifyResult.feedback?.slice(0, 1000) || null,
      });
      feedback = verifyResult.feedback;
    }

    // 마지막 실패 원인 분류
    const lastReport = feedback || "";
    const hasTestFailures = lastReport.includes("테스트 실패");
    const hasCriticalIssues = lastReport.includes("critical");
    const severity = hasCriticalIssues
      ? "critical"
      : hasTestFailures
        ? "test_failures"
        : "review_issues";
    const msg = `verify loop exhausted after ${maxIterations} iterations (${severity}). Last feedback: ${lastReport.slice(0, 200)}`;
    this.dag.warnings.push(msg);
    try {
      await this.dag.save();
    } catch (saveErr) {
      this.emit("agent:output", {
        stage: "save",
        chunk: `[forge] failed to save DAG after verify exhaustion: ${saveErr.message}`,
      });
    }
    throw new Error(msg);
  }

  async learnToHivemind() {
    try {
      const store = require("../hivemind/store");
      const indexer = require("../hivemind/indexer");
      const { extractKeywordsFromText, processAndSave } = require("../hivemind/extract");

      store.ensureDirectories();
      indexer.loadFromDisk();

      const title = this.dag.title || this.taskId;
      const { loadArtifact } = require("../core/worktree");

      let summary = "";
      try {
        summary = await loadArtifact(this.taskId, "summary.md");
      } catch (e) {
        if (e.code !== "ENOENT")
          this.emit("agent:output", {
            stage: "hivemind",
            chunk: `[forge] loadArtifact error (summary.md): ${e.message}`,
          });
        this.emit("agent:output", {
          stage: "hivemind",
          chunk: "[forge] no summary artifact available for hivemind",
        });
      }

      if (!summary) return;

      const body = `## ${title}\n\n${summary}\n\npipeline: ${this.dag.pipeline}\nstages: ${this.dag.stageHistory.map((s) => `${s.stage}(${s.status})`).join(", ")}\ntokens: ${this.dag.tokenUsage.input + this.dag.tokenUsage.output}`;

      const zettelTitle = `forge: ${title}`;
      const keywordList = extractKeywordsFromText(zettelTitle, body);
      const keywords = {};
      for (const kw of keywordList) {
        keywords[kw] = 3;
      }

      const now = new Date().toISOString();
      const zettel = {
        id: store.generateUniqueId(),
        kind: "permanent",
        title: zettelTitle,
        body,
        keywords,
        links: [],
        createdAt: now,
        lastAccessed: now,
        boostCount: 0,
      };
      await processAndSave([zettel], {
        skipDedup: true,
        log: (msg) =>
          this.emit("agent:output", { stage: "hivemind", chunk: `[forge] ${msg}` }),
      });
    } catch (e) {
      this.dag.warnings.push(`hivemind learning failed: ${e.message}`);
    }
  }

  async waitForStageGate(stageName) {
    const autoApprove = this.stageApproval[stageName] !== false;
    if (autoApprove) return;

    this.emit("stage:gate", { stage: stageName, status: "waiting" });

    const GATE_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours
    return new Promise((resolve, reject) => {
      this._pendingGate = { resolve, reject, stage: stageName };
      this._pendingGateTimer = setTimeout(() => {
        if (this._pendingGate && this._pendingGate.stage === stageName) {
          this._pendingGate = null;
          reject(
            new Error(
              `stage gate timeout: ${stageName} was not approved within 24 hours`,
            ),
          );
        }
      }, GATE_TIMEOUT_MS);
    });
  }

  resolveGate(action, feedback) {
    if (!this._pendingGate) return false;
    const gate = this._pendingGate;
    this._pendingGate = null;
    if (this._pendingGateTimer) {
      clearTimeout(this._pendingGateTimer);
      this._pendingGateTimer = null;
    }

    if (action === "approve") {
      this.emit("stage:gate_resolved", {
        stage: gate.stage,
        action: "approve",
      });
      gate.resolve();
    } else {
      this.emit("stage:gate_resolved", { stage: gate.stage, action: "reject" });
      gate.reject(
        new Error(`stage ${gate.stage} rejected: ${feedback || "no feedback"}`),
      );
    }
    return true;
  }

  async abort() {
    this.aborted = true;
    this.emit("pipeline:abort", {});

    // Resolve any pending gate to unblock
    if (this._pendingGateTimer) {
      clearTimeout(this._pendingGateTimer);
      this._pendingGateTimer = null;
    }
    if (this._pendingGate) {
      const gate = this._pendingGate;
      this._pendingGate = null;
      gate.reject(new Error("pipeline aborted"));
    }

    // worktree 정리
    try {
      const workspace = await loadWorkspace(this.taskId);
      if (workspace) {
        await removeWorktrees(this.taskId, workspace.projects);
      }
    } catch (e) {
      this.emit("agent:output", {
        stage: "abort",
        chunk: `[forge] worktree cleanup on abort failed: ${e.message}`,
      });
    }

    // DAG 상태 업데이트
    if (this.dag) {
      this.dag.status = "aborted";
      try {
        await this.dag.save();
      } catch (e) {
        this.emit("agent:output", {
          stage: "abort",
          chunk: `[forge] failed to save DAG on abort: ${e.message}`,
        });
      }
    }
  }
}

function wireEvents(pipeline, onEvent) {
  const events = [
    "pipeline:start",
    "pipeline:complete",
    "pipeline:error",
    "pipeline:abort",
    "stage:start",
    "stage:complete",
    "agent:output",
    "gate:result",
    "gate:iteration",
    "subtask:start",
    "subtask:complete",
    "stage:gate",
    "stage:gate_resolved",
    "warning:budget",
    "notice:budget",
  ];
  for (const event of events) {
    pipeline.on(event, (d) => onEvent(event, d));
  }
}

async function forge(input, options = {}) {
  const pipeline = new ForgePipeline({
    input,
    project: options.project,
    pipeline: options.pipeline,
    autoApprove: options.autoApprove,
    onQuestion: options.onQuestion,
    tokenBudget: options.tokenBudget,
  });

  if (options.onEvent) {
    wireEvents(pipeline, options.onEvent);
  }

  return pipeline.run();
}

async function resolveResumeProject(taskId, projectOption) {
  if (typeof projectOption === "string" && projectOption.trim()) {
    return path.resolve(projectOption);
  }

  const workspace = await loadWorkspace(taskId);
  const projects = Array.isArray(workspace?.projects) ? workspace.projects : [];
  if (projects.length > 0) {
    const primary =
      projects.find((project) => project?.role === "primary") || projects[0];
    const candidate = primary?.origin || primary?.path;
    if (typeof candidate === "string" && candidate.trim()) {
      return path.resolve(candidate);
    }
  }

  throw new Error("resume requires --project option or workspace metadata");
}

async function resume(taskId, options = {}) {
  const project = await resolveResumeProject(taskId, options.project);
  const dag = await TaskDag.load(taskId);
  assertResumableDagStatus(dag);

  const pipeline = new ForgePipeline({
    taskId,
    project,
    pipeline: dag.pipeline,
    autoApprove: options.autoApprove,
    onQuestion: options.onQuestion,
    tokenBudget: options.tokenBudget,
    resumeFrom: options.fromStage || lastFailedStage(dag) || "implement",
  });

  if (options.onEvent) {
    wireEvents(pipeline, options.onEvent);
  }

  return pipeline.run();
}

function lastFailedStage(dag) {
  for (let i = dag.stageHistory.length - 1; i >= 0; i--) {
    if (dag.stageHistory[i].status === "fail") {
      return dag.stageHistory[i].stage;
    }
  }
  return null;
}

function assertResumableDagStatus(dag) {
  if (!dag || typeof dag.status !== "string") {
    throw new Error("invalid task state for resume");
  }
  if (!RESUMABLE_DAG_STATUSES.has(dag.status)) {
    throw new Error(`cannot resume task in status: ${dag.status}`);
  }
}

module.exports = {
  ForgePipeline,
  forge,
  resume,
  wireEvents,
  assertResumableDagStatus,
  resolveResumeProject,
};
