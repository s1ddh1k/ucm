import type {
  AgentSnapshot,
  MissionSnapshot,
  RunExecutionSession,
  RunDetail,
  RunEvent,
} from "../shared/contracts";
import type { ExecutionController } from "./execution-types";
import type { RuntimeState } from "./runtime-state";

const impl: any = require("../../../packages/application/runtime-execution.js");

type ExecutionCallbacks = {
  onSessionStart: (
    missionId: string,
    runId: string,
    session: RunExecutionSession,
  ) => void;
  onTerminalData: (missionId: string, runId: string, chunk: string) => void;
  onComplete: (result: {
    missionId: string;
    runId: string;
    agentId: string;
    summary: string;
    source: "provider" | "mock" | "local";
    outcome: "completed" | "blocked" | "needs_review";
    stderr?: string;
    stdout?: string;
    generatedPatch?: string;
    session?: RunExecutionSession;
  }) => void;
};

export const collectSteeringContext = (
  state: RuntimeState,
  runId: string,
): string => impl.collectSteeringContext(state, runId);

export const maybeStartAgentExecutionInState = (input: {
  state: RuntimeState;
  missionId: string;
  runId: string;
  agentId: string;
  executionService: ExecutionController;
  callbacks: ExecutionCallbacks;
}): void => impl.maybeStartAgentExecutionInState(input);

export const completeAgentRunInState = (
  state: RuntimeState,
  input: {
    missionId: string;
    runId: string;
    agentId: string;
    summary: string;
    source: "provider" | "mock" | "local";
    outcome: "completed" | "blocked" | "needs_review";
    stderr?: string;
    stdout?: string;
    generatedPatch?: string;
    session?: RunExecutionSession;
  },
): { run: RunDetail; agent: AgentSnapshot } | null =>
  impl.completeAgentRunInState(state, input);

export const recordTerminalSessionInState = (
  state: RuntimeState,
  missionId: string,
  runId: string,
  session: RunExecutionSession,
): boolean => impl.recordTerminalSessionInState(state, missionId, runId, session);

export const appendTerminalPreviewInState = (
  state: RuntimeState,
  missionId: string,
  runId: string,
  chunk: string,
): boolean => impl.appendTerminalPreviewInState(state, missionId, runId, chunk);

export const updateMissionStatusInState = (
  state: RuntimeState,
  missionId: string,
  nextStatus: MissionSnapshot["status"],
): void => impl.updateMissionStatusInState(state, missionId, nextStatus);

export const advanceMissionStatusInState = (
  state: RuntimeState,
  missionId: string,
  eventKind: RunEvent["kind"],
  deriveMissionStatus: (
    current: MissionSnapshot["status"],
    eventKind: RunEvent["kind"],
  ) => MissionSnapshot["status"],
): void => impl.advanceMissionStatusInState(state, missionId, eventKind, deriveMissionStatus);
