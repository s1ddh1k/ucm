import { ArrowLeft, FolderTree, Lightbulb, ListTodo } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { encodeProjectKeyForRoute } from "@/lib/project";

type WorkspaceTab = "overview" | "tasks" | "proposals";

interface ProjectWorkspaceNavProps {
  projectKey: string;
  projectLabel: string;
  projectPath?: string | null;
  activeTab: WorkspaceTab;
  taskCount?: number;
  proposalCount?: number;
}

export function ProjectWorkspaceNav({
  projectKey,
  projectLabel,
  projectPath,
  activeTab,
  taskCount,
  proposalCount,
}: ProjectWorkspaceNavProps) {
  const encoded = encodeProjectKeyForRoute(projectKey);
  const base = `/projects/${encoded}`;

  return (
    <Card className="border-dashed">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <FolderTree className="h-3.5 w-3.5" />
              Project Workspace
            </p>
            <h2 className="text-base font-semibold truncate">{projectLabel}</h2>
            {projectPath && (
              <p className="text-xs text-muted-foreground truncate">
                {projectPath}
              </p>
            )}
          </div>
          <Button asChild size="sm" variant="outline">
            <NavLink to="/projects">
              <ArrowLeft className="h-4 w-4" />
              Projects
            </NavLink>
          </Button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <WorkspaceLink to={base} active={activeTab === "overview"}>
            Overview
          </WorkspaceLink>
          <WorkspaceLink to={`${base}/tasks`} active={activeTab === "tasks"}>
            <ListTodo className="h-4 w-4" />
            Tasks
            {typeof taskCount === "number" && (
              <Badge variant="secondary">{taskCount}</Badge>
            )}
          </WorkspaceLink>
          <WorkspaceLink
            to={`${base}/proposals`}
            active={activeTab === "proposals"}
          >
            <Lightbulb className="h-4 w-4" />
            Proposals
            {typeof proposalCount === "number" && (
              <Badge variant="secondary">{proposalCount}</Badge>
            )}
          </WorkspaceLink>
        </div>
      </CardContent>
    </Card>
  );
}

function WorkspaceLink({
  to,
  active,
  children,
}: {
  to: string;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <NavLink
      to={to}
      end={to.split("/").length <= 3}
      className={[
        "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors",
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "hover:bg-accent text-muted-foreground hover:text-foreground",
      ].join(" ")}
    >
      {children}
    </NavLink>
  );
}
