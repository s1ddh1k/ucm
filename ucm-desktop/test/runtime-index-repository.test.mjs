import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as runtimeIndexRepository from "../dist-electron/main/runtime-index-repository.js";
import * as runtimeStateIndex from "../dist-electron/main/runtime-state-index.js";
import * as runtimeState from "../dist-electron/main/runtime-state-fixture.js";
import * as runtimeStore from "../dist-electron/main/runtime-store.js";

test("runtime index repository exposes normalized workspace, mission, run, release, handoff, wakeup, and attempt rows", () => {
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
  state.wakeupRequestsByMissionId["m-1"] = [
    {
      id: "wr-r-1-1",
      workspaceId: "ws-storefront",
      missionId: "m-1",
      runId: "r-1",
      source: "automation",
      status: "completed",
      requestedAt: "2026-03-31T00:00:00.000Z",
      requestedBy: "runtime",
      reason: "Start Builder-2 for Patch checkout auth regression.",
    },
  ];
  state.executionAttemptsByRunId["r-1"] = [
    {
      id: "att-r-1-1",
      workspaceId: "ws-storefront",
      missionId: "m-1",
      runId: "r-1",
      wakeupRequestId: "wr-r-1-1",
      attemptNumber: 1,
      provider: "codex",
      status: "blocked",
      startedAt: "2026-03-31T00:00:01.000Z",
      finishedAt: "2026-03-31T00:00:06.000Z",
      sessionId: "exec-r-1",
      terminalSessionId: "exec-r-1",
      exitCode: null,
      estimatedPromptTokens: 321,
      outputChars: 777,
      latencyMs: 5000,
      stdoutExcerpt: "builder output",
      stderrExcerpt: "missing fixture path",
      localityScore: 1,
    },
  ];
  state.sessionLeasesByWorkspaceId["ws-storefront"] = [
    {
      id: "lease-codex-1",
      provider: "codex",
      workspaceId: "ws-storefront",
      missionId: "m-1",
      runId: "r-1",
      affinityKey: "m-1:a-builder-2:codex",
      sessionId: "exec-r-1",
      status: "warm",
      reusePolicy: "prefer_reuse",
      lastAttemptId: "att-r-1-1",
      lastUsedAt: "2026-03-31T00:00:06.000Z",
    },
  ];
  store.write(state);

  const repository = new runtimeIndexRepository.RuntimeIndexRepository(dbPath);
  const workspaces = repository.listWorkspaces();
  const missions = repository.listMissions({ workspaceId: "ws-storefront" });
  const activeMission = repository.getActiveMission();
  const runs = repository.listRuns({ missionId: "m-1" });
  const activeRun = repository.getActiveRun();
  const releases = repository.listReleases({ runId: "r-1" });
  const handoffs = repository.listHandoffs({ runId: "r-1" });
  const wakeupRequests = repository.listWakeupRequests({ runId: "r-1" });
  const attempts = repository.listExecutionAttempts({ runId: "r-1" });
  const leases = repository.listSessionLeases({ runId: "r-1" });

  assert.equal(workspaces[0]?.workspaceId, "ws-storefront");
  assert.equal(missions.length, 3);
  assert.equal(activeMission?.missionId, "m-1");
  assert.equal(runs[0]?.runId, "r-1");
  assert.equal(runs[0]?.releaseCount, 2);
  assert.equal(runs[0]?.sessionTransport, null);
  assert.equal(runs[0]?.workspaceMode, null);
  assert.equal(runs[0]?.worktreePath, null);
  assert.equal(activeRun?.runId, "r-1");
  assert.equal(releases[0]?.latestRevisionId, "del-1-r2");
  assert.equal(handoffs[0]?.releaseRevisionId, "del-1-r2");
  assert.equal(wakeupRequests[0]?.wakeupRequestId, "wr-r-1-1");
  assert.equal(wakeupRequests[0]?.status, "completed");
  assert.equal(attempts[0]?.attemptId, "att-r-1-1");
  assert.equal(attempts[0]?.provider, "codex");
  assert.equal(attempts[0]?.estimatedPromptTokens, 321);
  assert.equal(leases[0]?.leaseId, "lease-codex-1");
  assert.equal(leases[0]?.status, "warm");
  assert.equal(leases[0]?.sessionId, "exec-r-1");

  repository.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});
