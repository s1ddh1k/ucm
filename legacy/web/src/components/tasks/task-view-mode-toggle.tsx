import type { TaskViewMode, TaskViewOption } from "@/hooks/use-task-view-mode";
import { cn } from "@/lib/utils";

interface TaskViewModeToggleProps {
  viewMode: TaskViewMode;
  viewOptions: readonly TaskViewOption[];
  onChange: (mode: TaskViewMode) => void;
}

export function TaskViewModeToggle({
  viewMode,
  viewOptions,
  onChange,
}: TaskViewModeToggleProps) {
  return (
    <div
      role="radiogroup"
      aria-label="Task view mode"
      className="flex items-center border rounded-md shrink-0"
    >
      {viewOptions.map(({ value, title, Icon }) => (
        <button
          type="button"
          key={value}
          role="radio"
          aria-checked={viewMode === value}
          aria-label={title}
          className={cn(
            "p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            viewMode === value ? "bg-accent" : "hover:bg-accent/50",
          )}
          onClick={() => onChange(value)}
          title={title}
        >
          <Icon className="h-3.5 w-3.5" />
        </button>
      ))}
    </div>
  );
}
