import { create } from "zustand";

interface TerminalState {
  spawned: boolean;
  sessionId: number | null;
  cwd: string | null;
  setSpawned: (spawned: boolean, sessionId?: number, cwd?: string) => void;
  reset: () => void;
}

export const useTerminalStore = create<TerminalState>((set) => ({
  spawned: false,
  sessionId: null,
  cwd: null,
  setSpawned: (spawned, sessionId, cwd) =>
    set({ spawned, sessionId: sessionId ?? null, cwd: cwd ?? null }),
  reset: () => set({ spawned: false, sessionId: null, cwd: null }),
}));
