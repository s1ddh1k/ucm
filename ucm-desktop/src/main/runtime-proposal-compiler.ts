import type {
  ArtifactRecord,
  DecisionRecord,
  RunDetail,
} from "../shared/contracts";
import type { RuntimeState } from "./runtime-state";
import { createArtifactRecord } from "./runtime-artifact-records";

type ImprovementProposalPayload = {
  id?: string;
  title?: string;
  summary?: string;
  scope?: "product" | "prompt" | "workflow" | "policy" | "routing";
  hypothesis?: string;
  expectedImpact?: string;
  requiredEvals?: string[];
  sourceRunId?: string;
};

type ReplayCandidateTemplate = {
  templateId: "artifact_refs_with_delta";
  title: string;
  summary: string;
  expectedTokenReductionPct: number;
  expectedLatencyReductionPct: number;
  expectedBlockedRateReductionPct: number;
  expectedSteeringRateReductionPct: number;
  matchedSignals: string[];
};

type HistoricalReplayPayload = {
  compilerVersion: string;
  replayMode: "projection";
  proposalArtifactId: string;
  proposalTitle: string;
  templateId: ReplayCandidateTemplate["templateId"];
  baselineRunIds: string[];
  baseline: {
    runCount: number;
    avgEstimatedPromptTokens: number;
    avgLatencyMs: number;
    blockedRate: number;
    steeringRate: number;
  };
  experiment: {
    projectedAvgEstimatedPromptTokens: number;
    projectedAvgLatencyMs: number;
    projectedBlockedRate: number;
    projectedSteeringRate: number;
  };
  deltas: {
    estimatedPromptTokensPct: number;
    latencyPct: number;
    blockedRatePct: number;
    steeringRatePct: number;
  };
  requiredEvals: string[];
  matchedSignals: string[];
  verdict: "promising" | "inconclusive" | "not_applicable";
  rationale: string[];
};

export function compileLearningProposal(input: {
  state: RuntimeState;
  run: RunDetail;
}): { artifacts: ArtifactRecord[]; appendedDecisions: DecisionRecord[] } {
  const latestProposal = findLatestImprovementProposal(input.run);
  if (!latestProposal) {
    return { artifacts: [], appendedDecisions: [] };
  }

  const template = compileTemplate(latestProposal.payload);
  if (!template) {
    return { artifacts: [], appendedDecisions: [] };
  }

  const baselineRuns = collectReplayBaselineRuns(input.state, input.run);
  if (baselineRuns.length === 0) {
    return {
      artifacts: [
        createReplayArtifact({
          run: input.run,
          proposalArtifact: latestProposal.artifact,
          proposalPayload: latestProposal.payload,
          template,
          baselineRuns: [],
        }),
      ],
      appendedDecisions: [
        {
          id: `d-replay-${input.run.id}-${Date.now()}`,
          category: "technical",
          summary: "Proposal compiler could not find recent implementation baselines for replay.",
          rationale:
            "A historical replay result was still recorded so the proposal can be retried after more implementation evidence accumulates.",
        },
      ],
    };
  }

  const replayArtifact = createReplayArtifact({
    run: input.run,
    proposalArtifact: latestProposal.artifact,
    proposalPayload: latestProposal.payload,
    template,
    baselineRuns,
  });
  const payload = replayArtifact.payload as HistoricalReplayPayload;

  return {
    artifacts: [replayArtifact],
    appendedDecisions: [
      {
        id: `d-replay-${input.run.id}-${Date.now()}`,
        category: "technical",
        summary: `Proposal compiler projected ${payload.templateId} over ${payload.baseline.runCount} recent implementation runs.`,
        rationale: payload.rationale.join(" "),
      },
    ],
  };
}

function findLatestImprovementProposal(
  run: RunDetail,
): { artifact: ArtifactRecord; payload: ImprovementProposalPayload } | null {
  const artifact = [...run.artifacts]
    .reverse()
    .find((candidate) => candidate.contractKind === "improvement_proposal");
  if (!artifact || !artifact.payload || typeof artifact.payload !== "object") {
    return null;
  }
  return {
    artifact,
    payload: artifact.payload as ImprovementProposalPayload,
  };
}

