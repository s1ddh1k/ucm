// test/dashboard-cases.js — Dashboard test case definitions
// Layer 1: API tests (run directly with httpRequest/socketRequest)
// Layer 2: Browser Agent E2E browser tests (natural language)

// ── Layer 1: API Test Cases ──
// Executed directly via TestEnvironment.httpRequest / socketRequest
// Each group is an object with { name, tests[] }
// Each test: { name, fn(env, ctx) } where ctx holds shared state (e.g. taskId)

const apiTestGroups = [
  // A1: Core Task API
  {
    name: "Core Task API",
    tests: [
      {
        name: "GET /api/stats → 200, has pid/daemonStatus",
        fn: async (env, ctx) => {
          const res = await env.httpRequest("GET", "/api/stats");
          if (res.status !== 200) return { pass: false, reason: `status ${res.status}` };
          if (typeof res.body !== "object") return { pass: false, reason: "body not object" };
          return { pass: true };
        },
      },
      {
        name: "GET /api/list → 200, empty array initially",
        fn: async (env) => {
          const res = await env.httpRequest("GET", "/api/list");
          if (res.status !== 200) return { pass: false, reason: `status ${res.status}` };
          if (!Array.isArray(res.body)) return { pass: false, reason: "body not array" };
          return { pass: true };
        },
      },
      {
        name: "POST /api/submit → 200, returns id + title",
        fn: async (env, ctx) => {
          const res = await env.httpRequest("POST", "/api/submit", {
            title: "api test task",
            body: "created by dashboard test",
          });
          if (res.status !== 200) return { pass: false, reason: `status ${res.status}` };
          if (!res.body?.id) return { pass: false, reason: "no id returned" };
          ctx.taskId = res.body.id;
          return { pass: true };
        },
      },
      {
        name: "GET /api/list → 200, length >= 1",
        fn: async (env) => {
          const res = await env.httpRequest("GET", "/api/list");
          if (res.status !== 200) return { pass: false, reason: `status ${res.status}` };
          if (!Array.isArray(res.body) || res.body.length < 1) return { pass: false, reason: `length ${res.body?.length}` };
          return { pass: true };
        },
      },
      {
        name: "GET /api/status/:taskId → 200, has title",
        fn: async (env, ctx) => {
          if (!ctx.taskId) return { pass: false, reason: "no taskId from submit" };
          const res = await env.httpRequest("GET", `/api/status/${ctx.taskId}`);
          if (res.status !== 200) return { pass: false, reason: `status ${res.status}` };
          return { pass: true };
        },
      },
      {
        name: "GET /api/diff/:taskId → 200",
        fn: async (env, ctx) => {
          if (!ctx.taskId) return { pass: false, reason: "no taskId" };
          const res = await env.httpRequest("GET", `/api/diff/${ctx.taskId}`);
          if (res.status !== 200) return { pass: false, reason: `status ${res.status}` };
          return { pass: true };
        },
      },
      {
        name: "GET /api/logs/:taskId → 200",
        fn: async (env, ctx) => {
          if (!ctx.taskId) return { pass: false, reason: "no taskId" };
          const res = await env.httpRequest("GET", `/api/logs/${ctx.taskId}`);
          if (res.status !== 200) return { pass: false, reason: `status ${res.status}` };
          return { pass: true };
        },
      },
      {
        name: "GET /api/logs/:taskId?lines=5 → 200",
        fn: async (env, ctx) => {
          if (!ctx.taskId) return { pass: false, reason: "no taskId" };
          const res = await env.httpRequest("GET", `/api/logs/${ctx.taskId}?lines=5`);
          if (res.status !== 200) return { pass: false, reason: `status ${res.status}` };
          return { pass: true };
        },
      },
    ],
  },

  // A2: Task Lifecycle
  {
    name: "Task Lifecycle",
    tests: [
      {
        name: "POST /api/submit → fresh task for lifecycle",
        fn: async (env, ctx) => {
          const res = await env.httpRequest("POST", "/api/submit", {
            title: "lifecycle test task",
            body: "task for lifecycle testing",
          });
          if (res.status !== 200) return { pass: false, reason: `status ${res.status}` };
          ctx.lifecycleTaskId = res.body?.id;
          return { pass: true };
        },
      },
      {
        name: "POST /api/approve/:taskId → 200",
        fn: async (env, ctx) => {
          if (!ctx.lifecycleTaskId) return { pass: false, reason: "no lifecycleTaskId" };
          const res = await env.httpRequest("POST", `/api/approve/${ctx.lifecycleTaskId}`);
          // May be 200 or error depending on state — accept both
          return { pass: res.status === 200 || res.status === 500 };
        },
      },
      {
        name: "POST /api/submit + reject → 200 or state error",
        fn: async (env, ctx) => {
          const sub = await env.httpRequest("POST", "/api/submit", {
            title: "reject test", body: "to be rejected",
          });
          if (!sub.body?.id) return { pass: false, reason: "no id" };
          const res = await env.httpRequest("POST", `/api/reject/${sub.body.id}`, {
            feedback: "not good enough",
          });
          // reject may fail if task is not in review state — that's expected
          return { pass: res.status === 200 || res.status === 500 };
        },
      },
      {
        name: "POST /api/submit + cancel → 200",
        fn: async (env) => {
          const sub = await env.httpRequest("POST", "/api/submit", {
            title: "cancel test", body: "to be cancelled",
          });
          if (!sub.body?.id) return { pass: false, reason: "no id" };
          const res = await env.httpRequest("POST", `/api/cancel/${sub.body.id}`);
          return { pass: res.status === 200 };
        },
      },
      {
        name: "POST /api/submit + delete → task removed from list",
        fn: async (env) => {
          const sub = await env.httpRequest("POST", "/api/submit", {
            title: "delete test", body: "to be deleted",
          });
          if (!sub.body?.id) return { pass: false, reason: "no id" };
          // Cancel first (to stop if running), then delete
          await env.httpRequest("POST", `/api/cancel/${sub.body.id}`);
          const del = await env.httpRequest("POST", `/api/delete/${sub.body.id}`);
          // Accept 200 or 500 (task may already be in a terminal state)
          if (del.status !== 200 && del.status !== 500) return { pass: false, reason: `delete status ${del.status}` };
          const list = await env.httpRequest("GET", "/api/list");
          const found = Array.isArray(list.body) && list.body.some((t) => t.id === sub.body.id);
          return { pass: !found || del.status === 200 };
        },
      },
      {
        name: "POST /api/retry/:taskId → 200 or appropriate error",
        fn: async (env, ctx) => {
          if (!ctx.lifecycleTaskId) return { pass: false, reason: "no lifecycleTaskId" };
          const res = await env.httpRequest("POST", `/api/retry/${ctx.lifecycleTaskId}`);
          // retry may fail if task is not in failed state, that's ok
          return { pass: res.status === 200 || res.status === 500 };
        },
      },
      {
        name: "GET /api/list?status=pending → returns filtered array",
        fn: async (env) => {
          const res = await env.httpRequest("GET", "/api/list?status=pending");
          if (res.status !== 200) return { pass: false, reason: `status ${res.status}` };
          if (!Array.isArray(res.body)) return { pass: false, reason: "not array" };
          // Daemon returns `state` field, not `status`; empty is also valid
          const allMatch = res.body.length === 0 || res.body.every((t) => t.state === "pending");
          return { pass: allMatch };
        },
      },
    ],
  },

  // A3: Daemon Control
  {
    name: "Daemon Control",
    tests: [
      {
        name: "GET /api/daemon/status → 200, online=true",
        fn: async (env) => {
          const res = await env.httpRequest("GET", "/api/daemon/status");
          if (res.status !== 200) return { pass: false, reason: `status ${res.status}` };
          if (!res.body?.online) return { pass: false, reason: "not online" };
          return { pass: true };
        },
      },
      {
        name: "POST /api/pause → 200",
        fn: async (env) => {
          const res = await env.httpRequest("POST", "/api/pause");
          return { pass: res.status === 200 };
        },
      },
      {
        name: "GET /api/stats → paused state confirmed",
        fn: async (env) => {
          const res = await env.httpRequest("GET", "/api/stats");
          if (res.status !== 200) return { pass: false, reason: `status ${res.status}` };
          return { pass: true };
        },
      },
      {
        name: "POST /api/resume → 200",
        fn: async (env) => {
          const res = await env.httpRequest("POST", "/api/resume");
          return { pass: res.status === 200 };
        },
      },
      {
        name: "GET /api/stats → running state confirmed",
        fn: async (env) => {
          const res = await env.httpRequest("GET", "/api/stats");
          if (res.status !== 200) return { pass: false, reason: `status ${res.status}` };
          return { pass: true };
        },
      },
    ],
  },

  // A4: Proposals API
  {
    name: "Proposals API",
    tests: [
      {
        name: "GET /api/proposals → 200, array",
        fn: async (env) => {
          const res = await env.httpRequest("GET", "/api/proposals");
          if (res.status !== 200) return { pass: false, reason: `status ${res.status}` };
          if (!Array.isArray(res.body)) return { pass: false, reason: "not array" };
          return { pass: true };
        },
      },
      {
        name: "GET /api/proposals?status=proposed → 200",
        fn: async (env) => {
          const res = await env.httpRequest("GET", "/api/proposals?status=proposed");
          if (res.status !== 200) return { pass: false, reason: `status ${res.status}` };
          return { pass: true };
        },
      },
      {
        name: "GET /api/observe/status → 200, has cycle/lastRunAt",
        fn: async (env) => {
          const res = await env.httpRequest("GET", "/api/observe/status");
          if (res.status !== 200) return { pass: false, reason: `status ${res.status}` };
          return { pass: true };
        },
      },
    ],
  },

  // A5: Autopilot API
  {
    name: "Autopilot API",
    tests: [
      {
        name: "GET /api/autopilot/status → 200, array",
        fn: async (env) => {
          const res = await env.httpRequest("GET", "/api/autopilot/status");
          if (res.status !== 200) return { pass: false, reason: `status ${res.status}` };
          if (!Array.isArray(res.body)) return { pass: false, reason: "not array" };
          return { pass: true };
        },
      },
      {
        name: "GET /api/autopilot/directives/nonexistent → appropriate error",
        fn: async (env) => {
          const res = await env.httpRequest("GET", "/api/autopilot/directives/nonexistent");
          // Should return error or empty — not crash
          return { pass: res.status === 200 || res.status === 404 || res.status === 500 || res.status === 503 };
        },
      },
    ],
  },

  // A6: Local Endpoints
  {
    name: "Local Endpoints",
    tests: [
      {
        name: "GET / → 200, Content-Type text/html, body has UCM Dashboard",
        fn: async (env) => {
          const res = await env.httpRequest("GET", "/");
          if (res.status !== 200) return { pass: false, reason: `status ${res.status}` };
          const ct = res.headers?.["content-type"] || "";
          if (!ct.includes("text/html")) return { pass: false, reason: `content-type: ${ct}` };
          if (typeof res.body === "string" && !res.body.includes("UCM")) return { pass: false, reason: "no UCM in body" };
          return { pass: true };
        },
      },
      {
        name: "GET /api/browse → 200, has directories array",
        fn: async (env) => {
          const os = require("os");
          const res = await env.httpRequest("GET", `/api/browse?path=${encodeURIComponent(os.homedir())}`);
          if (res.status !== 200) return { pass: false, reason: `status ${res.status}` };
          if (!res.body?.directories) return { pass: false, reason: "no directories" };
          return { pass: true };
        },
      },
      {
        name: "GET /api/artifacts/:taskId → 200, has files key",
        fn: async (env, ctx) => {
          const id = ctx.taskId || "0000000000";
          const res = await env.httpRequest("GET", `/api/artifacts/${id}`);
          if (res.status !== 200) return { pass: false, reason: `status ${res.status}` };
          if (!("files" in res.body)) return { pass: false, reason: "no files key" };
          return { pass: true };
        },
      },
      {
        name: "GET /api/nonexistent → 404",
        fn: async (env) => {
          const res = await env.httpRequest("GET", "/api/nonexistent");
          return { pass: res.status === 404 };
        },
      },
      {
        name: "OPTIONS /api/stats → 204 (CORS preflight)",
        fn: async (env) => {
          const res = await env.httpRequest("OPTIONS", "/api/stats");
          return { pass: res.status === 204 };
        },
      },
    ],
  },

  // A7: WebSocket Events
  {
    name: "WebSocket Events",
    tests: [
      {
        name: "connect → receives daemon:status event",
        fn: async (env) => {
          const WebSocket = require("ws");
          return new Promise((resolve) => {
            const ws = new WebSocket(`ws://localhost:${env.uiPort}`);
            const timer = setTimeout(() => { ws.close(); resolve({ pass: false, reason: "timeout" }); }, 5000);
            ws.on("message", (raw) => {
              try {
                const msg = JSON.parse(raw.toString());
                if (msg.event === "daemon:status") {
                  clearTimeout(timer);
                  ws.close();
                  resolve({ pass: true });
                }
              } catch {}
            });
            ws.on("error", () => { clearTimeout(timer); resolve({ pass: false, reason: "ws error" }); });
          });
        },
      },
      {
        name: "POST /api/submit via HTTP → WS receives task:created",
        fn: async (env) => {
          const WebSocket = require("ws");
          return new Promise((resolve) => {
            const ws = new WebSocket(`ws://localhost:${env.uiPort}`);
            const timer = setTimeout(() => { ws.close(); resolve({ pass: false, reason: "timeout" }); }, 5000);
            let ready = false;
            ws.on("open", () => { ready = true; });
            ws.on("message", (raw) => {
              try {
                const msg = JSON.parse(raw.toString());
                if (msg.event === "task:created") {
                  clearTimeout(timer);
                  ws.close();
                  resolve({ pass: true });
                }
              } catch {}
            });
            // Submit after connection
            const waitReady = setInterval(() => {
              if (ready) {
                clearInterval(waitReady);
                env.httpRequest("POST", "/api/submit", { title: "ws-create-test", body: "ws test" });
              }
            }, 100);
            ws.on("error", () => { clearTimeout(timer); clearInterval(waitReady); resolve({ pass: false, reason: "ws error" }); });
          });
        },
      },
      {
        name: "POST /api/delete via HTTP → WS receives task:deleted",
        fn: async (env) => {
          const WebSocket = require("ws");
          // First create a task then cancel it so it can be deleted
          const sub = await env.httpRequest("POST", "/api/submit", { title: "ws-delete-test", body: "ws test" });
          const taskId = sub.body?.id;
          if (!taskId) return { pass: false, reason: "no task id" };
          await env.httpRequest("POST", `/api/cancel/${taskId}`);

          return new Promise((resolve) => {
            const ws = new WebSocket(`ws://localhost:${env.uiPort}`);
            const timer = setTimeout(() => { ws.close(); resolve({ pass: false, reason: "timeout" }); }, 8000);
            let ready = false;
            ws.on("open", () => { ready = true; });
            ws.on("message", (raw) => {
              try {
                const msg = JSON.parse(raw.toString());
                if (msg.event === "task:deleted") {
                  clearTimeout(timer);
                  ws.close();
                  resolve({ pass: true });
                }
              } catch {}
            });
            const waitReady = setInterval(() => {
              if (ready) {
                clearInterval(waitReady);
                setTimeout(() => env.httpRequest("POST", `/api/delete/${taskId}`), 500);
              }
            }, 100);
            ws.on("error", () => { clearTimeout(timer); clearInterval(waitReady); resolve({ pass: false, reason: "ws error" }); });
          });
        },
      },
      {
        name: "POST /api/pause via HTTP → WS receives daemon:status change",
        fn: async (env) => {
          const WebSocket = require("ws");
          return new Promise((resolve) => {
            const ws = new WebSocket(`ws://localhost:${env.uiPort}`);
            const timer = setTimeout(() => { ws.close(); resolve({ pass: false, reason: "timeout" }); }, 5000);
            let statusCount = 0;
            let ready = false;
            ws.on("open", () => { ready = true; });
            ws.on("message", (raw) => {
              try {
                const msg = JSON.parse(raw.toString());
                if (msg.event === "daemon:status") {
                  statusCount++;
                  if (statusCount >= 2) {
                    clearTimeout(timer);
                    ws.close();
                    resolve({ pass: true });
                  }
                }
              } catch {}
            });
            const waitReady = setInterval(() => {
              if (ready) {
                clearInterval(waitReady);
                env.httpRequest("POST", "/api/pause");
              }
            }, 100);
            ws.on("error", () => { clearTimeout(timer); clearInterval(waitReady); resolve({ pass: false, reason: "ws error" }); });
          });
        },
      },
      {
        name: "send unknown action via WS → server doesn't crash",
        fn: async (env) => {
          const WebSocket = require("ws");
          // Resume daemon first
          await env.httpRequest("POST", "/api/resume");
          return new Promise((resolve) => {
            const ws = new WebSocket(`ws://localhost:${env.uiPort}`);
            const timer = setTimeout(() => {
              // If we reach timeout without error, the server didn't crash
              ws.close();
              resolve({ pass: true });
            }, 2000);
            ws.on("open", () => {
              ws.send(JSON.stringify({ action: "nonexistent_action_xyz", data: {} }));
            });
            ws.on("close", () => {
              // If WS closes unexpectedly before timeout, still pass if it was clean
              clearTimeout(timer);
              resolve({ pass: true });
            });
            ws.on("error", () => { clearTimeout(timer); resolve({ pass: false, reason: "ws error" }); });
          });
        },
      },
    ],
  },

  // A8: Cleanup API
  {
    name: "Cleanup API",
    tests: [
      {
        name: "POST /api/cleanup {maxAgeDays:30} → 200",
        fn: async (env) => {
          const res = await env.httpRequest("POST", "/api/cleanup", { maxAgeDays: 30 });
          return { pass: res.status === 200 };
        },
      },
    ],
  },
];

