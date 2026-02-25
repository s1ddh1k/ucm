import { cn } from "@/lib/utils";
import { useStatsQuery } from "@/queries/stats";
import { useDaemonStore } from "@/stores/daemon";
import { StatusDot } from "./status-dot";

export function ConnectionIndicator() {
  const status = useDaemonStore((s) => s.status);
  const connected = useDaemonStore((s) => s.connected);
  const { data: stats } = useStatsQuery();
  const hivemindRunning = stats?.hivemind?.running ?? false;

  const displayStatus = !connected ? "offline" : status;
  const label = !connected
    ? "Disconnected"
    : status === "running"
      ? "Running"
      : status === "paused"
        ? "Paused"
        : status === "unknown"
          ? "Connecting..."
          : "Offline";

  return (
    <div
      className={cn(
        "flex items-center gap-2 text-sm",
        !connected && "text-muted-foreground",
      )}
    >
      <span className="text-muted-foreground">Daemon:</span>
      <StatusDot status={displayStatus} />
      <span>{label}</span>
      <span className="text-muted-foreground ml-1">Hivemind:</span>
      <StatusDot status={hivemindRunning ? "running" : "offline"} />
    </div>
  );
}
