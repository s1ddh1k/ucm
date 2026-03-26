import type { RuntimeUpdateEvent, UcmDesktopApi } from "@shared/contracts";

const API_BASE = `http://127.0.0.1:${import.meta.env.VITE_UCM_PORT || 4800}`;
const WS_URL = `ws://127.0.0.1:${import.meta.env.VITE_UCM_PORT || 4800}/ws`;

async function rpc<T>(method: string, params?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}/rpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, params }),
  });
  if (!res.ok) throw new Error(`RPC ${method} failed: ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.result as T;
}

export function createApiClient(): UcmDesktopApi {
  return {
    app: {
      getVersion: () => rpc("app:get-version"),
    },
    navigation: {
      listScreens: () => rpc("navigation:list-screens"),
    },
    workspace: {
      list: () => rpc("workspace:list"),
      setActive: (input) => rpc("workspace:set-active", input),
      add: (input) => rpc("workspace:add", input),
      pickDirectory: () => Promise.resolve(null), // No native dialog in web mode
      browse: (input) => rpc("workspace:browse", input),
      createDirectory: (input) => rpc("workspace:create-directory", input),
    },
    mission: {
      list: () => rpc("mission:list"),
      getActive: () => rpc("mission:get-active"),
      setActive: (input) => rpc("mission:set-active", input),
      create: (input) => rpc("mission:create", input),
    },
    run: {
      getActive: () => rpc("run:get-active"),
      listForActiveMission: () => rpc("run:list-for-active-mission"),
      setActive: (input) => rpc("run:set-active", input),
      retry: (input) => rpc("run:retry", input),
      autopilotStep: () => rpc("run:autopilot-step"),
      autopilotBurst: (input) => rpc("run:autopilot-burst", input),
      steeringSubmit: (input) => rpc("run:steering-submit", input),
      terminalWrite: (input) => rpc("run:terminal-write", input),
      terminalResize: (input) => rpc("run:terminal-resize", input),
      terminalKill: (input) => rpc("run:terminal-kill", input),
    },
    deliverable: {
      generate: (input) => rpc("release:generate", input),
      handoff: (input) => rpc("release:handoff", input),
      approve: (input) => rpc("release:approve", input),
    },
    shell: {
      getSnapshot: () => rpc("shell:get-snapshot"),
    },
    events: {
      onRuntimeUpdate: (listener) => {
        const ws = new WebSocket(WS_URL);
        ws.onmessage = (event) => {
          try {
            const payload: RuntimeUpdateEvent = JSON.parse(String(event.data));
            listener(payload);
          } catch { /* ignore malformed */ }
        };
        ws.onclose = () => {
          // Auto-reconnect after 2s
          setTimeout(() => {
            const unsub = createApiClient().events.onRuntimeUpdate(listener);
            // Store cleanup ref — best effort
            (ws as unknown as { _unsub: () => void })._unsub = unsub;
          }, 2000);
        };
        return () => ws.close();
      },
    },
  };
}
