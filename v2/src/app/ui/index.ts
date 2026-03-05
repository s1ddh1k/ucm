import { Electroview } from "electrobun/view";
import type { AppRPC } from "../rpc.ts";
import type { Task, LoopEvent } from "../../types.ts";
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
        addLog(`[task] ${task.goal}`);
      },
      phase2Event: ({ event }) => {
        addLog(`[phase2] ${event.type}`, "event");
      },
      requestUserInput: ({ prompt }) => {
        showUserInput(prompt);
      },
      requestTaskApproval: ({ task }) => {
        showTaskApproval(task);
      },
      requestMergeApproval: () => {
        showMergeApproval();
      },
      controllerDone: ({ status, task }) => {
        updateStatus(status);
        addLog(`[done] ${status}${task ? `: ${task.goal}` : ""}`, status === "done" ? "event" : "error");
      },
    },
  },
});

const ev = new Electroview({ rpc });

// --- UI 헬퍼 ---

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
  div.className = "entry " + cls;
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function showUserInput(prompt: string) {
  addLog(prompt);
  const container = $("approval");
  container.innerHTML = `
    <p>Respond to the agent:</p>
    <textarea id="user-input-text" rows="3" style="width:100%;background:#1a1a1a;border:1px solid #333;border-radius:4px;color:#e0e0e0;padding:8px;font-size:14px;resize:vertical;"></textarea>
    <button id="user-input-submit">Send</button>
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
  addLog(`\n--- Task Proposed ---\nGoal: ${task.goal}\nContext: ${task.context}\nAcceptance: ${task.acceptance}\n`);
  const container = $("approval");
  container.innerHTML = `
    <p>Approve this task?</p>
    <button id="approve-task-yes">Approve</button>
    <button id="approve-task-no">Reject</button>
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
  addLog("\n--- Merge Ready ---");
  const container = $("approval");
  container.innerHTML = `
    <p>Merge to main branch?</p>
    <button id="approve-merge-yes">Merge</button>
    <button id="approve-merge-no">Cancel</button>
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

// --- 시작 폼 ---
$("start-btn").addEventListener("click", async () => {
  const projectPath = ($("project-path") as HTMLInputElement).value.trim();
  if (!projectPath) return;
  const provider = ($("provider") as HTMLSelectElement).value as "claude" | "codex";
  const model = ($("model") as HTMLInputElement).value.trim() || undefined;
  const maxIterations = parseInt(($("max-iterations") as HTMLInputElement).value, 10) || 10;
  const autoApprove = ($("auto-approve") as HTMLInputElement).checked;

  $("config-form").style.display = "none";
  addLog(`Starting: ${projectPath} (${provider})`, "event");

  await ev.rpc.request.startController({
    projectPath,
    provider,
    model,
    maxIterations,
    autoApprove,
  });
});
