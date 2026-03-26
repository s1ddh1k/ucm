import type {
  ProviderWindowSummary,
  RunDetail,
  RuntimeProvider,
} from "../shared/contracts";
import type { RuntimeState } from "./runtime-state";

export const RUNTIME_PROVIDERS: RuntimeProvider[] = [
  "claude",
  "codex",
  "gemini",
];

export function listProviderWindowsForWorkspace(
  state: RuntimeState,
  workspaceId: string,
): ProviderWindowSummary[] {
  const workspaceMissionIds = new Set(
    Object.entries(state.workspaceIdByMissionId)
      .filter(([, candidateWorkspaceId]) => candidateWorkspaceId === workspaceId)
      .map(([missionId]) => missionId),
  );
  const runs = Object.entries(state.runsByMissionId)
    .filter(([missionId]) => workspaceMissionIds.has(missionId))
    .flatMap(([, missionRuns]) => missionRuns);

  return RUNTIME_PROVIDERS.map((provider) =>
    summarizeProviderWindow(provider, runs),
  );
}

export function findQueuedRunToResume(
  state: RuntimeState,
): { run: RunDetail; provider: RuntimeProvider } | null {
  const runs = Object.values(state.runsByMissionId).flat();
  const runningProviders = new Set(
    runs
      .filter((run) => run.status === "running" && run.providerPreference && run.providerPreference !== "local")
      .map((run) => run.providerPreference as RuntimeProvider),
  );

  const queuedRun = runs.find(
    (run) =>
      run.status === "queued" &&
      run.providerPreference &&
      run.providerPreference !== "local" &&
      !runningProviders.has(run.providerPreference),
  );
  if (!queuedRun?.providerPreference || queuedRun.providerPreference === "local") {
    return null;
  }

  return {
    run: queuedRun,
    provider: queuedRun.providerPreference,
  };
}

function summarizeProviderWindow(
  provider: RuntimeProvider,
  runs: RunDetail[],
): ProviderWindowSummary {
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
}
