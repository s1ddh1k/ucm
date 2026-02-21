#!/usr/bin/env node
// test/web-dashboard.test.js — Web frontend (React) E2E test orchestrator
// Layer 1: API tests (via Vite proxy)
// Layer 2: Browser Agent E2E tests targeting the React SPA

const { state, assert, runGroup, startSuiteTimer, stopSuiteTimer, summary } = require("./harness.js");
const { WebTestEnvironment } = require("./helpers/web-test-infra.js");
const { apiTestGroups, browserTestCases } = require("./web-dashboard-cases.js");
const { execSync } = require("child_process");

const VALID_LAYERS = new Set(["all", "api", "browser"]);
const VALID_PROFILES = new Set(["full", "release", "smoke", "changed"]);
const SMOKE_BROWSER_IDS = ["WB-001", "WB-010", "WB-020", "WB-030", "WB-050", "WB-060", "WB-070", "WB-080", "WB-090"];

const SYSTEM_PROMPT = `You are a QA test agent for the UCM Web Dashboard (React SPA).
You have Chrome DevTools MCP tools to interact with the browser.

## Dashboard Structure
- React SPA served by Vite dev server at {URL}
- Sidebar navigation on the left with links: Dashboard, Tasks, Proposals, Autopilot, Terminal, Settings
- Header bar at the top showing page title and daemon status
- Dark theme (very dark background)
- Content area fills the remaining space

## Page URLs
- Dashboard: {URL}/
- Tasks: {URL}/tasks
- Proposals: {URL}/proposals
- Autopilot: {URL}/autopilot
- Terminal: {URL}/terminal
- Settings: {URL}/settings

## UI Framework
- Built with React, Tailwind CSS, shadcn/ui (Radix UI primitives)
- Components use class names like "rounded-md", "bg-card", "text-foreground"
- Buttons use the Button component with variants: default, outline, ghost, destructive
- Status indicators use colored dots (blue=running, yellow=pending, green=done, red=failed)
- Dialogs open as modal overlays with backdrop

## Key MCP Tools
- navigate_page: go to a URL
- click: click an element by uid from snapshot
- fill: type text into an input
- evaluate_script: run JS in the page (best for DOM checks)
- take_screenshot: capture the page
- press_key: press keyboard keys
- take_snapshot: get page accessibility snapshot with element uids

## Important Notes
- Always take_snapshot before clicking to get current element UIDs
- Use evaluate_script for DOM state verification
- The app uses React Router for client-side routing, so URL changes are instant
- Data loads asynchronously via TanStack Query — wait briefly after navigation

## Result Format
After ALL tests, respond with a JSON array (no markdown fences):
[{"id":"WB-001","pass":true,"evidence":"what you observed"}, ...]`;

function parseCsv(value) {
  if (!value) return [];
  return value.split(",").map((x) => x.trim()).filter(Boolean);
}

function parseArgs(argv) {
  const opts = {
    help: false,
    listGroups: false,
    profile: null,
    layer: null,
    watch: false,
    watchOnChange: false,
    watchIntervalMs: 5000,
    maxCycles: 0,
    apiGroups: [],
    browserGroups: [],
    ids: [],
    unknown: [],
  };

  function readValue(arg, i) {
    const v = argv[i + 1];
    if (!v || v.startsWith("-")) {
      opts.unknown.push(`${arg} requires a value`);
      return { value: null, next: i };
    }
    return { value: v, next: i + 1 };
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") { opts.help = true; continue; }
    if (arg === "--list-groups") { opts.listGroups = true; continue; }
    if (arg === "--watch") { opts.watch = true; continue; }
    if (arg === "--watch-on-change") { opts.watch = true; opts.watchOnChange = true; continue; }
    if (arg.startsWith("--watch-interval-ms=")) { opts.watch = true; opts.watchIntervalMs = Number(arg.slice("--watch-interval-ms=".length)); continue; }
    if (arg === "--watch-interval-ms") { const r = readValue(arg, i); i = r.next; if (r.value) { opts.watch = true; opts.watchIntervalMs = Number(r.value); } continue; }
    if (arg.startsWith("--max-cycles=")) { opts.maxCycles = Number(arg.slice("--max-cycles=".length)); continue; }
    if (arg === "--max-cycles") { const r = readValue(arg, i); i = r.next; if (r.value) opts.maxCycles = Number(r.value); continue; }
    if (arg.startsWith("--profile=")) { opts.profile = arg.slice("--profile=".length); continue; }
    if (arg === "--profile") { const r = readValue(arg, i); i = r.next; if (r.value) opts.profile = r.value; continue; }
    if (arg.startsWith("--layer=")) { opts.layer = arg.slice("--layer=".length); continue; }
    if (arg === "--layer") { const r = readValue(arg, i); i = r.next; if (r.value) opts.layer = r.value; continue; }
    if (arg.startsWith("--api-groups=")) { opts.apiGroups.push(...parseCsv(arg.slice("--api-groups=".length))); continue; }
    if (arg === "--api-groups") { const r = readValue(arg, i); i = r.next; if (r.value) opts.apiGroups.push(...parseCsv(r.value)); continue; }
    if (arg.startsWith("--groups=") || arg.startsWith("--browser-groups=")) {
      const value = arg.startsWith("--groups=") ? arg.slice("--groups=".length) : arg.slice("--browser-groups=".length);
      opts.browserGroups.push(...parseCsv(value)); continue;
    }
    if (arg === "--groups" || arg === "--browser-groups") { const r = readValue(arg, i); i = r.next; if (r.value) opts.browserGroups.push(...parseCsv(r.value)); continue; }
    if (arg.startsWith("--ids=")) { opts.ids.push(...parseCsv(arg.slice("--ids=".length))); continue; }
    if (arg === "--ids") { const r = readValue(arg, i); i = r.next; if (r.value) opts.ids.push(...parseCsv(r.value)); continue; }
    opts.unknown.push(`unknown option: ${arg}`);
  }
  return opts;
}

