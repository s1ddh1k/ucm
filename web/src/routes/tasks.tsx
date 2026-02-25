import {
  AlertCircle,
  FileText,
  GanttChart,
  LayoutGrid,
  List,
  ListTodo,
  Loader2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { ProjectWorkspaceNav } from "@/components/layout/project-workspace-nav";
import { EmptyState } from "@/components/shared/empty-state";
import { TaskCreateDialog } from "@/components/tasks/task-create-dialog";
import { TaskDetail } from "@/components/tasks/task-detail";
import { TaskKanban } from "@/components/tasks/task-kanban";
import { TaskList } from "@/components/tasks/task-list";
import { TaskTimeline } from "@/components/tasks/task-timeline";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useOpenFromSearchParam } from "@/hooks/use-open-from-search-param";
import {
  decodeProjectKeyFromRoute,
  getProjectKey,
  getProjectLabel,
  getProposalProjectPath,
  getTaskProjectPath,
  UNKNOWN_PROJECT_KEY,
} from "@/lib/project";
import { useProposalsQuery } from "@/queries/proposals";
import { useTasksQuery } from "@/queries/tasks";
import { useUiStore } from "@/stores/ui";

const TASK_VIEW_OPTIONS = [
  { value: "list", title: "List view", Icon: List },
  { value: "board", title: "Board view", Icon: LayoutGrid },
  { value: "timeline", title: "Timeline view", Icon: GanttChart },
] as const;
const TASK_CREATE_CLEAR_PARAMS = ["template"] as const;

export default function TasksPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const params = useParams();
  const routeScoped = Boolean(params.projectKey);
  const selectedTaskId = useUiStore((s) => s.selectedTaskId);
  const setSelectedTaskId = useUiStore((s) => s.setSelectedTaskId);
  const clearActiveProject = useUiStore((s) => s.clearActiveProject);
  const setTaskProjectFilter = useUiStore((s) => s.setTaskProjectFilter);
  const setActiveProject = useUiStore((s) => s.setActiveProject);
  const taskProjectFilter = useUiStore((s) => s.taskProjectFilter);
  const [viewMode, setViewMode] = useState<"list" | "board" | "timeline">(
    "list",
  );
  const { data: tasks, isLoading, isError, error, refetch } = useTasksQuery();
  const { data: proposals } = useProposalsQuery();

  const projectKey = useMemo(
    () => decodeProjectKeyFromRoute(params.projectKey),
    [params.projectKey],
  );
  const projectLabel =
    projectKey === UNKNOWN_PROJECT_KEY
      ? "Unknown Project"
      : getProjectLabel(projectKey);

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
    () =>
      (tasks || []).filter(
        (t) => getProjectKey(getTaskProjectPath(t)) === projectKey,
      ).length,
    [tasks, projectKey],
  );
  const projectProposalCount = useMemo(
    () =>
      (proposals || []).filter(
        (p) => getProjectKey(getProposalProjectPath(p)) === projectKey,
      ).length,
    [proposals, projectKey],
  );

  const defaultProjectPath =
    routeScoped && projectKey !== UNKNOWN_PROJECT_KEY ? projectKey : undefined;

  const boardTasks = useMemo(() => {
    if (!tasks) return [];
    let result = [...tasks];
    const projectFilter = routeScoped ? projectKey : taskProjectFilter;
    if (projectFilter) {
      result = result.filter(
        (t) => getProjectKey(getTaskProjectPath(t)) === projectFilter,
      );
    }
    return result;
  }, [tasks, routeScoped, projectKey, taskProjectFilter]);

  useOpenFromSearchParam({
    param: "new",
    clearParams: TASK_CREATE_CLEAR_PARAMS,
    onOpen: () => setCreateOpen(true),
  });

  const boardError =
    error instanceof Error
      ? error.message
      : "Task request failed. Check daemon connection and retry.";

  return (
    <div className="h-full flex flex-col p-6 gap-4">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          {routeScoped ? (
            <ProjectWorkspaceNav
              projectKey={projectKey}
              projectLabel={projectLabel}
              projectPath={
                projectKey === UNKNOWN_PROJECT_KEY ? null : projectKey
              }
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
                  View and triage tasks across all projects, then drill down
                  into a project workspace.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
        <div className="flex items-center border rounded-md shrink-0">
          {TASK_VIEW_OPTIONS.map(({ value, title, Icon }) => (
            <button
              type="button"
              key={value}
              className={`p-1.5 transition-colors ${
                viewMode === value ? "bg-accent" : "hover:bg-accent/50"
              }`}
              onClick={() => setViewMode(value)}
              title={title}
              aria-label={title}
              aria-pressed={viewMode === value}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
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
                  <Button size="sm" variant="outline" onClick={() => refetch()}>
                    Retry
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
                  <Button size="sm" variant="outline" onClick={() => refetch()}>
                    Retry
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
