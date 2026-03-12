#!/usr/bin/env node
// test/dashboard.test.js — Dashboard E2E test orchestrator
// Layer 1: API tests (direct HTTP/Socket)
// Layer 2: Browser Agent + Chrome DevTools MCP browser tests (batched spawn)

const {
  state,
  assert,
  runGroup,
  startSuiteTimer,
  stopSuiteTimer,
  summary,
} = require("./harness.js");
const { TestEnvironment } = require("./helpers/test-infra.js");
const { apiTestGroups, geminiTestCases } = require("./dashboard-cases.js");
const { execSync } = require("node:child_process");

const VALID_LAYERS = new Set(["all", "api", "browser"]);
const VALID_PROFILES = new Set(["full", "release", "smoke", "changed"]);
const SMOKE_BROWSER_IDS = [
  "TC-001",
  "TC-010",
  "TC-020",
  "TC-040",
  "TC-060",
  "TC-080",
];

const SYSTEM_PROMPT = `You are a QA test agent for the UCM Dashboard.
You have Chrome DevTools MCP tools to interact with the browser.

## Dashboard Structure
- Single page app at {URL}
- 3 panels switchable via top tabs: Chat, Tasks, Proposals
- Tasks is the default panel
- Left side: task list, Right side: detail view
- Dark theme (background: #0d1117)
- Footer: stats bar with system metrics

## Key MCP Tools
- navigate_page: go to a URL
- click: click an element by uid from snapshot
- fill: type text into an input
- evaluate_script: run JS in the page (best for DOM checks)
- take_screenshot: capture the page
- press_key: press keyboard keys
- take_snapshot: get page accessibility snapshot with element uids

## Result Format
After ALL tests, respond with a JSON array (no markdown fences):
[{"id":"TC-001","pass":true,"evidence":"what you observed"}, ...]`;

function parseCsv(value) {
  if (!value) return [];
  return value
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
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
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
      continue;
    }
    if (arg === "--list-groups") {
      opts.listGroups = true;
      continue;
    }
    if (arg === "--watch") {
      opts.watch = true;
      continue;
    }
    if (arg === "--watch-on-change") {
      opts.watch = true;
      opts.watchOnChange = true;
      continue;
    }
    if (arg.startsWith("--watch-interval-ms=")) {
      opts.watch = true;
      opts.watchIntervalMs = Number(arg.slice("--watch-interval-ms=".length));
      continue;
    }
    if (arg === "--watch-interval-ms") {
      const r = readValue(arg, i);
      i = r.next;
      if (r.value) {
        opts.watch = true;
        opts.watchIntervalMs = Number(r.value);
      }
      continue;
    }
    if (arg.startsWith("--max-cycles=")) {
      opts.maxCycles = Number(arg.slice("--max-cycles=".length));
      continue;
    }
    if (arg === "--max-cycles") {
      const r = readValue(arg, i);
      i = r.next;
      if (r.value) opts.maxCycles = Number(r.value);
      continue;
    }
    if (arg.startsWith("--profile=")) {
      opts.profile = arg.slice("--profile=".length);
      continue;
    }
    if (arg === "--profile") {
      const r = readValue(arg, i);
      i = r.next;
      if (r.value) opts.profile = r.value;
      continue;
    }
    if (arg.startsWith("--layer=")) {
      opts.layer = arg.slice("--layer=".length);
      continue;
    }
    if (arg === "--layer") {
      const r = readValue(arg, i);
      i = r.next;
      if (r.value) opts.layer = r.value;
      continue;
    }
    if (arg.startsWith("--api-groups=")) {
      opts.apiGroups.push(...parseCsv(arg.slice("--api-groups=".length)));
      continue;
    }
    if (arg === "--api-groups") {
      const r = readValue(arg, i);
      i = r.next;
      if (r.value) opts.apiGroups.push(...parseCsv(r.value));
      continue;
    }
    if (arg.startsWith("--groups=") || arg.startsWith("--browser-groups=")) {
      const value = arg.startsWith("--groups=")
        ? arg.slice("--groups=".length)
        : arg.slice("--browser-groups=".length);
      opts.browserGroups.push(...parseCsv(value));
      continue;
    }
    if (arg === "--groups" || arg === "--browser-groups") {
      const r = readValue(arg, i);
      i = r.next;
      if (r.value) opts.browserGroups.push(...parseCsv(r.value));
      continue;
    }
    if (arg.startsWith("--ids=")) {
      opts.ids.push(...parseCsv(arg.slice("--ids=".length)));
      continue;
    }
    if (arg === "--ids") {
      const r = readValue(arg, i);
      i = r.next;
      if (r.value) opts.ids.push(...parseCsv(r.value));
      continue;
    }
    opts.unknown.push(`unknown option: ${arg}`);
  }

  return opts;
}

