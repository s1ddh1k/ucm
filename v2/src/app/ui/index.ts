import { Electroview } from "electrobun/view";
import type { AppRPC } from "../rpc.ts";
import type { AdaptivePlan, LoopEvent, ReviewIssue, ReviewPack, Task } from "../../types.ts";
import type { ControllerStatus } from "../../controller.ts";

const rpc = Electroview.defineRPC<AppRPC>({
  handlers: {
    requests: {},
    messages: {
      statusChange: ({ status }) => {
        updateStatus(status);
      },
      phase1Message: ({ text }) => {
        addLog(text);
      },
      taskProposed: ({ task }) => {
        renderTask(task);
        addLog(`[task] ${task.goal}`);
      },
      planReady: ({ plan }) => {
        renderPlan(plan);
        addLog(`[plan] ${plan.summary}`, "event");
      },
      phase2Event: ({ event }) => {
        addLog(formatEvent(event), event.type === "error" ? "error" : "event");
        if (event.type === "review_blocked") {
          renderBlockingIssues(event.issues, event.summary);
        }
      },
      requestUserInput: ({ prompt }) => {
        showUserInput(prompt);
      },
      requestTaskApproval: ({ task }) => {
        renderTask(task);
        showTaskApproval(task);
      },
      reviewReady: ({ review }) => {
        renderReview(review);
        addLog(`[review] ${review.changedFiles.length} files, ${review.commits.length} commits`, "event");
      },
      requestMergeApproval: () => {
        showMergeApproval();
      },
      controllerDone: ({ status, task, plan, review }) => {
        updateStatus(status);
        if (task) renderTask(task);
        if (plan) renderPlan(plan);
        if (review) renderReview(review);
        addLog(`[done] ${status}${task ? `: ${task.goal}` : ""}`, status === "done" ? "event" : "error");
      },
    },
  },
});

const ev = new Electroview({ rpc });
let currentReview: ReviewPack | null = null;
let selectedReviewFile: string | null = null;

function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}

function updateStatus(status: ControllerStatus) {
  const el = $("status");
  el.textContent = status;
  el.className = "status" +
    (["phase1", "phase2", "merging"].includes(status) ? " active" : "") +
    (status === "done" ? " done" : "") +
    (["failed", "cancelled"].includes(status) ? " failed" : "");
}

