import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { TaskList } from "@/components/tasks/task-list";
import { TaskDetail } from "@/components/tasks/task-detail";
import { TaskKanban } from "@/components/tasks/task-kanban";
import { TaskTimeline } from "@/components/tasks/task-timeline";
import { TaskCreateDialog } from "@/components/tasks/task-create-dialog";
import { useUiStore } from "@/stores/ui";
import { FileText, LayoutGrid, List, GanttChart } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { useTasksQuery } from "@/queries/tasks";
import { getProjectKey, getTaskProjectPath } from "@/lib/project";

export function TaskInboxContent() {
  const [createOpen, setCreateOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedTaskId = useUiStore((s) => s.selectedTaskId);
  const setSelectedTaskId = useUiStore((s) => s.setSelectedTaskId);
  const clearActiveProject = useUiStore((s) => s.clearActiveProject);
  const setTaskProjectFilter = useUiStore((s) => s.setTaskProjectFilter);
  const [viewMode, setViewMode] = useState<"list" | "board" | "timeline">("list");
  const { data: tasks } = useTasksQuery(undefined, createOpen);

  useEffect(() => {
    setSelectedTaskId(null);
    clearActiveProject();
    setTaskProjectFilter("");
  }, [clearActiveProject, setSelectedTaskId, setTaskProjectFilter]);

  const boardTasks = useMemo(() => {
    if (!tasks) return [];
    const result = [...tasks];
    const projectFilter = useUiStore.getState().taskProjectFilter;
    if (projectFilter) {
      return result.filter(
        (t) => getProjectKey(getTaskProjectPath(t)) === projectFilter
      );
    }
    return result;
  }, [tasks]);

  useEffect(() => {
    if (searchParams.get("new") !== "1") return;
    setCreateOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete("new");
    next.delete("template");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  return (
    <div className="h-full flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0" />
        <div className="flex items-center border rounded-md shrink-0">
          <button
            className={`p-1.5 transition-colors ${viewMode === "list" ? "bg-accent" : "hover:bg-accent/50"}`}
            onClick={() => setViewMode("list")}
            title="List view"
          >
            <List className="h-3.5 w-3.5" />
          </button>
          <button
            className={`p-1.5 transition-colors ${viewMode === "board" ? "bg-accent" : "hover:bg-accent/50"}`}
            onClick={() => setViewMode("board")}
            title="Board view"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </button>
          <button
            className={`p-1.5 transition-colors ${viewMode === "timeline" ? "bg-accent" : "hover:bg-accent/50"}`}
            onClick={() => setViewMode("timeline")}
            title="Timeline view"
          >
            <GanttChart className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {viewMode === "timeline" ? (
        <div className="flex flex-1 min-h-0 border rounded-md overflow-hidden">
          <div className="flex-1 min-w-0">
            <TaskTimeline tasks={boardTasks} />
          </div>
          {selectedTaskId && (
            <div className="w-[480px] shrink-0 border-l">
              <TaskDetail taskId={selectedTaskId} />
            </div>
          )}
        </div>
      ) : viewMode === "board" ? (
        <div className="flex flex-1 min-h-0 border rounded-md overflow-hidden">
          <div className="flex-1 min-w-0">
            <TaskKanban tasks={boardTasks} />
          </div>
          {selectedTaskId && (
            <div className="w-[480px] shrink-0 border-l">
              <TaskDetail taskId={selectedTaskId} />
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-1 min-h-0 border rounded-md overflow-hidden">
          <div className="w-80 shrink-0">
            <TaskList
              onNewTask={() => setCreateOpen(true)}
              projectScopeLocked={false}
            />
          </div>
          <div className="flex-1 min-w-0">
            {selectedTaskId ? (
              <TaskDetail taskId={selectedTaskId} />
            ) : (
              <EmptyState
                icon={FileText}
                title="Select a task"
                description="Choose a task from the list to view its details"
                className="h-full"
              />
            )}
          </div>
        </div>
      )}

      <TaskCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
