import {
  FilterX,
  FolderTree,
  Lightbulb,
  ListTodo,
  MoreVertical,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { ProjectAddDialog } from "@/components/projects/project-add-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingSkeleton } from "@/components/shared/loading-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  encodeProjectKeyForRoute,
  getProjectKey,
  getProjectLabel,
  getProposalProjectPath,
  getTaskProjectPath,
  UNKNOWN_PROJECT_KEY,
} from "@/lib/project";
import {
  useProjectCatalogQuery,
  useRemoveProjectCatalogItem,
} from "@/queries/projects";
import { useProposalsQuery } from "@/queries/proposals";
import { useTasksQuery } from "@/queries/tasks";
import { useUiStore } from "@/stores/ui";

type ProjectSummary = {
  key: string;
  label: string;
  path: string;
  taskCount: number;
  proposalCount: number;
  runningCount: number;
  reviewCount: number;
  registered: boolean;
};

export default function ProjectsPage() {
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const navigate = useNavigate();
  const { data: tasks, isLoading: tasksLoading } = useTasksQuery();
  const { data: proposals, isLoading: proposalsLoading } = useProposalsQuery();
  const { data: catalog, isLoading: catalogLoading } = useProjectCatalogQuery();
  const removeCatalogItem = useRemoveProjectCatalogItem();
  const activeProjectKey = useUiStore((s) => s.activeProjectKey);
  const clearActiveProject = useUiStore((s) => s.clearActiveProject);
  const setActiveProject = useUiStore((s) => s.setActiveProject);
  const setTaskProjectFilter = useUiStore((s) => s.setTaskProjectFilter);
  const setProposalProjectFilter = useUiStore(
    (s) => s.setProposalProjectFilter,
  );

  const projectSummaries = useMemo(() => {
    const map = new Map<string, ProjectSummary>();

    const ensure = (projectPath: string | null) => {
      const key = getProjectKey(projectPath);
      if (!map.has(key)) {
        map.set(key, {
          key,
          label: getProjectLabel(projectPath),
          path: projectPath || "",
          taskCount: 0,
          proposalCount: 0,
          runningCount: 0,
          reviewCount: 0,
          registered: false,
        });
      }
      return map.get(key)!;
    };

    for (const entry of catalog || []) {
      const summary = ensure(entry.path);
      summary.registered = true;
      if (entry.name?.trim()) {
        summary.label = entry.name.trim();
      }
      summary.path = entry.path;
    }

    for (const task of tasks || []) {
      const summary = ensure(getTaskProjectPath(task));
      summary.taskCount += 1;
      if (task.state === "running") summary.runningCount += 1;
      if (task.state === "review") summary.reviewCount += 1;
    }

    for (const proposal of proposals || []) {
      const summary = ensure(getProposalProjectPath(proposal));
      summary.proposalCount += 1;
    }

    return [...map.values()]
      .filter((p) => {
        if (!search.trim()) return true;
        const s = search.trim().toLowerCase();
        return (
          p.label.toLowerCase().includes(s) || p.path.toLowerCase().includes(s)
        );
      })
      .sort((a, b) => {
        if (a.registered !== b.registered) return a.registered ? -1 : 1;
        if (b.taskCount + b.proposalCount !== a.taskCount + a.proposalCount) {
          return (
            b.taskCount + b.proposalCount - (a.taskCount + a.proposalCount)
          );
        }
        return a.label.localeCompare(b.label);
      });
  }, [tasks, proposals, catalog, search]);

  const openWorkspace = (project: ProjectSummary) => {
    setActiveProject({
      key: project.key,
      label: project.label,
      path: project.path || null,
    });
    setTaskProjectFilter(project.key);
    setProposalProjectFilter(project.key);
    navigate(`/projects/${encodeProjectKeyForRoute(project.key)}`);
  };

  const openProjectTasks = (project: ProjectSummary) => {
    setActiveProject({
      key: project.key,
      label: project.label,
      path: project.path || null,
    });
    setTaskProjectFilter(project.key);
    setProposalProjectFilter(project.key);
    navigate(`/projects/${encodeProjectKeyForRoute(project.key)}/tasks`);
  };

  const openProjectProposals = (project: ProjectSummary) => {
    setActiveProject({
      key: project.key,
      label: project.label,
      path: project.path || null,
    });
    setTaskProjectFilter(project.key);
    setProposalProjectFilter(project.key);
    navigate(`/projects/${encodeProjectKeyForRoute(project.key)}/proposals`);
  };

  if (tasksLoading || proposalsLoading || catalogLoading)
    return <LoadingSkeleton />;

  return (
    <div className="p-6 space-y-6">
      {(catalog?.length || 0) === 0 && (
        <Card className="border-dashed">
          <CardContent className="p-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">
                Start by registering projects
              </p>
              <p className="text-xs text-muted-foreground">
                Registered projects become your stable IA root. Tasks and
                proposals are then grouped under each workspace.
              </p>
            </div>
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" />
              Add First Project
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Projects</h2>
          <p className="text-sm text-muted-foreground">
            Register projects first, then run work inside each project
            workspace.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeProjectKey && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                clearActiveProject();
                setTaskProjectFilter("");
                setProposalProjectFilter("");
              }}
            >
              <FilterX className="h-4 w-4" />
              Clear Scope
            </Button>
          )}
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" />
            Add Project
          </Button>
        </div>
      </div>

      <div className="max-w-sm">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or path"
            className="pl-7 h-9"
          />
        </div>
      </div>

      {projectSummaries.length === 0 ? (
        <EmptyState
          icon={FolderTree}
          title="No projects registered"
          description="Add your first project to unlock project-scoped task and proposal workflow."
          action={
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" />
              Add First Project
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {projectSummaries.map((project) => {
            const isUnknown = project.key === UNKNOWN_PROJECT_KEY;
            return (
              <Card
                key={project.key}
                className={`cursor-pointer hover:bg-accent/50 transition-colors ${project.key === activeProjectKey ? "ring-1 ring-primary/60" : ""}`}
                onClick={() => openWorkspace(project)}
              >
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center justify-between gap-2">
                    <span className="truncate">{project.label}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      {project.key === activeProjectKey && (
                        <Badge variant="secondary" className="text-[10px]">
                          Active
                        </Badge>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              openProjectTasks(project);
                            }}
                          >
                            <ListTodo className="h-4 w-4 mr-2" /> Tasks
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              openProjectProposals(project);
                            }}
                          >
                            <Lightbulb className="h-4 w-4 mr-2" /> Proposals
                          </DropdownMenuItem>
                          {project.registered && !isUnknown && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeCatalogItem.mutate(project.path);
                                }}
                              >
                                <Trash2 className="h-4 w-4 mr-2" /> Remove
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </CardTitle>
                  <p className="text-xs text-muted-foreground truncate">
                    {isUnknown ? "No project path metadata" : project.path}
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center gap-2">
                    {project.registered && (
                      <span className="text-xs text-emerald-500">
                        Registered
                      </span>
                    )}
                    <p className="text-sm text-muted-foreground">
                      {project.taskCount} tasks · {project.proposalCount}{" "}
                      proposals
                      {project.runningCount > 0 && (
                        <span className="text-blue-500">
                          {" "}
                          · {project.runningCount} running
                        </span>
                      )}
                      {project.reviewCount > 0 && (
                        <span className="text-purple-500">
                          {" "}
                          · {project.reviewCount} review
                        </span>
                      )}
                    </p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ProjectAddDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdded={({ path, name }) => {
          const key = getProjectKey(path);
          setActiveProject({
            key,
            label: name || getProjectLabel(path),
            path,
          });
          setTaskProjectFilter(key);
          setProposalProjectFilter(key);
          navigate(`/projects/${encodeProjectKeyForRoute(key)}`);
        }}
      />
    </div>
  );
}
