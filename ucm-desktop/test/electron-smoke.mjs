import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { _electron as electron } from "playwright";
import { cloneSeed } from "../dist-electron/main/runtime-state-fixture.js";

const require = createRequire(import.meta.url);
const electronBinary = require("electron");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("electron smoke launches, switches workspace, and drills into the active run", async (t) => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ucm-desktop-smoke-"));
  const importedWorkspaceDir = fs.mkdtempSync(
    path.join(os.homedir(), "ucm-desktop-import-"),
  );
  const importedWorkspaceName = path.basename(importedWorkspaceDir);
  const importedWorkspaceInput = `~/${importedWorkspaceName}`;
  fs.writeFileSync(
    path.join(userDataDir, "runtime-state.json"),
    `${JSON.stringify(cloneSeed(), null, 2)}\n`,
    "utf8",
  );
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
  const activeWorkspaceName = (
    await page.locator(".workspace-switcher-copy strong").first().textContent()
  )?.trim();
  assert.ok(activeWorkspaceName);

  await page.locator(".workspace-switcher").click();
  await page.getByRole("button", { name: /워크스페이스 추가/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ timeout: 15000 });
  await dialog.getByRole("textbox", { name: "선택된 폴더" }).fill(importedWorkspaceInput);
  await dialog.getByRole("button", { name: /^워크스페이스 추가$/ }).click();
  await page.locator(".workspace-switcher-copy strong").getByText(importedWorkspaceName, {
    exact: true,
  }).waitFor({
    timeout: 15000,
  });
  await page.getByRole("heading", { name: "활성 미션이 없습니다" }).waitFor({
    timeout: 15000,
  });
  await page.locator(".workspace-switcher").click();
  await page.locator(".workspace-dropdown").getByRole("button", {
    name: new RegExp(`^${escapeRegExp(activeWorkspaceName)}\\s`, "i"),
  }).click();
  await page.locator(".workspace-switcher-copy strong").getByText(activeWorkspaceName, {
    exact: true,
  }).waitFor({
    timeout: 15000,
  });
  const missionButton = page.locator(".mission-list").getByRole("button", {
    name: /Checkout rollback fix/,
  });
  await missionButton.waitFor({ timeout: 15000 });
  await missionButton.click();
  await page.getByRole("heading", { name: "Checkout rollback fix" }).waitFor({
    timeout: 15000,
  });
  await page.getByRole("tab", { name: "실행" }).click();
  await page.getByText("루트 실행").waitFor({ timeout: 15000 });

  const runButton = page.locator(".run-stream-card").getByRole("button", {
    name: /Patch checkout auth regression/,
  });
  await runButton.waitFor({ timeout: 15000 });
  await runButton.click();

  await page
    .locator(".run-workbench-card .eyebrow")
    .filter({ hasText: "Patch checkout auth regression" })
    .waitFor({ timeout: 15000 });
  await page
    .locator(".run-context-card .section-mini-title")
    .filter({ hasText: "실행 흐름" })
    .waitFor({ timeout: 15000 });
  await page
    .locator(".run-context-card .section-mini-title")
    .filter({ hasText: "프로바이더 상태" })
    .waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: /src\/checkout\/session\.ts/ }).click();
  await page.getByTestId("patch-surface").waitFor({ timeout: 15000 });
  await page.getByText("resolveCheckoutFixture", { exact: false }).waitFor({
    timeout: 15000,
  });

  const providersMetric = page.getByRole("banner").getByText(/claude:(ready|busy|cooldown)/);
  assert.equal(await providersMetric.isVisible(), true);
  assert.equal(
    await page
      .locator(".run-context-card .section-mini-title")
      .filter({ hasText: "프로바이더 상태" })
      .isVisible(),
    true,
  );
  assert.equal(
    await page
      .locator(".run-context-card .section-mini-title")
      .filter({ hasText: "실행 흐름" })
      .isVisible(),
    true,
  );
});
