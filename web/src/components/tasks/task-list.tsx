import type { Task } from "@/api/types";
import { useTasksQuery } from "@/queries/tasks";
import { useUiStore } from "@/stores/ui";
import { TaskFilters } from "./task-filters";
import { TaskListItem } from "./task-list-item";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Plus, ListTodo } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useMemo } from "react";

interface TaskListProps {
  onNewTask: () => void;
}

export function TaskList({ onNewTask }: TaskListProps) {
  const { data: tasks, isLoading } = useTasksQuery();
  const selectedTaskId = useUiStore((s) => s.selectedTaskId);
  const setSelectedTaskId = useUiStore((s) => s.setSelectedTaskId);
  const taskFilter = useUiStore((s) => s.taskFilter);
  const taskSort = useUiStore((s) => s.taskSort);
  const taskSearch = useUiStore((s) => s.taskSearch);

  const filteredTasks = useMemo(() => {
    if (!tasks) return [];
    let result = [...tasks];

    if (taskFilter) {
      result = result.filter((t) => t.state === taskFilter);
    }

    if (taskSearch) {
      const search = taskSearch.toLowerCase();
      result = result.filter(
        (t) =>
          t.title.toLowerCase().includes(search) ||
          t.id.includes(search)
      );
    }

    result.sort((a, b) => {
      if (taskSort === "priority") return (b.priority || 0) - (a.priority || 0);
      if (taskSort === "title") return a.title.localeCompare(b.title);
      return new Date(b.created).getTime() - new Date(a.created).getTime();
    });

    return result;
  }, [tasks, taskFilter, taskSort, taskSearch]);

  return (
    <div className="flex flex-col h-full border-r">
      <TaskFilters />

      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="p-3 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : filteredTasks.length === 0 ? (
          <EmptyState icon={ListTodo} title="No tasks" description="Create a new task to get started" />
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
