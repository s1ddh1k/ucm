import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as runtimeIndexRepository from "../dist-electron/main/runtime-index-repository.js";
import * as runtimeStateIndex from "../dist-electron/main/runtime-state-index.js";
import * as runtimeState from "../dist-electron/main/runtime-state-fixture.js";
import * as runtimeStore from "../dist-electron/main/runtime-store.js";

test("runtime index repository exposes normalized workspace, mission, run, release, and handoff rows", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ucm-runtime-index-"));
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

  const state = runtimeState.cloneSeed();
  state.runsByMissionId["m-1"][0].session = {
    sessionId: "exec-r-1",
    provider: "codex",
    transport: "provider_terminal",
    cwd: "/tmp/storefront-r-1",
    workspaceMode: "git_worktree",
    workspaceRootPath: "/workspaces/storefront-app",
    worktreePath: "/tmp/storefront-r-1",
    interactive: true,
  };
  store.write(state);

  const repository = new runtimeIndexRepository.RuntimeIndexRepository(dbPath);
  const workspaces = repository.listWorkspaces();
  const missions = repository.listMissions({ workspaceId: "ws-storefront" });
  const activeMission = repository.getActiveMission();
  const runs = repository.listRuns({ missionId: "m-1" });
  const activeRun = repository.getActiveRun();
  const releases = repository.listReleases({ runId: "r-1" });
  const handoffs = repository.listHandoffs({ runId: "r-1" });

  assert.equal(workspaces[0]?.workspaceId, "ws-storefront");
  assert.equal(missions.length, 3);
  assert.equal(activeMission?.missionId, "m-1");
  assert.equal(runs[0]?.runId, "r-1");
  assert.equal(runs[0]?.releaseCount, 1);
  assert.equal(runs[0]?.sessionTransport, "provider_terminal");
  assert.equal(runs[0]?.workspaceMode, "git_worktree");
  assert.equal(runs[0]?.worktreePath, "/tmp/storefront-r-1");
  assert.equal(activeRun?.runId, "r-1");
  assert.equal(releases[0]?.latestRevisionId, "del-1-r2");
  assert.equal(handoffs[0]?.releaseRevisionId, "del-1-r2");

  repository.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});