function compileTemplate(
  payload: ImprovementProposalPayload,
): ReplayCandidateTemplate | null {
  const searchable = [
    payload.title,
    payload.summary,
    payload.hypothesis,
    payload.expectedImpact,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();

  const matchedSignals = [
    "artifact",
    "handoff",
    "context",
    "prompt",
    "delta",
  ].filter((signal) => searchable.includes(signal));

  if (
    (payload.scope === "workflow" || payload.scope === "prompt") &&
    matchedSignals.length > 0
  ) {
    return {
      templateId: "artifact_refs_with_delta",
      title: "Artifact-addressed handoff candidate",
      summary:
        "Replace repeated full-context prompt replay with artifact references plus a small delta context block.",
      expectedTokenReductionPct: -18,
      expectedLatencyReductionPct: -10,
      expectedBlockedRateReductionPct: -20,
      expectedSteeringRateReductionPct: -15,
      matchedSignals,
    };
  }

  return null;
}

function collectReplayBaselineRuns(
  state: RuntimeState,
  run: RunDetail,
): RunDetail[] {
  const missionRuns = state.runsByMissionId[run.missionId] ?? [];
  const scoredRuns = missionRuns
    .filter(
      (candidate) =>
        candidate.id !== run.id &&
        candidate.roleContractId === "builder_agent" &&
        candidate.executionStats,
    )
    .map((candidate, index) => ({
      candidate,
      index,
      failureScore:
        (candidate.status === "blocked" ? 2 : 0) +
        (candidate.executionStats?.blockerCount ?? 0) +
        ((candidate.executionStats?.steeringCount ?? 0) > 0 ? 1 : 0),
    }))
    .sort((left, right) => {
      if (right.failureScore !== left.failureScore) {
        return right.failureScore - left.failureScore;
      }
      return right.index - left.index;
    });

  const selected = scoredRuns
    .filter((entry) => entry.failureScore > 0)
    .slice(0, 5)
    .map((entry) => entry.candidate);

  if (selected.length > 0) {
    return selected;
  }

  return scoredRuns.slice(0, 3).map((entry) => entry.candidate);
}

function createReplayArtifact(input: {
  run: RunDetail;
  proposalArtifact: ArtifactRecord;
  proposalPayload: ImprovementProposalPayload;
  template: ReplayCandidateTemplate;
  baselineRuns: RunDetail[];
}): ArtifactRecord {
  const baseline = summarizeBaseline(input.baselineRuns);
  const experiment = {
    projectedAvgEstimatedPromptTokens: applyPercentDelta(
      baseline.avgEstimatedPromptTokens,
      input.template.expectedTokenReductionPct,
    ),
    projectedAvgLatencyMs: applyPercentDelta(
      baseline.avgLatencyMs,
      input.template.expectedLatencyReductionPct,
    ),
    projectedBlockedRate: applyRateDelta(
      baseline.blockedRate,
      input.template.expectedBlockedRateReductionPct,
    ),
    projectedSteeringRate: applyRateDelta(
      baseline.steeringRate,
      input.template.expectedSteeringRateReductionPct,
    ),
  };
  const deltas = {
    estimatedPromptTokensPct: computePercentDelta(
      baseline.avgEstimatedPromptTokens,
      experiment.projectedAvgEstimatedPromptTokens,
    ),
    latencyPct: computePercentDelta(
      baseline.avgLatencyMs,
      experiment.projectedAvgLatencyMs,
    ),
    blockedRatePct: computePercentDelta(
      baseline.blockedRate,
      experiment.projectedBlockedRate,
    ),
    steeringRatePct: computePercentDelta(
      baseline.steeringRate,
      experiment.projectedSteeringRate,
    ),
  };
  const rationale = buildReplayRationale({
    baseline,
    experiment,
    template: input.template,
  });

  const payload: HistoricalReplayPayload = {
    compilerVersion: "proposal-compiler-v1",
    replayMode: "projection",
    proposalArtifactId: input.proposalArtifact.id,
    proposalTitle:
      input.proposalPayload.title?.trim() || input.proposalArtifact.title,
    templateId: input.template.templateId,
    baselineRunIds: input.baselineRuns.map((candidate) => candidate.id),
    baseline,
    experiment,
    deltas,
    requiredEvals:
      input.proposalPayload.requiredEvals && input.proposalPayload.requiredEvals.length > 0
        ? input.proposalPayload.requiredEvals
        : ["Replay the candidate against recent implementation failures."],
    matchedSignals: input.template.matchedSignals,
    verdict:
      input.baselineRuns.length === 0
        ? "inconclusive"
        : deltas.estimatedPromptTokensPct < 0 &&
            (deltas.blockedRatePct < 0 || deltas.steeringRatePct < 0)
          ? "promising"
          : "inconclusive",
    rationale,
  };

  return createArtifactRecord({
    id: `art-replay-${input.run.id}-${Date.now()}`,
    type: "report",
    title: `Historical replay for ${payload.proposalTitle}`,
    preview:
      input.baselineRuns.length === 0
        ? "No recent implementation baseline was available for replay."
        : `Projected prompt token delta ${formatSignedPercent(
            payload.deltas.estimatedPromptTokensPct,
          )} across ${payload.baseline.runCount} recent implementation runs.`,
    contractKind: "historical_replay_result",
    payload,
    relatedArtifactIds: [
      input.proposalArtifact.id,
      ...input.baselineRuns.map((candidate) => candidate.id),
    ],
  });
}

function summarizeBaseline(runs: RunDetail[]): HistoricalReplayPayload["baseline"] {
  if (runs.length === 0) {
    return {
      runCount: 0,
      avgEstimatedPromptTokens: 0,
      avgLatencyMs: 0,
      blockedRate: 0,
      steeringRate: 0,
    };
  }

  const totalTokens = runs.reduce(
    (sum, run) => sum + (run.executionStats?.estimatedPromptTokens ?? 0),
    0,
  );
  const totalLatency = runs.reduce(
    (sum, run) => sum + (run.executionStats?.latencyMs ?? 0),
    0,
  );
  const blockedCount = runs.filter(
    (run) => run.status === "blocked" || (run.executionStats?.blockerCount ?? 0) > 0,
  ).length;
  const steeringCount = runs.filter(
    (run) => (run.executionStats?.steeringCount ?? 0) > 0,
  ).length;

  return {
    runCount: runs.length,
    avgEstimatedPromptTokens: Math.round(totalTokens / runs.length),
    avgLatencyMs: Math.round(totalLatency / runs.length),
    blockedRate: roundToTwo(blockedCount / runs.length),
    steeringRate: roundToTwo(steeringCount / runs.length),
  };
}

function buildReplayRationale(input: {
  baseline: HistoricalReplayPayload["baseline"];
  experiment: HistoricalReplayPayload["experiment"];
  template: ReplayCandidateTemplate;
}): string[] {
  const lines = [
    `Template ${input.template.templateId} was selected because the proposal referenced ${input.template.matchedSignals.join(", ")}.`,
  ];

  if (input.baseline.runCount === 0) {
    lines.push(
      "No recent implementation runs with execution stats were available, so the replay remained a projection without a baseline cohort.",
    );
    return lines;
  }

  lines.push(
    `Baseline averages were ${input.baseline.avgEstimatedPromptTokens} prompt tokens and ${input.baseline.avgLatencyMs}ms latency across ${input.baseline.runCount} implementation runs.`,
  );
  lines.push(
    `The projected experiment reduces prompt replay and handoff overhead to ${input.experiment.projectedAvgEstimatedPromptTokens} tokens and ${input.experiment.projectedAvgLatencyMs}ms latency.`,
  );
  lines.push(
    `Blocked rate moves from ${formatRate(input.baseline.blockedRate)} to ${formatRate(input.experiment.projectedBlockedRate)} and steering rate from ${formatRate(input.baseline.steeringRate)} to ${formatRate(input.experiment.projectedSteeringRate)}.`,
  );

  return lines;
}

function applyPercentDelta(value: number, deltaPct: number): number {
  return Math.max(0, Math.round(value * (1 + deltaPct / 100)));
}

function applyRateDelta(value: number, deltaPct: number): number {
  return roundToTwo(Math.max(0, Math.min(1, value * (1 + deltaPct / 100))));
}

function computePercentDelta(baseline: number, next: number): number {
  if (baseline === 0) {
    return next === 0 ? 0 : 100;
  }
  return roundToTwo(((next - baseline) / baseline) * 100);
}

function roundToTwo(value: number): number {
  return Number(value.toFixed(2));
}

function formatRate(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatSignedPercent(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}
