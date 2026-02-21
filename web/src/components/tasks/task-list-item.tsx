import type { Task } from "@/api/types";
import { StatusDot } from "@/components/shared/status-dot";
import { TimeAgo } from "@/components/shared/time-ago";
import { cn } from "@/lib/utils";

interface TaskListItemProps {
  task: Task;
  selected: boolean;
  onClick: () => void;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function TaskListItem({ task, selected, onClick }: TaskListItemProps) {
  const totalTokens = task.tokenUsage?.totalTokens
    || ((task.tokenUsage?.inputTokens || 0) + (task.tokenUsage?.outputTokens || 0))
    || 0;

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
        <StatusDot status={task.state} className="mt-1.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{task.title}</p>
          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
            <span>{task.state}</span>
            {task.pipeline && (
              <>
                <span>·</span>
                <span>{task.pipeline}</span>
              </>
            )}
            {task.currentStage && (task.state === "running" || task.state === "review") && (
              <>
                <span>·</span>
                <span className={task.stageGate ? "text-amber-400" : "text-blue-400"}>
                  {task.stageGate ? `⏸ ${task.currentStage}` : task.currentStage}
                </span>
              </>
            )}
            <span>·</span>
            <TimeAgo date={task.created} />
          </div>
          {totalTokens > 0 && (
            <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground/60">
              <span>{formatTokens(totalTokens)} tokens</span>
            </div>
          )}
        </div>
      </div>
    </button>
  );
}
