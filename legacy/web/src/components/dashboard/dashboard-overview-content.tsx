import { useMemo, useState } from "react";
import { Activity, CheckCircle, Clock, AlertTriangle, Zap, Plus, FolderPlus, Route, Bot, ArrowUpDown, Settings, ArrowRight } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { api } from "@/api/client";
import { useStatsQuery } from "@/queries/stats";
import { useTasksQuery } from "@/queries/tasks";
import { useProposalsQuery } from "@/queries/proposals";
import { useProjectCatalogQuery } from "@/queries/projects";
import { useEventsStore } from "@/stores/events";
import { useUiStore } from "@/stores/ui";
import type { TaskFilter } from "@/stores/ui";
import { formatDuration } from "@/lib/format";
import { StatusDot } from "@/components/shared/status-dot";
import { TimeAgo } from "@/components/shared/time-ago";
import { LoadingSkeleton } from "@/components/shared/loading-skeleton";
import { ProjectAddDialog } from "@/components/projects/project-add-dialog";
import { encodeProjectKeyForRoute, getProjectKey } from "@/lib/project";
import type { Task } from "@/api/types";

export function DashboardOverviewContent() {
  const [addProjectOpen, setAddProjectOpen] = useState(false);
  const { data: stats, isLoading: statsLoading } = useStatsQuery();
  const { data: tasks } = useTasksQuery();
  const { data: proposals } = useProposalsQuery();
  const { data: projectCatalog } = useProjectCatalogQuery();
  const { data: cfg } = useQuery({
    queryKey: ["config"],
    queryFn: () => api.config.get(),
    staleTime: 30_000,
  });
  const activities = useEventsStore((s) => s.activities);
  const navigate = useNavigate();
  const [, setSearchParams] = useSearchParams();
  const setTaskFilter = useUiStore((s) => s.setTaskFilter);
  const setSelectedTaskId = useUiStore((s) => s.setSelectedTaskId);

  if (statsLoading) return <LoadingSkeleton />;

  const runningCount = tasks?.filter((t) => t.state === "running").length ?? 0;
  const reviewCount = tasks?.filter((t) => t.state === "review").length ?? 0;
  const pendingCount = tasks?.filter((t) => t.state === "pending").length ?? 0;
  const failedCount = stats?.tasksFailed ?? 0;
  const needsAttention = reviewCount > 0 || failedCount > 0;
  const taskLlmProvider = stats?.llm?.provider || (typeof cfg?.provider === "string" ? cfg.provider : "unknown");
  const taskLlmModel = stats?.llm?.model || (typeof cfg?.model === "string" ? cfg.model : "default");
  const hasNoRegisteredProject = (projectCatalog?.length || 0) === 0;
  const isFirstRun = hasNoRegisteredProject
    && (tasks?.length || 0) === 0
    && (proposals?.length || 0) === 0;

  function goToTasks(filter: TaskFilter | "all") {
    setTaskFilter(filter === "all" ? "" : filter);
    setSearchParams({ tab: "tasks" });
  }

  if (isFirstRun) {
    return (
      <div className="space-y-6">
        <Card className="border-dashed">
          <CardHeader><CardTitle>Welcome to UCM</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              First-run setup is missing one key step: register at least one project path.
              Without a project, tasks and proposals cannot be organized cleanly.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <OnboardingStep icon={FolderPlus} title="1. Add Project" desc="Register repository path(s) in Projects." />
              <OnboardingStep icon={Plus} title="2. Create Task" desc="Open Task Inbox and submit your first task." />
              <OnboardingStep icon={Route} title="3. Review Flow" desc="Track progress in Project Workspace tabs." />
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button onClick={() => setAddProjectOpen(true)}><FolderPlus className="h-4 w-4" />Add First Project</Button>
              <Button variant="outline" onClick={() => navigate("/projects")}>Open Projects</Button>
            </div>
          </CardContent>
        </Card>
        <ProjectAddDialog open={addProjectOpen} onOpenChange={setAddProjectOpen} onAdded={({ path }) => {
          const key = getProjectKey(path);
          navigate(`/projects/${encodeProjectKeyForRoute(key)}`);
        }} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {hasNoRegisteredProject && (
        <Card className="border-dashed">
          <CardContent className="p-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Project setup required</p>
              <p className="text-xs text-muted-foreground">Tasks can run, but UX and IA will remain unclear until at least one project is registered.</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => setAddProjectOpen(true)}><FolderPlus className="h-4 w-4" />Add Project</Button>
              <Button size="sm" variant="outline" onClick={() => navigate("/projects")}>Open Projects</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {needsAttention && (
        <Card className="border-yellow-400/30 bg-yellow-400/5">
          <CardContent className="p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-4 text-sm">
              <AlertTriangle className="h-4 w-4 text-yellow-400 shrink-0" />
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {reviewCount > 0 && <span className="text-foreground font-medium">{reviewCount} task{reviewCount !== 1 ? "s" : ""} awaiting review</span>}
                {reviewCount > 0 && failedCount > 0 && <span className="text-muted-foreground">&middot;</span>}
                {failedCount > 0 && <span className="text-foreground font-medium">{failedCount} failed task{failedCount !== 1 ? "s" : ""}</span>}
              </div>
            </div>
            <div className="flex gap-2">
              {reviewCount > 0 && <Button size="sm" variant="outline" onClick={() => goToTasks("review")}>Review Now <ArrowRight className="h-3.5 w-3.5" /></Button>}
              {failedCount > 0 && <Button size="sm" variant="outline" className="text-red-400 border-red-400/30 hover:bg-red-400/10" onClick={() => goToTasks("failed")}>View Failed <ArrowRight className="h-3.5 w-3.5" /></Button>}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Active" value={stats?.activeTasks?.length ?? runningCount} icon={Activity} color="text-blue-400" onClick={() => goToTasks("running")} />
        <StatCard label="Queue" value={stats?.queueLength ?? pendingCount} icon={Clock} color="text-yellow-400" onClick={() => goToTasks("pending")} />
        <StatCard label="Done" value={stats?.tasksCompleted ?? 0} icon={CheckCircle} color="text-emerald-400" onClick={() => goToTasks("done")} />
        <StatCard label="Spawns" value={stats?.totalSpawns ?? 0} icon={Zap} color="text-purple-400" />
      </div>

      <LlmRuntimeCard provider={taskLlmProvider} model={taskLlmModel} tasks={tasks} onNavigateSettings={() => navigate("/settings")} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {stats?.resources && (
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm font-medium text-muted-foreground">System Resources</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <ResourceBar label="CPU" value={stats.resources.cpuLoad} />
              <ResourceStat label="Memory" value={`${Math.round(stats.resources.memoryFreeMb).toLocaleString()} MB free`} />
              <ResourceStat label="Disk" value={stats.resources.diskFreeGb != null ? `${stats.resources.diskFreeGb.toFixed(0)} GB free` : "N/A"} />
              <ResourceStat label="Uptime" value={stats ? formatDuration(stats.uptime) : "-"} />
              {stats.resourcePressure && (
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-xs text-muted-foreground">Pressure:</span>
                  <span className={`text-xs font-medium ${stats.resourcePressure === "normal" ? "text-emerald-400" : stats.resourcePressure === "pressure" ? "text-yellow-400" : "text-red-400"}`}>{stats.resourcePressure}</span>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm font-medium text-muted-foreground">Activity Feed</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-1 max-h-64 overflow-auto">
              {activities.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recent activity</p>
              ) : (
                activities.slice(0, 20).map((activity) => {
                  const taskId = activity.data.taskId as string | undefined;
                  const isClickable = !!taskId && isTaskEvent(activity.event);
                  return (
                    <div
                      key={activity.id}
                      className={`flex items-start gap-3 text-sm ${isClickable ? "cursor-pointer hover:bg-accent/50 rounded px-2 -mx-2 py-1" : "py-1"}`}
                      onClick={isClickable ? () => { setSelectedTaskId(taskId); setSearchParams({ tab: "tasks" }); } : undefined}
                    >
                      <StatusDot status={eventToStatus(activity.event)} className="mt-1.5" />
                      <div className="flex-1 min-w-0">
                        <p className="text-foreground truncate">{formatEventMessage(activity)}</p>
                        <TimeAgo date={activity.timestamp} className="text-xs text-muted-foreground" />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <ProjectAddDialog open={addProjectOpen} onOpenChange={setAddProjectOpen} onAdded={({ path }) => {
        const key = getProjectKey(path);
        navigate(`/projects/${encodeProjectKeyForRoute(key)}`);
      }} />
    </div>
  );
}

function OnboardingStep({ icon: Icon, title, desc }: { icon: typeof FolderPlus; title: string; desc: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-medium">{title}</p>
      </div>
      <p className="text-xs text-muted-foreground mt-2">{desc}</p>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color, onClick, highlight }: {
  label: string; value: string | number; icon: typeof Activity; color: string;
  onClick?: () => void; highlight?: boolean;
}) {
  return (
    <Card className={`${onClick ? "cursor-pointer hover:bg-accent/50 transition-colors" : ""} ${highlight ? "ring-1 ring-purple-400/50" : ""}`} onClick={onClick}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-1">
          <Icon className={`h-4 w-4 ${color}`} />
          <span className="text-xs text-muted-foreground">{label}</span>
        </div>
        <div className={`text-2xl font-bold ${highlight ? "text-purple-400" : ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n >= 999_950) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function LlmRuntimeCard({ provider, model, tasks, onNavigateSettings }: {
  provider: string; model: string; tasks?: Task[]; onNavigateSettings: () => void;
}) {
  const usage = useMemo(() => {
    if (!tasks?.length) return { input: 0, output: 0, total: 0, taskCount: 0 };
    let input = 0; let output = 0; let taskCount = 0;
    for (const t of tasks) {
      const tu = t.tokenUsage;
      if (!tu) continue;
      const inp = tu.input ?? tu.inputTokens ?? 0;
      const out = tu.output ?? tu.outputTokens ?? 0;
      if (inp || out) { input += inp; output += out; taskCount++; }
    }
    return { input, output, total: input + output, taskCount };
  }, [tasks]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2"><Bot className="h-4 w-4" />LLM Runtime</CardTitle>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onNavigateSettings} aria-label="Switch AI provider"><Settings className="h-3.5 w-3.5" /><ArrowUpDown className="h-3.5 w-3.5" /></Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Task Engine</span>
          <span className="font-mono text-xs font-medium">{provider}/{model}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Terminal Chat</span>
          <span className="font-mono text-xs">{provider} (PTY session)</span>
        </div>
        <div className="pt-2 border-t space-y-2">
          {usage.total > 0 ? (
            usage.total < 100_000 ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Tokens</span>
                <span className="font-mono text-xs">
                  Input: {formatTokenCount(usage.input)} &middot; Output: {formatTokenCount(usage.output)} &middot; Total: {formatTokenCount(usage.total)}
                  <span className="text-muted-foreground ml-2">({usage.taskCount} task{usage.taskCount !== 1 ? "s" : ""})</span>
                </span>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Total Tokens</span>
                  <span className="font-mono text-xs font-medium">{formatTokenCount(usage.total)}</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-md bg-muted/50 p-2 text-center">
                    <div className="text-xs text-muted-foreground">Input</div>
                    <div className="font-mono text-sm font-medium">{formatTokenCount(usage.input)}</div>
                  </div>
                  <div className="rounded-md bg-muted/50 p-2 text-center">
                    <div className="text-xs text-muted-foreground">Output</div>
                    <div className="font-mono text-sm font-medium">{formatTokenCount(usage.output)}</div>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground text-right">across {usage.taskCount} task{usage.taskCount !== 1 ? "s" : ""}</div>
              </>
            )
          ) : (
            <div className="text-xs text-muted-foreground">No usage yet</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ResourceBar({ label, value }: { label: string; value: number }) {
  const percent = Math.round(value * 100);
  const barColor = percent > 90 ? "bg-red-400" : percent > 70 ? "bg-yellow-400" : "bg-emerald-400";
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm"><span className="text-muted-foreground">{label}</span><span>{percent}%</span></div>
      <div className="h-2 rounded-full bg-muted overflow-hidden"><div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${percent}%` }} /></div>
    </div>
  );
}

function ResourceStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm"><span className="text-muted-foreground">{label}</span><span className="font-mono text-xs">{value}</span></div>
  );
}

function isTaskEvent(event: string): boolean {
  return event === "task:created" || event === "task:updated" || event === "stage:start" || event === "stage:started" || event === "stage:complete" || event === "stage:gate" || event === "stage:gate_resolved";
}

function eventToStatus(event: string): string {
  if (event.includes("created") || event.includes("started")) return "running";
  if (event.includes("completed") || event.includes("done") || event.includes("approved")) return "done";
  if (event.includes("failed") || event.includes("rejected") || event.includes("error")) return "failed";
  if (event.includes("paused") || event.includes("gate")) return "paused";
  return "pending";
}

function formatEventMessage(activity: { event: string; data: Record<string, unknown> }): string {
  const { event, data } = activity;
  const taskId = (data.taskId as string)?.slice(0, 8);
  const title = data.title as string;
  const state = data.state as string;
  const stage = data.stage as string;
  switch (event) {
    case "task:created": return `Task created: ${title || taskId}`;
    case "task:updated": return `Task ${taskId}: ${state}`;
    case "task:deleted": return `Task deleted: ${taskId}`;
    case "proposal:created": return `Proposal: ${title || "new proposal"}`;
    case "proposal:updated": return `Proposal updated: ${title || ""}`;
    case "observer:started": return "Observer analysis started";
    case "observer:completed": return "Observer analysis completed";
    case "stage:start":
    case "stage:started": return `Stage started: ${stage || ""}${taskId ? ` (${taskId})` : ""}`;
    case "stage:complete": return `Stage completed: ${stage || ""}${taskId ? ` (${taskId})` : ""}`;
    case "stage:gate": return `Approval needed: ${stage || ""} stage${taskId ? ` (${taskId})` : ""}`;
    case "stage:gate_resolved": return `Stage ${data.action || "resolved"}: ${stage || ""}${taskId ? ` (${taskId})` : ""}`;
    case "config:updated": return "Configuration updated";
    default:
      return event;
  }
}
