import { create } from "zustand";

interface DaemonState {
  status: "running" | "paused" | "offline" | "unknown";
  connected: boolean;
  statsLastUpdatedAt: number | null;
  setStatus: (status: DaemonState["status"]) => void;
  setConnected: (connected: boolean) => void;
  setStatsLastUpdatedAt: (timestampMs: number | null) => void;
}

export const useDaemonStore = create<DaemonState>((set) => ({
  status: "unknown",
  connected: false,
  statsLastUpdatedAt: null,
  setStatus: (status) => set({ status }),
  setConnected: (connected) => set({ connected }),
  setStatsLastUpdatedAt: (timestampMs) =>
    set({ statsLastUpdatedAt: timestampMs }),
}));
