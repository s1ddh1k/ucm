import { useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingSkeleton } from "@/components/shared/loading-skeleton";
import { TimeAgo } from "@/components/shared/time-ago";
import { useTasksQuery } from "@/queries/tasks";
import { useProposalsQuery } from "@/queries/proposals";
import { useUiStore } from "@/stores/ui";
import {
  UNKNOWN_PROJECT_KEY,
  decodeProjectKeyFromRoute,
  getProjectLabel,
  getProjectKey,
  getTaskProjectPath,
  getProposalProjectPath,
} from "@/lib/project";
import { ProjectWorkspaceNav } from "@/components/layout/project-workspace-nav";
import { FileText, Lightbulb } from "lucide-react";

export default function ProjectOverviewPage() {
  const params = useParams();
  const navigate = useNavigate();
  const { data: tasks, isLoading: tasksLoading } = useTasksQuery();
  const { data: proposals, isLoading: proposalsLoading } = useProposalsQuery();
  const setActiveProject = useUiStore((s) => s.setActiveProject);
  const setTaskProjectFilter = useUiStore((s) => s.setTaskProjectFilter);
  const setProposalProjectFilter = useUiStore((s) => s.setProposalProjectFilter);
  const setSelectedTaskId = useUiStore((s) => s.setSelectedTaskId);

  const projectKey = useMemo(
    () => decodeProjectKeyFromRoute(params.projectKey),
    [params.projectKey]
  );
  const projectLabel = projectKey === UNKNOWN_PROJECT_KEY ? "Unknown Project" : getProjectLabel(projectKey);

  useEffect(() => {
    setActiveProject({
      key: projectKey,
      label: projectLabel,
      path: projectKey === UNKNOWN_PROJECT_KEY ? null : projectKey,
    });
    setTaskProjectFilter(projectKey);
    setProposalProjectFilter(projectKey);
  }, [projectKey, projectLabel, setActiveProject, setProposalProjectFilter, setTaskProjectFilter]);

  const projectTasks = useMemo(
    () => (tasks || []).filter((t) => getProjectKey(getTaskProjectPath(t)) === projectKey),
    [tasks, projectKey]
  );
  const projectProposals = useMemo(
    () => (proposals || []).filter((p) => getProjectKey(getProposalProjectPath(p)) === projectKey),
    [proposals, projectKey]
  );

  const runningCount = projectTasks.filter((t) => t.state === "running").length;
  const reviewCount = projectTasks.filter((t) => t.state === "review").length;
  const pendingCount = projectTasks.filter((t) => t.state === "pending").length;
  const proposedCount = projectProposals.filter((p) => p.status === "proposed").length;

  const recentTasks = [...projectTasks]
    .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime())
    .slice(0, 6);
  const recentProposals = [...projectProposals]
    .sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime())
    .slice(0, 6);

  if (tasksLoading || proposalsLoading) return <LoadingSkeleton />;

  return (
    <div className="p-6 space-y-6">
      <ProjectWorkspaceNav
        projectKey={projectKey}
        projectLabel={projectLabel}
        projectPath={projectKey === UNKNOWN_PROJECT_KEY ? null : projectKey}
        activeTab="overview"
        taskCount={projectTasks.length}
        proposalCount={projectProposals.length}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard label="Pending Tasks" value={pendingCount} />
        <SummaryCard label="Running Tasks" value={runningCount} />
        <SummaryCard label="Review Tasks" value={reviewCount} highlight={reviewCount > 0} />
        <SummaryCard label="Open Proposals" value={proposedCount} />
      </div>

      <RecommendationCard
        reviewCount={reviewCount}
        pendingCount={pendingCount}
        runningCount={runningCount}
        taskCount={projectTasks.length}
        proposalCount={projectProposals.length}
        onNavigate={(path) => navigate(path)}
      />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm">Recent Tasks</CardTitle>
            <Button size="sm" variant="outline" onClick={() => navigate("tasks")}>Open Tasks</Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {recentTasks.length === 0 ? (
              <EmptyState
                icon={FileText}
                title="No tasks in this project"
                description="Create the first task from the project task board."
              />
            ) : (
              recentTasks.map((task) => (
                <button
                  key={task.id}
                  className="w-full rounded border px-3 py-2 text-left hover:bg-accent/40 transition-colors"
                  onClick={() => {
                    setSelectedTaskId(task.id);
                    navigate("tasks");
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium truncate">{task.title}</p>
                    <Badge variant="outline">{task.state}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    <TimeAgo date={task.created} />
                  </p>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm">Recent Proposals</CardTitle>
            <Button size="sm" variant="outline" onClick={() => navigate("proposals")}>Open Proposals</Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {recentProposals.length === 0 ? (
              <EmptyState
                icon={Lightbulb}
                title="No proposals in this project"
                description="Run observer or add tasks to generate proposals."
              />
            ) : (
              recentProposals.map((proposal) => (
                <div key={proposal.id} className="rounded border px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium truncate">{proposal.title}</p>
                    <Badge variant="outline">{proposal.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {proposal.category} · {proposal.risk} risk
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <Card className={highlight ? "ring-1 ring-amber-400/50" : ""}>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={["text-2xl font-semibold", highlight ? "text-amber-400" : ""].join(" ")}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function getRecommendation(reviewCount: number, pendingCount: number, runningCount: number, taskCount: number, proposalCount: number) {
  if (reviewCount > 0) {
    return {
      message: `${reviewCount} task${reviewCount > 1 ? 's' : ''} ready for review`,
      primary: { label: "Review Now", action: "tasks" },
    };
  }
  if (taskCount === 0 && proposalCount === 0) {
    return {
      message: "Start by analyzing this project for improvement ideas",
      primary: { label: "Analyze Project", action: "proposals?kickoff=analyze" },
    };
  }
  if (pendingCount > 0) {
    return {
      message: `${pendingCount} task${pendingCount > 1 ? 's' : ''} queued and ready to start`,
      primary: { label: "View Queue", action: "tasks" },
    };
  }
  if (runningCount > 0) {
    return {
      message: `${runningCount} task${runningCount > 1 ? 's' : ''} in progress`,
      primary: { label: "View Progress", action: "tasks" },
    };
  }
  return {
    message: "Analyze this project for improvement suggestions",
    primary: { label: "Analyze Project", action: "proposals?kickoff=analyze" },
  };
}

function RecommendationCard({
  reviewCount,
  pendingCount,
  runningCount,
  taskCount,
  proposalCount,
  onNavigate,
}: {
  reviewCount: number;
  pendingCount: number;
  runningCount: number;
  taskCount: number;
  proposalCount: number;
  onNavigate: (path: string) => void;
}) {
  const rec = getRecommendation(reviewCount, pendingCount, runningCount, taskCount, proposalCount);
  return (
    <Card className="border-dashed">
      <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Recommended Next Step</p>
          <p className="text-xs text-muted-foreground">{rec.message}</p>
        </div>
        <Button size="sm" onClick={() => onNavigate(rec.primary.action)}>
          {rec.primary.label}
        </Button>
      </CardContent>
    </Card>
  );
}
