import type {
  HandoffRecord,
  MissionSnapshot,
  RunDetail,
} from "../shared/contracts";
import type { RuntimeState } from "./runtime-state";

const impl: any = require("../../../packages/application/runtime-mutations.js");

export const createMissionInState = (
  state: RuntimeState,
  input: {
    workspaceId: string;
    title: string;
    goal: string;
    command?: string;
  },
): MissionSnapshot => impl.createMissionInState(state, input);

export const generateReleaseRevisionInState = (
  state: RuntimeState,
  input: {
    runId: string;
    releaseId: string;
    summary: string;
  },
): RunDetail | null => impl.generateReleaseRevisionInState(state, input);

export const handoffReleaseInState = (
  state: RuntimeState,
  input: {
    runId: string;
    releaseRevisionId: string;
    channel: HandoffRecord["channel"];
    target?: string;
  },
): RunDetail | null => impl.handoffReleaseInState(state, input);

export const approveReleaseRevisionInState = (
  state: RuntimeState,
  input: {
    runId: string;
    releaseRevisionId: string;
  },
): { missionId: string; run: RunDetail } | null =>
  impl.approveReleaseRevisionInState(state, input);

export const submitSteeringInState = (
  state: RuntimeState,
  input: { runId: string; text: string },
): RunDetail | null => impl.submitSteeringInState(state, input);
