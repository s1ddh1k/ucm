import type { EvidenceCheck, EvidencePack, RunDetail } from "../shared/contracts";
import { listValidContractArtifacts } from "./runtime-artifact-queries";
import { normalizeReviewQualitySummary } from "./runtime-review-quality-core";
import { validateArtifactPayload } from "./runtime-schema-loader";

export function deriveEvidencePacks(run: RunDetail): EvidencePack[] {
  const artifactIds = run.artifacts.map((artifact) => artifact.id);
  const explicitDecisionArtifacts = listValidContractArtifacts(run, "decision_record");
  const hasDecision = run.decisions.length > 0 || explicitDecisionArtifacts.length > 0;
  const patchArtifacts = listValidContractArtifacts(run, "patch_set");
  const diffArtifacts =
    patchArtifacts.length > 0
      ? patchArtifacts
      : run.artifacts.filter((artifact) => artifact.type === "diff");
  const explicitTestArtifacts = listValidContractArtifacts(run, "test_result");
  const testArtifacts =
    explicitTestArtifacts.length > 0
      ? explicitTestArtifacts
      : run.artifacts.filter((artifact) => artifact.type === "test_result");
  const explicitReviewPackets = listValidContractArtifacts(run, "review_packet");
  const latestReviewQuality = explicitReviewPackets.at(-1)
    ? normalizeReviewQualitySummary(
        explicitReviewPackets.at(-1)?.payload as
          | {
              functionalStatus?: string;
              visualStatus?: string;
              bugRiskStatus?: string;
              smokeStatus?: string;
              knownIssues?: string[];
              surfacesReviewed?: string[];
            }
          | undefined,
      )
    : null;
  const activeRevision = run.deliverables
    .flatMap((deliverable) => deliverable.revisions)
    .find((revision) => revision.status === "active");
  const approvedRevision = run.deliverables
    .flatMap((deliverable) => deliverable.revisions)
    .find((revision) => revision.status === "approved");
  const hasReviewPacket =
    explicitReviewPackets.length > 0 || Boolean(activeRevision || approvedRevision);
  const reviewArtifactIds =
    explicitReviewPackets.length > 0
      ? explicitReviewPackets.map((artifact) => artifact.id)
      : activeRevision?.basedOnArtifactIds ?? approvedRevision?.basedOnArtifactIds ?? [];
  const reviewPacketSummary =
    explicitReviewPackets.length > 0 && !activeRevision && !approvedRevision
      ? "An explicit review packet artifact is available for inspection."
      : hasReviewPacket
        ? "A deliverable revision is available for review or completion."
        : "No deliverable revision is available yet.";

  const checks: EvidenceCheck[] = [
    {
      name: "decision_record_present",
      status: hasDecision ? "pass" : "fail",
      summary: hasDecision
        ? "The run includes at least one recorded decision."
        : "No decision record is attached to this run yet.",
    },
    {
      name: "latest_artifact_present",
      status: artifactIds.length > 0 ? "pass" : "fail",
      summary:
        artifactIds.length > 0
          ? "At least one material artifact exists for this run."
          : "No material artifact has been produced yet.",
      artifactIds,
    },
    {
      name: "verification_signal_present",
      status:
        testArtifacts.length > 0
          ? "pass"
          : diffArtifacts.length > 0
            ? "warn"
            : "fail",
      summary:
        testArtifacts.length > 0
          ? "Verification artifacts exist for this run."
          : diffArtifacts.length > 0
            ? "Implementation artifacts exist, but verification evidence is still missing."
            : "No implementation or verification artifact exists yet.",
      artifactIds: [...diffArtifacts, ...testArtifacts].map((artifact) => artifact.id),
    },
    {
      name: "review_packet_present",
      status: hasReviewPacket ? "pass" : "fail",
      summary: reviewPacketSummary,
      artifactIds: reviewArtifactIds,
    },
  ];

  if (latestReviewQuality) {
    checks.push(
      {
        name: "functional_quality_gate",
        status:
          latestReviewQuality.functionalStatus === "fail"
            ? "fail"
            : latestReviewQuality.functionalStatus === "warn"
              ? "warn"
              : "pass",
        summary: `Functional readiness is ${latestReviewQuality.functionalStatus}.`,
        artifactIds: explicitReviewPackets.at(-1) ? [explicitReviewPackets.at(-1)!.id] : undefined,
      },
      {
        name: "visual_quality_gate",
        status:
          latestReviewQuality.visualStatus === "fail"
            ? "fail"
            : latestReviewQuality.visualStatus === "warn"
              ? "warn"
              : "pass",
        summary:
          latestReviewQuality.visualStatus === "not_applicable"
            ? "Visual completeness is not applicable for this run."
            : `Visual completeness is ${latestReviewQuality.visualStatus}.`,
        artifactIds: explicitReviewPackets.at(-1) ? [explicitReviewPackets.at(-1)!.id] : undefined,
      },
      {
        name: "bug_risk_gate",
        status:
          latestReviewQuality.bugRiskStatus === "fail"
            ? "fail"
            : latestReviewQuality.bugRiskStatus === "warn"
              ? "warn"
              : latestReviewQuality.knownIssues.length > 0
                ? "warn"
                : "pass",
        summary:
          latestReviewQuality.knownIssues.length > 0
            ? `${latestReviewQuality.knownIssues.length} known issues are still open.`
            : `Bug-risk readiness is ${latestReviewQuality.bugRiskStatus}.`,
        artifactIds: explicitReviewPackets.at(-1) ? [explicitReviewPackets.at(-1)!.id] : undefined,
      },
      {
        name: "smoke_quality_gate",
        status:
          latestReviewQuality.smokeStatus === "fail"
            ? "fail"
            : latestReviewQuality.smokeStatus === "warn"
              ? "warn"
              : "pass",
        summary:
          latestReviewQuality.smokeStatus === "not_applicable"
            ? "Smoke coverage is not applicable for this run."
            : `Smoke readiness is ${latestReviewQuality.smokeStatus}.`,
        artifactIds: explicitReviewPackets.at(-1) ? [explicitReviewPackets.at(-1)!.id] : undefined,
      },
    );
  }

  const hasBlockingQualityGate = checks.some(
    (check) =>
      (check.name === "functional_quality_gate" ||
        check.name === "visual_quality_gate" ||
        check.name === "bug_risk_gate" ||
        check.name === "smoke_quality_gate") &&
      check.status !== "pass",
  );

  const decision =
    approvedRevision
      ? hasBlockingQualityGate
        ? "insufficient"
        : "promote_to_completion"
      : hasReviewPacket &&
          artifactIds.length > 0 &&
          (testArtifacts.length > 0 || diffArtifacts.length === 0)
        ? "promote_to_review"
        : "insufficient";

  const evidencePack: EvidencePack = {
    id: `evp-${run.id}-latest`,
    decision,
    checks,
    artifactIds,
    generatedAtLabel: "just now",
  };
  const validation = validateArtifactPayload("evidence_pack", evidencePack);

  if (validation.enforced && !validation.valid) {
    evidencePack.decision = "insufficient";
    evidencePack.checks = [
      ...evidencePack.checks,
      {
        name: "schema_valid",
        status: "fail",
        summary: `Evidence pack schema validation failed: ${validation.errors.join("; ")}`,
      },
    ];
  }

  return [evidencePack];
}
