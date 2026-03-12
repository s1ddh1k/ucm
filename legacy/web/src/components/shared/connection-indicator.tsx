import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useStatsQuery } from "@/queries/stats";
import { useDaemonStore } from "@/stores/daemon";
import { StatusDot } from "./status-dot";

const STATS_STALE_MS = 45_000;

function formatAge(ms: number) {
  const totalSeconds = Math.max(1, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return remainMinutes === 0 ? `${hours}h` : `${hours}h ${remainMinutes}m`;
}

export function ConnectionIndicator() {
  const status = useDaemonStore((s) => s.status);
  const connected = useDaemonStore((s) => s.connected);
  const statsLastUpdatedAt = useDaemonStore((s) => s.statsLastUpdatedAt);
  const { data: stats } = useStatsQuery();
  const hivemindRunning = stats?.hivemind?.running ?? false;
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);

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
  const ageMs =
    typeof statsLastUpdatedAt === "number"
      ? Math.max(0, nowMs - statsLastUpdatedAt)
      : null;
  const stale = connected && ageMs !== null && ageMs > STATS_STALE_MS;
  const statsLabel =
    ageMs === null
      ? "stats update pending"
      : stale
        ? `stats stale (${formatAge(ageMs)} ago)`
        : `stats updated ${formatAge(ageMs)} ago`;

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
      <span
        className={cn(
          "ml-1 text-xs",
          stale ? "text-amber-600" : "text-muted-foreground",
        )}
        title={
          typeof statsLastUpdatedAt === "number"
            ? `Last stats update: ${new Date(statsLastUpdatedAt).toLocaleString()}`
            : "Waiting for first stats update"
        }
      >
        {statsLabel}
      </span>
    </div>
  );
}