function readChangedFiles() {
  try {
    const out = execSync("git status --porcelain", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => l.slice(3).split(" -> ").pop().trim());
  } catch { return []; }
}

function inferChangedSelection(files) {
  const api = new Set();
  const browser = new Set();
  for (const file of files) {
    const f = file.toLowerCase();
    if (f.includes("web/")) {
      // Web frontend file changed → run all browser tests
      browser.add("Page Load");
      browser.add("Navigation");
      browser.add("Dashboard");
      browser.add("Tasks");
      browser.add("Task Filter");
      browser.add("Proposals");
      browser.add("Autopilot");
      browser.add("Terminal");
      browser.add("Settings");
      browser.add("Visual");
    }
    if (f.includes("ucm-ui-server") || f.includes("ucmd-")) {
      api.add("Proxy Health");
      api.add("Task CRUD API");
      api.add("WebSocket Proxy");
    }
  }
  return { apiGroups: [...api], browserGroups: [...browser] };
}

function uniq(values) { return [...new Set(values)]; }

function resolvePlan(raw, apiGroupNames, browserGroupNames) {
  const errors = [...raw.unknown];
  const plan = {
    profile: raw.profile ? raw.profile.toLowerCase() : "full",
    layer: raw.layer ? raw.layer.toLowerCase() : "all",
    apiGroups: uniq(raw.apiGroups),
    browserGroups: uniq(raw.browserGroups),
    ids: uniq(raw.ids),
    inferredFromChanged: false,
  };

  if (!VALID_LAYERS.has(plan.layer)) errors.push(`invalid --layer: ${plan.layer}`);
  if (!VALID_PROFILES.has(plan.profile)) errors.push(`invalid --profile: ${plan.profile}`);
  if (plan.profile === "release") plan.profile = "full";

  if (plan.profile === "smoke" && plan.ids.length === 0) plan.ids = SMOKE_BROWSER_IDS.slice();

  if (plan.profile === "changed" && plan.apiGroups.length === 0 && plan.browserGroups.length === 0 && plan.ids.length === 0) {
    const inferred = inferChangedSelection(readChangedFiles());
    plan.apiGroups = inferred.apiGroups;
    plan.browserGroups = inferred.browserGroups;
    plan.inferredFromChanged = true;
    if (plan.apiGroups.length === 0 && plan.browserGroups.length === 0) plan.ids = SMOKE_BROWSER_IDS.slice();
  }

  const apiNameSet = new Set(apiGroupNames);
  const browserNameSet = new Set(browserGroupNames);
  const idSet = new Set(browserTestCases.map((x) => x.id));

  const invalidApi = plan.apiGroups.filter((x) => !apiNameSet.has(x));
  const invalidBrowser = plan.browserGroups.filter((x) => !browserNameSet.has(x));
  const invalidIds = plan.ids.filter((x) => !idSet.has(x));
  if (invalidApi.length > 0) errors.push(`unknown api groups: ${invalidApi.join(", ")}`);
  if (invalidBrowser.length > 0) errors.push(`unknown browser groups: ${invalidBrowser.join(", ")}`);
  if (invalidIds.length > 0) errors.push(`unknown ids: ${invalidIds.join(", ")}`);

  if (plan.layer === "api") { plan.browserGroups = []; plan.ids = []; }
  else if (plan.layer === "browser") { plan.apiGroups = []; }

  return { plan, errors };
}