function addLog(text: string, cls = "") {
  const log = $("log");
  const div = document.createElement("div");
  div.className = `entry ${cls}`.trim();
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function formatEvent(event: LoopEvent): string {
  switch (event.type) {
    case "implement_start":
      return `[iteration ${event.iteration}] implementation started`;
    case "implement_done":
      return `[iteration ${event.iteration}] implementation finished`;
    case "verify_start":
      return `[iteration ${event.iteration}] verify started`;
    case "verify_done":
      return event.result.passed ? `[verify] passed` : `[verify] failed: ${event.result.reason}`;
    case "tool_start":
      return `[tool:${event.stage}] ${event.tool} started`;
    case "tool_done":
      return `[tool:${event.result.stage}] ${event.result.tool}: ${event.result.summary}`;
    case "review_blocked":
      return `[review] blocked on iteration ${event.iteration}: ${event.summary}`;
    case "test_start":
      return `[test] running command gate`;
    case "test_done":
      return event.passed ? `[test] passed` : `[test] failed: ${event.output}`;
    case "passed":
      return `[review] review pack ready`;
    case "max_iterations":
      return `[loop] max iterations reached`;
    case "error":
      return `[error] ${event.message}`;
  }
}

function renderList(containerId: string, items: string[], emptyText: string) {
  const container = $(containerId);
  if (items.length === 0) {
    container.innerHTML = `<div class="empty">${emptyText}</div>`;
    return;
  }
  container.innerHTML = items.map((item) => `<div class="pill">${escapeHtml(item)}</div>`).join("");
}

function renderIssueList(containerId: string, issues: ReviewIssue[], emptyText: string) {
  const container = $(containerId);
  if (issues.length === 0) {
    container.innerHTML = `<div class="empty">${emptyText}</div>`;
    return;
  }
  container.innerHTML = issues.map((issue) => `
    <div class="issue-card ${issue.severity}">
      <div class="issue-head">
        <span>${escapeHtml(issue.severity)}</span>
        <span>${escapeHtml(issue.source ?? "review")}</span>
      </div>
      <div class="issue-summary">${escapeHtml(issue.summary)}</div>
      ${issue.where ? `<div class="issue-meta">Where: ${escapeHtml(issue.where)}</div>` : ""}
      ${issue.fix ? `<div class="issue-meta">Fix: ${escapeHtml(issue.fix)}</div>` : ""}
    </div>
  `).join("");
}

function renderTask(task: Task) {
  $("task-goal").textContent = task.goal;
  $("task-context").textContent = task.context;
  $("task-acceptance").textContent = task.acceptance;
  $("task-constraints").textContent = task.constraints?.trim() || "none";
}

function renderPlan(plan: AdaptivePlan) {
  $("plan-summary").textContent = plan.summary;
  const container = $("plan-tools");
  if (plan.tools.length === 0) {
    container.innerHTML = '<div class="empty">No extra adaptive tools selected.</div>';
    return;
  }
  container.innerHTML = plan.tools.map((tool) => `
    <div class="tool-card">
      <div class="tool-name">${escapeHtml(tool.tool)}</div>
      <div class="tool-stage">${escapeHtml(tool.stage)}</div>
      <div class="tool-rationale">${escapeHtml(tool.rationale)}</div>
    </div>
  `).join("");
}

function renderReview(review: ReviewPack) {
  currentReview = review;
  selectedReviewFile = selectedReviewFile && review.files.some((file) => file.path === selectedReviewFile)
    ? selectedReviewFile
    : review.files[0]?.path ?? null;

  $("review-branch").textContent = `${review.baseBranch} -> ${review.branchName}`;
  $("review-reason").textContent = review.finalReason;
  $("review-iterations").textContent = String(review.iterations);
  $("review-diffstat").textContent = review.diffStat || "No diff stat available.";
  $("review-diff").textContent = review.diff || "No diff captured.";
  $("review-tests").textContent = review.testOutput || "Not run";
  $("review-blocked-summary").textContent = "No unresolved review blockers.";

  renderList("review-files-summary", review.changedFiles, "No changed files captured.");
  renderList("review-commits", review.commits, "No commits captured.");
  renderIssueList("review-issues", review.reviewIssues, "No review issues in the final round.");

  const toolContainer = $("review-tools");
  if (review.toolResults.length === 0) {
    toolContainer.innerHTML = '<div class="empty">No adaptive tool output recorded.</div>';
  } else {
    toolContainer.innerHTML = review.toolResults.map((result) => `
      <div class="review-tool ${result.status} ${result.blocking ? "blocking" : ""}">
        <div class="review-tool-head">
          <span>${escapeHtml(result.tool)} · round ${result.iteration}</span>
          <span>${escapeHtml(result.stage)}</span>
        </div>
        <div class="review-tool-summary">${escapeHtml(result.summary)}</div>
      </div>
    `).join("");
  }

  renderReviewFiles(review);
}

function renderReviewFiles(review: ReviewPack) {
  const container = $("review-file-list");
  if (review.files.length === 0) {
    container.innerHTML = '<div class="empty">No file patches captured.</div>';
    $("review-file-meta").textContent = "-";
    $("review-file-patch").textContent = "No file patch selected.";
    return;
  }

  container.innerHTML = review.files.map((file) => `
    <button class="file-tab ${file.path === selectedReviewFile ? "selected" : ""}" data-path="${encodeURIComponent(file.path)}">
      <span>${escapeHtml(file.path)}</span>
      <span>+${file.additions} / -${file.deletions}</span>
    </button>
  `).join("");

  for (const button of container.querySelectorAll<HTMLButtonElement>(".file-tab")) {
    button.onclick = () => {
      selectedReviewFile = button.dataset.path ? decodeURIComponent(button.dataset.path) : null;
      if (currentReview) renderReviewFiles(currentReview);
    };
  }

  const selected = review.files.find((file) => file.path === selectedReviewFile) ?? review.files[0];
  $("review-file-meta").textContent = `${selected.path} (+${selected.additions} / -${selected.deletions})`;
  $("review-file-patch").textContent = selected.patch || "No patch text captured for this file.";
}

function renderBlockingIssues(issues: ReviewIssue[], summary: string) {
  $("review-blocked-summary").textContent = summary;
  renderIssueList("review-issues", issues, "No current blockers.");
}

function showUserInput(prompt: string) {
  addLog(prompt);
  const container = $("approval");
  container.innerHTML = `
    <p>Respond to the agent</p>
    <textarea id="user-input-text" rows="3"></textarea>
    <div class="approval-actions">
      <button id="user-input-submit">Send</button>
    </div>
  `;
  container.style.display = "block";
  const textarea = document.getElementById("user-input-text") as HTMLTextAreaElement;
  textarea.focus();
  document.getElementById("user-input-submit")!.onclick = () => {
    const text = textarea.value.trim();
    if (!text) return;
    ev.rpc.request.submitUserInput({ text });
    container.style.display = "none";
    addLog(`> ${text}`, "event");
  };
}

function showTaskApproval(task: Task) {
  addLog(`Approve task: ${task.goal}`);
  const container = $("approval");
  container.innerHTML = `
    <p>Approve this goal contract?</p>
    <div class="approval-actions">
      <button id="approve-task-yes">Approve</button>
      <button class="secondary" id="approve-task-no">Reject</button>
    </div>
  `;
  container.style.display = "block";
  document.getElementById("approve-task-yes")!.onclick = () => {
    ev.rpc.request.approveTask({ approved: true });
    container.style.display = "none";
  };
  document.getElementById("approve-task-no")!.onclick = () => {
    ev.rpc.request.approveTask({ approved: false });
    container.style.display = "none";
  };
}

function showMergeApproval() {
  addLog("Merge approval requested");
  const container = $("approval");
  container.innerHTML = `
    <p>Review pack is ready. Merge to the base branch?</p>
    <div class="approval-actions">
      <button id="approve-merge-yes">Merge</button>
      <button class="secondary" id="approve-merge-no">Cancel</button>
    </div>
  `;
  container.style.display = "block";
  document.getElementById("approve-merge-yes")!.onclick = () => {
    ev.rpc.request.approveMerge({ approved: true });
    container.style.display = "none";
  };
  document.getElementById("approve-merge-no")!.onclick = () => {
    ev.rpc.request.approveMerge({ approved: false });
    container.style.display = "none";
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

$("start-btn").addEventListener("click", async () => {
  const projectPath = ($("project-path") as HTMLInputElement).value.trim();
  if (!projectPath) return;
  const provider = ($("provider") as HTMLSelectElement).value as "claude" | "codex";
  const model = ($("model") as HTMLInputElement).value.trim() || undefined;
  const maxIterations = parseInt(($("max-iterations") as HTMLInputElement).value, 10) || 10;
  const autoApprove = ($("auto-approve") as HTMLInputElement).checked;
  const resume = ($("resume-run") as HTMLInputElement).checked;

  $("config-form").style.display = "none";
  addLog(`Starting ${projectPath} with ${provider}`, "event");
  $("plan-summary").textContent = "Waiting for goal contract...";
  $("plan-tools").innerHTML = '<div class="empty">No adaptive plan yet.</div>';
  $("review-diff").textContent = "Review pack will appear after verify passes.";
  $("review-diffstat").textContent = "";
  $("review-tests").textContent = "";
  $("review-iterations").textContent = "-";
  $("review-branch").textContent = "-";
  $("review-reason").textContent = "-";
  $("review-files-summary").innerHTML = '<div class="empty">No changed files yet.</div>';
  $("review-commits").innerHTML = '<div class="empty">No commits yet.</div>';
  $("review-tools").innerHTML = '<div class="empty">No adaptive tool output yet.</div>';
  $("review-issues").innerHTML = '<div class="empty">No review issues yet.</div>';
  $("review-file-list").innerHTML = '<div class="empty">No file patches yet.</div>';
  $("review-file-meta").textContent = "-";
  $("review-file-patch").textContent = "No file patch selected.";
  $("review-blocked-summary").textContent = "No unresolved review blockers.";
  currentReview = null;
  selectedReviewFile = null;

  await ev.rpc.request.startController({
    projectPath,
    provider,
    model,
    maxIterations,
    autoApprove,
    resume,
  });
});
