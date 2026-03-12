const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// IMPORTANT: setup must happen before requiring hivemind modules
// store.js reads process.env.HIVEMIND_DIR at module load time
const { setupTestDir, cleanupTestDir } = require("./helpers/setup");
const testDir = setupTestDir();

const store = require("../lib/hivemind/store");
const indexer = require("../lib/hivemind/indexer");
const { decayScore } = require("../lib/hivemind/search");
const extract = require("../lib/hivemind/extract");
const lifecycle = require("../lib/hivemind/lifecycle");
const document = require("../lib/hivemind/adapters/document");
const { extractJson, buildLlmCallOptions } = require("../lib/hivemind/llm");
const daemon = require("../lib/hivemind/daemon");

// --- Test infrastructure ---

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (condition) {
    passed++;
    process.stdout.write(".");
  } else {
    failed++;
    failures.push(message);
    process.stdout.write("F");
  }
}

function assertEqual(actual, expected, message) {
  if (actual === expected) {
    passed++;
    process.stdout.write(".");
  } else {
    failed++;
    failures.push(
      `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
    process.stdout.write("F");
  }
}

function assertDeepEqual(actual, expected, message) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++;
    process.stdout.write(".");
  } else {
    failed++;
    failures.push(
      `${message}:\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`,
    );
    process.stdout.write("F");
  }
}

// --- Store tests ---

function testSaveLoadConfig() {
  const custom = {
    ...store.DEFAULT_CONFIG,
    decayDays: 14,
    models: { ...store.DEFAULT_CONFIG.models, retrieval: "claude-sonnet-4-6" },
  };
  store.saveConfig(custom);
  const loaded = store.loadConfig();
  assertEqual(loaded.decayDays, 14, "config: custom decayDays preserved");
  assertEqual(
    loaded.models.retrieval,
    "claude-sonnet-4-6",
    "config: custom model preserved",
  );
  assertEqual(
    loaded.models.extraction,
    store.DEFAULT_CONFIG.models.extraction,
    "config: deep merge keeps default model slots",
  );

  // Restore original config
  store.saveConfig(store.DEFAULT_CONFIG);
}

function testGenerateUniqueId() {
  const ids = new Set();
  for (let i = 0; i < 100; i++) {
    ids.add(store.generateUniqueId());
  }
  assertEqual(ids.size, 100, "generateUniqueId: 100 IDs are unique");
}

function testZettelYamlRoundtrip() {
  const zettel = {
    id: "yaml-test-001",
    kind: "literature",
    title: "한글 제목 with English",
    keywords: { 한글키: 3, "english-key": 2, "@transactional": 1 },
    links: ["t001", "t002"],
    createdAt: "2026-02-18T00:00:00.000Z",
    lastAccessed: "2026-02-18T00:00:00.000Z",
    boostCount: 0,
    body: "한글 본문 with English content.\n\nSecond paragraph.",
  };

  store.saveZettel(zettel);
  const loaded = store.loadZettel("yaml-test-001");

  assert(loaded !== null, "yaml roundtrip: loaded");
  assertEqual(loaded.title, zettel.title, "yaml roundtrip: title");
  assertEqual(loaded.keywords.한글키, 3, "yaml roundtrip: Korean key weight");
  assertEqual(
    loaded.keywords["english-key"],
    2,
    "yaml roundtrip: English key weight",
  );
  assertEqual(
    loaded.keywords["@transactional"],
    1,
    "yaml roundtrip: special char key",
  );
  assertDeepEqual(loaded.links, ["t001", "t002"], "yaml roundtrip: links");
  assert(
    loaded.body.includes("Second paragraph"),
    "yaml roundtrip: body preserved",
  );

  store.deleteZettel("yaml-test-001");
}

function testZettelCrud() {
  const now = new Date().toISOString();
  const zettel = {
    id: "crud-test-001",
    kind: "fleeting",
    title: "CRUD test zettel",
    keywords: { test: 3 },
    links: [],
    createdAt: now,
    lastAccessed: now,
    boostCount: 0,
    body: "Test body content",
  };

  const filePath = store.saveZettel(zettel);
  assert(fs.existsSync(filePath), "zettel save: file created");

  const loaded = store.loadZettel("crud-test-001");
  assert(loaded !== null, "zettel load: found");
  assertEqual(loaded.title, "CRUD test zettel", "zettel load: title matches");

  const deleted = store.deleteZettel("crud-test-001");
  assertEqual(deleted, true, "zettel delete: returns true");
  assertEqual(
    store.loadZettel("crud-test-001"),
    null,
    "zettel delete: no longer loadable",
  );
  assertEqual(
    store.deleteZettel("nonexistent"),
    false,
    "zettel delete nonexistent: returns false",
  );
}

function testArchiveRestore() {
  const now = new Date().toISOString();
  const zettel = {
    id: "archive-test-001",
    kind: "literature",
    title: "Archive test",
    keywords: { test: 3 },
    links: [],
    createdAt: now,
    lastAccessed: now,
    boostCount: 0,
    body: "Archive test body",
  };

  store.saveZettel(zettel);

  const archived = store.archiveZettel("archive-test-001");
  assertEqual(archived, true, "archive: returns true");
  assertEqual(
    store.loadZettel("archive-test-001"),
    null,
    "archive: not in zettel dir",
  );
  assert(
    fs.existsSync(path.join(store.ARCHIVE_DIR, "archive-test-001.md")),
    "archive: file in archive dir",
  );

  const restored = store.restoreZettel("archive-test-001");
  assertEqual(restored, true, "restore: returns true");
  assert(
    store.loadZettel("archive-test-001") !== null,
    "restore: back in zettel dir",
  );

  store.deleteZettel("archive-test-001");
}

function testListZettels() {
  const all = store.listZettels();
  assertEqual(all.length, 31, "listZettels: 31 fixtures");

  const permanent = store.listZettels({ kind: "permanent" });
  assertEqual(permanent.length, 1, "listZettels kind=permanent: 1 (t019)");
  assertEqual(permanent[0].id, "t019", "listZettels permanent: id is t019");

  const limited = store.listZettels({ limit: 5 });
  assertEqual(limited.length, 5, "listZettels limit=5: returns 5");
}

function testValidateConfig() {
  const validWarnings = store.validateConfig(store.DEFAULT_CONFIG);
  assertEqual(validWarnings.length, 0, "validateConfig valid: no warnings");

  const invalid = {
    models: { retrieval: "gpt-4" },
    adapters: { unknown: { enabled: true } },
    decayDays: 0,
    minKeep: -1,
  };
  const warnings = store.validateConfig(invalid);
  assert(warnings.length >= 3, "validateConfig invalid: multiple warnings");
  assert(
    warnings.some((w) => w.includes("models.retrieval")),
    "validateConfig: invalid model warning",
  );
  assert(
    warnings.some((w) => w.includes("unknown")),
    "validateConfig: unknown adapter warning",
  );
  assert(
    warnings.some((w) => w.includes("decayDays")),
    "validateConfig: decayDays range warning",
  );

  const codexValid = {
    ...store.DEFAULT_CONFIG,
    llmProvider: "codex",
    models: {
      retrieval: "low",
      extraction: "medium",
      dedup: "gpt-5-mini",
      consolidation: "high",
    },
  };
  const codexWarnings = store.validateConfig(codexValid);
  assertEqual(
    codexWarnings.length,
    0,
    "validateConfig codex: codex models accepted",
  );

  const codexInvalid = {
    ...codexValid,
    models: { ...codexValid.models, retrieval: "claude-sonnet-4-6" },
  };
  const codexInvalidWarnings = store.validateConfig(codexInvalid);
  assert(
    codexInvalidWarnings.some((w) => w.includes("models.retrieval")),
    "validateConfig codex: claude model rejected",
  );
}

// --- Indexer tests ---

function testBuildFromDisk() {
  const result = indexer.buildFromDisk();
  assertEqual(result.zettels, 31, "buildFromDisk: 31 zettels");
  assert(result.keywords > 0, "buildFromDisk: keywords > 0");
}

function testIndexUnindexZettel() {
  const countBefore = indexer.getAllEntries().length;
  const zettel = {
    id: "index-test-001",
    kind: "literature",
    title: "Index test zettel",
    keywords: { "index-test": 3 },
    links: [],
    createdAt: new Date().toISOString(),
    lastAccessed: new Date().toISOString(),
    boostCount: 0,
    body: "Index test body",
  };

  indexer.indexZettel(zettel);
  assertEqual(
    indexer.getAllEntries().length,
    countBefore + 1,
    "indexZettel: count +1",
  );

  indexer.unindexZettel("index-test-001");
  assertEqual(
    indexer.getAllEntries().length,
    countBefore,
    "unindexZettel: count restored",
  );
}

function testBm25Search() {
  const enResults = indexer.bm25Search(["kubernetes"]);
  assert(enResults.length > 0, "bm25 English: results found");
  assert(
    enResults.some((r) => r.id === "t019"),
    "bm25 English: t019 (kubernetes)",
  );

  const krResults = indexer.bm25Search(["트랜잭션"]);
  assert(krResults.length > 0, "bm25 Korean: results found");
}

function testLookupKeywords() {
  const results = indexer.lookupKeywords(["kubernetes", "cronjob"]);
  assert(results.length > 0, "lookupKeywords: results found");
  assertEqual(results[0].id, "t019", "lookupKeywords: t019 is top match");
}

function testTokenize() {
  const tokens = indexer.tokenize("Hello World 한글 테스트");
  assert(tokens.includes("hello"), "tokenize: lowercase english");
  assert(tokens.includes("한글"), "tokenize: korean preserved");
  assert(tokens.includes("테스트"), "tokenize: korean word");
  assertEqual(tokens.length, 4, "tokenize: 4 tokens");
}

// --- Search tests ---

function testDecayScore() {
  const now = new Date().toISOString();
  const recent = decayScore(now, 0, 30);
  assert(recent > 0.95, "decay recent: close to 1");

  const old = new Date(Date.now() - 60 * 86400_000).toISOString();
  const oldScore = decayScore(old, 0, 30);
  assert(oldScore < recent, "decay old: lower than recent");
  assert(oldScore < 0.5, "decay 60 days: below 0.5");

  const boosted = decayScore(old, 5, 30);
  assert(boosted > oldScore, "decay boosted: higher than unboosted");
}

// --- Extract tests ---

function testTitleTokensJaccard() {
  const tokensA = extract.titleTokens("Spring @Transactional 버그");
  assert(tokensA.has("spring"), "titleTokens: lowercase");
  assert(tokensA.has("버그"), "titleTokens: Korean");

  const tokensB = extract.titleTokens("Spring Transaction 문제");
  const sim = extract.jaccardSimilarity(tokensA, tokensB);
  assert(sim > 0, "jaccard: some overlap (spring)");
  assert(sim < 1, "jaccard: not identical");

  assertEqual(
    extract.jaccardSimilarity(tokensA, tokensA),
    1,
    "jaccard identical: 1",
  );

  const tokensC = extract.titleTokens("completely different words here");
  assertEqual(
    extract.jaccardSimilarity(tokensA, tokensC),
    0,
    "jaccard disjoint: 0",
  );
}

function testCharBigrams() {
  const bigrams = extract.charBigrams("hivemind 구조");
  assert(bigrams instanceof Set, "charBigrams returns Set");
  assert(bigrams.has("hi"), "charBigrams: 'hi'");
  assert(bigrams.has("구조"), "charBigrams: '구조'");
  assert(!bigrams.has(" "), "charBigrams: no space");

  // similarity: same text = 1
  const a = extract.charBigrams("hivemind test");
  assertEqual(extract.jaccardSimilarity(a, a), 1, "charBigrams identical: 1");

  // similar titles should have high similarity
  const t1 = extract.charBigrams("hivemind 구조 재설계 facts-only");
  const t2 = extract.charBigrams("hivemind 구조 재설계 claims 규칙");
  const sim = extract.jaccardSimilarity(t1, t2);
  assert(sim > 0.3, `charBigrams similar titles: ${sim.toFixed(3)} > 0.3`);

  // completely different = low
  const t3 = extract.charBigrams("completely unrelated text here");
  const sim2 = extract.jaccardSimilarity(t1, t3);
  assert(sim2 < 0.1, `charBigrams disjoint: ${sim2.toFixed(3)} < 0.1`);
}

function testNormalizedKwSet() {
  // spacing normalization
  const set1 = extract.normalizedKwSet(["재귀오염", "codex 파서"]);
  const set2 = extract.normalizedKwSet(["재귀 오염", "codex 하네스"]);
  assert(set1.has("재귀오염"), "normalizedKwSet: joined form");
  assert(set2.has("재귀오염"), "normalizedKwSet: space stripped → same");

  // token splitting
  assert(set1.has("codex"), "normalizedKwSet: token 'codex'");
  assert(set1.has("파서"), "normalizedKwSet: token '파서'");

  // jaccard should be > 0 due to shared tokens
  const sim = extract.jaccardSimilarity(set1, set2);
  assert(sim > 0, `normalizedKwSet jaccard: ${sim.toFixed(3)} > 0`);

  // empty input
  const empty = extract.normalizedKwSet([]);
  assertEqual(empty.size, 0, "normalizedKwSet empty: size 0");
}

function testBodyOverlapDeduplicateBody() {
  const body1 =
    "This is the first paragraph with enough words to pass the thirty character minimum threshold easily for testing.";
  const body2 =
    "This is the first paragraph with enough words to pass the thirty character minimum threshold easily for testing.";
  const overlap = extract.bodyOverlap(body1, body2);
  assertEqual(overlap, 1, "bodyOverlap identical: 1");

  const different =
    "Completely different content that has no overlap whatsoever with the original text at all really.";
  const noOverlap = extract.bodyOverlap(body1, different);
  assert(noOverlap < 0.5, "bodyOverlap different: low");

  const dupBody = [
    "First section content that is long enough to pass the thirty character minimum threshold.",
    "First section content that is long enough to pass the thirty character minimum threshold.",
    "Unique second section content that is definitely long enough to be checked for dedup.",
  ].join("\n\n---\n\n");
  const deduped = extract.deduplicateBody(dupBody);
  assert(
    !deduped.includes("---"),
    "deduplicateBody: duplicate section removed",
  );
  assert(
    deduped.includes("Unique second"),
    "deduplicateBody: unique section kept",
  );
}

function testCoreKeywordsExtractKeywords() {
  const keywords = { spring: 3, "race-condition": 3, zookeeper: 2, test: 1 };
  const core = extract.coreKeywords(keywords);
  assert(core.includes("spring"), "coreKeywords: includes weight 3");
  assert(core.includes("race-condition"), "coreKeywords: includes weight 3");
  assert(!core.includes("zookeeper"), "coreKeywords: excludes weight 2");
  assertEqual(core.length, 2, "coreKeywords: correct count");

  const extracted = extract.extractKeywordsFromText(
    "Kubernetes CronJob",
    "CronJob scheduling structure and concurrency policy explanation in detail",
  );
  assert(extracted.length > 0, "extractKeywordsFromText: returns keywords");
  assert(
    extracted.includes("cronjob"),
    "extractKeywordsFromText: contains cronjob",
  );
}

function testDeduplicateBatch() {
  const zettels = [
    {
      title: "Spring Transactional race condition bug pattern",
      keywords: { spring: 3, "race-condition": 3, transactional: 2 },
      body: "The longer and more detailed first version of the zettel about spring transactional race condition issues with full context and description.",
    },
    {
      title: "Spring Transactional race condition",
      keywords: { spring: 3, "race-condition": 3, bug: 2 },
      body: "Shorter second version about the same topic.",
    },
    {
      title: "Kubernetes CronJob scheduling",
      keywords: { kubernetes: 3, cronjob: 3, scheduling: 2 },
      body: "Completely different topic about kubernetes scheduling.",
    },
  ];

  const result = extract.deduplicateBatch(zettels);
  assertEqual(result.length, 2, "deduplicateBatch: merged duplicate pair");
  assert(
    result.some((z) => z.title.includes("Kubernetes")),
    "deduplicateBatch: kept unique zettel",
  );
}

// --- Lifecycle tests ---

function testRunGcDryRun() {
  // With 31 fixtures and minKeep=50 (from setup.js config), GC should skip
  const result = lifecycle.runGc({ dryRun: true });
  assertEqual(result.archived, 0, "gc dry-run minKeep: nothing archived");
  assertEqual(result.total, 31, "gc dry-run: total is 31");
}

function testCleanupAll() {
  const zettel = {
    id: "cleanup-test",
    kind: "literature",
    title: "Cleanup test",
    keywords: { a: 3, b: 3, c: 3, d: 2, e: 2, f: 2, g: 1, h: 1, i: 1, j: 1 },
    links: [],
    createdAt: new Date().toISOString(),
    lastAccessed: new Date().toISOString(),
    boostCount: 0,
    body: [
      "Cleanup test body section one with enough text to pass the threshold.",
      "Cleanup test body section one with enough text to pass the threshold.",
      "Cleanup test body section two is different and has enough text to count.",
    ].join("\n\n---\n\n"),
  };
  store.saveZettel(zettel);
  indexer.indexZettel(zettel);

  const result = lifecycle.cleanupAll({});
  assert(result.kwFixed >= 1, "cleanupAll: keyword cap applied");

  const loaded = store.loadZettel("cleanup-test");
  assert(
    Object.keys(loaded.keywords).length <= 8,
    "cleanupAll: keywords capped at 8",
  );

  store.deleteZettel("cleanup-test");
  indexer.unindexZettel("cleanup-test");
}

function testDedupAll() {
  const now = new Date().toISOString();
  const z1 = {
    id: "dedup-a",
    kind: "literature",
    title: "Spring Transactional race condition",
    keywords: { spring: 3, "race-condition": 3, transactional: 3 },
    links: [],
    createdAt: now,
    lastAccessed: now,
    boostCount: 0,
    body: "First version about spring transactional race condition pattern with enough detail.",
  };
  const z2 = {
    id: "dedup-b",
    kind: "literature",
    title: "Spring Transactional race condition bug",
    keywords: { spring: 3, "race-condition": 3, transactional: 3, bug: 2 },
    links: [],
    createdAt: now,
    lastAccessed: now,
    boostCount: 0,
    body: "Second more detailed version about spring transactional race condition bug pattern with extra information and context.",
  };
  store.saveZettel(z1);
  store.saveZettel(z2);
  indexer.indexZettel(z1);
  indexer.indexZettel(z2);

  const before = indexer.getAllEntries().length;
  const result = lifecycle.dedupAll({});
  assert(result.merged >= 1, "dedupAll: at least 1 merge");
  assert(
    indexer.getAllEntries().length < before,
    "dedupAll: entry count decreased",
  );

  store.deleteZettel("dedup-a");
  store.deleteZettel("dedup-b");
  indexer.unindexZettel("dedup-a");
  indexer.unindexZettel("dedup-b");
}

// --- Document adapter tests ---

async function testDocumentScanRead() {
  const docDir = path.join(testDir, "docs-test");
  fs.mkdirSync(docDir, { recursive: true });

  fs.writeFileSync(
    path.join(docDir, "test-doc.md"),
    [
      "# Main Title",
      "",
      "Intro paragraph that is long enough to pass the hundred character minimum and contains meaningful content about testing documents.",
      "",
      "## Section One",
      "",
      "This section has enough content to pass the minimum threshold of one hundred characters and discusses the first topic in detail here.",
      "",
      "## Section Two",
      "",
      "Another section that is also long enough and discusses a completely different topic with sufficient length to pass the threshold easily.",
    ].join("\n"),
  );
  fs.writeFileSync(path.join(docDir, "empty.md"), "");
  fs.writeFileSync(path.join(docDir, "short.md"), "Too short.");

  // Scan: empty files (size 0) skipped, non-empty files found
  const items = await document.scan({}, { dirs: [docDir] });
  assertEqual(
    items.length,
    2,
    "document scan: 2 non-empty files (empty.md skipped)",
  );

  // Read: sections split by ## headers
  const testDocItem = items.find((i) => i.ref === "test-doc.md");
  assert(testDocItem !== undefined, "document scan: test-doc.md found");

  const chunks = await document.read(testDocItem);
  assert(
    chunks.length >= 2,
    "document read: multiple sections from ## headers",
  );
  assert(
    chunks[0].metadata.adapter === "document",
    "document read: metadata.adapter",
  );
  assert(
    chunks[0].metadata.ref === "test-doc.md",
    "document read: metadata.ref",
  );

  // Short file returns no chunks (content < 100 chars)
  const shortItem = items.find((i) => i.ref === "short.md");
  if (shortItem) {
    const shortChunks = await document.read(shortItem);
    assertEqual(
      shortChunks.length,
      0,
      "document read: short file returns no chunks",
    );
  }

  fs.rmSync(docDir, { recursive: true });
}

async function testCodexAdapterReadCurrentSchema() {
  const fakeHome = fs.mkdtempSync(
    path.join(os.tmpdir(), "hivemind-codex-home-"),
  );
  const sessionDir = path.join(
    fakeHome,
    ".codex",
    "sessions",
    "2026",
    "02",
    "16",
  );
  fs.mkdirSync(sessionDir, { recursive: true });
  const sessionPath = path.join(sessionDir, "test-session.jsonl");

  const longUserText = "사용자 요청 문장입니다. ".repeat(80).trim();
  const longAssistantText = "어시스턴트 응답 문장입니다. ".repeat(80).trim();
  const longReasoningText = "중간 추론 문장입니다. ".repeat(80).trim();
  const lines = [
    JSON.stringify({ type: "session_meta", payload: { id: "sess-001" } }),
    JSON.stringify({
      type: "event_msg",
      payload: { type: "user_message", message: longUserText },
    }),
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: longAssistantText }],
      },
    }),
    JSON.stringify({
      type: "event_msg",
      payload: { type: "agent_reasoning", text: longReasoningText },
    }),
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: longUserText }],
      },
    }),
    "",
  ];
  fs.writeFileSync(sessionPath, lines.join("\n"));

  const prevHome = process.env.HOME;
  process.env.HOME = fakeHome;
  const modulePath = require.resolve("../lib/hivemind/adapters/codex");
  delete require.cache[modulePath];
  const codex = require("../lib/hivemind/adapters/codex");

  try {
    const items = await codex.scan({});
    assertEqual(items.length, 1, "codex scan: found session file");

    const chunks = await codex.read(items[0]);
    assertEqual(chunks.length, 1, "codex read: generated one chunk");
    assert(chunks[0].text.includes("[user]"), "codex read: includes user role");
    assert(
      chunks[0].text.includes("[assistant]"),
      "codex read: includes assistant role",
    );
    assert(
      chunks[0].text.includes("[reasoning]"),
      "codex read: includes reasoning role",
    );
  } finally {
    process.env.HOME = prevHome;
    delete require.cache[modulePath];
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }
}

// --- LLM utility tests ---

function testBuildLlmCallOptions() {
  const codex = buildLlmCallOptions({ provider: "codex", model: "high" });
  assertEqual(codex.provider, "codex", "buildLlmCallOptions codex: provider");
  assertEqual(
    codex.outputFormat,
    "text",
    "buildLlmCallOptions codex: output text",
  );

  const claude = buildLlmCallOptions({
    provider: "claude",
    model: "claude-sonnet-4-6",
  });
  assertEqual(
    claude.provider,
    "claude",
    "buildLlmCallOptions claude: provider",
  );
  assertEqual(
    claude.outputFormat,
    "stream-json",
    "buildLlmCallOptions claude: stream-json",
  );

  const fallback = buildLlmCallOptions({ provider: "unknown" });
  assertEqual(
    fallback.provider,
    "claude",
    "buildLlmCallOptions fallback: claude",
  );
}

function testExtractJson() {
  const codeBlock = 'Some text\n```json\n{"key": "value"}\n```\nMore text';
  assertDeepEqual(
    extractJson(codeBlock),
    { key: "value" },
    "extractJson code block",
  );

  const direct = '{"hello": "world"}';
  assertDeepEqual(
    extractJson(direct),
    { hello: "world" },
    "extractJson direct object",
  );

  const array = '[{"a": 1}, {"b": 2}]';
  assertDeepEqual(
    extractJson(array),
    [{ a: 1 }, { b: 2 }],
    "extractJson array",
  );

  const embedded =
    'Here is the result: {"verdict": "MERGE", "reason": "same topic"} end';
  assertDeepEqual(
    extractJson(embedded),
    { verdict: "MERGE", reason: "same topic" },
    "extractJson embedded object",
  );

  let threw = false;
  try {
    extractJson("no json here at all");
  } catch {
    threw = true;
  }
  assert(threw, "extractJson invalid: throws");
}

function testDaemonQueueRefIndex() {
  daemon._test.resetQueueForTests();

  const first = { ref: "doc/a.md", mtime: 100 };
  const duplicate = { ref: "doc/a.md", mtime: 101 };
  const second = { ref: "doc/b.md", mtime: 200 };

  assertEqual(
    daemon._test.enqueueUniqueItem("document", first),
    true,
    "daemon queue index: first enqueue accepted",
  );
  assertEqual(
    daemon._test.enqueueUniqueItem("document", duplicate),
    false,
    "daemon queue index: duplicate ref rejected",
  );
  assertEqual(
    daemon._test.enqueueUniqueItem("document", second),
    true,
    "daemon queue index: second unique enqueue accepted",
  );
  assertEqual(
    daemon._test.getQueueLength(),
    2,
    "daemon queue index: queue length tracks unique refs",
  );
  assertEqual(
    daemon._test.getQueueRefCount(),
    2,
    "daemon queue index: ref set tracks queue entries",
  );

  const firstBatch = daemon._test.dequeueBatch(1);
  assertEqual(
    firstBatch.length,
    1,
    "daemon queue index: dequeue returns requested batch size",
  );
  assertEqual(
    firstBatch[0].ref,
    "doc/a.md",
    "daemon queue index: dequeue preserves queue order",
  );
  assertEqual(
    daemon._test.getQueueLength(),
    1,
    "daemon queue index: queue length decremented after dequeue",
  );
  assertEqual(
    daemon._test.getQueueRefCount(),
    1,
    "daemon queue index: ref set decremented after dequeue",
  );

  assertEqual(
    daemon._test.enqueueUniqueItem("document", duplicate),
    true,
    "daemon queue index: ref can be re-enqueued after dequeue",
  );
  assertEqual(
    daemon._test.getQueueLength(),
    2,
    "daemon queue index: queue length updated after re-enqueue",
  );
  assertEqual(
    daemon._test.getQueueRefCount(),
    2,
    "daemon queue index: ref set updated after re-enqueue",
  );

  daemon._test.resetQueueForTests();
}

// --- Main ---

async function main() {
  console.log("Hivemind Test Suite\n");

  console.log("Store Tests:");
  testSaveLoadConfig();
  testGenerateUniqueId();
  testZettelYamlRoundtrip();
  testZettelCrud();
  testArchiveRestore();
  testListZettels();
  testValidateConfig();
  console.log();

  console.log("Indexer Tests:");
  testBuildFromDisk();
  testIndexUnindexZettel();
  testBm25Search();
  testLookupKeywords();
  testTokenize();
  console.log();

  console.log("Search Tests:");
  testDecayScore();
  console.log();

  console.log("Extract Tests:");
  testTitleTokensJaccard();
  testCharBigrams();
  testNormalizedKwSet();
  testBodyOverlapDeduplicateBody();
  testCoreKeywordsExtractKeywords();
  testDeduplicateBatch();
  console.log();

  console.log("Lifecycle Tests:");
  testRunGcDryRun();
  testCleanupAll();
  testDedupAll();
  console.log();

  console.log("Document Adapter Tests:");
  await testDocumentScanRead();
  console.log();

  console.log("Codex Adapter Tests:");
  await testCodexAdapterReadCurrentSchema();
  console.log();

  console.log("LLM Utility Tests:");
  testBuildLlmCallOptions();
  testExtractJson();
  testDaemonQueueRefIndex();
  console.log();

  // Cleanup
  indexer.close();
  cleanupTestDir(testDir);

  // Summary
  console.log(`\n${passed + failed} tests, ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const f of failures) {
      console.log(`  - ${f}`);
    }
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`\nTest error: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
