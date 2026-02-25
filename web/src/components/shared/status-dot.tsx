import { cn } from "@/lib/utils";

const dotColors = {
  running: "bg-blue-400",
  pending: "bg-yellow-400",
  review: "bg-purple-400",
  done: "bg-emerald-400",
  failed: "bg-red-400",
  paused: "bg-orange-400",
  offline: "bg-zinc-500",
  online: "bg-emerald-400",
  planning: "bg-cyan-400",
  awaiting_review: "bg-purple-400",
  releasing: "bg-indigo-400",
  stopped: "bg-zinc-500",
  completed: "bg-emerald-400",
  unknown: "bg-zinc-500",
} as const;

type DotStatus = keyof typeof dotColors;

function getDotColor(status: string): string {
  if (status in dotColors) {
    return dotColors[status as DotStatus];
  }
  return "bg-zinc-500";
}

function formatStatusLabel(status: string): string {
  const normalized = status.trim();
  if (!normalized) return "unknown";
  return normalized.replace(/_/g, " ");
}

interface StatusDotProps {
  status: string;
  pulse?: boolean;
  className?: string;
}

export function StatusDot({ status, pulse, className }: StatusDotProps) {
  const color = getDotColor(status);
  const shouldPulse = pulse ?? (status === "running" || status === "planning");
  const label = formatStatusLabel(status);

  return (
    <span
      className={cn("relative inline-flex h-2 w-2", className)}
      role="img"
      aria-label={`Status: ${label}`}
    >
      {shouldPulse && (
        <span
          className={cn(
            "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
            color,
          )}
          aria-hidden="true"
        />
      )}
      <span
        className={cn("relative inline-flex h-2 w-2 rounded-full", color)}
        aria-hidden="true"
      />
    </span>
  );
}
