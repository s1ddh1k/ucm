import { useEffect, useState } from "react";
import { TaskList } from "@/components/tasks/task-list";
import { TaskDetail } from "@/components/tasks/task-detail";
import { TaskKanban } from "@/components/tasks/task-kanban";
import { TaskTimeline } from "@/components/tasks/task-timeline";
import { TaskCreateDialog } from "@/components/tasks/task-create-dialog";
import { TaskViewModeToggle } from "@/components/tasks/task-view-mode-toggle";
import { Button } from "@/components/ui/button";
import { useUiStore } from "@/stores/ui";
import {
  AlertCircle,
  FileText,
  Loader2,
} from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { useOpenFromSearchParam } from "@/hooks/use-open-from-search-param";
import { useTaskBoardData } from "@/hooks/use-task-board-data";
import { useTaskViewMode } from "@/hooks/use-task-view-mode";

const TASK_CREATE_CLEAR_PARAMS = ["template"] as const;

export function TaskInboxContent() {
  const [createOpen, setCreateOpen] = useState(false);
  const selectedTaskId = useUiStore((s) => s.selectedTaskId);
  const setSelectedTaskId = useUiStore((s) => s.setSelectedTaskId);
  const clearActiveProject = useUiStore((s) => s.clearActiveProject);
  const setTaskProjectFilter = useUiStore((s) => s.setTaskProjectFilter);
  const taskProjectFilter = useUiStore((s) => s.taskProjectFilter);
  const { viewMode, setViewMode, viewOptions } = useTaskViewMode();
  const {
    boardTasks,
    isLoading,
    isError,
    boardError,
    isRetrying,
    retryLabel,
    retry,
  } = useTaskBoardData({
    paused: createOpen,
    projectFilter: taskProjectFilter,
  });

  useEffect(() => {
    setSelectedTaskId(null);
    clearActiveProject();
    setTaskProjectFilter("");
  }, [clearActiveProject, setSelectedTaskId, setTaskProjectFilter]);

  useOpenFromSearchParam({
    param: "new",
    clearParams: TASK_CREATE_CLEAR_PARAMS,
    onOpen: () => setCreateOpen(true),
  });

  return (
    <div className="h-full flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0" />
        <TaskViewModeToggle
          viewMode={viewMode}
          viewOptions={viewOptions}
          onChange={setViewMode}
        />
      </div>

      {viewMode === "timeline" ? (
        <div className="flex flex-1 min-h-0 border rounded-md overflow-hidden">
          <div className="flex-1 min-w-0">
            {isLoading ? (
              <div className="h-full flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Loading tasks…</span>
              </div>
            ) : isError ? (
              <EmptyState
                icon={AlertCircle}
                title="Failed to load timeline"
                description={boardError}
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
                className="h-full"
              />
            ) : (
              <TaskTimeline tasks={boardTasks} />
            )}
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
            {isLoading ? (
              <div className="h-full flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Loading tasks…</span>
              </div>
            ) : isError ? (
              <EmptyState
                icon={AlertCircle}
                title="Failed to load board"
                description={boardError}
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
                className="h-full"
              />
            ) : (
              <TaskKanban tasks={boardTasks} />
            )}
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