function readChangedFiles() {
  try {
    const out = execSync("git status --porcelain", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.slice(3).split(" -> ");
        return parts[parts.length - 1].trim();
      });
  } catch {
    return [];
  }
}

function inferChangedSelection(files) {
  const api = new Set();
  const browser = new Set();

  for (const file of files) {
    const f = file.toLowerCase();

    if (
      f.includes("browser-agent") ||
      f.includes("gemini-runner") ||
      f.includes("dashboard.test")
    ) {
      browser.add("Page Load");
      browser.add("Navigation");
      browser.add("Task CRUD");
      browser.add("Task Filter");
      browser.add("Proposals");
      browser.add("Daemon");
      browser.add("Toast");
      browser.add("Visual");
      continue;
    }

    if (f.includes("ucm-ui") || f.includes("dashboard")) {
      browser.add("Page Load");
      browser.add("Navigation");
      browser.add("Visual");
    }
    if (f.includes("proposal") || f.includes("observer")) {
      api.add("Proposals API");
      browser.add("Proposals");
    }
    if (f.includes("daemon") || f.includes("ucmd.js") || f.includes("ucmd-")) {
      api.add("Daemon Control");
      browser.add("Daemon");
    }
    if (f.includes("task") || f.includes("queue") || f.includes("forge/")) {
      api.add("Core Task API");
      api.add("Task Lifecycle");
      browser.add("Task CRUD");
      browser.add("Task Filter");
      browser.add("Toast");
    }
    if (f.includes("server") || f.includes("/api/")) {
      api.add("Local Endpoints");
      api.add("WebSocket Events");
    }
  }

  return { apiGroups: [...api], browserGroups: [...browser] };
}

