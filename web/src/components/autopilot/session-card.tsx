import type { AutopilotSessionSummary } from "@/api/types";
import { StatusDot } from "@/components/shared/status-dot";
import { TimeAgo } from "@/components/shared/time-ago";
import { cn } from "@/lib/utils";

interface SessionCardProps {
  session: AutopilotSessionSummary;
  selected: boolean;
  onClick: () => void;
}

export function SessionCard({ session, selected, onClick }: SessionCardProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-3 py-3 border-b border-border transition-colors cursor-pointer",
        "hover:bg-accent/50",
        selected && "bg-accent"
      )}
    >
      <div className="flex items-start gap-2">
        <StatusDot status={session.status} className="mt-1.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{session.projectName}</p>
          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
            <span>{session.status}</span>
            <span>·</span>
            <span>{session.stats.completedItems}/{session.stats.totalItems} items</span>
          </div>
          <TimeAgo date={session.lastActivityAt} className="text-xs text-muted-foreground" />
        </div>
      </div>
    </button>
  );
}
