#!/usr/bin/env node
const path = require("node:path");
const os = require("node:os");
const { mkdtemp, mkdir, writeFile, rm, utimes } = require("node:fs/promises");
const {
  startSuiteTimer,
  stopSuiteTimer,
  assert,
  assertEqual,
  runGroup,
  summary,
} = require("./harness");

const { PROXY_ROUTES } = require("../lib/ucm-ui-server");
const documentAdapter = require("../lib/hivemind/adapters/document");

startSuiteTimer(15_000);

async function main() {
  await runGroup("proxy route param precedence", {
    "route path params cannot be overridden by body fields": () => {
      const cases = [
        {
          method: "approve",
          urlPath: "/api/approve/a1b2c3d4",
          paramKey: "taskId",
          expected: "a1b2c3d4",
        },
        {
          method: "proposal_priority",
          urlPath: "/api/proposal/priority/p-deadbeef",
          paramKey: "proposalId",
          expected: "p-deadbeef",
        },
        {
          method: "stage_gate_reject",
          urlPath: "/api/stage-gate/reject/forge-20260101-abcd",
          paramKey: "taskId",
          expected: "forge-20260101-abcd",
        },
      ];

      for (const item of cases) {
        const route = PROXY_ROUTES.find((entry) => entry.method === item.method);
        assert(route, `${item.method} route exists`);
        const match = item.urlPath.match(route.pattern);
        assert(match, `${item.method} route matches test path`);
        const params = route.params({}, match, {
          [item.paramKey]: "overridden-by-body",
          keep: true,
        });
        assertEqual(
          params[item.paramKey],
          item.expected,
          `${item.method} keeps route parameter`,
        );
        assertEqual(params.keep, true, `${item.method} preserves non-id fields`);
      }
    },
  });

  await runGroup("hivemind document adapter", {
    "scan/read behavior remains stable with nested markdown files": async () => {
      const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ucm-doc-adapter-"));
      try {
        const nestedDir = path.join(tempRoot, "nested");
        const hiddenDir = path.join(tempRoot, ".hidden");
        const topMarkdown = path.join(tempRoot, "top.md");
        const nestedMarkdown = path.join(nestedDir, "notes.md");
        const hiddenMarkdown = path.join(hiddenDir, "secret.md");
        const textFile = path.join(tempRoot, "readme.txt");

        await mkdir(nestedDir, { recursive: true });
        await mkdir(hiddenDir, { recursive: true });
        await writeFile(topMarkdown, "## Top\\n\\n" + "A".repeat(120));
        await writeFile(
          nestedMarkdown,
          "## First\\n\\n" + "B".repeat(120) + "\\n\\n## Second\\n\\n" + "C".repeat(120),
        );
        await writeFile(hiddenMarkdown, "## Hidden\\n\\n" + "D".repeat(120));
        await writeFile(textFile, "not markdown");

        const older = new Date(Date.now() - 5_000);
        const newer = new Date(Date.now() - 1_000);
        await utimes(topMarkdown, older, older);
        await utimes(nestedMarkdown, newer, newer);

        const scanned = await documentAdapter.scan(
          { processed: {} },
          { dirs: [tempRoot] },
        );
        assertEqual(scanned.length, 2, "only visible markdown files are scanned");
        assertEqual(
          scanned[0].ref,
          path.join("nested", "notes.md"),
          "newer markdown appears first",
        );

        const filtered = await documentAdapter.scan(
          {
            processed: {
              [path.join("nested", "notes.md")]: newer.getTime(),
            },
          },
          { dirs: [tempRoot] },
        );
        assertEqual(filtered.length, 1, "processed files are skipped");
        assertEqual(filtered[0].ref, "top.md", "unprocessed file remains");

        const chunks = await documentAdapter.read(scanned[0]);
        assert(chunks.length >= 1, "read returns chunk(s)");
        assertEqual(chunks[0].metadata.adapter, "document", "adapter metadata");
      } finally {
        await rm(tempRoot, { recursive: true, force: true });
      }
    },
  });

  console.log();
  const { failed } = summary();
  stopSuiteTimer();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
