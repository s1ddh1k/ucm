const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  collectRecallContext,
  collectRepoContext,
  parseStagedHunks,
  readFocusedSymbols,
  readFocusedSnippets,
  readPathHistory,
  readRelatedReferences,
  readSymbolHistory,
} = require("../src/repo-context");
const { getRepoRoot, getStagedDiff, getStagedFiles } = require("../src/checks");
const { beginSession, recordSessionEvent } = require("../src/session-state");

async function withTempRepo(callback) {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tacit-context-"));
  try {
    execFileSync("git", ["init"], { cwd: repoRoot, stdio: "ignore" });
    await callback(repoRoot);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

test("parses staged hunk ranges by file", () => {
  const hunks = parseStagedHunks(`diff --git a/src/app.js b/src/app.js
index 1111111..2222222 100644
--- a/src/app.js
+++ b/src/app.js
@@ -10,0 +11,3 @@
+const value = 1;
+const next = 2;
+return value + next;
diff --git a/test/app.test.js b/test/app.test.js
index 3333333..4444444 100644
--- a/test/app.test.js
+++ b/test/app.test.js
@@ -1,0 +1,1 @@
+test("app", () => {});
`);

  assert.deepEqual(hunks.get("src/app.js"), [{ start: 11, end: 13 }]);
  assert.deepEqual(hunks.get("test/app.test.js"), [{ start: 1, end: 1 }]);
});

test("reads focused staged snippets around changed hunks", async () => {
  await withTempRepo(async (repoRoot) => {
    const srcDir = path.join(repoRoot, "src");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(
      path.join(srcDir, "math.js"),
      [
        "export function add(a, b) {",
        "  return a + b;",
        "}",
        "",
        "export function multiply(a, b) {",
        "  return a * b;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    execFileSync("git", ["add", "src/math.js"], { cwd: repoRoot, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "feat: seed math"], {
      cwd: repoRoot,
      stdio: "ignore",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Tacit",
        GIT_AUTHOR_EMAIL: "tacit@example.com",
        GIT_COMMITTER_NAME: "Tacit",
        GIT_COMMITTER_EMAIL: "tacit@example.com",
      },
    });

    fs.writeFileSync(
      path.join(srcDir, "math.js"),
      [
        "export function add(a, b) {",
        "  const left = Number(a);",
        "  const right = Number(b);",
        "  return left + right;",
        "}",
        "",
        "export function multiply(a, b) {",
        "  return a * b;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    execFileSync("git", ["add", "src/math.js"], { cwd: repoRoot, stdio: "ignore" });

    const resolvedRepoRoot = getRepoRoot(repoRoot);
    const stagedFiles = getStagedFiles(resolvedRepoRoot);
    const stagedDiff = getStagedDiff(resolvedRepoRoot);
    const snippets = readFocusedSnippets(resolvedRepoRoot, stagedFiles, stagedDiff);

    assert.equal(snippets.length, 1);
    assert.equal(snippets[0].path, "src/math.js");
    assert.match(snippets[0].windows[0].snippet, /const left = Number\(a\);/);
    assert.match(snippets[0].windows[0].snippet, /return left \+ right;/);
    assert.match(snippets[0].windows[0].snippet, /1 \| export function add/);
  });
});

test("prefers symbol extraction for JS changes", async () => {
  await withTempRepo(async (repoRoot) => {
    const srcDir = path.join(repoRoot, "src");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(
      path.join(srcDir, "cart.js"),
      [
        "export function computeTotal(items) {",
        "  return items.reduce((sum, item) => sum + item.price, 0);",
        "}",
        "",
        "export const formatTotal = (total) => {",
        "  return `$${total.toFixed(2)}`;",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );

    execFileSync("git", ["add", "src/cart.js"], { cwd: repoRoot, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "feat: seed cart"], {
      cwd: repoRoot,
      stdio: "ignore",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Tacit",
        GIT_AUTHOR_EMAIL: "tacit@example.com",
        GIT_COMMITTER_NAME: "Tacit",
        GIT_COMMITTER_EMAIL: "tacit@example.com",
      },
    });

    fs.writeFileSync(
      path.join(srcDir, "cart.js"),
      [
        "export function computeTotal(items) {",
        "  const prices = items.map((item) => Number(item.price));",
        "  return prices.reduce((sum, price) => sum + price, 0);",
        "}",
        "",
        "export const formatTotal = (total) => {",
        "  return `$${total.toFixed(2)}`;",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );

    execFileSync("git", ["add", "src/cart.js"], { cwd: repoRoot, stdio: "ignore" });

    const resolvedRepoRoot = getRepoRoot(repoRoot);
    const stagedFiles = getStagedFiles(resolvedRepoRoot);
    const stagedDiff = getStagedDiff(resolvedRepoRoot);
    const symbols = readFocusedSymbols(resolvedRepoRoot, stagedFiles, stagedDiff);

    assert.equal(symbols.length, 1);
    assert.equal(symbols[0].path, "src/cart.js");
    assert.equal(symbols[0].symbols[0].name, "computeTotal");
    assert.match(symbols[0].symbols[0].snippet, /const prices = items\.map/);
    assert.match(symbols[0].symbols[0].snippet, /return prices\.reduce/);
  });
});

test("finds related test and caller references for changed symbols", async () => {
  await withTempRepo(async (repoRoot) => {
    const srcDir = path.join(repoRoot, "src");
    const testDir = path.join(repoRoot, "test");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(testDir, { recursive: true });

    fs.writeFileSync(
      path.join(srcDir, "cart.js"),
      [
        "export function computeTotal(items) {",
        "  return items.reduce((sum, item) => sum + item.price, 0);",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(
      path.join(srcDir, "checkout.js"),
      [
        "import { computeTotal } from \"./cart.js\";",
        "",
        "export function checkout(items) {",
        "  return computeTotal(items);",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(
      path.join(testDir, "cart.test.js"),
      [
        "import { computeTotal } from \"../src/cart.js\";",
        "",
        "if (computeTotal([{ price: 2 }, { price: 3 }]) !== 5) {",
        "  throw new Error(\"fail\");",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    execFileSync("git", ["add", "."], { cwd: repoRoot, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "feat: seed cart"], {
      cwd: repoRoot,
      stdio: "ignore",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Tacit",
        GIT_AUTHOR_EMAIL: "tacit@example.com",
        GIT_COMMITTER_NAME: "Tacit",
        GIT_COMMITTER_EMAIL: "tacit@example.com",
      },
    });

    fs.writeFileSync(
      path.join(srcDir, "cart.js"),
      [
        "export function computeTotal(items) {",
        "  const prices = items.map((item) => Number(item.price));",
        "  return prices.reduce((sum, price) => sum + price, 0);",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    execFileSync("git", ["add", "src/cart.js"], { cwd: repoRoot, stdio: "ignore" });

    const resolvedRepoRoot = getRepoRoot(repoRoot);
    const stagedFiles = getStagedFiles(resolvedRepoRoot);
    const stagedDiff = getStagedDiff(resolvedRepoRoot);
    const symbols = readFocusedSymbols(resolvedRepoRoot, stagedFiles, stagedDiff);
    const related = readRelatedReferences(resolvedRepoRoot, symbols);

    assert.ok(related.some((item) => item.path === "test/cart.test.js" && item.kind === "test"));
    assert.ok(related.some((item) => item.path === "src/checkout.js" && item.kind === "caller"));
    assert.ok(related.every((item) => item.symbol === "computeTotal"));
  });
});

test("recalls session residue and git history by path and symbol", async () => {
  await withTempRepo(async (repoRoot) => {
    const srcDir = path.join(repoRoot, "src");
    fs.mkdirSync(srcDir, { recursive: true });

    fs.writeFileSync(
      path.join(srcDir, "cart.js"),
      [
        "export function computeTotal(items) {",
        "  return items.reduce((sum, item) => sum + item.price, 0);",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    execFileSync("git", ["add", "src/cart.js"], { cwd: repoRoot, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "feat: seed cart"], {
      cwd: repoRoot,
      stdio: "ignore",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Tacit",
        GIT_AUTHOR_EMAIL: "tacit@example.com",
        GIT_COMMITTER_NAME: "Tacit",
        GIT_COMMITTER_EMAIL: "tacit@example.com",
      },
    });

    beginSession(repoRoot, {
      intent: "Preserve commit rationale in git history",
    });
    recordSessionEvent(repoRoot, {
      type: "decision",
      summary: "Use session scratchpad instead of branch memory.",
      paths: ["src/cart.js"],
      symbols: ["computeTotal"],
    });

    const recall = collectRecallContext(repoRoot, {
      paths: ["src/cart.js"],
      symbols: ["computeTotal"],
    });

    assert.equal(recall.session.intent, "Preserve commit rationale in git history");
    assert.ok(recall.session.events.some((event) => event.type === "decision"));
    assert.ok(recall.pathHistory.some((entry) => entry.subject === "feat: seed cart"));
    assert.ok(
      recall.symbolHistory.some(
        (entry) => entry.subject === "feat: seed cart" && entry.symbol === "computeTotal",
      ),
    );
  });
});

test("collects session residue and path history for staged files", async () => {
  await withTempRepo(async (repoRoot) => {
    const srcDir = path.join(repoRoot, "src");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(
      path.join(srcDir, "service.js"),
      [
        "export function run() {",
        "  return true;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    execFileSync("git", ["add", "src/service.js"], { cwd: repoRoot, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "feat: seed service"], {
      cwd: repoRoot,
      stdio: "ignore",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Tacit",
        GIT_AUTHOR_EMAIL: "tacit@example.com",
        GIT_COMMITTER_NAME: "Tacit",
        GIT_COMMITTER_EMAIL: "tacit@example.com",
      },
    });

    beginSession(repoRoot, {
      intent: "Keep service changes explainable",
    });
    recordSessionEvent(repoRoot, {
      type: "attempt",
      summary: "Avoid branch-based retrieval keys.",
      paths: ["src/service.js"],
      symbols: ["run"],
    });

    fs.writeFileSync(
      path.join(srcDir, "service.js"),
      [
        "export function run() {",
        "  return Number(true);",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    execFileSync("git", ["add", "src/service.js"], { cwd: repoRoot, stdio: "ignore" });

    const resolvedRepoRoot = getRepoRoot(repoRoot);
    const stagedFiles = getStagedFiles(resolvedRepoRoot);
    const stagedDiff = getStagedDiff(resolvedRepoRoot);
    const context = collectRepoContext(resolvedRepoRoot, stagedFiles, { stagedDiff });

    assert.equal(context.session.intent, "Keep service changes explainable");
    assert.ok(context.session.events.some((event) => event.type === "attempt"));
    assert.ok(context.pathHistory.some((entry) => entry.subject === "feat: seed service"));
  });
});