function printUsage(apiGroupNames, browserGroupNames) {
  console.log(`Web Dashboard test runner (React SPA)

Usage:
  node test/web-dashboard.test.js [options]

Options:
  --profile <full|release|smoke|changed>   Run profile (default: full)
  --layer <all|api|browser>                Which layer to run (default: all)
  --watch                                  Keep running in loop mode
  --watch-on-change                        Run loop only when git status changes
  --watch-interval-ms <ms>                 Loop interval (default: 5000)
  --max-cycles <n>                         Stop after N cycles (0=unlimited)
  --api-groups "A,B"                       API group filter
  --groups "A,B"                           Browser group filter
  --ids "WB-001,WB-030"                    Browser test case id filter
  --list-groups                            Print available groups
  --help                                   Show help

Env:
  UCM_BROWSER_AGENT_PROVIDER=gemini|claude|codex (default: gemini)
`);
  console.log(`API groups: ${apiGroupNames.join(", ")}`);
  console.log(`Browser groups: ${browserGroupNames.join(", ")}`);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function resetState() { state.passed = 0; state.failed = 0; state.failures.length = 0; }

function gitStatusSignature() {
  try {
    return execSync("git status --porcelain", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split("\n").filter(Boolean).sort().join("\n");
  } catch { return ""; }
}

async function main() {
  const apiGroupNames = apiTestGroups.map((x) => x.name);
  const browserGroupNames = uniq(browserTestCases.map((x) => x.group));
  const raw = parseArgs(process.argv.slice(2));

  if (raw.help) { printUsage(apiGroupNames, browserGroupNames); return; }
  if (raw.listGroups) {
    console.log("API groups:");
    apiGroupNames.forEach((x) => console.log(`  - ${x}`));
    console.log("\nBrowser groups:");
    browserGroupNames.forEach((x) => console.log(`  - ${x}`));
    return;
  }

  const initial = resolvePlan(raw, apiGroupNames, browserGroupNames);
  if (initial.errors.length > 0) {
    initial.errors.forEach((x) => console.error(`Error: ${x}`));
    printUsage(apiGroupNames, browserGroupNames);
    process.exit(1);
  }

  const provider = (process.env.UCM_BROWSER_AGENT_PROVIDER || "gemini").toLowerCase();
  const basePlan = initial.plan;
  const suiteTimeoutMs = raw.watch
    ? null
    : (basePlan.layer === "api" ? 300_000 : (provider === "codex" ? 1_800_000 : 600_000));
  if (suiteTimeoutMs) startSuiteTimer(suiteTimeoutMs);

  const env = new WebTestEnvironment("ucm-web-test");
  let stopRequested = false;
  process.on("SIGINT", () => {
    stopRequested = true;
    if (raw.watch) console.log("\nStopping watch mode...");
  });

  console.log("Web Dashboard Test Suite (React)\n");
  console.log(`Suite timeout: ${suiteTimeoutMs ? `${suiteTimeoutMs}ms` : "disabled (watch)"}`);
  if (raw.watch) {
    console.log(`Watch mode: interval=${raw.watchIntervalMs}ms${raw.watchOnChange ? ", trigger=git-change" : ""}${raw.maxCycles > 0 ? `, maxCycles=${raw.maxCycles}` : ""}`);
  }
  console.log("\nStarting daemon + UI server + Vite dev server...");

  try {
    await env.startAll();
  } catch (e) {
    console.error("Failed to start infrastructure:", e.message);
    await env.cleanup();
    process.exit(1);
  }

  console.log(`Backend UI server: ${env.url}`);
  console.log(`Vite dev server:   ${env.webUrl}\n`);

  let cycle = 0;
  let lastGitSig = gitStatusSignature();
  let lastResult = { passed: 0, failed: 0 };

  do {
    cycle += 1;
    const { plan } = resolvePlan(raw, apiGroupNames, browserGroupNames);
    const currentGitSig = gitStatusSignature();
    const hasChange = currentGitSig !== lastGitSig;
    const shouldRun = !raw.watchOnChange || cycle === 1 || hasChange;

    if (!shouldRun) {
      console.log(`[watch] cycle ${cycle}: no git changes detected, skip`);
    } else {
      lastGitSig = currentGitSig;
      resetState();
      console.log(`\n=== Cycle ${cycle} ===`);
      console.log(`Execution plan: profile=${plan.profile}, layer=${plan.layer}`);
      console.log(`API groups: ${plan.apiGroups.length > 0 ? plan.apiGroups.join(", ") : (plan.layer === "browser" ? "(skipped)" : "all")}`);
      console.log(`Browser groups: ${plan.browserGroups.length > 0 ? plan.browserGroups.join(", ") : (plan.layer === "api" ? "(skipped)" : "all")}`);
      console.log(`Browser ids: ${plan.ids.length > 0 ? plan.ids.join(", ") : (plan.layer === "api" ? "(skipped)" : "all")}`);

      // ── Layer 1: API Tests ──
      if (plan.layer !== "browser") {
        console.log("\n═══ Layer 1: API Tests (via Vite proxy) ═══\n");

        // For API tests, use the Vite port to test proxy
        const originalPort = env.uiPort;
        env.uiPort = env.vitePort;

        const selectedApiGroups = plan.apiGroups.length > 0
          ? apiTestGroups.filter((x) => plan.apiGroups.includes(x.name))
          : apiTestGroups;
        const ctx = {};
        for (const group of selectedApiGroups) {
          const tests = {};
          for (const tc of group.tests) {
            tests[tc.name] = async () => {
              const result = await tc.fn(env, ctx);
              assert(result.pass, `${tc.name}: ${result.reason || "failed"}`);
            };
          }
          await runGroup(group.name, tests, { timeout: 15000 });
        }
        if (selectedApiGroups.length === 0) {
          console.log("No API groups selected; skipping Layer 1.");
        }

        // Restore port
        env.uiPort = originalPort;
      } else {
        console.log("\nLayer 1 skipped (--layer=browser)\n");
      }

      // ── Layer 2: Browser Agent E2E Tests ──
      if (plan.layer !== "api") {
        console.log("\n═══ Layer 2: Browser Agent E2E Tests ═══\n");
        const { GeminiRunner } = require("./helpers/gemini-runner.js");
        const runner = new GeminiRunner();
        try {
          console.log(`Starting browser runner (provider: ${runner.provider})...`);
          await runner.start();
          console.log("Browser runner ready\n");

          const selectedCases = browserTestCases.filter((tc) => {
            const groupOk = plan.browserGroups.length === 0 || plan.browserGroups.includes(tc.group);
            const idOk = plan.ids.length === 0 || plan.ids.includes(tc.id);
            return groupOk && idOk;
          });

          if (selectedCases.length === 0) {
            console.log("No browser test cases selected; skipping Layer 2.");
          } else {
            const systemPrompt = SYSTEM_PROMPT.replace(/\{URL\}/g, env.webUrl);
            const cases = selectedCases.map((tc) => ({
              ...tc,
              instruction: tc.instruction.replace(/\{URL\}/g, env.webUrl),
            }));

            console.log(`Running ${cases.length} tests in batched mode...`);
            const startTime = Date.now();
            const results = await runner.runBatch(cases, systemPrompt);
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log(`Batch completed in ${elapsed}s\n`);

            const groups = {};
            for (const tc of selectedCases) {
              if (!groups[tc.group]) groups[tc.group] = [];
              groups[tc.group].push(tc);
            }

            for (const [groupName, groupCases] of Object.entries(groups)) {
              process.stdout.write(`${groupName}:\n`);
              for (const tc of groupCases) {
                const r = results.find((x) => x.id === tc.id);
                if (r && r.pass) {
                  state.passed++;
                  process.stdout.write(".");
                } else {
                  state.failed++;
                  state.failures.push(`${tc.id} ${tc.name}: ${r?.evidence?.slice(0, 200) || "no result"}`);
                  process.stdout.write("F");
                }
              }
              console.log();
            }
          }
        } catch (e) {
          console.error("Browser runner error:", e.message);
        } finally {
          await runner.stop();
        }
      } else {
        console.log("\nLayer 2 skipped (--layer=api)\n");
      }

      lastResult = summary();
    }

    if (!raw.watch || stopRequested) break;
    if (raw.maxCycles > 0 && cycle >= raw.maxCycles) break;
    await sleep(raw.watchIntervalMs);
  } while (!stopRequested);

  // ── Cleanup ──
  await env.cleanup();

  if (suiteTimeoutMs) stopSuiteTimer();
  process.exit(lastResult.failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Web dashboard test error:", e);
  process.exit(1);
});
