import { Activity, CheckCircle, Clock, AlertTriangle, Zap, Timer, Eye, Plus } from "lucide-react";
import { useNavigate } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useStatsQuery } from "@/queries/stats";
import { useTasksQuery } from "@/queries/tasks";
import { useEventsStore } from "@/stores/events";
import { useUiStore } from "@/stores/ui";
import { formatDuration } from "@/lib/format";
import { StatusDot } from "@/components/shared/status-dot";
import { TimeAgo } from "@/components/shared/time-ago";
import { LoadingSkeleton } from "@/components/shared/loading-skeleton";

export default function DashboardPage() {
  const { data: stats, isLoading: statsLoading } = useStatsQuery();
  const { data: tasks } = useTasksQuery();
  const activities = useEventsStore((s) => s.activities);
  const navigate = useNavigate();
  const setTaskFilter = useUiStore((s) => s.setTaskFilter);

  if (statsLoading) return <LoadingSkeleton />;

  const runningCount = tasks?.filter((t) => t.state === "running").length ?? 0;
  const pendingCount = tasks?.filter((t) => t.state === "pending").length ?? 0;
  const reviewCount = tasks?.filter((t) => t.state === "review").length ?? 0;

  function goToTasks(filter: string) {
    setTaskFilter(filter === "all" ? "" : filter);
    navigate("/tasks");
  }

  return (
    <div className="p-6 space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-4">
        <StatCard
          label="Active"
          value={stats?.activeTasks?.length ?? runningCount}
          icon={Activity}
          color="text-blue-400"
          onClick={() => goToTasks("running")}
        />
        <StatCard
          label="Queue"
          value={stats?.queueLength ?? pendingCount}
          icon={Clock}
          color="text-yellow-400"
          onClick={() => goToTasks("pending")}
        />
        <StatCard
          label="Review"
          value={reviewCount}
          icon={Eye}
          color="text-purple-400"
          highlight={reviewCount > 0}
          onClick={() => goToTasks("review")}
        />
        <StatCard
          label="Done"
          value={stats?.tasksCompleted ?? 0}
          icon={CheckCircle}
          color="text-emerald-400"
          onClick={() => goToTasks("done")}
        />
        <StatCard
          label="Failed"
          value={stats?.tasksFailed ?? 0}
          icon={AlertTriangle}
          color="text-red-400"
          onClick={() => goToTasks("failed")}
        />
        <StatCard
          label="Uptime"
          value={stats ? formatDuration(stats.uptime) : "-"}
          icon={Timer}
          color="text-cyan-400"
        />
        <StatCard
          label="Spawns"
          value={stats?.totalSpawns ?? 0}
          icon={Zap}
          color="text-purple-400"
        />
      </div>

      {/* Quick Actions */}
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => { navigate("/tasks"); }}>
          <Plus className="h-4 w-4" /> New Task
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Resource Gauges */}
        {stats?.resources && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground">System Resources</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <ResourceBar
                label="CPU"
                value={stats.resources.cpuLoad}
              />
              <ResourceStat
                label="Memory"
                value={`${Math.round(stats.resources.memoryFreeMb).toLocaleString()} MB free`}
              />
              <ResourceStat
                label="Disk"
                value={stats.resources.diskFreeGb != null ? `${stats.resources.diskFreeGb.toFixed(0)} GB free` : "N/A"}
              />
              {stats.resourcePressure && (
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-xs text-muted-foreground">Pressure:</span>
                  <span className={`text-xs font-medium ${
                    stats.resourcePressure === "normal" ? "text-emerald-400" :
                    stats.resourcePressure === "pressure" ? "text-yellow-400" :
                    "text-red-400"
                  }`}>
                    {stats.resourcePressure}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Activity Feed */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Activity Feed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-64 overflow-auto">
              {activities.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recent activity</p>
              ) : (
                activities.slice(0, 20).map((activity) => (
                  <div key={activity.id} className="flex items-start gap-3 text-sm">
                    <StatusDot status={eventToStatus(activity.event)} className="mt-1.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-foreground truncate">{formatEventMessage(activity)}</p>
                      <TimeAgo date={activity.timestamp} className="text-xs text-muted-foreground" />
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({
  label, value, icon: Icon, color, onClick, highlight,
}: {
  label: string; value: string | number; icon: typeof Activity; color: string;
  onClick?: () => void; highlight?: boolean;
}) {
  return (
    <Card
      className={`${onClick ? "cursor-pointer hover:bg-accent/50 transition-colors" : ""} ${highlight ? "ring-1 ring-purple-400/50" : ""}`}
      onClick={onClick}
    >
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

function ResourceBar({ label, value }: { label: string; value: number }) {
  const percent = Math.round(value * 100);
  const barColor = percent > 90 ? "bg-red-400" : percent > 70 ? "bg-yellow-400" : "bg-emerald-400";

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span>{percent}%</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function ResourceStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-xs">{value}</span>
    </div>
  );
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
    case "stage:started": return `Stage started: ${stage || ""}${taskId ? ` (${taskId})` : ""}`;
    case "stage:complete": return `Stage completed: ${stage || ""}${taskId ? ` (${taskId})` : ""}`;
    case "stage:gate": return `Approval needed: ${stage || ""} stage${taskId ? ` (${taskId})` : ""}`;
    case "stage:gate_resolved": return `Stage ${data.action || "resolved"}: ${stage || ""}${taskId ? ` (${taskId})` : ""}`;
    case "config:updated": return "Configuration updated";
    default:
      if (event.startsWith("autopilot:")) {
        const action = event.replace("autopilot:", "");
        return `Autopilot ${action}${data.sessionId ? ` (${(data.sessionId as string).slice(0, 8)})` : ""}`;
      }
      return event;
  }
}
