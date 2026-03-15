function summarizeMission(state, mission) {
  const runs = state.runsByMissionId[mission.id] ?? [];
  const focusRun =
    runs.find((run) => run.status === "blocked" || run.status === "needs_review") ??
    runs.find((run) => run.status === "running" || run.status === "queued") ??
    runs.at(-1) ??
    null;

  return {
    ...mission,
    lineStatus: focusRun?.status,
    latestResult: focusRun?.summary,
    artifactCount: focusRun?.artifacts.length ?? 0,
    attentionRequired:
      focusRun?.status === "blocked" || focusRun?.status === "needs_review",
  };
}

function activateWorkspaceSelection(state, workspaceId) {
  const targetWorkspace = state.workspaces.find(
    (workspace) => workspace.id === workspaceId,
  );
  if (!targetWorkspace) {
    return false;
  }

  state.activeWorkspaceId = targetWorkspace.id;
  state.workspaces = state.workspaces.map((workspace) => ({
    ...workspace,
    active: workspace.id === targetWorkspace.id,
  }));

  const workspaceMissions = state.missions.filter(
    (mission) => state.workspaceIdByMissionId[mission.id] === targetWorkspace.id,
  );
  const nextMission =
    workspaceMissions.find((mission) => mission.id === state.activeMissionId) ??
    workspaceMissions[0] ??
    null;

  state.activeMissionId = nextMission?.id ?? "";
  const nextRuns = nextMission ? state.runsByMissionId[nextMission.id] ?? [] : [];
  state.activeRunId =
    nextRuns.find((run) => run.id === state.activeRunId)?.id ??
    nextRuns[0]?.id ??
    "";

  return true;
}

function activateMissionSelection(state, missionId) {
  const mission = state.missions.find((item) => item.id === missionId);
  if (!mission) {
    return false;
  }

  const workspaceId = state.workspaceIdByMissionId[mission.id];
  state.activeMissionId = mission.id;
  const missionRuns = state.runsByMissionId[mission.id] ?? [];
  state.activeRunId =
    missionRuns.find((run) => run.id === state.activeRunId)?.id ??
    missionRuns[0]?.id ??
    "";

  if (workspaceId) {
    state.activeWorkspaceId = workspaceId;
    state.workspaces = state.workspaces.map((workspace) => ({
      ...workspace,
      active: workspace.id === workspaceId,
    }));
  }

  return true;
}

function activateRunSelection(state, runId) {
  for (const [missionId, runs] of Object.entries(state.runsByMissionId)) {
    const run = runs.find((item) => item.id === runId);
    if (!run) {
      continue;
    }

    state.activeMissionId = missionId;
    state.activeRunId = run.id;
    const workspaceId = state.workspaceIdByMissionId[missionId];
    if (workspaceId) {
      state.activeWorkspaceId = workspaceId;
      state.workspaces = state.workspaces.map((workspace) => ({
        ...workspace,
        active: workspace.id === workspaceId,
      }));
    }
    return { missionId, run };
  }

  return null;
}

function listBudgetBuckets(state, missionId) {
  const budget = missionId ? state.missionBudgetById[missionId] : null;
  if (!budget) {
    return [];
  }

  return [
    { className: "light", ...budget.light },
    { className: "standard", ...budget.standard },
    { className: "heavy", ...budget.heavy },
  ];
}

function formatBudgetLabel(state, missionId) {
  const budgetBuckets = listBudgetBuckets(state, missionId);
  if (budgetBuckets.length === 0) {
    return "No budget";
  }

  const used = budgetBuckets.reduce((sum, bucket) => sum + bucket.used, 0);
  const limit = budgetBuckets.reduce((sum, bucket) => sum + bucket.limit, 0);
  return `${used} / ${limit} budget slots`;
}

function listProviderWindows(state, activeWorkspaceId) {
  const workspaceMissionIds = new Set(
    Object.entries(state.workspaceIdByMissionId)
      .filter(([, workspaceId]) => workspaceId === activeWorkspaceId)
      .map(([missionId]) => missionId),
  );
  const runs = Object.entries(state.runsByMissionId)
    .filter(([missionId]) => workspaceMissionIds.has(missionId))
    .flatMap(([, missionRuns]) => missionRuns);

  return ["claude", "codex"].map((provider) => {
    const activeRuns = runs.filter(
      (run) => run.providerPreference === provider && run.status === "running",
    ).length;
    const queuedRuns = runs.filter(
      (run) => run.providerPreference === provider && run.status === "queued",
    ).length;
    return {
      provider,
      status: activeRuns > 0 ? "busy" : queuedRuns > 0 ? "cooldown" : "ready",
      activeRuns,
      queuedRuns,
      nextAvailableLabel:
        activeRuns > 0
          ? "after current run finishes"
          : queuedRuns > 0
            ? "queued for next open window"
            : "now",
    };
  });
}

function findNextAutopilotTarget(state) {
  const missionIds = [
    state.activeMissionId,
    ...state.missions
      .map((mission) => mission.id)
      .filter((id) => id !== state.activeMissionId),
  ];

  for (const missionId of missionIds) {
    const runs = state.runsByMissionId[missionId] ?? [];
    const orderedRuns = [
      ...runs.filter((run) => run.id === state.activeRunId),
      ...runs.filter((run) => run.id !== state.activeRunId),
    ];

    for (const run of orderedRuns) {
      const handledIds = new Set(
        state.autopilotHandledEventIdsByRunId[run.id] ?? [],
      );
      const nextEvent = [...(state.runEventsByRunId[run.id] ?? [])]
        .reverse()
        .find((event) => !handledIds.has(event.id));
      if (nextEvent) {
        return { missionId, run, event: nextEvent };
      }
    }
  }

  return null;
}

module.exports = {
  activateMissionSelection,
  activateRunSelection,
  activateWorkspaceSelection,
  findNextAutopilotTarget,
  formatBudgetLabel,
  listBudgetBuckets,
  listProviderWindows,
  summarizeMission,
};
