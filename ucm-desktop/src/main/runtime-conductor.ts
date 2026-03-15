import type { ArtifactRecord, RunDetail, RunEvent } from "../shared/contracts";
import type { RuntimeState } from "./runtime-state";

const impl: any = require("../../../packages/application/runtime-conductor.js");

export type ConductorDecisionContext = {
  run: RunDetail;
  event: RunEvent;
  latestArtifactType?: ArtifactRecord["type"];
  hasRelease: boolean;
};

export type ConductorDecision =
  | {
      decision: "observe";
      summary: string;
    }
  | {
      decision: "prepare_revision";
      summary: string;
      revisionSummary: string;
    }
  | {
      decision: "prepare_revision_and_request_review";
      summary: string;
      revisionSummary: string;
      handoffTarget: string;
    }
  | {
      decision: "prepare_revision_and_request_steering";
      summary: string;
      revisionSummary: string;
      handoffTarget: string;
    };

export const decideFromContext = (
  context: ConductorDecisionContext,
): ConductorDecision => impl.decideFromContext(context);

export const applyConductorDecision = (
  state: RuntimeState,
  run: RunDetail,
  decision: ConductorDecision,
): void => impl.applyConductorDecision(state, run, decision);
