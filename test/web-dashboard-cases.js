// test/web-dashboard-cases.js — Test cases for the new React web frontend
// Layer 1: API tests (reuses existing backend routes via Vite proxy)
// Layer 2: Browser Agent E2E tests targeting the React UI at web/

// ── Layer 1: API Test Cases (via Vite proxy) ──

const apiTestGroups = [
  // WA1: Proxy Health — ensure Vite proxy to backend works
  {
    name: "Proxy Health",
    tests: [
      {
        name: "GET /api/stats via Vite proxy → 200, has pid",
        fn: async (env) => {
          const res = await env.httpRequest("GET", "/api/stats");
          if (res.status !== 200)
            return { pass: false, reason: `status ${res.status}` };
          if (typeof res.body !== "object")
            return { pass: false, reason: "body not object" };
          if (!res.body.pid) return { pass: false, reason: "no pid" };
          return { pass: true };
        },
      },
      {
        name: "GET /api/list via Vite proxy → 200, array",
        fn: async (env) => {
          const res = await env.httpRequest("GET", "/api/list");
          if (res.status !== 200)
            return { pass: false, reason: `status ${res.status}` };
          if (!Array.isArray(res.body))
            return { pass: false, reason: "not array" };
          return { pass: true };
        },
      },
      {
        name: "GET /api/proposals via Vite proxy → 200, array",
        fn: async (env) => {
          const res = await env.httpRequest("GET", "/api/proposals");
          if (res.status !== 200)
            return { pass: false, reason: `status ${res.status}` };
          if (!Array.isArray(res.body))
            return { pass: false, reason: "not array" };
          return { pass: true };
        },
      },
      {
        name: "GET /api/daemon/status via Vite proxy → 200, has online",
        fn: async (env) => {
          const res = await env.httpRequest("GET", "/api/daemon/status");
          if (res.status !== 200)
            return { pass: false, reason: `status ${res.status}` };
          if (!("online" in res.body))
            return { pass: false, reason: "no online field" };
          return { pass: true };
        },
      },
    ],
  },

  // WA2: Task CRUD via proxy
  {
    name: "Task CRUD API",
    tests: [
      {
        name: "POST /api/submit → 200, returns id",
        fn: async (env, ctx) => {
          const res = await env.httpRequest("POST", "/api/submit", {
            title: "web test task",
            body: "created by web dashboard test",
            pipeline: "small",
          });
          if (res.status !== 200)
            return { pass: false, reason: `status ${res.status}` };
          if (!res.body?.id) return { pass: false, reason: "no id" };
          ctx.taskId = res.body.id;
          return { pass: true };
        },
      },
      {
        name: "GET /api/list → includes created task",
        fn: async (env, ctx) => {
          if (!ctx.taskId) return { pass: false, reason: "no taskId" };
          const res = await env.httpRequest("GET", "/api/list");
          if (res.status !== 200)
            return { pass: false, reason: `status ${res.status}` };
          const found = res.body.some((t) => t.id === ctx.taskId);
          return {
            pass: found,
            reason: found ? undefined : "task not in list",
          };
        },
      },
      {
        name: "GET /api/status/:taskId → 200, has title",
        fn: async (env, ctx) => {
          if (!ctx.taskId) return { pass: false, reason: "no taskId" };
          const res = await env.httpRequest("GET", `/api/status/${ctx.taskId}`);
          if (res.status !== 200)
            return { pass: false, reason: `status ${res.status}` };
          if (res.body?.title !== "web test task")
            return { pass: false, reason: `title: ${res.body?.title}` };
          return { pass: true };
        },
      },
      {
        name: "POST /api/cancel/:taskId → 200",
        fn: async (env, ctx) => {
          if (!ctx.taskId) return { pass: false, reason: "no taskId" };
          const res = await env.httpRequest(
            "POST",
            `/api/cancel/${ctx.taskId}`,
          );
          return { pass: res.status === 200 };
        },
      },
      {
        name: "POST /api/delete/:taskId → 200",
        fn: async (env, ctx) => {
          if (!ctx.taskId) return { pass: false, reason: "no taskId" };
          const res = await env.httpRequest(
            "POST",
            `/api/delete/${ctx.taskId}`,
          );
          return { pass: res.status === 200 };
        },
      },
    ],
  },

  // WA3: WebSocket via proxy
  {
    name: "WebSocket Proxy",
    tests: [
      {
        name: "WS connect via Vite → receives daemon:status",
        fn: async (env) => {
          const WebSocket = require("ws");
          // Connect via Vite's /ws proxy path (root WS is Vite HMR)
          return new Promise((resolve) => {
            const ws = new WebSocket(`ws://localhost:${env.uiPort}/ws`);
            const timer = setTimeout(() => {
              ws.close();
              resolve({ pass: false, reason: "timeout" });
            }, 5000);
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
            ws.on("error", () => {
              clearTimeout(timer);
              resolve({ pass: false, reason: "ws error" });
            });
          });
        },
      },
      {
        name: "submit via HTTP → WS receives task:created",
        fn: async (env) => {
          const WebSocket = require("ws");
          return new Promise((resolve) => {
            const ws = new WebSocket(`ws://localhost:${env.uiPort}/ws`);
            const timer = setTimeout(() => {
              ws.close();
              resolve({ pass: false, reason: "timeout" });
            }, 5000);
            let ready = false;
            ws.on("open", () => {
              ready = true;
            });
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
            const waitReady = setInterval(() => {
              if (ready) {
                clearInterval(waitReady);
                env.httpRequest("POST", "/api/submit", {
                  title: "ws-web-test",
                  body: "ws test",
                });
              }
            }, 100);
            ws.on("error", () => {
              clearTimeout(timer);
              clearInterval(waitReady);
              resolve({ pass: false, reason: "ws error" });
            });
          });
        },
      },
    ],
  },
];

