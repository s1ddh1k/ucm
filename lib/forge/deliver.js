const { llmText } = require("../core/llm");
const { saveArtifact, loadArtifact, loadWorkspace, getWorktreeDiff, mergeWorktrees } = require("../core/worktree");
const { STAGE_MODELS } = require("../core/constants");

let _mergeQueueManager = null;

function setMergeQueueManager(manager) {
  _mergeQueueManager = manager;
}

async function run({ taskId, dag, project, autopilot, timeouts, onLog = () => {} } = {}) {
  onLog("[deliver] generating diff summary...");

  let diffSummary = "";
  try {
    const workspace = await loadWorkspace(taskId);
    if (workspace) {
      const diffs = await getWorktreeDiff(taskId, workspace.projects);
      diffSummary = diffs.map((d) => `### ${d.project}\n\n\`\`\`diff\n${d.diff.slice(0, 3000)}\n\`\`\``).join("\n\n");
    }
  } catch (e) {
    onLog(`[deliver] worktree diff failed: ${e.message}`);
  }

  if (!diffSummary) {
    try {
      diffSummary = await loadArtifact(taskId, "design.md");
      onLog("[deliver] using fallback: design.md for summary (no diff available)");
    } catch (e) {
      if (e.code !== "ENOENT") onLog(`[deliver] loadArtifact error (design.md): ${e.message}`);
      try {
        diffSummary = await loadArtifact(taskId, "spec.md");
        onLog("[deliver] using fallback: spec.md for summary (no diff or design available)");
      } catch (e2) {
        if (e2.code !== "ENOENT") onLog(`[deliver] loadArtifact error (spec.md): ${e2.message}`);
        onLog("[deliver] warning: no diff, design, or spec artifact available for summary");
        diffSummary = "";
      }
    }
  }

  let summary = "";
  let tokenUsage = { input: 0, output: 0 };
  if (diffSummary) {
    const result = await llmText(
      `아래 변경사항을 간결하게 요약하세요 (3-5줄). 마크다운 형식.\n\n${diffSummary.slice(0, 5000)}`,
      { model: STAGE_MODELS.deliver, allowTools: "" },
    );
    summary = result.text;
    tokenUsage = result.tokenUsage;
  } else {
    summary = "(no changes to summarize)";
  }

  await saveArtifact(taskId, "summary.md", summary);

  if (autopilot && dag.warnings.length === 0) {
    // autopilot + 경고 없음: 자동 머지
    const mqManager = _mergeQueueManager;
    const mqEnabled = mqManager && mqManager.isEnabled();

    if (mqEnabled && mqManager.isBusy(project)) {
      // merge queue busy → enqueue to serialize merges
      try {
        mqManager.enqueue(taskId, project, 0);
        onLog("[deliver] enqueued to merge queue");
        dag.status = "merge_queued";
      } catch (error) {
        onLog(`[deliver] merge queue enqueue failed: ${error.message}`);
        dag.warnings.push(`merge queue enqueue failed: ${error.message}`);
        dag.status = "review";
      }
    } else {
      // 직접 머지 (큐 비어있거나 비활성)
      try {
        const workspace = await loadWorkspace(taskId);
        if (workspace) {
          await mergeWorktrees(taskId, workspace.projects, {
            log: (msg) => onLog(`[deliver] ${msg}`),
          });
          onLog("[deliver] auto-merged");
        }
        dag.status = "auto_merged";
      } catch (error) {
        onLog(`[deliver] auto-merge failed: ${error.message}`);
        dag.warnings.push(`auto-merge failed: ${error.message}`);

        // merge queue enabled이면 enqueue 시도
        if (mqEnabled) {
          try {
            mqManager.enqueue(taskId, project, 0);
            onLog("[deliver] auto-merge failed, enqueued to merge queue for retry");
            dag.status = "merge_queued";
          } catch (enqueueError) {
            onLog(`[deliver] merge queue enqueue also failed: ${enqueueError.message}`);
            dag.status = "review";
          }
        } else {
          dag.status = "review";
        }
      }
    }
  } else {
    dag.status = "review";
  }

  await dag.save();

  onLog(`[deliver] status=${dag.status}, warnings=${dag.warnings.length}`);

  return {
    status: dag.status,
    summary,
    warnings: dag.warnings,
    tokenUsage,
  };
}

async function approve(taskId) {
  const { TaskDag } = require("../core/task");
  const dag = await TaskDag.load(taskId);

  if (dag.status !== "review") {
    throw new Error(`cannot approve task in status: ${dag.status}`);
  }

  try {
    const workspace = await loadWorkspace(taskId);
    if (workspace) {
      await mergeWorktrees(taskId, workspace.projects, {
        log: (msg) => console.error(`[deliver] ${msg}`),
      });
    }
  } catch (error) {
    throw new Error(`merge failed: ${error.message}`);
  }

  dag.status = "done";
  await dag.save();

  return { status: "done" };
}

async function reject(taskId, feedback) {
  const { TaskDag } = require("../core/task");
  const dag = await TaskDag.load(taskId);

  if (dag.status !== "review") {
    throw new Error(`cannot reject task in status: ${dag.status}`);
  }

  await saveArtifact(taskId, "rejection-feedback.md", feedback || "");

  dag.status = "rejected";
  dag.warnings.push(`rejected: ${feedback?.slice(0, 100) || "no feedback"}`);
  await dag.save();

  return { status: "rejected", feedback };
}

module.exports = { run, approve, reject, setMergeQueueManager };
