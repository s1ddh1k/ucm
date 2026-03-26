import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
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

async function closeElectronApp(app) {
  const child = app.process();
  const closeResult = await Promise.race([
    app.close().then(() => "closed").catch(() => "errored"),
    new Promise((resolve) => {
      setTimeout(() => resolve("timeout"), 5000);
    }),
  ]);
  if (!child || child.exitCode !== null || child.killed) {
    return;
  }

  const exitResult = await Promise.race([
    once(child, "exit").then(() => "exited"),
    new Promise((resolve) => {
      setTimeout(() => resolve("timeout"), closeResult === "timeout" ? 0 : 5000);
    }),
  ]);
  if (exitResult !== "timeout") {
    return;
  }

  child.kill("SIGKILL");
  await once(child, "exit");
}

test("electron smoke launches, switches workspace, and drills into the active run", {
  timeout: 60000,
}, async (t) => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ucm-desktop-smoke-"));
  const importedWorkspaceDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "ucm-desktop-import-"),
  );
  const repoWorkspaceName = path.basename(path.resolve(process.cwd(), ".."));
  const importedWorkspaceName = path.basename(importedWorkspaceDir);
  let appClosed = false;
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
    if (!appClosed) {
      await closeElectronApp(app);
    }
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(importedWorkspaceDir, { recursive: true, force: true });
  });

  const page = await app.firstWindow();
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  page.on("console", (message) => {
    if (message.type() !== "error") {
      return;
    }
    consoleErrors.push(message.text());
  });
  await page.waitForLoadState("domcontentloaded");

  await page.getByRole("banner").waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: /^홈\s/i }).waitFor({ timeout: 15000 });

  await page.evaluate(async (workspacePath) => {
    await window.ucm.workspace.add({ rootPath: workspacePath });
  }, importedWorkspaceDir);

  await page.getByRole("button", {
    name: new RegExp(`^${escapeRegExp(importedWorkspaceName)}\\s`, "i"),
  }).click();
  await page.getByRole("banner").getByText(importedWorkspaceName, { exact: true }).waitFor({
    timeout: 15000,
  });
  await page.getByRole("button", {
    name: new RegExp(`^${escapeRegExp(repoWorkspaceName)}\\s`, "i"),
  }).click();
  await page.getByRole("banner").getByText(repoWorkspaceName, { exact: true }).waitFor({
    timeout: 15000,
  });
  await page.getByRole("button", { name: /^홈\s/i }).click();
  await page.getByRole("heading", { name: /새 미션 시작|Start a new mission/ }).waitFor({
    timeout: 15000,
  });

  const createdMissionTitle = "Smoke mission planning lane";
  const createdMissionGoal = "Verify the launcher flow can create and focus a new mission.";
  await page.getByLabel("미션 제목").fill(createdMissionTitle);
  await page.getByLabel("목표").fill(createdMissionGoal);
  await page.getByRole("button", { name: "미션 생성" }).click();
  await page.getByRole("heading", { name: createdMissionTitle }).waitFor({
    timeout: 15000,
  });
  await page.getByRole("heading", { name: createdMissionGoal }).waitFor({
    timeout: 15000,
  });
  await page.getByRole("button", { name: /^홈\s/i }).click();
  await page.getByRole("heading", { name: /새 미션 시작|Start a new mission/ }).waitFor({
    timeout: 15000,
  });
  const missionButton = page.getByRole("button", {
    name: /Checkout rollback fix/,
  });
  await missionButton.waitFor({ timeout: 15000 });
  await missionButton.click();

  await page.getByRole("banner").getByRole("heading", { name: "Checkout rollback fix" }).waitFor({
    timeout: 15000,
  });
  await page.getByText("변경 파일", { exact: true }).waitFor({ timeout: 15000 });
  await page.getByText("실행 흐름", { exact: true }).waitFor({ timeout: 15000 });
  await page.getByText("프로바이더 상태", { exact: true }).waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: /src\/checkout\/session\.ts/ }).click();
  await page.getByTestId("patch-surface").waitFor({ timeout: 15000 });
  await page.getByText("resolveCheckoutFixture", { exact: false }).waitFor({
    timeout: 15000,
  });

  const providersMetric = page.getByRole("banner").getByText(/claude:(ready|busy|cooldown)/);
  assert.equal(await providersMetric.isVisible(), true);
  assert.equal(await page.getByText("프로바이더 상태").isVisible(), true);
  assert.equal(await page.getByText("실행 흐름").isVisible(), true);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(consoleErrors, []);
  await closeElectronApp(app);
  appClosed = true;
});