function uniq(values) {
  return [...new Set(values)];
}

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

  if (!VALID_LAYERS.has(plan.layer)) {
    errors.push(`invalid --layer: ${plan.layer} (use all|api|browser)`);
  }
  if (!VALID_PROFILES.has(plan.profile)) {
    errors.push(
      `invalid --profile: ${plan.profile} (use full|release|smoke|changed)`,
    );
  }
  if (!Number.isFinite(raw.watchIntervalMs) || raw.watchIntervalMs <= 0) {
    errors.push(
      `invalid --watch-interval-ms: ${raw.watchIntervalMs} (must be > 0)`,
    );
  }
  if (!Number.isFinite(raw.maxCycles) || raw.maxCycles < 0) {
    errors.push(`invalid --max-cycles: ${raw.maxCycles} (must be >= 0)`);
  }
  if (plan.profile === "release") plan.profile = "full";

  if (plan.profile === "smoke" && plan.ids.length === 0) {
    plan.ids = SMOKE_BROWSER_IDS.slice();
  }

  if (
    plan.profile === "changed" &&
    plan.apiGroups.length === 0 &&
    plan.browserGroups.length === 0 &&
    plan.ids.length === 0
  ) {
    const inferred = inferChangedSelection(readChangedFiles());
    plan.apiGroups = inferred.apiGroups;
    plan.browserGroups = inferred.browserGroups;
    plan.inferredFromChanged = true;
    if (plan.apiGroups.length === 0 && plan.browserGroups.length === 0) {
      plan.ids = SMOKE_BROWSER_IDS.slice();
    }
  }

  const apiNameSet = new Set(apiGroupNames);
  const browserNameSet = new Set(browserGroupNames);
  const idSet = new Set(geminiTestCases.map((x) => x.id));

  const invalidApi = plan.apiGroups.filter((x) => !apiNameSet.has(x));
  const invalidBrowser = plan.browserGroups.filter(
    (x) => !browserNameSet.has(x),
  );
  const invalidIds = plan.ids.filter((x) => !idSet.has(x));
  if (invalidApi.length > 0)
    errors.push(`unknown api groups: ${invalidApi.join(", ")}`);
  if (invalidBrowser.length > 0)
    errors.push(`unknown browser groups: ${invalidBrowser.join(", ")}`);
  if (invalidIds.length > 0)
    errors.push(`unknown ids: ${invalidIds.join(", ")}`);

  if (plan.layer === "api") {
    plan.browserGroups = [];
    plan.ids = [];
  } else if (plan.layer === "browser") {
    plan.apiGroups = [];
  }

  return { plan, errors };
}

