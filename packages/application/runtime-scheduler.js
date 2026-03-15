function scheduleFollowupRunInState(input) {
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
  const artifactIds = sourceRun.artifacts.map((artifact) => artifact.id);

  const latestArtifact = sourceRun.artifacts.at(-1);
  const nextRun = {
    id: runId,
    missionId,
    agentId: agent.id,
    title: followup.title,
    status: followup.status,
    summary: followup.summary,
    budgetClass: rule.budgetClass,
    providerPreference: agent.role === "implementation" ? "codex" : "claude",
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
    artifacts: latestArtifact ? [latestArtifact] : [],
    runEvents: [],
    releases: [
      {
        id: `del-${runId}`,
        kind: followup.releaseKind,
        title: `${followup.title} review packet`,
        latestRevisionId: revisionId,
        revisions: [
          {
            id: revisionId,
            revision: 1,
            summary: followup.revisionSummary,
            createdAtLabel: "just now",
            basedOnArtifactIds: artifactIds,
            status: "active",
          },
        ],
      },
    ],
    handoffs: [],
  };

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

function deriveFollowupSpec(sourceRun, sourceEvent, agent) {
  const matchingRule = [...FOLLOWUP_RULES]
    .sort((left, right) => right.priority - left.priority)
    .find(
      (rule) =>
        rule.role === agent.role &&
        rule.eventKinds.includes(sourceEvent.kind) &&
        rule.matches({ sourceRun, sourceEvent, agent }),
    );

  return matchingRule
    ? {
        rule: matchingRule,
        spec: matchingRule.buildSpec({ sourceRun, sourceEvent, agent }),
      }
    : null;
}

const FOLLOWUP_RULES = [
  {
    id: "verification_from_diff_artifact",
    priority: 70,
    role: "verification",
    reuseExistingRun: true,
    spawnMode: "execute",
    maxOpenRuns: 1,
    exclusiveWith: ["review_from_review_ready_event"],
    budgetClass: "standard",
    eventKinds: ["artifact_created"],
    matches: ({ sourceRun }) => sourceRun.artifacts.at(-1)?.type === "diff",
    buildSpec: ({ sourceRun, agent }) => ({
      key: "verify",
      title: `Verify ${sourceRun.title}`,
      status: "running",
      summary: `${agent.name} is preparing a dedicated verification follow-up run.`,
      decisionSummary:
        "Create a dedicated verification run for the latest implementation diff.",
      rationale:
        "Verification should run in its own follow-up run so the mission can branch cleanly after implementation artifacts appear.",
      revisionSummary:
        "Verification follow-up run initialized from the latest implementation artifact.",
      releaseKind: "review_packet",
    }),
  },
  {
    id: "research_from_blocker_context",
    priority: 80,
    role: "research",
    reuseExistingRun: true,
    spawnMode: "execute",
    maxOpenRuns: 1,
    exclusiveWith: [],
    budgetClass: "light",
    eventKinds: ["blocked"],
    matches: ({ sourceEvent }) =>
      sourceEvent.metadata?.requestedInput === "fixture_path" ||
      sourceEvent.metadata?.requestedInput === "external_context",
    buildSpec: ({ sourceRun, agent }) => ({
      key: "research",
      title: `Research ${sourceRun.title}`,
      status: "running",
      summary: `${agent.name} is collecting context to unblock ${sourceRun.title}.`,
      decisionSummary:
        "Create a dedicated research run to resolve the current blocker.",
      rationale:
        "Research should branch into its own run so missing context can be gathered without overloading the implementation run.",
      revisionSummary:
        "Research follow-up run initialized from the blocker context and latest artifacts.",
      releaseKind: "review_packet",
    }),
  },
  {
    id: "review_from_review_ready_event",
    priority: 90,
    role: "verification",
    reuseExistingRun: true,
    spawnMode: "queue_only",
    maxOpenRuns: 1,
    exclusiveWith: ["verification_from_diff_artifact"],
    budgetClass: "light",
    eventKinds: ["needs_review", "review_requested"],
    matches: () => true,
    buildSpec: ({ sourceRun, agent }) => ({
      key: "review",
      title: `Review ${sourceRun.title}`,
      status: "needs_review",
      summary: `${agent.name} opened a dedicated review follow-up run for the latest packet.`,
      decisionSummary:
        "Create a dedicated review run for the latest review-ready packet.",
      rationale:
        "Review should exist as its own run so approval work can be inspected separately from execution work.",
      revisionSummary:
        "Review follow-up run initialized from the latest review-ready packet.",
      releaseKind: "review_packet",
    }),
  },
];

function getSchedulingBlockReason(state, missionId, rule) {
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

function hasBudgetCapacity(missionBudget, rule) {
  const bucket = missionBudget[rule.budgetClass];
  return bucket.used < bucket.limit;
}

function consumeBudgetForRule(missionBudget, rule) {
  const current =
    missionBudget ??
    {
      light: { limit: 0, used: 0 },
      standard: { limit: 0, used: 0 },
      heavy: { limit: 0, used: 0 },
    };

  return {
    ...current,
    [rule.budgetClass]: {
      ...current[rule.budgetClass],
      used: current[rule.budgetClass].used + 1,
    },
  };
}

module.exports = {
  scheduleFollowupRunInState,
};
