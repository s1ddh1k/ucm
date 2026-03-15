import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import * as runtimeStateIndex from "../dist-electron/main/runtime-state-index.js";
import * as runtimeState from "../dist-electron/main/runtime-state-fixture.js";
import * as runtimeStore from "../dist-electron/main/runtime-store.js";

test("runtime store persists state in sqlite instead of json", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ucm-runtime-store-"));
  const dbPath = path.join(tempDir, "runtime-state.db");
  const store = new runtimeStore.RuntimeStore(
    dbPath,
    runtimeState.cloneSeed,
    (parsed, seed) => ({ ...seed, ...parsed }),
    undefined,
    {
      projectState: runtimeStateIndex.projectRuntimeState,
    },
  );

  const state = store.read();
  state.activeMissionId = "m-2";
  state.runsByMissionId["m-1"][0].session = {
    sessionId: "exec-r-1",
    provider: "local",
    transport: "local_shell",
    cwd: "/tmp/worktree-r-1",
    workspaceMode: "git_worktree",
    workspaceRootPath: "/workspaces/storefront-app",
    worktreePath: "/tmp/worktree-r-1",
    interactive: false,
  };
  store.write(state);

  assert.equal(fs.existsSync(dbPath), true);
  assert.equal(fs.existsSync(path.join(tempDir, "runtime-state.json")), false);
  assert.equal(store.read().activeMissionId, "m-2");
  const db = new DatabaseSync(dbPath);
  const workspaceRows = db
    .prepare("SELECT workspace_id FROM runtime_workspace_index WHERE store_key = ?")
    .all("default");
  const missionRow = db
    .prepare(
      "SELECT mission_id, is_active FROM runtime_mission_index WHERE store_key = ? AND mission_id = ?",
    )
    .get("default", "m-2");
  const runRow = db
    .prepare(
      "SELECT run_id, release_count, handoff_count, session_transport, workspace_mode, worktree_path FROM runtime_run_index WHERE store_key = ? AND run_id = ?",
    )
    .get("default", "r-1");
  const releaseRow = db
    .prepare(
      "SELECT release_id, latest_revision_id FROM runtime_release_index WHERE store_key = ? AND release_id = ?",
    )
    .get("default", "del-1");
  const handoffRow = db
    .prepare(
      "SELECT handoff_id, release_revision_id FROM runtime_handoff_index WHERE store_key = ? AND handoff_id = ?",
    )
    .get("default", "handoff-1");

  assert.ok(workspaceRows.length > 0);
  assert.equal(missionRow?.is_active, 1);
  assert.equal(runRow?.release_count, 1);
  assert.equal(runRow?.handoff_count, 1);
  assert.equal(runRow?.session_transport, "local_shell");
  assert.equal(runRow?.workspace_mode, "git_worktree");
  assert.equal(runRow?.worktree_path, "/tmp/worktree-r-1");
  assert.equal(releaseRow?.latest_revision_id, "del-1-r2");
  assert.equal(handoffRow?.release_revision_id, "del-1-r2");

  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("runtime store migrates legacy json into sqlite on first read", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ucm-runtime-migrate-"));
  const dbPath = path.join(tempDir, "runtime-state.db");
  const legacyJsonPath = path.join(tempDir, "runtime-state.json");
  const seeded = runtimeState.cloneSeed();
  seeded.activeMissionId = "m-3";
  fs.writeFileSync(legacyJsonPath, `${JSON.stringify(seeded, null, 2)}\n`, "utf8");

  const store = new runtimeStore.RuntimeStore(
    dbPath,
    runtimeState.cloneSeed,
    (parsed, seed) => ({ ...seed, ...parsed }),
    undefined,
    {
      legacyJsonPath,
      projectState: runtimeStateIndex.projectRuntimeState,
    },
  );

  const migrated = store.read();
  const db = new DatabaseSync(dbPath);
  const missionRow = db
    .prepare(
      "SELECT mission_id, is_active FROM runtime_mission_index WHERE store_key = ? AND mission_id = ?",
    )
    .get("default", "m-3");

  assert.equal(migrated.activeMissionId, "m-3");
  assert.equal(fs.existsSync(dbPath), true);
  assert.equal(fs.existsSync(legacyJsonPath), true);
  assert.equal(missionRow?.is_active, 1);

  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});
