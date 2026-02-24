import { Badge } from "@/components/ui/badge";
import { STATE_BG_COLORS, type TaskState } from "@/lib/constants";
import { cn } from "@/lib/utils";

interface TaskStatusBadgeProps {
  state: TaskState;
  className?: string;
}

export function TaskStatusBadge({ state, className }: TaskStatusBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn("text-xs border", STATE_BG_COLORS[state], className)}
    >
      {state}
    </Badge>
  );
}
