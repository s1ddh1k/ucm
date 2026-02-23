import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { TaskList } from "@/components/tasks/task-list";
import { TaskDetail } from "@/components/tasks/task-detail";
import { TaskKanban } from "@/components/tasks/task-kanban";
import { TaskTimeline } from "@/components/tasks/task-timeline";
import { TaskCreateDialog } from "@/components/tasks/task-create-dialog";
import { useUiStore } from "@/stores/ui";
import { FileText, LayoutGrid, List, ListTodo, GanttChart } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { useTasksQuery } from "@/queries/tasks";
import { useProposalsQuery } from "@/queries/proposals";
import { ProjectWorkspaceNav } from "@/components/layout/project-workspace-nav";
import {
  UNKNOWN_PROJECT_KEY,
  decodeProjectKeyFromRoute,
  getProjectLabel,
  getProjectKey,
  getTaskProjectPath,
  getProposalProjectPath,
} from "@/lib/project";

export default function TasksPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const routeScoped = Boolean(params.projectKey);
  const selectedTaskId = useUiStore((s) => s.selectedTaskId);
  const setSelectedTaskId = useUiStore((s) => s.setSelectedTaskId);
  const clearActiveProject = useUiStore((s) => s.clearActiveProject);
  const setTaskProjectFilter = useUiStore((s) => s.setTaskProjectFilter);
  const setActiveProject = useUiStore((s) => s.setActiveProject);
  const [viewMode, setViewMode] = useState<"list" | "board" | "timeline">("list");
  const { data: tasks } = useTasksQuery();
  const { data: proposals } = useProposalsQuery();

  const projectKey = useMemo(
    () => decodeProjectKeyFromRoute(params.projectKey),
    [params.projectKey]
  );
  const projectLabel = projectKey === UNKNOWN_PROJECT_KEY ? "Unknown Project" : getProjectLabel(projectKey);

  useEffect(() => {
    setSelectedTaskId(null);
    if (!routeScoped) {
      clearActiveProject();
      setTaskProjectFilter("");
      return;
    }
    setTaskProjectFilter(projectKey);
    setActiveProject({
      key: projectKey,
      label: projectLabel,
      path: projectKey === UNKNOWN_PROJECT_KEY ? null : projectKey,
    });
  }, [
    clearActiveProject,
    projectKey,
    projectLabel,
    routeScoped,
    setActiveProject,
    setSelectedTaskId,
    setTaskProjectFilter,
  ]);

  const projectTaskCount = useMemo(
    () => (tasks || []).filter((t) => getProjectKey(getTaskProjectPath(t)) === projectKey).length,
    [tasks, projectKey]
  );
  const projectProposalCount = useMemo(
    () => (proposals || []).filter((p) => getProjectKey(getProposalProjectPath(p)) === projectKey).length,
    [proposals, projectKey]
  );

  const defaultProjectPath = routeScoped && projectKey !== UNKNOWN_PROJECT_KEY ? projectKey : undefined;

  const boardTasks = useMemo(() => {
    if (!tasks) return [];
    let result = [...tasks];
    const projectFilter = routeScoped ? projectKey : useUiStore.getState().taskProjectFilter;
    if (projectFilter) {
      result = result.filter(
        (t) => getProjectKey(getTaskProjectPath(t)) === projectFilter
      );
    }
    return result;
  }, [tasks, routeScoped, projectKey]);

  useEffect(() => {
    if (searchParams.get("new") !== "1") return;
    setCreateOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete("new");
    next.delete("template");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  return (
    <div className="h-full flex flex-col p-6 gap-4">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          {routeScoped ? (
            <ProjectWorkspaceNav
              projectKey={projectKey}
              projectLabel={projectLabel}
              projectPath={projectKey === UNKNOWN_PROJECT_KEY ? null : projectKey}
              activeTab="tasks"
              taskCount={projectTaskCount}
              proposalCount={projectProposalCount}
            />
          ) : (
            <Card className="border-dashed">
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <ListTodo className="h-3.5 w-3.5" />
                  Global Queue
                </p>
                <h2 className="text-base font-semibold">Task Inbox</h2>
                <p className="text-sm text-muted-foreground">
                  View and triage tasks across all projects, then drill down into a project workspace.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
        <div className="flex items-center border rounded-md shrink-0">
          <button
            className={`p-1.5 transition-colors ${
              viewMode === "list" ? "bg-accent" : "hover:bg-accent/50"
            }`}
            onClick={() => setViewMode("list")}
            title="List view"
          >
            <List className="h-3.5 w-3.5" />
          </button>
          <button
            className={`p-1.5 transition-colors ${
              viewMode === "board" ? "bg-accent" : "hover:bg-accent/50"
            }`}
            onClick={() => setViewMode("board")}
            title="Board view"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </button>
          <button
            className={`p-1.5 transition-colors ${
              viewMode === "timeline" ? "bg-accent" : "hover:bg-accent/50"
            }`}
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
              onNewTask={() => {
                setCreateOpen(true);
              }}
              projectScopeLocked={routeScoped}
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

      <TaskCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultProjectPath={defaultProjectPath}
      />
    </div>
  );
}
