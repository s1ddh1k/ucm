import { useMemo } from "react";

export type TerminalSessionStatus = "idle" | "connecting" | "connected";

interface UseTerminalSessionFeedbackInput {
  connected: boolean;
  spawned: boolean;
  sessionStatus: TerminalSessionStatus;
}

interface TerminalSessionFeedback {
  isConnecting: boolean;
  statusText: string;
  canStartSession: boolean;
  canStartNewSession: boolean;
  canEndSession: boolean;
  startLabel: string;
  newSessionLabel: string;
}

export function useTerminalSessionFeedback({
  connected,
  spawned,
  sessionStatus,
}: UseTerminalSessionFeedbackInput): TerminalSessionFeedback {
  return useMemo(() => {
    const isConnecting = sessionStatus === "connecting";
    const statusText =
      sessionStatus === "connected"
        ? "Connected"
        : sessionStatus === "connecting"
          ? "Connecting..."
          : "Idle";

    return {
      isConnecting,
      statusText,
      canStartSession: !spawned && connected && !isConnecting,
      canStartNewSession: spawned && connected && !isConnecting,
      canEndSession: spawned && !isConnecting,
      startLabel: isConnecting ? "Starting..." : "Start Session",
      newSessionLabel: isConnecting ? "Starting..." : "New Session",
    };
  }, [connected, sessionStatus, spawned]);
}
