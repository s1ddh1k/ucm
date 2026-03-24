import type { RunDetail } from "../shared/contracts";
import {
  listDeliverableRevisionArtifacts,
  listValidContractArtifacts,
} from "./runtime-artifact-queries";
import { deriveEvidencePacks } from "./runtime-evidence";
import { listProviderWindowsForWorkspace } from "./runtime-provider-broker";
import type { RuntimeState } from "./runtime-state";

export type RoleDependencyPhase = "input" | "output";

function collectRunEvents(state: RuntimeState, runId: string) {
  return state.runEventsByRunId[runId] ?? [];
}

function findMissionRun(
  state: RuntimeState,
  missionId: string,
  runId: string | undefined,
) {
  if (!runId) {
    return null;
  }
  return (state.runsByMissionId[missionId] ?? []).find((run) => run.id === runId) ?? null;
}

function hasActiveReviewPacket(
  run: RunDetail,
  freshness?: "latest_phase" | "latest_run" | "approved_only",
) {
  return run.deliverables.some((deliverable) =>
    deliverable.kind === "review_packet" &&
    deliverable.revisions.some((revision) =>
      freshness === "approved_only"
        ? revision.status === "approved"
        : revision.status === "active" || revision.status === "approved",
    ),
  );
}

function hasReportArtifact(run: RunDetail) {
  return run.artifacts.some((artifact) => artifact.type === "report");
}

function hasArtifactContractKind(
  run: RunDetail,
  kind: string,
  phase: RoleDependencyPhase,
): boolean {
  const explicitArtifacts = listValidContractArtifacts(run, kind);
  if (phase === "input") {
    return explicitArtifacts.length > 0;
  }
  const baselineCount = run.outputBaseline?.artifactContractCounts?.[kind] ?? 0;
  return explicitArtifacts.length > baselineCount;
}

function hasNewArtifactOfType(
  run: RunDetail,
  type: "diff" | "test_result" | "report",
): boolean {
  const baseline = run.outputBaseline;
  const nextCount = run.artifacts.filter((artifact) => artifact.type === type).length;
  if (!baseline) {
    return nextCount > 0;
  }
  if (type === "diff") {
    return nextCount > baseline.diffArtifactCount;
  }
  if (type === "test_result") {
    return nextCount > baseline.testArtifactCount;
  }
  return nextCount > baseline.reportArtifactCount;
}

function hasNewDecisionRecord(run: RunDetail): boolean {
  return run.decisions.length > (run.outputBaseline?.decisionCount ?? 0);
}

function hasNewDeliverableRevision(
  run: RunDetail,
  freshness?: "latest_phase" | "latest_run" | "approved_only",
): boolean {
  const baselineCount = run.outputBaseline?.deliverableRevisionCount ?? 0;
  const currentCount = run.deliverables.reduce(
    (sum, deliverable) => sum + deliverable.revisions.length,
    0,
  );
  if (currentCount <= baselineCount) {
    return false;
  }

  return run.deliverables.some((deliverable) =>
    deliverable.revisions.some((revision) => {
      if (freshness === "approved_only") {
        return revision.status === "approved";
      }
      return revision.status === "active" || revision.status === "approved";
    }),
  );
}

function countDeliverableRevisionArtifacts(
  run: RunDetail,
  freshness?: "latest_phase" | "latest_run" | "approved_only",
): number {
  return run.deliverables.reduce((sum, deliverable) => {
    return (
      sum +
      deliverable.revisions.filter((revision) => {
        if (freshness === "approved_only") {
          return revision.status === "approved";
        }
        return revision.status === "active" || revision.status === "approved";
      }).length
    );
  }, 0);
}

function hasNewRuntimeTrace(run: RunDetail): boolean {
  return run.timeline.length > (run.outputBaseline?.timelineCount ?? 0);
}

function resolveWorkspaceId(state: RuntimeState, missionId: string) {
  return state.workspaceIdByMissionId[missionId] ?? state.activeWorkspaceId;
}

