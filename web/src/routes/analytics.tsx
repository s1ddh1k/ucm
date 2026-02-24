import { BarChart3 } from "lucide-react";
import { useMemo } from "react";
import type { Task } from "@/api/types";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingSkeleton } from "@/components/shared/loading-skeleton";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTasksQuery } from "@/queries/tasks";

export default function AnalyticsPage() {
  const { data: tasks, isLoading } = useTasksQuery();

  const metrics = useMemo(() => {
    if (!tasks?.length) return null;
    return computeMetrics(tasks);
  }, [tasks]);

  if (isLoading) return <LoadingSkeleton />;
  if (!metrics)
    return (
      <EmptyState
        icon={BarChart3}
        title="No data yet"
        description="Complete some tasks to see analytics"
      />
    );

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard label="Total Tasks" value={metrics.total} />
        <MetricCard
          label="Approval Rate"
          value={`${metrics.approvalRate}%`}
          color={
            metrics.approvalRate >= 70 ? "text-emerald-400" : "text-amber-400"
          }
        />
        <MetricCard
          label="Failure Rate"
          value={`${metrics.failureRate}%`}
          color={
            metrics.failureRate <= 20 ? "text-emerald-400" : "text-red-400"
          }
        />
        <MetricCard label="Avg Duration" value={metrics.avgDuration} />
      </div>

      {/* Token Usage Chart */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Token Usage (Last 14 Days)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DailyTokenChart dailyTokens={metrics.dailyTokens} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Task State Distribution */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Task State Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StateDistribution
              distribution={metrics.stateDistribution}
              total={metrics.total}
            />
          </CardContent>
        </Card>

        {/* Pipeline Stage Performance */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Stage Performance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <StagePerformance stages={metrics.stageStats} />
          </CardContent>
        </Card>
      </div>

      {/* Pipeline Type Breakdown */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Pipeline Type Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PipelineBreakdown pipelines={metrics.pipelineStats} />
        </CardContent>
      </Card>
    </div>
  );
}

// ── Metric computation ──

interface DailyToken {
  date: string;
  input: number;
  output: number;
}
interface StageStats {
  stage: string;
  avgDurationMs: number;
  failCount: number;
  totalCount: number;
}
interface PipelineStats {
  pipeline: string;
  count: number;
  avgDurationMs: number;
  successRate: number;
}

function computeMetrics(tasks: Task[]) {
  const total = tasks.length;
  const done = tasks.filter((t) => t.state === "done").length;
  const failed = tasks.filter((t) => t.state === "failed").length;
  const completed = done + failed; // tasks that finished
  const approvalRate = completed > 0 ? Math.round((done / completed) * 100) : 0;
  const failureRate =
    completed > 0 ? Math.round((failed / completed) * 100) : 0;

  // Average duration for completed tasks
  const durations = tasks
    .filter((t) => t.startedAt && t.completedAt)
    .map(
      (t) =>
        new Date(t.completedAt!).getTime() - new Date(t.startedAt!).getTime(),
    );
  const avgMs =
    durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;
  const avgDuration = formatDurationShort(avgMs);

  // Daily token usage (last 14 days)
  const dailyTokens: DailyToken[] = [];
  const now = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    let input = 0;
    let output = 0;
    for (const task of tasks) {
      const taskDate = (
        task.completedAt ||
        task.startedAt ||
        task.created
      ).slice(0, 10);
      if (taskDate === dateStr && task.tokenUsage) {
        input += task.tokenUsage.input ?? task.tokenUsage.inputTokens ?? 0;
        output += task.tokenUsage.output ?? task.tokenUsage.outputTokens ?? 0;
      }
    }
    dailyTokens.push({ date: dateStr, input, output });
  }

  // State distribution
  const stateDistribution: Record<string, number> = {};
  for (const task of tasks) {
    stateDistribution[task.state] = (stateDistribution[task.state] || 0) + 1;
  }

  // Stage performance (from stageHistory)
  const stageMap = new Map<
    string,
    { durations: number[]; fails: number; total: number }
  >();
  for (const task of tasks) {
    if (!task.stageHistory) continue;
    for (const entry of task.stageHistory) {
      let s = stageMap.get(entry.stage);
      if (!s) {
        s = { durations: [], fails: 0, total: 0 };
        stageMap.set(entry.stage, s);
      }
      s.total++;
      if (entry.status === "fail") s.fails++;
      if (entry.durationMs) s.durations.push(entry.durationMs);
    }
  }
  const stageStats: StageStats[] = [...stageMap.entries()].map(
    ([stage, s]) => ({
      stage,
      avgDurationMs:
        s.durations.length > 0
          ? s.durations.reduce((a, b) => a + b, 0) / s.durations.length
          : 0,
      failCount: s.fails,
      totalCount: s.total,
    }),
  );

  // Pipeline type breakdown
  const pipelineMap = new Map<
    string,
    { count: number; durations: number[]; successes: number }
  >();
  for (const task of tasks) {
    const p = task.pipeline || task.pipelineType || "unknown";
    let s = pipelineMap.get(p);
    if (!s) {
      s = { count: 0, durations: [], successes: 0 };
      pipelineMap.set(p, s);
    }
    s.count++;
    if (task.state === "done") s.successes++;
    if (task.startedAt && task.completedAt) {
      s.durations.push(
        new Date(task.completedAt).getTime() -
          new Date(task.startedAt).getTime(),
      );
    }
  }
  const pipelineStats: PipelineStats[] = [...pipelineMap.entries()].map(
    ([pipeline, s]) => ({
      pipeline,
      count: s.count,
      avgDurationMs:
        s.durations.length > 0
          ? s.durations.reduce((a, b) => a + b, 0) / s.durations.length
          : 0,
      successRate: s.count > 0 ? Math.round((s.successes / s.count) * 100) : 0,
    }),
  );

  return {
    total,
    approvalRate,
    failureRate,
    avgDuration,
    dailyTokens,
    stateDistribution,
    stageStats,
    pipelineStats,
  };
}

function formatDurationShort(ms: number): string {
  if (ms === 0) return "-";
  const min = ms / 60000;
  if (min < 60) return `${Math.round(min)}m`;
  const hrs = min / 60;
  return `${hrs.toFixed(1)}h`;
}

function formatTokenShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

// ── Visual Components ──

function MetricCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-2xl font-bold ${color || ""}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function DailyTokenChart({ dailyTokens }: { dailyTokens: DailyToken[] }) {
  const maxTotal = Math.max(...dailyTokens.map((d) => d.input + d.output), 1);

  return (
    <div>
      <div className="flex items-end gap-1 h-40">
        {dailyTokens.map((d) => {
          const total = d.input + d.output;
          const heightPercent = (total / maxTotal) * 100;
          const inputPercent = total > 0 ? (d.input / total) * 100 : 0;
          return (
            <div
              key={d.date}
              className="flex-1 flex flex-col items-center gap-0.5"
              title={`${d.date}\nInput: ${formatTokenShort(d.input)}\nOutput: ${formatTokenShort(d.output)}`}
            >
              <div
                className="w-full flex flex-col justify-end"
                style={{ height: "100%" }}
              >
                <div
                  className="w-full rounded-t"
                  style={{
                    height: `${heightPercent}%`,
                    minHeight: total > 0 ? "2px" : "0",
                  }}
                >
                  <div
                    className="w-full bg-blue-400/60 rounded-t"
                    style={{ height: `${inputPercent}%` }}
                  />
                  <div
                    className="w-full bg-emerald-400/60"
                    style={{ height: `${100 - inputPercent}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-2 text-[10px] text-muted-foreground">
        <span>{dailyTokens[0]?.date.slice(5)}</span>
        <span>{dailyTokens[dailyTokens.length - 1]?.date.slice(5)}</span>
      </div>
      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-blue-400/60" /> Input
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-emerald-400/60" /> Output
        </span>
      </div>
    </div>
  );
}

function StateDistribution({
  distribution,
  total,
}: {
  distribution: Record<string, number>;
  total: number;
}) {
  const stateColors: Record<string, string> = {
    pending: "bg-yellow-400",
    running: "bg-blue-400",
    review: "bg-purple-400",
    done: "bg-emerald-400",
    failed: "bg-red-400",
  };

  return (
    <div className="space-y-3">
      {/* Stacked bar */}
      <div className="h-6 rounded-full overflow-hidden flex">
        {Object.entries(distribution).map(([state, count]) => (
          <div
            key={state}
            className={`${stateColors[state] || "bg-muted"} transition-all`}
            style={{ width: `${(count / total) * 100}%` }}
            title={`${state}: ${count}`}
          />
        ))}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs">
        {Object.entries(distribution).map(([state, count]) => (
          <span key={state} className="flex items-center gap-1.5">
            <span
              className={`w-2.5 h-2.5 rounded-full ${stateColors[state] || "bg-muted"}`}
            />
            <span className="capitalize">{state}</span>
            <span className="text-muted-foreground">{count}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function StagePerformance({ stages }: { stages: StageStats[] }) {
  if (stages.length === 0)
    return <p className="text-sm text-muted-foreground">No stage data</p>;
  const maxDuration = Math.max(...stages.map((s) => s.avgDurationMs), 1);

  return (
    <div className="space-y-2">
      {stages.map((s) => (
        <div key={s.stage} className="flex items-center gap-3 text-xs">
          <span className="font-mono w-20 shrink-0 truncate">{s.stage}</span>
          <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-400/60 rounded-full transition-all"
              style={{ width: `${(s.avgDurationMs / maxDuration) * 100}%` }}
            />
          </div>
          <span className="text-muted-foreground w-12 text-right">
            {formatDurationShort(s.avgDurationMs)}
          </span>
          {s.failCount > 0 && (
            <Badge
              variant="outline"
              className="text-[10px] text-red-400 border-red-400/30"
            >
              {s.failCount} fail
            </Badge>
          )}
        </div>
      ))}
    </div>
  );
}

function PipelineBreakdown({ pipelines }: { pipelines: PipelineStats[] }) {
  if (pipelines.length === 0)
    return <p className="text-sm text-muted-foreground">No pipeline data</p>;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
      {pipelines.map((p) => (
        <div key={p.pipeline} className="border rounded-lg p-3 space-y-1.5">
          <p className="text-sm font-medium capitalize">{p.pipeline}</p>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{p.count} tasks</span>
            <span
              className={
                p.successRate >= 70 ? "text-emerald-400" : "text-amber-400"
              }
            >
              {p.successRate}% success
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Avg: {formatDurationShort(p.avgDurationMs)}
          </p>
        </div>
      ))}
    </div>
  );
}
