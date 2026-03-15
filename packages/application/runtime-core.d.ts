export function summarizeMission(state: any, mission: any): any;
export function activateWorkspaceSelection(state: any, workspaceId: string): boolean;
export function activateMissionSelection(state: any, missionId: string): boolean;
export function activateRunSelection(
  state: any,
  runId: string,
): { missionId: string; run: any } | null;
export function listBudgetBuckets(state: any, missionId?: string): any[];
export function formatBudgetLabel(state: any, missionId?: string): string;
export function listProviderWindows(state: any, activeWorkspaceId: string): any[];
export function findNextAutopilotTarget(
  state: any,
): { missionId: string; run: any; event: any } | null;
