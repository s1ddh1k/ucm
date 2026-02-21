import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { TaskList } from "@/components/tasks/task-list";
import { TaskDetail } from "@/components/tasks/task-detail";
import { TaskCreateDialog } from "@/components/tasks/task-create-dialog";
import { useUiStore } from "@/stores/ui";
import { FileText, ListTodo } from "lucide-react";
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

      <TaskCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultProjectPath={defaultProjectPath}
      />
    </div>
  );
}