function printUsage(apiGroupNames, browserGroupNames) {
  console.log(`Dashboard test runner

Usage:
  node test/dashboard.test.js [options]

Options:
  --profile <full|release|smoke|changed>   Run profile (default: full)
  --layer <all|api|browser>                Which layer to run (default: all)
  --watch                                  Keep running in loop mode
  --watch-on-change                        Run loop only when git status changes
  --watch-interval-ms <ms>                 Loop interval in ms (default: 5000)
  --max-cycles <n>                         Stop after N cycles in watch mode (0=unlimited)
  --api-groups "A,B"                       API group filter
  --groups "A,B"                           Browser group filter (alias: --browser-groups)
  --ids "TC-001,TC-050"                    Browser test case id filter
  --list-groups                            Print available groups and exit
  --help                                   Show help
`);
  console.log(`API groups: ${apiGroupNames.join(", ")}`);
  console.log(`Browser groups: ${browserGroupNames.join(", ")}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resetState() {
  state.passed = 0;
  state.failed = 0;
  state.failures.length = 0;
}

function gitStatusSignature() {
  try {
    const out = execSync("git status --porcelain", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split("\n").filter(Boolean).sort().join("\n");
  } catch {
    return "";
  }
}

async function main() {
  const apiGroupNames = apiTestGroups.map((x) => x.name);
  const browserGroupNames = uniq(geminiTestCases.map((x) => x.group));
  const raw = parseArgs(process.argv.slice(2));

  if (raw.help) {
    printUsage(apiGroupNames, browserGroupNames);
    return;
  }

  if (raw.listGroups) {
    console.log("API groups:");
    apiGroupNames.forEach((x) => {
      console.log(`- ${x}`);
    });
    console.log("\nBrowser groups:");
    browserGroupNames.forEach((x) => {
      console.log(`- ${x}`);
    });
    return;
  }

  const initial = resolvePlan(raw, apiGroupNames, browserGroupNames);
  const { errors } = initial;
  if (errors.length > 0) {
    errors.forEach((x) => {
      console.error(`Error: ${x}`);
    });
    printUsage(apiGroupNames, browserGroupNames);
    process.exit(1);
  }

  const provider = (
    process.env.UCM_BROWSER_AGENT_PROVIDER || "codex"
  ).toLowerCase();
  const basePlan = initial.plan;
  const suiteTimeoutMs = raw.watch
    ? null
    : basePlan.layer === "api"
      ? 300_000
      : provider === "codex"
        ? 1_800_000
        : 600_000;
  if (suiteTimeoutMs) startSuiteTimer(suiteTimeoutMs);

  const env = new TestEnvironment("ucm-dashboard-test");
  let stopRequested = false;
  process.on("SIGINT", () => {
    stopRequested = true;
    if (raw.watch) console.log("\nStopping watch mode...");
  });

  console.log("Dashboard Test Suite\n");
  console.log(
    `Suite timeout: ${suiteTimeoutMs ? `${suiteTimeoutMs}ms` : "disabled (watch mode)"}`,
  );
  if (raw.watch) {
    console.log(
      `Watch mode: interval=${raw.watchIntervalMs}ms${raw.watchOnChange ? ", trigger=git-change" : ""}${raw.maxCycles > 0 ? `, maxCycles=${raw.maxCycles}` : ""}`,
    );
  }
  console.log("\nStarting daemon + UI server...");

  try {
    await env.startAll();
  } catch (e) {
    console.error("Failed to start infrastructure:", e.message);
    await env.cleanup();
    process.exit(1);
  }

  console.log(`UI server ready at ${env.url}\n`);

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
      console.log(
        `Execution plan: profile=${plan.profile}, layer=${plan.layer}`,
      );
      console.log(
        `API groups: ${plan.apiGroups.length > 0 ? plan.apiGroups.join(", ") : plan.layer === "browser" ? "(skipped)" : "all"}`,
      );
      console.log(
        `Browser groups: ${plan.browserGroups.length > 0 ? plan.browserGroups.join(", ") : plan.layer === "api" ? "(skipped)" : "all"}`,
      );
      console.log(
        `Browser ids: ${plan.ids.length > 0 ? plan.ids.join(", ") : plan.layer === "api" ? "(skipped)" : "all"}`,
      );
      if (plan.profile === "changed" && plan.inferredFromChanged) {
        console.log("Changed profile: inferred filters from git working tree");
      }

      // ── Layer 1: API Tests ──
      if (plan.layer !== "browser") {
        console.log("\n═══ Layer 1: API Tests ═══\n");
        const selectedApiGroups =
          plan.apiGroups.length > 0
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
      } else {
        console.log("\nLayer 1 skipped (--layer=browser)\n");
      }

      // ── Layer 2: Browser Agent E2E Tests (batched) ──
      if (plan.layer !== "api") {
        console.log("\n═══ Layer 2: Browser Agent E2E Tests (batched) ═══\n");
        const { GeminiRunner } = require("./helpers/gemini-runner.js");
        const runner = new GeminiRunner();
        try {
          console.log(
            `Starting browser runner (provider: ${runner.provider}, perTaskTimeoutMs: ${runner.perTaskTimeoutMs}, batchSize: ${runner.batchSize || "all"})...`,
          );
          await runner.start();
          console.log("Browser runner ready\n");

          const selectedCases = geminiTestCases.filter((tc) => {
            const groupOk =
              plan.browserGroups.length === 0 ||
              plan.browserGroups.includes(tc.group);
            const idOk = plan.ids.length === 0 || plan.ids.includes(tc.id);
            return groupOk && idOk;
          });

          if (selectedCases.length === 0) {
            console.log("No browser test cases selected; skipping Layer 2.");
          } else {
            const systemPrompt = SYSTEM_PROMPT.replace(/\{URL\}/g, env.url);
            const cases = selectedCases.map((tc) => ({
              ...tc,
              instruction: tc.instruction.replace(/\{URL\}/g, env.url),
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
                if (r?.pass) {
                  state.passed++;
                  process.stdout.write(".");
                } else {
                  state.failed++;
                  state.failures.push(
                    `${tc.id} ${tc.name}: ${r?.evidence?.slice(0, 200) || "no result"}`,
                  );
                  process.stdout.write("F");
                }
              }
              console.log();
            }
          }
        } catch (e) {
          console.error("Gemini runner error:", e.message);
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
  console.error("Dashboard test error:", e);
  process.exit(1);
});
