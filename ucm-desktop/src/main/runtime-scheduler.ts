import type { AgentSnapshot, RunDetail, RunEvent } from "../shared/contracts";
import type { RuntimeState } from "./runtime-state";
import { buildFollowupInputArtifacts } from "./runtime-context-artifacts";
import { captureRunOutputBaseline } from "./runtime-run-helpers";
import {
  describeDeliverableTitle,
  deriveFollowupSpec,
  inferScheduledProviderPreference,
  type FollowupRule,
} from "./runtime-followup-rules";

export function scheduleFollowupRunInState(input: {
  state: RuntimeState;
  missionId: string;
  sourceRun: RunDetail;
  sourceEvent: RunEvent;
  agent: AgentSnapshot;
}): {
  outcome: "scheduled" | "reused" | "blocked";
  runId: string;
  agentId: string;
  status: RunDetail["status"];
  ruleId: string;
  spawnMode: "execute" | "queue_only";
  reason?: string;
} | null {
  const { state, missionId, sourceRun, sourceEvent, agent } = input;

  const scheduled = deriveFollowupSpec(sourceRun, sourceEvent, agent);
  if (!scheduled) return null;
  const { rule, spec: followup } = scheduled;

  if (rule.reuseExistingRun) {
    const existingRun = (state.runsByMissionId[missionId] ?? []).find(
      (run) =>
        run.agentId === agent.id &&
        run.id !== sourceRun.id &&
        run.title === followup.title &&
        run.status !== "completed",
    );
    if (existingRun) {
      return {
        outcome: "reused",
        runId: existingRun.id,
        agentId: agent.id,
        status: existingRun.status,
        ruleId: rule.id,
        spawnMode: rule.spawnMode,
      };
    }
  }

  const blockedReason = getSchedulingBlockReason(state, missionId, rule);
  if (blockedReason) {
    return {
      outcome: "blocked",
      runId: sourceRun.id,
      agentId: agent.id,
      status: sourceRun.status,
      ruleId: rule.id,
      spawnMode: rule.spawnMode,
      reason: blockedReason,
    };
  }

  const revisionId = `del-${missionId}-${followup.key}-${Date.now()}-r1`;
  const runId = `r-${missionId}-${followup.key}-${Date.now()}`;
  const missionDetail = state.missionDetailsById[missionId] ?? null;
  const mission = state.missions.find((item) => item.id === missionId) ?? null;
  const inputArtifacts = buildFollowupInputArtifacts({
    runId,
    roleContractId: rule.roleContractId,
    sourceRun,
    missionDetail,
    missionTitle: mission?.title ?? sourceRun.title,
    missionGoal: mission?.goal ?? missionDetail?.goal ?? sourceRun.summary,
  });

  const nextRun: RunDetail = {
    id: runId,
    missionId,
    agentId: agent.id,
    roleContractId: rule.roleContractId,
    title: followup.title,
    status: followup.status,
    summary: followup.summary,
    budgetClass: rule.budgetClass,
    providerPreference: inferScheduledProviderPreference(rule.roleContractId, agent.role),
    terminalSessionId: undefined,
    terminalProvider: undefined,
    activeSurface: "artifacts",
    terminalPreview: [],
    origin: {
      parentRunId: sourceRun.id,
      sourceEventId: sourceEvent.id,
      sourceEventKind: sourceEvent.kind,
      schedulerRuleId: rule.id,
      spawnMode: rule.spawnMode,
      budgetClass: rule.budgetClass,
    },
    timeline: [
      {
        id: `tl-start-${runId}`,
        kind: "started",
        summary: `${agent.name} follow-up run was scheduled from ${sourceRun.title}.`,
        timestampLabel: "just now",
      },
    ],
    decisions: [
      {
        id: `d-plan-${runId}`,
        category: "planning",
        summary: followup.decisionSummary,
        rationale: followup.rationale,
      },
    ],
    artifacts: inputArtifacts,
    runEvents: [],
    deliverables: [
      {
        id: `del-${runId}`,
        kind: followup.deliverableKind,
        title: describeDeliverableTitle(followup.title, followup.deliverableKind),
        latestRevisionId: revisionId,
        revisions: [
          {
            id: revisionId,
            revision: 1,
            summary: followup.revisionSummary,
            createdAtLabel: "just now",
            basedOnArtifactIds: inputArtifacts.map((artifact) => artifact.id),
            status: "active",
          },
        ],
      },
    ],
    handoffs: [],
  };
  nextRun.outputBaseline = captureRunOutputBaseline(nextRun);

  state.runsByMissionId[missionId] = [
    ...(state.runsByMissionId[missionId] ?? []),
    nextRun,
  ];
  state.runEventsByRunId[runId] = [];
  state.missionBudgetById[missionId] = consumeBudgetForRule(
    state.missionBudgetById[missionId],
    rule,
  );

  return {
    outcome: "scheduled",
    runId,
    agentId: agent.id,
    status: nextRun.status,
    ruleId: rule.id,
    spawnMode: rule.spawnMode,
  };
}

function canScheduleRuleInState(
  state: RuntimeState,
  missionId: string,
  rule: FollowupRule,
): boolean {
  return getSchedulingBlockReason(state, missionId, rule) === null;
}

function getSchedulingBlockReason(
  state: RuntimeState,
  missionId: string,
  rule: FollowupRule,
): string | null {
  const missionBudget = state.missionBudgetById[missionId];
  if (!missionBudget || !hasBudgetCapacity(missionBudget, rule)) {
    return `Governor blocked ${rule.id} because the ${rule.budgetClass} budget bucket is exhausted.`;
  }

  const openRuns = (state.runsByMissionId[missionId] ?? []).filter(
    (run) => run.status !== "completed" && run.origin?.schedulerRuleId === rule.id,
  );
  if (openRuns.length >= rule.maxOpenRuns) {
    return `Governor blocked ${rule.id} because maxOpenRuns=${rule.maxOpenRuns} is already reached.`;
  }

  if (rule.exclusiveWith.length === 0) {
    return null;
  }

  const conflictingRuleIds = new Set([rule.id, ...rule.exclusiveWith]);
  const conflictingRuns = (state.runsByMissionId[missionId] ?? []).some(
    (run) =>
      run.status !== "completed" &&
      run.origin?.schedulerRuleId &&
      conflictingRuleIds.has(run.origin.schedulerRuleId) &&
      run.origin.schedulerRuleId !== rule.id,
  );

  return conflictingRuns
    ? `Governor blocked ${rule.id} because an exclusive follow-up run is already open.`
    : null;
}

function hasBudgetCapacity(
  missionBudget: RuntimeState["missionBudgetById"][string],
  rule: FollowupRule,
): boolean {
  const bucket = missionBudget[rule.budgetClass];
  return bucket.used < bucket.limit;
}

function consumeBudgetForRule(
  missionBudget: RuntimeState["missionBudgetById"][string] | undefined,
  rule: FollowupRule,
): RuntimeState["missionBudgetById"][string] {
  const current =
    missionBudget ??
    ({
      light: { limit: 0, used: 0 },
      standard: { limit: 0, used: 0 },
      heavy: { limit: 0, used: 0 },
    } satisfies RuntimeState["missionBudgetById"][string]);

  return {
    ...current,
    [rule.budgetClass]: {
      ...current[rule.budgetClass],
      used: current[rule.budgetClass].used + 1,
    },
  };
}
