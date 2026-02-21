import { create } from "zustand";

interface DaemonState {
  status: "running" | "paused" | "offline" | "unknown";
  connected: boolean;
  setStatus: (status: DaemonState["status"]) => void;
  setConnected: (connected: boolean) => void;
}

export const useDaemonStore = create<DaemonState>((set) => ({
  status: "unknown",
  connected: false,
  setStatus: (status) => set({ status }),
  setConnected: (connected) => set({ connected }),
}));
