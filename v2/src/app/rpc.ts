import type { RPCSchema } from "electrobun/bun";
import type { ControllerStatus } from "../controller.ts";
import type { Task, LoopEvent } from "../types.ts";

export type AppRPC = {
  bun: RPCSchema<{
    requests: {
      startController: {
        params: {
          projectPath: string;
          provider: "claude" | "codex";
          model?: string;
          maxIterations: number;
          autoApprove: boolean;
        };
        response: { status: ControllerStatus; task: Task | null };
      };
      approveTask: {
        params: { approved: boolean };
        response: void;
      };
      approveMerge: {
        params: { approved: boolean };
        response: void;
      };
      submitUserInput: {
        params: { text: string };
        response: void;
      };
    };
    messages: {};
  }>;
  webview: RPCSchema<{
    requests: {};
    messages: {
      requestUserInput: { prompt: string };
      statusChange: { status: ControllerStatus };
      phase1Message: { text: string };
      taskProposed: { task: Task };
      phase2Event: { event: LoopEvent };
      requestTaskApproval: { task: Task };
      requestMergeApproval: {};
      controllerDone: { status: ControllerStatus; task: Task | null };
    };
  }>;
};
