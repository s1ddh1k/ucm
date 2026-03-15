import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as workspaceBrowserService from "../dist-electron/main/workspace-browser-service.js";

test("workspace browser lists directories and marks repository roots", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ucm-workspace-browser-"));
  const repoPath = path.join(tempDir, "repo-app");
  const plainPath = path.join(tempDir, "notes");

  fs.mkdirSync(repoPath);
  fs.mkdirSync(path.join(repoPath, ".git"));
  fs.mkdirSync(plainPath);

  const snapshot = workspaceBrowserService.browseWorkspaceDirectories({
    rootPath: tempDir,
  });

  assert.equal(snapshot.currentPath, tempDir);
  assert.equal(snapshot.directories.length, 2);
  assert.equal(snapshot.directories[0].path, repoPath);
  assert.equal(snapshot.directories[0].isRepositoryRoot, true);
  assert.equal(snapshot.directories[1].path, plainPath);
  assert.equal(snapshot.directories[1].isRepositoryRoot, false);

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("workspace browser can create a child directory and focus it", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ucm-workspace-create-"));

  const snapshot = workspaceBrowserService.createWorkspaceDirectory({
    parentPath: tempDir,
    directoryName: "new-workspace",
  });

  assert.equal(snapshot.currentPath, path.join(tempDir, "new-workspace"));
  assert.equal(fs.existsSync(snapshot.currentPath), true);

  fs.rmSync(tempDir, { recursive: true, force: true });
});
