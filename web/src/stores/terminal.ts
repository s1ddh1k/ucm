import { create } from "zustand";
import { wsManager } from "@/api/websocket";
import {
  getArrayBufferField,
  getNumberField,
  getStringField,
} from "@/lib/ws-event";

const MAX_SCROLLBACK_BYTES = 256 * 1024; // 256KB ring buffer

interface TerminalState {
  spawned: boolean;
  sessionId: number | null;
  cwd: string | null;
  provider: string | null;
  scrollback: Uint8Array[];
  scrollbackSize: number;
  setSpawned: (
    spawned: boolean,
    sessionId?: number,
    cwd?: string,
    provider?: string,
  ) => void;
  appendScrollback: (data: Uint8Array) => void;
  reset: () => void;
  clearScrollback: () => void;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  spawned: false,
  sessionId: null,
  cwd: null,
  provider: null,
  scrollback: [],
  scrollbackSize: 0,
  setSpawned: (spawned, sessionId, cwd, provider) =>
    set({
      spawned,
      sessionId: sessionId ?? null,
      cwd: cwd ?? null,
      provider: provider ?? null,
    }),
  appendScrollback: (data) => {
    const state = get();
    const newSize = state.scrollbackSize + data.byteLength;
    const chunks = [...state.scrollback, data];
    // Trim oldest chunks if over budget
    let size = newSize;
    let start = 0;
    while (size > MAX_SCROLLBACK_BYTES && start < chunks.length - 1) {
      size -= chunks[start].byteLength;
      start++;
    }
    set({ scrollback: chunks.slice(start), scrollbackSize: size });
  },
  reset: () =>
    set({ spawned: false, sessionId: null, cwd: null, provider: null }),
  clearScrollback: () => set({ scrollback: [], scrollbackSize: 0 }),
}));

// ── Persistent PTY event listeners (survive component unmount) ──
// These run at module load time, before any component mounts.

wsManager.on("pty:data", (eventData) => {
  const buf = getArrayBufferField(eventData, "data");
  if (!buf) return;
  useTerminalStore.getState().appendScrollback(new Uint8Array(buf));
});

wsManager.on("pty:spawned", (data) => {
  const sessionId = getNumberField(data, "id") ?? undefined;
  const cwd = getStringField(data, "cwd") ?? undefined;
  const provider = getStringField(data, "provider") ?? undefined;
  useTerminalStore
    .getState()
    .setSpawned(true, sessionId, cwd, provider);
});

wsManager.on("pty:exit", () => {
  useTerminalStore.getState().reset();
});

wsManager.on("pty:error", () => {
  useTerminalStore.getState().reset();
});

// On WebSocket reconnect, the server-side PTY is dead (server kills on ws close).
// Reset client state so the UI shows "Start Session" instead of a frozen terminal.
wsManager.on("ws:connected", () => {
  const state = useTerminalStore.getState();
  if (state.spawned) {
    state.reset();
  }
});