// ── Layer 2: Browser Agent E2E Test Cases ──
// These target the React SPA at {URL} (Vite dev server)

const browserTestCases = [
  // ── WB-01: Page Load & Structure (3) ──
  {
    id: "WB-001",
    group: "Page Load",
    name: "React app loads and renders",
    instruction: `
      Navigate to {URL}.
      Verify the page loads without errors.
      Verify the page title is "UCM Dashboard".
      Verify a sidebar navigation is visible on the left.
      Verify a header bar is visible at the top with "Dashboard" text.
      Take a screenshot.
    `,
  },
  {
    id: "WB-002",
    group: "Page Load",
    name: "sidebar navigation items",
    instruction: `
      Navigate to {URL}.
      Verify the sidebar contains navigation links for:
      - Dashboard
      - Tasks
      - Proposals
      - Terminal
      - Settings
      Verify each link is visible and clickable.
      Take a screenshot of the sidebar.
    `,
  },
  {
    id: "WB-003",
    group: "Page Load",
    name: "daemon connection indicator",
    instruction: `
      Navigate to {URL}.
      Verify the header area contains a daemon status indicator.
      Verify it shows "Daemon:" text with a status (Running, Paused, or Offline).
      Take a screenshot of the header.
    `,
  },

  // ── WB-02: Navigation (3) ──
  {
    id: "WB-010",
    group: "Navigation",
    name: "sidebar link navigation",
    instruction: `
      Navigate to {URL}.
      Click the "Tasks" link in the sidebar.
      Verify the header changes to show "Tasks".
      Click the "Proposals" link in the sidebar.
      Verify the header changes to show "Proposals".
      Click the "Dashboard" link to go back.
      Verify the header shows "Dashboard" again.
    `,
  },
  {
    id: "WB-011",
    group: "Navigation",
    name: "active sidebar highlight",
    instruction: `
      Navigate to {URL}.
      Verify the "Dashboard" link in the sidebar is visually highlighted (has a different background color) since it's the current page.
      Click the "Tasks" link.
      Verify the "Tasks" link is now highlighted and "Dashboard" is not.
      Click the "Proposals" link.
      Verify the "Proposals" link is now highlighted.
    `,
  },
  {
    id: "WB-012",
    group: "Navigation",
    name: "sidebar collapse toggle",
    instruction: `
      Navigate to {URL}.
      Find and click the "Collapse" button at the bottom of the sidebar.
      Verify the sidebar collapses (becomes narrow, text labels disappear, only icons visible).
      Click the collapse/expand button again.
      Verify the sidebar expands back (text labels reappear).
      Take a screenshot.
    `,
  },

  // ── WB-03: Dashboard Page (3) ──
  {
    id: "WB-020",
    group: "Dashboard",
    name: "stats grid display",
    instruction: `
      Navigate to {URL}.
      Verify the dashboard shows a stats grid with cards for:
      - Active (count)
      - Queue (count)
      - Done (count)
      - Failed (count)
      - Uptime (duration)
      - Spawns (count)
      Each card should show a number or value.
      Take a screenshot.
    `,
  },
  {
    id: "WB-021",
    group: "Dashboard",
    name: "system resources display",
    instruction: `
      Navigate to {URL}.
      Verify there is a "System Resources" card/section.
      Verify it shows CPU, Memory, and Disk usage bars with percentage values.
      Verify the bars have visual indicators (colored fill).
      Take a screenshot.
    `,
  },
  {
    id: "WB-022",
    group: "Dashboard",
    name: "activity feed",
    instruction: `
      Navigate to {URL}.
      Verify there is an "Activity Feed" card/section.
      Verify it either shows activity entries with timestamps or a "No recent activity" message.
      Take a screenshot.
    `,
  },

  // ── WB-04: Tasks Page (5) ──
  {
    id: "WB-030",
    group: "Tasks",
    name: "task list layout",
    instruction: `
      Navigate to {URL}/tasks.
      Verify there is a task list panel on the left side.
      Verify there is a detail panel on the right side showing "Select a task" placeholder.
      Verify there are filter controls (status dropdown, sort dropdown, search input) above the task list.
      Verify there is a "New Task" button at the bottom of the task list.
      Take a screenshot.
    `,
  },
  {
    id: "WB-031",
    group: "Tasks",
    name: "task creation dialog",
    instruction: `
      Navigate to {URL}/tasks.
      Click the "New Task" button.
      Verify a dialog/modal opens with title "New Task".
      Verify the dialog has:
      - A "Title" input field
      - A "Description" textarea
      - A "Project Path" input field
      - A "Pipeline" dropdown (with options: Trivial, Small, Medium, Large)
      - A "Priority" number input
      - "Cancel" and "Create Task" buttons
      Take a screenshot of the dialog.
    `,
  },
  {
    id: "WB-032",
    group: "Tasks",
    name: "create and select task",
    instruction: `
      Navigate to {URL}/tasks.
      Click the "New Task" button.
      Type "Browser agent test task" in the Title field.
      Type "Created by browser test" in the Description field.
      Click the "Create Task" button.
      Wait 2 seconds.
      Verify "Browser agent test task" appears in the task list.
      Click on "Browser agent test task" in the list.
      Verify the detail panel shows:
      - The task title "Browser agent test task"
      - A status badge
      - Tabs for Overview, Logs, Diff, Artifacts
      Take a screenshot.
    `,
  },
  {
    id: "WB-033",
    group: "Tasks",
    name: "task detail tabs",
    instruction: `
      Navigate to {URL}/tasks.
      Use evaluate_script to submit a task: fetch('/api/submit', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({title:'tab-test-task', body:'for tab testing'})}).then(r=>r.json()).then(d=>d.id)
      Wait 2 seconds.
      Click on a task in the list (any task).
      Click the "Logs" tab in the detail panel.
      Verify a log content area is visible (may show "(no logs)").
      Click the "Diff" tab.
      Verify a diff area is visible (may show "No diff available").
      Click the "Artifacts" tab.
      Verify an artifacts area is visible (may show "No artifacts").
      Click the "Overview" tab.
      Verify the overview shows task properties (ID, Created, etc.).
    `,
  },
  {
    id: "WB-034",
    group: "Tasks",
    name: "task action buttons",
    instruction: `
      Navigate to {URL}/tasks.
      Use evaluate_script: fetch('/api/submit', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({title:'action-test', body:'test'})}).then(r=>r.json()).then(d=>d.id)
      Wait 2 seconds.
      Click on a task in the task list.
      Verify the detail panel bottom bar contains action buttons.
      For a pending task, verify "Start" and "Cancel" buttons exist.
      Take a screenshot of the action buttons area.
    `,
  },

  // ── WB-05: Task Filters (3) ──
  {
    id: "WB-040",
    group: "Task Filter",
    name: "status filter dropdown",
    instruction: `
      Navigate to {URL}/tasks.
      Find the status filter dropdown (should show "All" by default).
      Click the dropdown and verify it shows options: All, Pending, Running, Review, Done, Failed.
      Select "Pending" filter.
      Verify the task list shows only pending tasks (or is empty if none exist).
      Select "All" to reset.
    `,
  },
  {
    id: "WB-041",
    group: "Task Filter",
    name: "search input filter",
    instruction: `
      Navigate to {URL}/tasks.
      Use evaluate_script: fetch('/api/submit', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({title:'searchable-xyz-task', body:'unique'})}).then(r=>r.json())
      Wait 2 seconds.
      Find the search input field.
      Type "searchable-xyz" into the search input.
      Verify "searchable-xyz-task" appears in the filtered list.
      Clear the search input.
      Type "nonexistent-gibberish-query" into the search input.
      Verify the task list is empty or shows "No tasks" message.
    `,
  },
  {
    id: "WB-042",
    group: "Task Filter",
    name: "sort options",
    instruction: `
      Navigate to {URL}/tasks.
      Find the sort dropdown.
      Click it and verify it shows sort options: Newest, Priority, Title.
      Select a different sort option and verify the list is displayed.
    `,
  },

  // ── WB-06: Proposals Page (3) ──
  {
    id: "WB-050",
    group: "Proposals",
    name: "proposals page layout",
    instruction: `
      Navigate to {URL}/proposals.
      Verify the header shows "Proposals".
      Verify there is an Observer status indicator.
      Verify there are action buttons: "Run Observer", "Analyze", "Research".
      Verify there are filter dropdowns for Status, Category, and Risk.
      Verify the page shows either proposal cards or a "No proposals" empty state.
      Take a screenshot.
    `,
  },
  {
    id: "WB-051",
    group: "Proposals",
    name: "proposals filter controls",
    instruction: `
      Navigate to {URL}/proposals.
      Find the Status filter dropdown.
      Click it and verify it shows: All, Proposed, Approved, Rejected, Implemented.
      Find the Category filter dropdown.
      Click it and verify it shows category options (Bugfix, UX, Architecture, etc.).
      Find the Risk filter dropdown.
      Click it and verify it shows: All Risks, Low, Medium, High.
    `,
  },
  {
    id: "WB-052",
    group: "Proposals",
    name: "observer controls clickable",
    instruction: `
      Navigate to {URL}/proposals.
      Verify "Run Observer" button is visible and clickable.
      Verify "Analyze" button is visible and clickable.
      Verify "Research" button is visible and clickable.
      Take a screenshot.
    `,
  },

  // ── WB-07: Terminal Page (2) ──
  {
    id: "WB-070",
    group: "Terminal",
    name: "terminal page layout",
    instruction: `
      Navigate to {URL}/terminal.
      Verify the header shows "Terminal".
      Verify there is a toolbar with:
      - "Terminal" label
      - Connection status indicator
      - A "Start Session" button
      Verify a terminal area (dark background) is visible below the toolbar.
      Take a screenshot.
    `,
  },
  {
    id: "WB-071",
    group: "Terminal",
    name: "terminal status display",
    instruction: `
      Navigate to {URL}/terminal.
      Verify the toolbar shows connection status (Idle, Connecting, or Connected).
      Verify the "Start Session" button is present when no session is active.
      Take a screenshot.
    `,
  },

  // ── WB-09: Settings Page (2) ──
  {
    id: "WB-080",
    group: "Settings",
    name: "settings page layout",
    instruction: `
      Navigate to {URL}/settings.
      Verify the header shows "Settings".
      Verify there is a "Daemon Control" card with:
      - Daemon status indicator
      - Start/Stop/Pause/Resume buttons (visibility depends on state)
      Verify there is a "Maintenance" card with a "Run Cleanup" button.
      Verify there is a "System Info" card showing system details.
      Take a screenshot.
    `,
  },
  {
    id: "WB-081",
    group: "Settings",
    name: "daemon control actions",
    instruction: `
      Navigate to {URL}/settings.
      Verify the daemon status is displayed (Running, Paused, or Offline).
      If a "Pause" button is visible, verify it is clickable.
      If the daemon is running, the PID and Uptime should be displayed.
      Take a screenshot.
    `,
  },

  // ── WB-10: Visual & Layout (3) ──
  {
    id: "WB-090",
    group: "Visual",
    name: "full page dark theme",
    instruction: `
      Navigate to {URL}.
      Take a full page screenshot.
      Verify the page uses a dark theme:
      - Background is very dark (near black)
      - Text is light colored (white/gray)
      - Cards and panels have subtle dark borders
      - Status dots use color to indicate state
      Verify no overlapping or clipped elements.
      Report the overall visual quality.
    `,
  },
  {
    id: "WB-091",
    group: "Visual",
    name: "tasks page split layout",
    instruction: `
      Navigate to {URL}/tasks.
      Take a full page screenshot.
      Verify the split layout:
      - Left panel (task list) takes about 1/4 width
      - Right panel (detail) takes remaining width
      - Panels are separated by a border
      - No content overflow or horizontal scrollbar
      - Filter bar is properly aligned above the task list
    `,
  },
  {
    id: "WB-092",
    group: "Visual",
    name: "responsive sidebar",
    instruction: `
      Navigate to {URL}.
      Take a screenshot with the sidebar expanded.
      Verify the sidebar shows icons and text labels.
      Click the collapse button in the sidebar.
      Take a screenshot with the sidebar collapsed.
      Verify the sidebar is narrow, showing only icons.
      Verify the main content area expands to fill the space.
    `,
  },
];

module.exports = { apiTestGroups, browserTestCases };
