import { useDaemonStore } from "@/stores/daemon";

export function useSmartInterval(baseMs: number, paused = false): number | false {
  const connected = useDaemonStore((s) => s.connected);
  if (paused) return false;
  return connected ? false : baseMs;
}
