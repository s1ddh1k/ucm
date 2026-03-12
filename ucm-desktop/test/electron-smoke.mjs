import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { _electron as electron } from "playwright";

const require = createRequire(import.meta.url);
const electronBinary = require("electron");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("electron smoke launches, switches workspace, and drills into the active run", async (t) => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ucm-desktop-smoke-"));
  const importedWorkspaceDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "ucm-desktop-import-"),
  );
  const repoWorkspaceName = path.basename(path.resolve(process.cwd(), ".."));
  const importedWorkspaceName = path.basename(importedWorkspaceDir);
  const app = await electron.launch({
    executablePath: electronBinary,
    args: ["."],
    cwd: path.resolve(process.cwd()),
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: "1",
      UCM_DESKTOP_USER_DATA_DIR: userDataDir,
    },
  });

  t.after(async () => {
    await app.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(importedWorkspaceDir, { recursive: true, force: true });
  });

  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");

  await page.getByText("UCM Desktop").waitFor({ timeout: 15000 });

  await page.evaluate(async (workspacePath) => {
    await window.ucm.workspace.add({ rootPath: workspacePath });
  }, importedWorkspaceDir);

  await page.getByRole("button", {
    name: new RegExp(`^${escapeRegExp(importedWorkspaceName)}\\s`, "i"),
  }).click();
  await page.getByRole("heading", { name: importedWorkspaceName }).waitFor({
    timeout: 15000,
  });
  await page.getByRole("button", {
    name: new RegExp(`^${escapeRegExp(repoWorkspaceName)}\\s`, "i"),
  }).click();
  await page.getByRole("heading", { name: repoWorkspaceName }).waitFor({
    timeout: 15000,
  });

  const runButton = page.getByRole("button", {
    name: /Patch checkout auth regression/,
  });
  await runButton.waitFor({ timeout: 15000 });
  await runButton.click();

  await page.getByRole("heading", { name: "Patch checkout auth regression" }).waitFor({
    timeout: 15000,
  });
  await page.getByText("실행 흐름").waitFor({ timeout: 15000 });
  await page.getByText("프로바이더 상태").waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: /src\/checkout\/session\.ts/ }).click();
  await page.getByTestId("patch-surface").waitFor({ timeout: 15000 });
  await page.getByText("resolveCheckoutFixture", { exact: false }).waitFor({
    timeout: 15000,
  });

  const providersMetric = page.getByRole("banner").getByText(/claude:(ready|busy|cooldown)/);
  assert.equal(await providersMetric.isVisible(), true);
  assert.equal(await page.getByText("프로바이더 상태").isVisible(), true);
  assert.equal(await page.getByText("실행 흐름").isVisible(), true);
});
