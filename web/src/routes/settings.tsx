import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AutomationConfig } from "@/api/client";
import {
  Bot,
  Loader2,
  Pause,
  Play,
  RotateCw,
  Square,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { StageApprovalConfig } from "@/api/types";
import { StatusDot } from "@/components/shared/status-dot";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDuration } from "@/lib/format";
import { useStartDaemon, useStatsQuery, useStopDaemon } from "@/queries/stats";
import { useDaemonStore } from "@/stores/daemon";

const GATE_STAGES = [
  "clarify",
  "specify",
  "decompose",
  "design",
  "implement",
  "verify",
  "ux-review",
  "polish",
  "integrate",
] as const;

export default function SettingsPage() {
  const [confirmCleanup, setConfirmCleanup] = useState(false);
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
    mutationFn: () =>
      fetch("/api/pause", { method: "POST" }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["stats"] }),
  });

  const resumeDaemon = useMutation({
    mutationFn: () =>
      fetch("/api/resume", { method: "POST" }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["stats"] }),
  });

  const runCleanup = useMutation({
    mutationFn: () => api.cleanup.run(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("Cleanup completed.");
      setConfirmCleanup(false);
    },
    onError: (error) => {
      const detail =
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : "unknown error";
      toast.error(
        `Cleanup failed: ${detail}. Check daemon logs, then try again.`,
      );
    },
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
            <span className="text-sm font-medium capitalize">
              {daemonStatus}
            </span>
            {stats && (
              <span className="text-sm text-muted-foreground">
                (PID: {stats.pid}, Uptime: {formatDuration(stats.uptime)})
              </span>
            )}
          </div>

          <div className="flex gap-2">
            {daemonStatus === "offline" || daemonStatus === "unknown" ? (
              <Button
                size="sm"
                onClick={() => startDaemon.mutate()}
                disabled={startDaemon.isPending}
              >
                <Play className="h-4 w-4" /> Start Daemon
              </Button>
            ) : (
              <>
                {daemonStatus === "running" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => pauseDaemon.mutate()}
                    disabled={pauseDaemon.isPending}
                  >
                    <Pause className="h-4 w-4" /> Pause
                  </Button>
                )}
                {daemonStatus === "paused" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => resumeDaemon.mutate()}
                    disabled={resumeDaemon.isPending}
                  >
                    <RotateCw className="h-4 w-4" /> Resume
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => stopDaemon.mutate()}
                  disabled={stopDaemon.isPending}
                >
                  <Square className="h-4 w-4" /> Stop Daemon
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <ProviderCard />

      <StageApprovalCard />

      <AutomationDefaultsCard />

      <Card>
        <CardHeader>
          <CardTitle>Maintenance</CardTitle>
          <CardDescription>Cleanup completed and failed tasks</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setConfirmCleanup(true)}
            disabled={runCleanup.isPending}
          >
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
              <InfoRow
                label="Available Pipelines"
                value={stats.pipelines?.join(", ") || "-"}
              />
              <InfoRow
                label="Resource Pressure"
                value={stats.resourcePressure || "normal"}
              />
              <InfoRow
                label="CPU Load"
                value={`${Math.round(stats.resources.cpuLoad * 100)}%`}
              />
              <InfoRow
                label="Memory Free"
                value={`${Math.round(stats.resources.memoryFreeMb).toLocaleString()} MB`}
              />
              <InfoRow
                label="Disk Free"
                value={
                  stats.resources.diskFreeGb != null
                    ? `${stats.resources.diskFreeGb.toFixed(0)} GB`
                    : "N/A"
                }
              />
              <InfoRow
                label="Active Tasks"
                value={stats.activeTasks?.join(", ") || "none"}
              />
              <InfoRow
                label="Suspended Tasks"
                value={stats.suspendedTasks?.join(", ") || "none"}
              />
              <InfoRow
                label="Tasks Completed"
                value={String(stats.tasksCompleted)}
              />
              <InfoRow label="Tasks Failed" value={String(stats.tasksFailed)} />
              <InfoRow label="Total Spawns" value={String(stats.totalSpawns)} />
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog
        open={confirmCleanup}
        onOpenChange={(open) => {
          if (!runCleanup.isPending) setConfirmCleanup(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Run Cleanup?</DialogTitle>
            <DialogDescription>
              This removes completed/failed task worktrees, logs, and artifacts
              older than your retention window. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirmCleanup(false)}
              disabled={runCleanup.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => runCleanup.mutate()}
              disabled={runCleanup.isPending}
            >
              {runCleanup.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}{" "}
              {runCleanup.isPending ? "Cleaning..." : "Run Cleanup"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const PROVIDERS = ["claude", "codex", "gemini"] as const;
const MODELS_BY_PROVIDER: Record<string, readonly string[]> = {
  claude: ["sonnet", "opus", "haiku"],
  codex: ["high", "medium", "low"],
  gemini: ["auto", "pro", "flash"],
};
const DEFAULT_MODELS: Record<string, string> = {
  claude: "opus",
  codex: "high",
  gemini: "auto",
};

function ProviderCard() {
  const { data: stats } = useStatsQuery();
  const qc = useQueryClient();
  const { data: ucmConfig, isLoading } = useQuery({
    queryKey: ["config"],
    queryFn: () => api.config.get(),
  });

  const activeProvider =
    stats?.llm?.provider || ucmConfig?.provider || "claude";
  const activeModel = stats?.llm?.model || ucmConfig?.model || "opus";
  const availableModels =
    MODELS_BY_PROVIDER[activeProvider] || MODELS_BY_PROVIDER.claude;
  const displayedModel = availableModels.includes(activeModel)
    ? activeModel
    : availableModels[0];

  const updateConfig = useMutation({
    mutationFn: (params: { provider: string; model: string }) =>
      api.config.set(params),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["config"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      const p = data?.provider || "unknown";
      const m = data?.model || "unknown";
      toast.success(`LLM switched to ${p}/${m}`);
    },
    onError: (err) => {
      toast.error(`Failed to switch: ${err.message}`);
    },
  });

  // Sync server when displayed model diverges from active model (e.g. after provider change
  // made the old model invalid). The changeProvider function already handles this for its own
  // calls, but this catches cases where the config was changed externally.
  useEffect(() => {
    if (
      !isLoading &&
      activeModel !== displayedModel &&
      !updateConfig.isPending
    ) {
      updateConfig.mutate({ provider: activeProvider, model: displayedModel });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeModel,
    displayedModel,
    activeProvider,
    isLoading,
    updateConfig.isPending,
    updateConfig.mutate,
  ]);

  function changeProvider(newProvider: string) {
    const models = MODELS_BY_PROVIDER[newProvider] || MODELS_BY_PROVIDER.claude;
    const model = DEFAULT_MODELS[newProvider] || models[0];
    updateConfig.mutate({ provider: newProvider, model });
  }

  function changeModel(newModel: string) {
    updateConfig.mutate({ provider: activeProvider, model: newModel });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-5 w-5" />
          AI Provider
        </CardTitle>
        <CardDescription>
          Switch the AI provider and model at runtime. Changes apply to new
          tasks and terminal sessions. Running tasks are not affected.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading config...</div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium" id="provider-label">
                  Provider
                </label>
                <Select
                  value={activeProvider}
                  onValueChange={changeProvider}
                  disabled={updateConfig.isPending}
                >
                  <SelectTrigger aria-labelledby="provider-label">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDERS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" id="model-label">
                  Model
                </label>
                <Select
                  value={displayedModel}
                  onValueChange={changeModel}
                  disabled={updateConfig.isPending}
                >
                  <SelectTrigger aria-labelledby="model-label">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availableModels.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1 border-t">
              {updateConfig.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <span>Active:</span>
              )}
              <span className="font-mono font-medium text-foreground">
                {activeProvider}/{activeModel}
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
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
          Control per-stage approval gates. When auto-approve is off, the
          pipeline pauses after each stage for manual approval.
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
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAll(true)}
                disabled={updateConfig.isPending}
              >
                All Auto
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAll(false)}
                disabled={updateConfig.isPending}
              >
                All Manual
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              intake and deliver stages are always automatic.
            </p>
          </>
        ) : (
          <div className="text-sm text-muted-foreground">
            Config not available (daemon offline?)
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const AUTOMATION_TOGGLES = [
  { key: "autoExecute" as const, label: "Auto Execute", description: "Automatically run forge when a task is created" },
  { key: "autoApprove" as const, label: "Auto Approve", description: "Automatically approve tasks after forge completes" },
  { key: "autoPropose" as const, label: "Auto Propose", description: "Observer automatically generates proposals" },
  { key: "autoConvert" as const, label: "Auto Convert", description: "Automatically promote proposals to tasks" },
];

function AutomationDefaultsCard() {
  const qc = useQueryClient();
  const { data: automationConfig, isLoading } = useQuery({
    queryKey: ["automation"],
    queryFn: () => api.automation.get(),
  });

  const mutation = useMutation({
    mutationFn: (params: Partial<AutomationConfig>) => api.automation.set(params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["automation"] });
      qc.invalidateQueries({ queryKey: ["config"] });
    },
  });

  const config = automationConfig || { autoExecute: false, autoApprove: false, autoPropose: false, autoConvert: false };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Automation Defaults</CardTitle>
        <CardDescription>
          Global automation toggles. Per-project overrides can be set from each project's overview page.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading config...</div>
        ) : (
          AUTOMATION_TOGGLES.map(({ key, label, description }) => (
            <div key={key} className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs text-muted-foreground">{description}</p>
              </div>
              <Switch
                checked={!!config[key as keyof typeof config]}
                onCheckedChange={(checked) => mutation.mutate({ [key]: checked })}
                disabled={mutation.isPending}
              />
            </div>
          ))
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
