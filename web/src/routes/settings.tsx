import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useStatsQuery, useStartDaemon, useStopDaemon } from "@/queries/stats";
import { useDaemonStore } from "@/stores/daemon";
import { StatusDot } from "@/components/shared/status-dot";
import { api } from "@/api/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDuration } from "@/lib/format";
import { Play, Square, Pause, RotateCw, Trash2 } from "lucide-react";
import type { StageApprovalConfig } from "@/api/types";

const GATE_STAGES = [
  "clarify", "specify", "decompose", "design",
  "implement", "verify", "ux-review", "polish", "integrate",
] as const;

export default function SettingsPage() {
  const { data: stats } = useStatsQuery();
  const daemonStatus = useDaemonStore((s) => s.status);
  const setStatus = useDaemonStore((s) => s.setStatus);
  const startDaemon = useStartDaemon();
  const stopDaemon = useStopDaemon();
  const qc = useQueryClient();

  // Sync daemon status from stats query on load
  useEffect(() => {
    if (stats?.daemonStatus) {
      setStatus(stats.daemonStatus);
    }
  }, [stats?.daemonStatus, setStatus]);

  const pauseDaemon = useMutation({
    mutationFn: () => fetch("/api/pause", { method: "POST" }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["stats"] }),
  });

  const resumeDaemon = useMutation({
    mutationFn: () => fetch("/api/resume", { method: "POST" }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["stats"] }),
  });

  const runCleanup = useMutation({
    mutationFn: () => api.cleanup.run(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Daemon Control</CardTitle>
          <CardDescription>Manage the UCM daemon process</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <StatusDot status={daemonStatus} />
            <span className="text-sm font-medium capitalize">{daemonStatus}</span>
            {stats && (
              <span className="text-sm text-muted-foreground">
                (PID: {stats.pid}, Uptime: {formatDuration(stats.uptime)})
              </span>
            )}
          </div>

          <div className="flex gap-2">
            {daemonStatus === "offline" || daemonStatus === "unknown" ? (
              <Button size="sm" onClick={() => startDaemon.mutate()} disabled={startDaemon.isPending}>
                <Play className="h-4 w-4" /> Start Daemon
              </Button>
            ) : (
              <>
                {daemonStatus === "running" && (
                  <Button size="sm" variant="outline" onClick={() => pauseDaemon.mutate()}>
                    <Pause className="h-4 w-4" /> Pause
                  </Button>
                )}
                {daemonStatus === "paused" && (
                  <Button size="sm" variant="outline" onClick={() => resumeDaemon.mutate()}>
                    <RotateCw className="h-4 w-4" /> Resume
                  </Button>
                )}
                <Button size="sm" variant="destructive" onClick={() => stopDaemon.mutate()} disabled={stopDaemon.isPending}>
                  <Square className="h-4 w-4" /> Stop Daemon
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <StageApprovalCard />

      <Card>
        <CardHeader>
          <CardTitle>Maintenance</CardTitle>
          <CardDescription>Cleanup completed and failed tasks</CardDescription>
        </CardHeader>
        <CardContent>
          <Button size="sm" variant="outline" onClick={() => runCleanup.mutate()} disabled={runCleanup.isPending}>
            <Trash2 className="h-4 w-4" /> Run Cleanup
          </Button>
        </CardContent>
      </Card>

      {stats && (
        <Card>
          <CardHeader>
            <CardTitle>System Info</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <InfoRow label="PID" value={String(stats.pid)} />
              <InfoRow label="Uptime" value={formatDuration(stats.uptime)} />
              <InfoRow label="Available Pipelines" value={stats.pipelines?.join(", ") || "-"} />
              <InfoRow label="Resource Pressure" value={stats.resourcePressure || "normal"} />
              <InfoRow label="CPU Load" value={`${Math.round(stats.resources.cpuLoad * 100)}%`} />
              <InfoRow label="Memory Free" value={`${Math.round(stats.resources.memoryFreeMb).toLocaleString()} MB`} />
              <InfoRow label="Disk Free" value={stats.resources.diskFreeGb != null ? `${stats.resources.diskFreeGb.toFixed(0)} GB` : "N/A"} />
              <InfoRow label="Active Tasks" value={stats.activeTasks?.join(", ") || "none"} />
              <InfoRow label="Suspended Tasks" value={stats.suspendedTasks?.join(", ") || "none"} />
              <InfoRow label="Tasks Completed" value={String(stats.tasksCompleted)} />
              <InfoRow label="Tasks Failed" value={String(stats.tasksFailed)} />
              <InfoRow label="Total Spawns" value={String(stats.totalSpawns)} />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StageApprovalCard() {
  const qc = useQueryClient();
  const { data: ucmConfig, isLoading } = useQuery({
    queryKey: ["config"],
    queryFn: () => api.config.get(),
  });

  const updateConfig = useMutation({
    mutationFn: (stageApproval: StageApprovalConfig) =>
      api.config.set({ stageApproval }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["config"] }),
  });

  const stageApproval = ucmConfig?.stageApproval;

  function toggleStage(stage: string, checked: boolean) {
    if (!stageApproval) return;
    updateConfig.mutate({ ...stageApproval, [stage]: checked });
  }

  function setAll(value: boolean) {
    if (!stageApproval) return;
    const updated = { ...stageApproval };
    for (const stage of GATE_STAGES) {
      updated[stage] = value;
    }
    updateConfig.mutate(updated);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stage Approval</CardTitle>
        <CardDescription>
          Control per-stage approval gates. When auto-approve is off, the pipeline pauses after each stage for manual approval.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading config...</div>
        ) : stageApproval ? (
          <>
            <div className="space-y-3">
              {GATE_STAGES.map((stage) => (
                <div key={stage} className="flex items-center justify-between">
                  <span className="text-sm font-mono">{stage}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {stageApproval[stage] ? "Auto" : "Manual"}
                    </span>
                    <Switch
                      checked={stageApproval[stage]}
                      onCheckedChange={(checked) => toggleStage(stage, checked)}
                      disabled={updateConfig.isPending}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2 pt-2 border-t">
              <Button size="sm" variant="outline" onClick={() => setAll(true)} disabled={updateConfig.isPending}>
                All Auto
              </Button>
              <Button size="sm" variant="outline" onClick={() => setAll(false)} disabled={updateConfig.isPending}>
                All Manual
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              intake and deliver stages are always automatic.
            </p>
          </>
        ) : (
          <div className="text-sm text-muted-foreground">Config not available (daemon offline?)</div>
        )}
      </CardContent>
    </Card>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground w-40 shrink-0">{label}</span>
      <span className="font-mono text-xs">{value}</span>
    </div>
  );
}
