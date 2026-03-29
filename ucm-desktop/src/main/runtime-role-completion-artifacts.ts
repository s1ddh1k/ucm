import type {
  ArtifactRecord,
  DecisionRecord,
  RoleContractId,
  RunDetail,
} from "../shared/contracts";
import { createArtifactRecord } from "./runtime-artifact-records";

export type RoleCompletionBuildInput = {
  run: RunDetail;
  summary: string;
  source: "provider" | "mock" | "local";
  stdout?: string;
  generatedPatch?: string;
};

export type RoleCompletionBuildResult = {
  artifacts: ArtifactRecord[];
  appendedDecisions: DecisionRecord[];
};

type RoleCompletionBuilder = (
  input: RoleCompletionBuildInput,
) => RoleCompletionBuildResult;

type ImprovementProposalPayload = {
  id: string;
  title: string;
  summary: string;
  scope: "product" | "prompt" | "workflow" | "policy" | "routing";
  hypothesis: string;
  expectedImpact: string;
  requiredEvals: string[];
  sourceRunId: string;
};

function createRunTraceArtifact(run: RunDetail): ArtifactRecord {
  return createArtifactRecord({
    id: `art-trace-${run.id}-${Date.now()}`,
    type: "report",
    title: "Run trace",
    preview: `${run.timeline.length} checkpoints were captured for this run.`,
    contractKind: "run_trace",
    payload: {
      runId: run.id,
      objective: run.summary,
      checkpoints: run.timeline.map((entry) => ({
        at: entry.timestampLabel,
        summary: entry.summary,
      })),
    },
  });
}

function extractPrimaryPatchPath(patch: string): string {
  const match = patch.match(/^diff --git a\/(.+?) b\//m);
  return match?.[1] ?? "workspace.diff";
}

function createBuilderPatchArtifact(input: RoleCompletionBuildInput): ArtifactRecord | null {
  if (input.run.roleContractId !== "builder_agent" || !input.generatedPatch?.trim()) {
    return null;
  }

  return createArtifactRecord({
    id: `art-patch-${input.run.id}-${Date.now()}`,
    type: "diff",
    title: input.source === "local" ? "Local workspace diff" : "Builder patch set",
    preview: "Workspace changes were captured from git diff.",
    contractKind: "patch_set",
    payload: {
      runId: input.run.id,
      summary: input.summary,
      patchLength: input.generatedPatch.length,
    },
    filePatches: [
      {
        path: extractPrimaryPatchPath(input.generatedPatch),
        summary: "Generated implementation patch surface",
        patch: input.generatedPatch,
      },
    ],
  });
}

function buildBuilderCompletionArtifacts(input: RoleCompletionBuildInput): RoleCompletionBuildResult {
  const artifacts: ArtifactRecord[] = [];
  if (input.stdout) {
    artifacts.push(
      createArtifactRecord({
        id: `art-output-${input.run.id}-${Date.now()}`,
        type: "report",
        title: "Builder output",
        preview: input.stdout.slice(0, 200),
      }),
    );
  }
  return { artifacts, appendedDecisions: [] };
}

function buildQaCompletionArtifacts(input: RoleCompletionBuildInput): RoleCompletionBuildResult {
  return {
    artifacts: [
      createArtifactRecord({
        id: `art-test-${input.run.id}-${Date.now()}`,
        type: "test_result",
        title: "Verification result",
        preview: input.stdout || input.summary,
        contractKind: "test_result",
        payload: {
          runId: input.run.id,
          summary: input.summary,
          output: input.stdout || input.summary,
        },
      }),
    ],
    appendedDecisions: [],
  };
}

function buildPlannerCompletionArtifacts(input: RoleCompletionBuildInput): RoleCompletionBuildResult {
  return {
    artifacts: [
      createArtifactRecord({
        id: `art-spec-${input.run.id}-${Date.now()}`,
        type: "report",
        title: "Planner spec",
        preview: input.summary,
      }),
    ],
    appendedDecisions: [],
  };
}

function extractJsonObject(stdout?: string): Record<string, unknown> | null {
  if (!stdout?.trim()) {
    return null;
  }

  const withoutStatus = stdout
    .split(/\r?\n/)
    .filter((line) => !/^status:/i.test(line.trim()))
    .join("\n")
    .trim();
  const fencedMatch = withoutStatus.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fencedMatch?.[1]?.trim() || withoutStatus;
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    return null;
  }

  try {
    const parsed = JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function normalizeProposalScope(
  value: unknown,
): ImprovementProposalPayload["scope"] {
  if (
    value === "product" ||
    value === "prompt" ||
    value === "workflow" ||
    value === "policy" ||
    value === "routing"
  ) {
    return value;
  }
  return "workflow";
}

function normalizeProposalString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeRequiredEvals(value: unknown): string[] {
  if (Array.isArray(value)) {
    const items = value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
    if (items.length > 0) {
      return items;
    }
  }
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  return ["Replay the candidate against recent implementation failures."];
}

function buildImprovementProposalPayload(
  input: RoleCompletionBuildInput,
): ImprovementProposalPayload {
  const parsed = extractJsonObject(input.stdout);
  const fallbackTitle = `Learning proposal from ${input.run.title}`;
  const fallbackSummary = input.summary;

  return {
    id: `imp-${input.run.id}-${Date.now()}`,
    title: normalizeProposalString(parsed?.title, fallbackTitle),
    summary: normalizeProposalString(parsed?.summary, fallbackSummary),
    scope: normalizeProposalScope(parsed?.scope),
    hypothesis: normalizeProposalString(parsed?.hypothesis, fallbackSummary),
    expectedImpact: normalizeProposalString(
      parsed?.expectedImpact,
      "Reduce recurring blockers or review overhead in similar runs.",
    ),
    requiredEvals: normalizeRequiredEvals(parsed?.requiredEvals),
    sourceRunId: input.run.id,
  };
}

function buildLearningCompletionArtifacts(
  input: RoleCompletionBuildInput,
): RoleCompletionBuildResult {
  const payload = buildImprovementProposalPayload(input);
  return {
    artifacts: [
      createArtifactRecord({
        id: `art-improvement-${input.run.id}-${Date.now()}`,
        type: "report",
        title: payload.title,
        preview: payload.summary,
        contractKind: "improvement_proposal",
        payload,
      }),
    ],
    appendedDecisions: [],
  };
}

const ROLE_COMPLETION_BUILDERS: Partial<Record<RoleContractId, RoleCompletionBuilder>> = {
  conductor: buildPlannerCompletionArtifacts,
  builder_agent: buildBuilderCompletionArtifacts,
  learning_agent: buildLearningCompletionArtifacts,
  qa_agent: buildQaCompletionArtifacts,
};

export function buildRoleCompletionArtifacts(
  input: RoleCompletionBuildInput,
): RoleCompletionBuildResult {
  const artifacts: ArtifactRecord[] = [];
  const appendedDecisions: DecisionRecord[] = [];

  const builderPatch = createBuilderPatchArtifact(input);
  if (builderPatch) {
    artifacts.push(builderPatch);
  }

  const roleBuilder = input.run.roleContractId
    ? ROLE_COMPLETION_BUILDERS[input.run.roleContractId]
    : undefined;
  if (roleBuilder) {
    const roleCompletion = roleBuilder(input);
    artifacts.push(...roleCompletion.artifacts);
    appendedDecisions.push(...roleCompletion.appendedDecisions);
  }

  artifacts.push(createRunTraceArtifact(input.run));

  return { artifacts, appendedDecisions };
}
