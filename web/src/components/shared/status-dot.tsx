import { cn } from "@/lib/utils";

const dotColors: Record<string, string> = {
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
};

interface StatusDotProps {
  status: string;
  pulse?: boolean;
  className?: string;
}

export function StatusDot({ status, pulse, className }: StatusDotProps) {
  const color = dotColors[status] || "bg-zinc-500";
  const shouldPulse = pulse ?? (status === "running" || status === "planning");

  return (
    <span className={cn("relative inline-flex h-2 w-2", className)}>
      {shouldPulse && (
        <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-75", color)} />
      )}
      <span className={cn("relative inline-flex h-2 w-2 rounded-full", color)} />
    </span>
  );
}