export function satisfiesRoleDependency(input: {
  state: RuntimeState;
  missionId: string;
  run: RunDetail;
  kind: string;
  freshness?: "latest_phase" | "latest_run" | "approved_only";
  phase: RoleDependencyPhase;
}): boolean {
  const { state, missionId, run, kind, freshness, phase } = input;
  const mission = state.missions.find((item) => item.id === missionId) ?? null;
  const missionDetail = state.missionDetailsById[missionId] ?? null;
  const sourceRun =
    phase === "input"
      ? findMissionRun(state, missionId, run.origin?.parentRunId) ?? run
      : run;
  const runEvents = collectRunEvents(state, run.id);
  const sourceRunEvents = collectRunEvents(state, sourceRun.id);
  const evidencePacks = deriveEvidencePacks({
    ...run,
    runEvents,
  });

  switch (kind) {
    case "user_goal":
      return Boolean(mission?.goal?.trim() || missionDetail?.goal?.trim());
    case "spec_brief":
      if (hasArtifactContractKind(run, kind, phase)) {
        return true;
      }
      return Boolean(missionDetail?.goal?.trim());
    case "acceptance_checks":
      if (hasArtifactContractKind(run, kind, phase)) {
        return true;
      }
      return (missionDetail?.successCriteria.length ?? 0) > 0;
    case "success_metrics":
      if (hasArtifactContractKind(run, kind, phase)) {
        return true;
      }
      return (missionDetail?.successCriteria.length ?? 0) > 0;
    case "task_backlog":
      if (hasArtifactContractKind(run, kind, phase)) {
        return true;
      }
      return (missionDetail?.phases.length ?? 0) > 0;
    case "decision_record":
      if (hasArtifactContractKind(run, kind, phase)) {
        return true;
      }
      return phase === "output" ? hasNewDecisionRecord(run) : run.decisions.length > 0;
    case "patch_set":
      if (hasArtifactContractKind(run, kind, phase)) {
        return true;
      }
      return phase === "output"
        ? hasNewArtifactOfType(run, "diff")
        : run.artifacts.some((artifact) => artifact.type === "diff");
    case "test_result":
      if (hasArtifactContractKind(run, kind, phase)) {
        return true;
      }
      return phase === "output"
        ? hasNewArtifactOfType(run, "test_result")
        : run.artifacts.some((artifact) => artifact.type === "test_result");
    case "review_packet":
      if (freshness !== "approved_only" && hasArtifactContractKind(run, kind, phase)) {
        return true;
      }
      if (freshness === "approved_only") {
        const approvedRevisionArtifacts = listDeliverableRevisionArtifacts(
          run,
          "approved",
          "review_packet",
        );
        if (phase === "input") {
          return (
            approvedRevisionArtifacts.length > 0 ||
            hasActiveReviewPacket(run, freshness)
          );
        }
        const baselineCount =
          run.outputBaseline?.artifactContractCounts?.deliverable_revision ?? 0;
        return (
          approvedRevisionArtifacts.length > baselineCount ||
          hasNewDeliverableRevision(run, freshness)
        );
      }
      return phase === "output"
        ? hasNewDeliverableRevision(run, freshness)
        : hasActiveReviewPacket(run, freshness);
    case "evidence_pack":
      if (hasArtifactContractKind(run, kind, phase)) {
        return true;
      }
      return phase === "output"
        ? evidencePacks.length > 0 &&
            (hasNewArtifactOfType(run, "test_result") ||
              hasNewArtifactOfType(run, "diff") ||
              hasNewDeliverableRevision(run, freshness))
        : evidencePacks.length > 0;
    case "run_trace":
      if (hasArtifactContractKind(run, kind, phase)) {
        return true;
      }
      return phase === "output"
        ? hasNewRuntimeTrace(run)
        : run.timeline.length > 0 || run.terminalPreview.length > 0 || runEvents.length > 0;
    case "research_dossier":
    case "evidence_log":
    case "risk_register":
    case "architecture_record":
    case "adr_record":
    case "release_manifest":
    case "rollback_plan":
    case "improvement_proposal":
    case "incident_record":
    case "security_report":
      if (hasArtifactContractKind(run, kind, phase)) {
        return true;
      }
      return phase === "output" ? hasNewArtifactOfType(run, "report") : hasReportArtifact(run);
    case "deliverable_revision":
      if (hasArtifactContractKind(run, kind, phase)) {
        return true;
      }
      return phase === "output"
        ? hasNewDeliverableRevision(run, freshness)
        : countDeliverableRevisionArtifacts(run, freshness) > 0;
    case "handoff_record":
      if (hasArtifactContractKind(run, kind, phase)) {
        return true;
      }
      return phase === "output"
        ? run.handoffs.length > (run.outputBaseline?.handoffCount ?? 0)
        : run.handoffs.length > 0;
    case "alternative_set":
      if (hasArtifactContractKind(run, kind, phase)) {
        return true;
      }
      return phase === "output" ? hasNewArtifactOfType(run, "report") : hasReportArtifact(run);
    case "provider_seat_snapshot":
      return listProviderWindowsForWorkspace(state, resolveWorkspaceId(state, missionId)).length > 0;
    case "tool_access_policy":
      return true;
    case "project_memory":
    case "repository_conventions":
      return Boolean(mission || missionDetail || resolveWorkspaceId(state, missionId));
    case "reflection_memory":
      return (
        (state.lifecycleEventsByMissionId[missionId]?.length ?? 0) > 0 ||
        sourceRun.decisions.length > 0 ||
        sourceRun.timeline.length > 0 ||
        sourceRunEvents.length > 0
      );
    case "historical_replay_result":
      return sourceRun.artifacts.some(
        (artifact) =>
          artifact.contractKind === "improvement_proposal" ||
          artifact.contractKind === "evidence_pack",
      );
    case "dependency_changes":
      return sourceRun.artifacts.some(
        (artifact) =>
          artifact.type === "diff" || artifact.contractKind === "patch_set",
      );
    case "run_assignment":
      return Boolean(run.agentId);
    case "approval_ticket":
      return phase === "output"
        ? run.handoffs.length > (run.outputBaseline?.handoffCount ?? 0)
        : run.handoffs.length > 0;
    case "steering_packet":
      return runEvents.some(
        (event) =>
          event.kind === "steering_requested" || event.kind === "steering_submitted",
      );
    case "runtime_events":
      return (phase === "input" ? sourceRunEvents : runEvents).length > 0;
    case "telemetry_summary":
      return (phase === "input" ? sourceRun : run).timeline.length > 0;
    default:
      return false;
  }
}