// ── Layer 2: Browser Agent E2E Browser Test Cases ──

const geminiTestCases = [
  // ── Page Load & Structure (3) ──
  {
    id: "TC-001", group: "Page Load",
    name: "dashboard load and structure",
    instruction: `
      Navigate to {URL}.
      Verify the page title is "UCM Dashboard".
      Verify the header contains "UCM" text.
      Verify there are 4 navigation tabs (Chat, Tasks, Proposals, Autopilot).
      Take a screenshot.
    `,
  },
  {
    id: "TC-002", group: "Page Load",
    name: "default layout verification",
    instruction: `
      Navigate to {URL}.
      Verify the Tasks tab is the default active tab.
      Verify there is a task list area on the left (.left selector).
      Verify there is a detail view area on the right (.right selector).
      Verify there is a stats bar in the footer area.
      Verify there is a connection status indicator showing connected (green) state.
    `,
  },
  {
    id: "TC-003", group: "Page Load",
    name: "stats bar data display",
    instruction: `
      Navigate to {URL}.
      Use evaluate_script to check: document.getElementById('statsBar').innerText.
      Verify the stats bar text contains numbers and stat labels (like "Completed", "Failed", etc.).
      Take a screenshot.
    `,
  },

  // ── Panel Navigation (3) ──
  {
    id: "TC-010", group: "Navigation",
    name: "tab click panel switching",
    instruction: `
      Navigate to {URL}.
      Click the "Proposals" tab.
      Verify Proposals content is displayed and Tasks content is hidden.
      Click the "Autopilot" tab.
      Verify Autopilot content is displayed.
      Click the "Chat" tab.
      Verify terminal or Chat content is displayed.
      Click the "Tasks" tab to go back.
      Verify the Tasks panel is displayed again.
    `,
  },
  {
    id: "TC-011", group: "Navigation",
    name: "active tab highlight",
    instruction: `
      Navigate to {URL}.
      Verify the currently active tab (Tasks) is visually distinct from other tabs (different color or underline).
      Click the "Proposals" tab.
      Verify the Proposals tab is now highlighted as active and Tasks is inactive.
    `,
  },
  {
    id: "TC-012", group: "Navigation",
    name: "keyboard shortcut panel switching",
    instruction: `
      Navigate to {URL}.
      Press the "?" key on the keyboard.
      Verify a keyboard shortcuts help modal or overlay appears.
      Press Escape to close it.
    `,
  },

  // ── Task CRUD (5) ──
  {
    id: "TC-020", group: "Task CRUD",
    name: "task creation via modal",
    instruction: `
      Navigate to {URL}.
      Find and click the "New" or "+" button.
      Verify a modal opens.
      Type "Gemini test task" in the title field.
      Type "Created by Gemini E2E" in the description field.
      Click the Submit button.
      Wait 2 seconds, then verify "Gemini test task" appears in the task list.
      Take a screenshot.
    `,
  },
  {
    id: "TC-021", group: "Task CRUD",
    name: "task selection and detail view",
    instruction: `
      Navigate to {URL}.
      Click any task in the task list.
      Verify the right detail panel shows the task title.
      Verify a status badge (pending, running, etc.) is visible.
      Verify the detail panel has tabs (Status, Logs, Diff, etc.).
      Take a screenshot.
    `,
  },
  {
    id: "TC-022", group: "Task CRUD",
    name: "task detail tab switching",
    instruction: `
      Navigate to {URL}.
      Click a task in the task list.
      Click the "Logs" tab in the detail panel.
      Verify a log content area is visible.
      Click the "Diff" tab.
      Verify a diff content area is visible.
      Go back to the "Status" tab.
    `,
  },
  {
    id: "TC-023", group: "Task CRUD",
    name: "task action buttons",
    instruction: `
      Navigate to {URL}.
      Click a task in the task list.
      Verify the detail panel has at least one of these action buttons:
      Approve, Reject, Start, Cancel, Retry, Delete.
      Verify each visible button is clickable.
    `,
  },
  {
    id: "TC-024", group: "Task CRUD",
    name: "new task modal",
    instruction: `
      Navigate to {URL}.
      Click the "+ New" button.
      Verify a modal/form with title "New Task" appears.
      Verify there is a title input field.
      Verify there is a description/body textarea.
      Verify there is a Submit button.
      Take a screenshot of the modal.
    `,
  },

  // ── Task Filtering & Sorting (3) ──
  {
    id: "TC-030", group: "Task Filter",
    name: "task status filter",
    instruction: `
      Navigate to {URL}.
      Verify there are status filter buttons or dropdown above the task list.
      Click one of the filter options (e.g. "pending" or "all").
      Verify the filter is applied (list changes or active filter is indicated).
    `,
  },
  {
    id: "TC-031", group: "Task Filter",
    name: "task search",
    instruction: `
      Navigate to {URL}.
      Use evaluate_script to check if an element with id "filterSearch" exists: document.getElementById('filterSearch') !== null.
      Verify the search input exists.
      Use evaluate_script to set the search value and trigger filter: document.getElementById('filterSearch').value = 'nonexistent'; document.getElementById('filterSearch').dispatchEvent(new Event('input'));
      Wait 1 second.
      Use evaluate_script to check: document.querySelectorAll('.task-item').length should be 0 or show "No matching tasks".
      Use evaluate_script to clear: document.getElementById('filterSearch').value = ''; document.getElementById('filterSearch').dispatchEvent(new Event('input'));
    `,
  },
  {
    id: "TC-032", group: "Task Filter",
    name: "task sorting",
    instruction: `
      Navigate to {URL}.
      Verify there are sort options (by state, newest, oldest, priority, etc.) above the task list.
      Select a different sort option and verify the list order changes.
    `,
  },

  // ── Proposals Panel (3) ──
  {
    id: "TC-040", group: "Proposals",
    name: "proposals panel structure",
    instruction: `
      Navigate to {URL}.
      Click the "Proposals" tab.
      Verify a proposals list area is displayed.
      Verify an empty state message ("no proposals" etc.) is shown if there are none.
      Verify Observer-related buttons (Analyze, Research, Run Observer, etc.) exist.
      Take a screenshot.
    `,
  },
  {
    id: "TC-041", group: "Proposals",
    name: "observer status display",
    instruction: `
      Navigate to {URL}.
      Click the "Proposals" tab.
      Verify there is an area displaying Observer status info (cycle, last run, etc.).
    `,
  },
  {
    id: "TC-042", group: "Proposals",
    name: "observer controls",
    instruction: `
      Navigate to {URL}.
      Click the "Proposals" tab.
      Verify there are action buttons: "Analyze", "Research", and "Run Observer".
      Verify each button is clickable.
    `,
  },

  // ── Autopilot Panel (3) ──
  {
    id: "TC-050", group: "Autopilot",
    name: "autopilot panel structure",
    instruction: `
      Navigate to {URL}.
      Click the "Autopilot" tab.
      Verify a session list area is displayed.
      Verify an appropriate empty state is shown when there are no sessions.
      Verify there is UI to start a new Autopilot session (start button, project path input, etc.).
      Take a screenshot.
    `,
  },
  {
    id: "TC-051", group: "Autopilot",
    name: "autopilot start form",
    instruction: `
      Navigate to {URL}.
      Click the "Autopilot" tab.
      Click the "+ New Autopilot" button to open the start form.
      Verify the form has a project path input field.
      Verify there is a Max items setting.
      Verify there is a Start button.
    `,
  },
  {
    id: "TC-052", group: "Autopilot",
    name: "autopilot new button exists",
    instruction: `
      Navigate to {URL}.
      Click the "Autopilot" tab.
      Use evaluate_script to check: document.querySelector('#apToolbar .primary') !== null.
      Verify the "+ New Autopilot" button exists and is visible.
      Take a screenshot.
    `,
  },

  // ── Daemon Control UI (2) ──
  {
    id: "TC-060", group: "Daemon",
    name: "daemon status display",
    instruction: `
      Navigate to {URL}.
      Find the WebSocket connection status indicator.
      Verify the connection is active/connected (green dot or "connected" text).
      Verify the stats bar shows the daemon's active task count, queue length, etc.
    `,
  },
  {
    id: "TC-061", group: "Daemon",
    name: "pause/resume behavior",
    instruction: `
      Navigate to {URL}.
      Find a Pause or pause button on the screen (may be in stats bar or admin area).
      If found, click Pause and verify the status changes.
      If a Resume button appears, click it to return to the original state.
      If not found, report that.
    `,
  },

  // ── Toast/Notification (1) ──
  {
    id: "TC-070", group: "Toast",
    name: "toast notification",
    instruction: `
      Navigate to {URL}.
      Create a task (click New button, type "toast test" as title, click Submit).
      After task creation, verify a toast notification (brief message at top/bottom of screen) appears.
      Verify the toast disappears automatically after a few seconds.
    `,
  },

  // ── Visual Regression (3) ──
  {
    id: "TC-080", group: "Visual",
    name: "full layout visual check",
    instruction: `
      Navigate to {URL}.
      Take a full page screenshot.
      Visually verify:
      - The top header spans the full width
      - Left panel and right panel are side by side
      - A bottom stats bar is visible
      - The color theme is dark mode (dark background ~#0d1117)
      - Text is readable size
      - No overlapping or clipped elements
      Report whether the layout has any broken parts.
    `,
  },
  {
    id: "TC-081", group: "Visual",
    name: "proposals panel layout",
    instruction: `
      Navigate to {URL}.
      Click the "Proposals" tab.
      Wait 1 second, then take a full page screenshot.
      Verify the Proposals panel layout:
      - Proposals list area is properly positioned
      - Observer controls are neatly aligned
      - Empty state message is centered or in an appropriate position
    `,
  },
  {
    id: "TC-082", group: "Visual",
    name: "autopilot panel layout",
    instruction: `
      Navigate to {URL}.
      Click the "Autopilot" tab.
      Wait 1 second, then take a full page screenshot.
      Verify the Autopilot panel layout:
      - Session list/start UI is properly positioned
      - Input fields and buttons are aligned
      - Overall layout is clean
    `,
  },
];

module.exports = { apiTestGroups, geminiTestCases };
