import { AlertCircle, ListTodo, Loader2, Plus } from "lucide-react";
import { useEffect, useMemo } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryFeedback } from "@/hooks/use-query-feedback";
import {
  getProjectKey,
  getProjectLabel,
  getTaskProjectPath,
  UNKNOWN_PROJECT_KEY,
} from "@/lib/project";
import { useTasksQuery } from "@/queries/tasks";
import { useUiStore } from "@/stores/ui";
import { TaskFilters } from "./task-filters";
import { TaskListItem } from "./task-list-item";

interface TaskListProps {
  onNewTask: () => void;
  projectScopeLocked?: boolean;
}

export function TaskList({
  onNewTask,
  projectScopeLocked = false,
}: TaskListProps) {
  const {
    data: tasks,
    isLoading,
    isError,
    error,
    isRefetching,
    refetch,
  } = useTasksQuery();
  const selectedTaskId = useUiStore((s) => s.selectedTaskId);
  const setSelectedTaskId = useUiStore((s) => s.setSelectedTaskId);
  const taskFilter = useUiStore((s) => s.taskFilter);
  const taskProjectFilter = useUiStore((s) => s.taskProjectFilter);
  const activeProjectKey = useUiStore((s) => s.activeProjectKey);
  const activeProjectLabel = useUiStore((s) => s.activeProjectLabel);
  const clearActiveProject = useUiStore((s) => s.clearActiveProject);
  const setTaskProjectFilter = useUiStore((s) => s.setTaskProjectFilter);
  const taskSort = useUiStore((s) => s.taskSort);
  const taskSearch = useUiStore((s) => s.taskSearch);
  const effectiveProjectFilter = projectScopeLocked
    ? activeProjectKey
    : taskProjectFilter || activeProjectKey;

  const projectOptions = useMemo(() => {
    if (!tasks) return [];
    const unique = new Map<string, string>();
    for (const task of tasks) {
      const projectPath = getTaskProjectPath(task);
      const key = getProjectKey(projectPath);
      if (!unique.has(key)) {
        unique.set(key, getProjectLabel(projectPath));
      }
    }
    const labelCounts = new Map<string, number>();
    for (const label of unique.values()) {
      labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
    }
    return [...unique.entries()]
      .map(([key, label]) => {
        const duplicated =
          (labelCounts.get(label) || 0) > 1 && key !== UNKNOWN_PROJECT_KEY;
        return { key, label: duplicated ? `${label} · ${key}` : label };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    if (!tasks) return [];
    let result = [...tasks];

    if (taskFilter) {
      result = result.filter((t) => t.state === taskFilter);
    }

    if (effectiveProjectFilter) {
      result = result.filter(
        (t) => getProjectKey(getTaskProjectPath(t)) === effectiveProjectFilter,
      );
    }

    if (taskSearch) {
      const search = taskSearch.toLowerCase();
      result = result.filter(
        (t) =>
          t.title.toLowerCase().includes(search) ||
          t.id.includes(search) ||
          getProjectLabel(getTaskProjectPath(t))
            .toLowerCase()
            .includes(search) ||
          String(getTaskProjectPath(t) || "")
            .toLowerCase()
            .includes(search),
      );
    }

    result.sort((a, b) => {
      if (taskSort === "priority") return (b.priority || 0) - (a.priority || 0);
      if (taskSort === "title") return a.title.localeCompare(b.title);
      return new Date(b.created).getTime() - new Date(a.created).getTime();
    });

    return result;
  }, [tasks, taskFilter, effectiveProjectFilter, taskSort, taskSearch]);

  const {
    errorMessage: taskListError,
    isRetrying,
    retryLabel,
    retry,
  } = useQueryFeedback(
    { error, isRefetching, refetch },
    {
      fallbackDetail: "Task list request failed",
      nextStep: "Check daemon connection, then retry.",
    },
  );

  useEffect(() => {
    if (!selectedTaskId || !tasks) return;
    const exists = tasks.some((task) => task.id === selectedTaskId);
    if (!exists) setSelectedTaskId(null);
  }, [tasks, selectedTaskId, setSelectedTaskId]);

  return (
    <div className="flex flex-col h-full border-r">
      <TaskFilters
        projectOptions={projectOptions}
        projectValue={effectiveProjectFilter}
        projectScopeLocked={projectScopeLocked}
      />
      {activeProjectKey && (
        <div className="px-3 py-2 border-b bg-muted/20 flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground truncate">
            Project scope:{" "}
            <span className="text-foreground">
              {activeProjectLabel || activeProjectKey}
            </span>
          </p>
          {projectScopeLocked ? (
            <p className="text-[11px] text-muted-foreground">Locked</p>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs"
              onClick={() => {
                clearActiveProject();
                setTaskProjectFilter("");
              }}
            >
              Clear
            </Button>
          )}
        </div>
      )}

      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="p-3 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : isError ? (
          <EmptyState
            icon={AlertCircle}
            title="Failed to load tasks"
            description={taskListError}
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={retry}
                disabled={isRetrying}
                aria-busy={isRetrying}
              >
                {isRetrying && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {retryLabel}
              </Button>
            }
          />
        ) : filteredTasks.length === 0 ? (
          <EmptyState
            icon={ListTodo}
            title="No tasks"
            description="Create a new task to get started"
          />
        ) : (
          filteredTasks.map((task) => (
            <TaskListItem
              key={task.id}
              task={task}
              selected={selectedTaskId === task.id}
              onClick={() => setSelectedTaskId(task.id)}
            />
          ))
        )}
      </ScrollArea>

      <div className="p-3 border-t">
        <Button onClick={onNewTask} className="w-full" size="sm">
          <Plus className="h-4 w-4" />
          New Task
        </Button>
      </div>
    </div>
  );
}
