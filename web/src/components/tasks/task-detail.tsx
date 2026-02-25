import {
  Ban,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  Pause,
  Play,
  RotateCw,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  PolishSummary,
  Task,
  TaskState,
  UxReviewReport,
  VerifyReport,
} from "@/api/types";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type ArtifactKind, useArtifactFiles } from "@/hooks/use-artifact-files";
import { useAutoScroll } from "@/hooks/use-auto-scroll";
import {
  parsePolishSummary,
  parseUxReviewReport,
  parseVerifyReport,
} from "@/lib/artifact-parsers";
import { PIPELINES, type PipelineName } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import { getTaskProjectLabel, getTaskProjectPath } from "@/lib/project";
import {
  useApproveTask,
  useCancelTask,
  useDeleteTask,
  useRejectTask,
  useRetryTask,
  useStageGateApprove,
  useStageGateReject,
  useStartTask,
  useTaskArtifactsQuery,
  useTaskDiffQuery,
  useTaskLogsQuery,
  useTaskQuery,
  useUpdatePriority,
} from "@/queries/tasks";
import { useEventsStore } from "@/stores/events";
import { TaskPipelineStepper } from "./task-pipeline-stepper";
import { TaskStatusBadge } from "./task-status-badge";

interface TaskDetailProps {
  taskId: string;
}

type TaskDetailTab = "overview" | "logs" | "diff" | "artifacts";

export function TaskDetail({ taskId }: TaskDetailProps) {
  const {
    data: task,
    isLoading: isTaskLoading,
    isError: isTaskError,
    error: taskError,
    refetch: refetchTask,
  } = useTaskQuery(taskId);
  const projectPath = task ? getTaskProjectPath(task) : null;
  const projectLabel = task ? getTaskProjectLabel(task) : "";
  const [feedbackText, setFeedbackText] = useState("");
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [activeTab, setActiveTab] = useState<TaskDetailTab>("overview");

  const startTask = useStartTask();
  const approveTask = useApproveTask();
  const rejectTask = useRejectTask();
  const cancelTask = useCancelTask();
  const retryTask = useRetryTask();
  const deleteTask = useDeleteTask();
  const gateApprove = useStageGateApprove();
  const gateReject = useStageGateReject();
  const updatePriority = useUpdatePriority();

  useEffect(() => {
    setActiveTab("overview");
    // biome-ignore lint/correctness/useExhaustiveDependencies: reset tab on taskId change
  }, [taskId]);

  useEffect(() => {
    if (task?.state === "review" && activeTab === "overview") {
      setActiveTab("diff");
    }
  }, [activeTab, task?.state]);

  if (isTaskLoading && !task) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <RotateCw className="h-4 w-4 animate-spin" />
          <span>Loading task details...</span>
        </div>
      </div>
    );
  }

  if (isTaskError && !task) {
    const description =
      taskError instanceof Error
        ? taskError.message
        : "Failed to load task details.";
    return (
      <EmptyState
        icon={Ban}
        title="Task detail unavailable"
        description={description}
        action={
          <Button size="sm" variant="outline" onClick={() => refetchTask()}>
            <RotateCw className="h-4 w-4" /> Retry
          </Button>
        }
      />
    );
  }

  if (!task) {
    return (
      <EmptyState
        icon={FileText}
        title="Task not found"
        description="The selected task may have been deleted or is no longer available."
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold truncate">{task.title}</h2>
            <div className="flex items-center gap-2 mt-1">
              <TaskStatusBadge state={task.state as TaskState} />
              <Badge
                variant="outline"
                className="text-[10px] font-normal"
                title={projectPath || projectLabel}
              >
                {projectLabel}
              </Badge>
              {task.pipeline && (
                <span className="text-xs text-muted-foreground">
                  {task.pipeline}
                </span>
              )}
            </div>
          </div>
        </div>

        {task.pipeline && (
          <TaskPipelineStepper
            pipeline={task.pipeline}
            currentStage={task.currentStage}
            state={task.state}
            stageGate={task.stageGate}
          />
        )}
        {task.state === "running" && task.startedAt && (
          <ElapsedTimer
            startedAt={task.startedAt}
            currentStage={task.currentStage}
          />
        )}
        {task.state === "running" && task.pipeline && (
          <StageProgressBar
            pipeline={task.pipeline}
            currentStage={task.currentStage}
            state={task.state}
          />
        )}
      </div>

      {/* Review Banner */}
      {task.state === "review" && (
        <div className="px-4 py-3 border-b bg-purple-500/5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-purple-400">
              Ready for Review
            </span>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => setConfirmApprove(true)}>
                <Check className="h-4 w-4" /> Approve & Merge
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                onClick={() => setConfirmDiscard(true)}
              >
                <Trash2 className="h-4 w-4" /> Discard
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Input
              placeholder="Feedback for retry..."
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              className="h-8 text-sm flex-1"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                rejectTask.mutate({ taskId, feedback: feedbackText });
                setFeedbackText("");
              }}
              disabled={!feedbackText || rejectTask.isPending}
            >
              <RotateCw className="h-3 w-3" /> Retry
            </Button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as TaskDetailTab)}
        className="flex-1 flex flex-col overflow-hidden"
      >
        <TabsList className="mx-4 mt-2 justify-start">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="logs" className="relative">
            Logs
            {task.state === "running" && (
              <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            )}
          </TabsTrigger>
          <TabsTrigger value="diff">Diff</TabsTrigger>
          <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-auto">
          <TabsContent value="overview" className="p-4 space-y-4 mt-0">
            <OverviewTab task={task} />
          </TabsContent>
          <TabsContent value="logs" className="p-0 h-full mt-0">
            <LogsTab taskId={taskId} taskState={task.state} />
          </TabsContent>
          <TabsContent value="diff" className="p-0 h-full mt-0">
            <DiffTab taskId={taskId} />
          </TabsContent>
          <TabsContent value="artifacts" className="p-4 mt-0">
            <ArtifactsTab taskId={taskId} />
          </TabsContent>
        </div>
      </Tabs>

      {/* Actions */}
      <div className="p-4 border-t flex items-center gap-2 flex-wrap">
        {task.state === "running" && task.stageGate && (
          <div className="flex items-center gap-2 w-full mb-2">
            <Pause className="h-4 w-4 text-amber-400" />
            <span className="text-sm text-amber-400">
              Stage &quot;{task.stageGate}&quot; awaiting approval
            </span>
            <Button
              size="sm"
              onClick={() => gateApprove.mutate(taskId)}
              disabled={gateApprove.isPending}
            >
              <Check className="h-4 w-4" /> Approve Stage
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => gateReject.mutate({ taskId })}
              disabled={gateReject.isPending}
            >
              <X className="h-4 w-4" /> Reject Stage
            </Button>
          </div>
        )}
        {task.state === "pending" && (
          <Button
            size="sm"
            onClick={() => startTask.mutate(taskId)}
            disabled={startTask.isPending}
          >
            {startTask.isPending ? (
              <RotateCw className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {startTask.isPending ? "Starting..." : "Start"}
          </Button>
        )}
        {/* Confirmation dialogs for review actions (triggered from banner) */}
        <Dialog open={confirmApprove} onOpenChange={setConfirmApprove}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Approve & Merge Changes?</DialogTitle>
              <DialogDescription>
                This will merge the changes into your repository. This action
                cannot be easily undone.
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm font-medium truncate">{task.title}</p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setConfirmApprove(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  approveTask.mutate({ taskId });
                  setConfirmApprove(false);
                }}
              >
                <Check className="h-4 w-4" /> Confirm Merge
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Discard Task?</DialogTitle>
              <DialogDescription>
                This will permanently move the task to failed state and discard
                all changes. Use &quot;Retry with feedback&quot; instead if you
                want the AI to try again.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setConfirmDiscard(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  rejectTask.mutate({ taskId });
                  setConfirmDiscard(false);
                }}
              >
                <Trash2 className="h-4 w-4" /> Discard
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Task?</DialogTitle>
              <DialogDescription>
                This permanently deletes the task, logs, and artifacts. This
                action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm font-medium truncate">{task.title}</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  deleteTask.mutate(taskId);
                  setConfirmDelete(false);
                }}
                disabled={deleteTask.isPending}
              >
                {deleteTask.isPending ? (
                  <RotateCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}{" "}
                {deleteTask.isPending ? "Deleting..." : "Delete Task"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        {task.state === "pending" && (
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                updatePriority.mutate({
                  taskId,
                  priority: (task.priority || 0) + 1,
                })
              }
              disabled={updatePriority.isPending}
              title="Increase priority"
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
            <span className="text-xs text-muted-foreground w-6 text-center">
              {task.priority || 0}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                updatePriority.mutate({
                  taskId,
                  priority: (task.priority || 0) - 1,
                })
              }
              disabled={updatePriority.isPending}
              title="Decrease priority"
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          </div>
        )}
        {(task.state === "running" || task.state === "pending") && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => cancelTask.mutate(taskId)}
            disabled={cancelTask.isPending}
          >
            <Ban className="h-4 w-4" /> Cancel
          </Button>
        )}
        {task.state === "failed" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => retryTask.mutate(taskId)}
            disabled={retryTask.isPending}
          >
            <RotateCw className="h-4 w-4" /> Retry
          </Button>
        )}
        {(task.state === "done" || task.state === "failed") && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setConfirmDelete(true)}
            disabled={deleteTask.isPending}
          >
            {deleteTask.isPending ? (
              <RotateCw className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}{" "}
            {deleteTask.isPending ? "Deleting..." : "Delete"}
          </Button>
        )}
      </div>
    </div>
  );
}

function ElapsedTimer({
  startedAt,
  currentStage,
}: {
  startedAt: string;
  currentStage?: string;
}) {
  const [elapsed, setElapsed] = useState("");

  useEffect(() => {
    const start = new Date(startedAt).getTime();
    function update() {
      const diff = Date.now() - start;
      const sec = Math.floor(diff / 1000);
      const min = Math.floor(sec / 60);
      const hrs = Math.floor(min / 60);
      if (hrs > 0) {
        setElapsed(`${hrs}h ${min % 60}m`);
      } else if (min > 0) {
        setElapsed(`${min}m ${sec % 60}s`);
      } else {
        setElapsed(`${sec}s`);
      }
    }
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [startedAt]);

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
      <span>
        Running{currentStage ? `: ${currentStage}` : ""} — {elapsed}
      </span>
    </div>
  );
}

function StageProgressBar({
  pipeline,
  currentStage,
  state,
}: {
  pipeline: string;
  currentStage?: string;
  state: string;
}) {
  const stages =
    PIPELINES[(pipeline || "small") as PipelineName] || PIPELINES.small;
  const currentIndex = currentStage
    ? stages.indexOf(currentStage as never)
    : -1;

  if (state !== "running" || currentIndex < 0) return null;

  const progress = ((currentIndex + 0.5) / stages.length) * 100;

  return (
    <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
      <div
        className="h-full bg-blue-400 transition-all duration-500 rounded-full"
        style={{ width: `${Math.min(progress, 100)}%` }}
      />
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = sec / 60;
  if (min < 60) return `${min.toFixed(1)}m`;
  return `${(min / 60).toFixed(1)}h`;
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function OverviewTab({ task }: { task: Task }) {
  const inputTokens = task.tokenUsage
    ? (task.tokenUsage.input ?? task.tokenUsage.inputTokens)
    : undefined;
  const outputTokens = task.tokenUsage
    ? (task.tokenUsage.output ?? task.tokenUsage.outputTokens)
    : undefined;
  const totalTokens = task.tokenUsage
    ? (task.tokenUsage.total ??
      task.tokenUsage.totalTokens ??
      (inputTokens != null || outputTokens != null
        ? (inputTokens || 0) + (outputTokens || 0)
        : undefined))
    : undefined;

  return (
    <div className="space-y-3">
      <InfoRow label="ID" value={task.id} mono />
      <InfoRow label="Created" value={formatDate(task.created)} />
      {task.startedAt && (
        <InfoRow label="Started" value={formatDate(task.startedAt)} />
      )}
      {task.completedAt && (
        <InfoRow label="Completed" value={formatDate(task.completedAt)} />
      )}
      {task.project && <InfoRow label="Project" value={task.project} mono />}
      {!task.project && task.projects && task.projects.length > 0 && (
        <div>
          <span className="text-xs text-muted-foreground w-24 shrink-0">
            Projects
          </span>
          <div className="mt-1 space-y-0.5">
            {task.projects.map((p, i) => (
              <div key={i} className="text-xs font-mono truncate">
                {typeof p === "string" ? p : p.path}
              </div>
            ))}
          </div>
        </div>
      )}
      {task.pipeline && <InfoRow label="Pipeline" value={task.pipeline} />}
      {task.currentStage && (
        <InfoRow label="Current Stage" value={task.currentStage} />
      )}
      {task.suspended && (
        <InfoRow
          label="Suspended"
          value={
            task.suspendedStage ? `Yes (at ${task.suspendedStage})` : "Yes"
          }
        />
      )}
      {task.priority !== undefined && (
        <InfoRow label="Priority" value={String(task.priority)} />
      )}

      {/* Token Usage */}
      {task.tokenUsage && (
        <div>
          <span className="text-xs text-muted-foreground">Token Usage</span>
          <div className="flex items-center gap-3 mt-1 text-xs">
            {inputTokens != null && (
              <span className="px-2 py-0.5 rounded bg-muted">
                In: {formatTokenCount(inputTokens)}
              </span>
            )}
            {outputTokens != null && (
              <span className="px-2 py-0.5 rounded bg-muted">
                Out: {formatTokenCount(outputTokens)}
              </span>
            )}
            {totalTokens != null && (
              <span className="px-2 py-0.5 rounded bg-muted font-medium">
                Total: {formatTokenCount(totalTokens)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Stage History */}
      {task.stageHistory && task.stageHistory.length > 0 && (
        <div>
          <span className="text-xs text-muted-foreground">Stage History</span>
          <div className="flex items-center gap-1 flex-wrap mt-1">
            {task.stageHistory.map((s, i) => (
              <div
                key={i}
                className="flex items-center gap-1"
                title={`${s.stage}: ${s.status}${s.durationMs ? ` (${formatDuration(s.durationMs)})` : ""}`}
              >
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold
                  ${
                    s.status === "pass"
                      ? "bg-emerald-500/20 text-emerald-400"
                      : s.status === "fail"
                        ? "bg-red-500/20 text-red-400"
                        : "bg-blue-500/20 text-blue-400"
                  }`}
                >
                  {s.stage.slice(0, 2).toUpperCase()}
                </div>
                {i < task.stageHistory!.length - 1 && (
                  <div
                    className={`w-3 h-0.5 ${s.status === "pass" ? "bg-emerald-400/40" : s.status === "fail" ? "bg-red-400/40" : "bg-blue-400/40"}`}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {task.feedback && (
        <div>
          <span className="text-xs text-muted-foreground">Feedback</span>
          <p className="text-sm mt-1 p-2 rounded bg-muted">{task.feedback}</p>
        </div>
      )}
      {task.body && (
        <div>
          <span className="text-xs text-muted-foreground">Description</span>
          <pre className="text-sm mt-1 p-3 rounded bg-muted whitespace-pre-wrap font-mono text-xs overflow-auto max-h-64">
            {task.body}
          </pre>
        </div>
      )}
    </div>
  );
}

function InfoRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs text-muted-foreground w-24 shrink-0">
        {label}
      </span>
      <span className={`text-sm truncate ${mono ? "font-mono text-xs" : ""}`}>
        {value}
      </span>
    </div>
  );
}

function LogsTab({ taskId, taskState }: { taskId: string; taskState: string }) {
  const logLines = taskState === "failed" ? 500 : 200;
  const {
    data: logs,
    isLoading,
    isError,
    error,
    refetch,
  } = useTaskLogsQuery(
    taskId,
    logLines,
    taskState === "running",
  );
  const wsLogs = useEventsStore((s) => s.getTaskLogs(taskId));

  if (isLoading && !logs && wsLogs.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <RotateCw className="h-4 w-4 animate-spin" />
          <span>Loading logs...</span>
        </div>
      </div>
    );
  }

  if (isError && !logs && wsLogs.length === 0) {
    const statusCode =
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      typeof (error as { status: unknown }).status === "number"
        ? (error as { status: number }).status
        : null;
    const baseMessage =
      error instanceof Error ? error.message : "Failed to load logs.";
    const recoveryHint =
      statusCode === 404
        ? "This task may have been deleted. Refresh the task list and retry."
        : statusCode && statusCode >= 500
          ? "Daemon may be restarting. Check daemon status and retry."
          : `Check daemon status, then retry. You can also run "ucm logs ${taskId}" in CLI.`;
    const description = `${baseMessage}${statusCode ? ` (HTTP ${statusCode})` : ""}. ${recoveryHint}`;
    return (
      <EmptyState
        icon={Ban}
        title="Unable to load logs"
        description={description}
        action={
          <Button size="sm" variant="outline" onClick={() => refetch()}>
            <RotateCw className="h-4 w-4" /> Retry
          </Button>
        }
        className="py-8"
      />
    );
  }

  // Merge: HTTP logs as baseline, append any WS lines received after
  const mergedLogs = useMemo(() => {
    if (!logs && wsLogs.length === 0) return null;
    const httpLines = logs || "";
    const normalizedWsLogs = wsLogs.map((line) =>
      typeof line === "string" ? line : String(line ?? ""),
    );
    if (taskState !== "running" || normalizedWsLogs.length === 0)
      return httpLines;
    // Append WS lines that aren't already in the HTTP response
    const lastHttpLine = httpLines.split("\n").filter(Boolean).pop() || "";
    const lastMatchIdx = lastHttpLine
      ? normalizedWsLogs.findIndex(
          (line) => line.trim() === lastHttpLine.trim(),
        )
      : -1;
    const wsStartIdx = lastMatchIdx >= 0 ? lastMatchIdx + 1 : 0;
    const newLines = normalizedWsLogs.slice(wsStartIdx);
    return newLines.length > 0
      ? `${httpLines}\n${newLines.join("\n")}`
      : httpLines;
  }, [logs, wsLogs, taskState]);

  const scrollRef = useAutoScroll<HTMLPreElement>([mergedLogs]);

  return (
    <pre
      ref={scrollRef}
      className="h-full p-4 overflow-auto font-mono text-xs leading-5 whitespace-pre-wrap text-muted-foreground"
    >
      {mergedLogs || "(no logs)"}
    </pre>
  );
}

function DiffLine({ line, id }: { line: string; id?: string }) {
  if (line.startsWith("+++") || line.startsWith("---")) {
    return <div className="text-muted-foreground font-bold">{line}</div>;
  }
  if (line.startsWith("@@")) {
    return <div className="text-blue-400/80 bg-blue-400/5">{line}</div>;
  }
  if (line.startsWith("+")) {
    return <div className="text-emerald-400 bg-emerald-400/10">{line}</div>;
  }
  if (line.startsWith("-")) {
    return <div className="text-red-400 bg-red-400/10">{line}</div>;
  }
  if (line.startsWith("diff --git")) {
    return (
      <div
        id={id}
        className="text-muted-foreground font-bold border-t border-border pt-2 mt-2"
      >
        {line}
      </div>
    );
  }
  return <div className="text-muted-foreground">{line}</div>;
}

interface SplitLine {
  left: {
    num: number | null;
    content: string;
    type: "context" | "removed" | "empty";
  };
  right: {
    num: number | null;
    content: string;
    type: "context" | "added" | "empty";
  };
}

function parseSplitDiff(diffText: string): SplitLine[] {
  const lines = diffText.split("\n");
  const result: SplitLine[] = [];
  let leftNum = 0;
  let rightNum = 0;

  for (const line of lines) {
    // Skip diff headers
    if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("---") ||
      line.startsWith("+++")
    ) {
      continue;
    }

    // Hunk header
    if (line.startsWith("@@")) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)/);
      if (match) {
        leftNum = parseInt(match[1], 10) - 1;
        rightNum = parseInt(match[2], 10) - 1;
      }
      result.push({
        left: { num: null, content: line, type: "context" },
        right: { num: null, content: "", type: "empty" },
      });
      continue;
    }

    if (line.startsWith("-")) {
      leftNum++;
      result.push({
        left: { num: leftNum, content: line.slice(1), type: "removed" },
        right: { num: null, content: "", type: "empty" },
      });
    } else if (line.startsWith("+")) {
      rightNum++;
      result.push({
        left: { num: null, content: "", type: "empty" },
        right: { num: rightNum, content: line.slice(1), type: "added" },
      });
    } else {
      leftNum++;
      rightNum++;
      const content = line.startsWith(" ") ? line.slice(1) : line;
      result.push({
        left: { num: leftNum, content, type: "context" },
        right: { num: rightNum, content, type: "context" },
      });
    }
  }

  return result;
}

function SplitDiffView({ diff }: { diff: string }) {
  const splitLines = useMemo(() => parseSplitDiff(diff), [diff]);

  return (
    <div className="text-xs font-mono overflow-auto">
      {splitLines.map((line, i) => (
        <div
          key={i}
          className="grid grid-cols-2 divide-x border-b border-border/30"
        >
          <SplitDiffCell side={line.left} />
          <SplitDiffCell side={line.right} />
        </div>
      ))}
    </div>
  );
}

function SplitDiffCell({
  side,
}: {
  side: SplitLine["left"] | SplitLine["right"];
}) {
  const bgColor =
    side.type === "removed"
      ? "bg-red-400/10"
      : side.type === "added"
        ? "bg-emerald-400/10"
        : side.type === "empty"
          ? "bg-muted/30"
          : "";
  const textColor =
    side.type === "removed"
      ? "text-red-400"
      : side.type === "added"
        ? "text-emerald-400"
        : "text-muted-foreground";

  return (
    <div className={`flex ${bgColor} min-h-[1.5em]`}>
      <span className="w-10 text-right pr-2 text-muted-foreground/50 select-none shrink-0 py-0.5">
        {side.num ?? ""}
      </span>
      <span className={`flex-1 whitespace-pre py-0.5 pl-1 ${textColor}`}>
        {side.content}
      </span>
    </div>
  );
}

function DiffTab({ taskId }: { taskId: string }) {
  const { data: diffs, isLoading } = useTaskDiffQuery(taskId);
  const [diffMode, setDiffMode] = useState<"unified" | "split">("unified");

  // Extract file list from diffs for navigation
  const fileList = useMemo(() => {
    if (!diffs) return [];
    return diffs.flatMap((d) => {
      if (!d.diff) return [];
      return d.diff
        .split("\n")
        .filter((line) => line.startsWith("diff --git"))
        .map((line) => {
          const match = line.match(/b\/(.+)$/);
          return match ? match[1] : line;
        });
    });
  }, [diffs]);

  if (isLoading)
    return (
      <div className="p-4 text-sm text-muted-foreground">Loading diff...</div>
    );
  if (!diffs?.length)
    return (
      <EmptyState
        icon={FileText}
        title="No diff available"
        className="h-full"
      />
    );

  // Build a global file index tracker across all diffs
  let globalFileIndex = 0;

  return (
    <div className="relative">
      {fileList.length > 1 && (
        <div className="sticky top-0 bg-background border-b px-4 py-2 flex flex-wrap gap-1.5 z-10">
          {fileList.map((file, i) => (
            <button
              key={i}
              className="text-xs font-mono px-2 py-0.5 rounded bg-muted hover:bg-accent transition-colors"
              onClick={() => {
                const el = document.getElementById(`diff-file-${i}`);
                el?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              {file.split("/").pop()}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 px-4 py-2 border-b">
        <span className="text-xs text-muted-foreground">View:</span>
        <div className="flex items-center rounded-md border divide-x">
          <button
            className={`px-2.5 py-1 text-xs font-medium transition-colors ${
              diffMode === "unified"
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50"
            }`}
            onClick={() => setDiffMode("unified")}
          >
            Unified
          </button>
          <button
            className={`px-2.5 py-1 text-xs font-medium transition-colors ${
              diffMode === "split"
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/50"
            }`}
            onClick={() => setDiffMode("split")}
          >
            Split
          </button>
        </div>
      </div>
      <div className="p-4 space-y-4">
        {diffs.map((d, i) => {
          const lines = d.diff ? d.diff.split("\n") : [];
          const startFileIndex = globalFileIndex;
          const fileCount = lines.filter((l) =>
            l.startsWith("diff --git"),
          ).length;
          globalFileIndex += fileCount;

          return (
            <div key={i}>
              <h3 className="text-sm font-medium mb-2">{d.project}</h3>
              {d.diff ? (
                diffMode === "split" ? (
                  <SplitDiffView diff={d.diff} />
                ) : (
                  <div className="text-xs font-mono p-3 rounded bg-muted overflow-auto whitespace-pre">
                    {(() => {
                      let fileIdx = startFileIndex;
                      return lines.map((line, j) => {
                        if (line.startsWith("diff --git")) {
                          const currentId = `diff-file-${fileIdx}`;
                          fileIdx++;
                          return (
                            <DiffLine key={j} line={line} id={currentId} />
                          );
                        }
                        return <DiffLine key={j} line={line} />;
                      });
                    })()}
                  </div>
                )
              ) : (
                <pre className="text-xs font-mono p-3 rounded bg-muted">
                  (empty)
                </pre>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    critical: "bg-red-500/20 text-red-400",
    major: "bg-amber-500/20 text-amber-400",
    minor: "bg-blue-500/20 text-blue-400",
  };
  return (
    <span
      className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase ${colors[severity] || "bg-muted text-muted-foreground"}`}
    >
      {severity}
    </span>
  );
}

function PassFailBadge({ passed }: { passed: boolean }) {
  return (
    <span
      className={`px-2 py-0.5 rounded text-xs font-medium ${passed ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}
    >
      {passed ? "PASS" : "FAIL"}
    </span>
  );
}

function VerifyReportView({ report }: { report: VerifyReport }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-medium">Verify Report</h4>
        <PassFailBadge passed={report.passed} />
      </div>
      <div className="flex gap-3 text-xs">
        <span className="flex items-center gap-1">
          Tests: <PassFailBadge passed={report.testsPassed} />
        </span>
        <span className="flex items-center gap-1">
          Review: <PassFailBadge passed={report.reviewPassed} />
        </span>
      </div>
      {report.summary && (
        <p className="text-xs text-muted-foreground">{report.summary}</p>
      )}
      {report.testFailures?.length > 0 && (
        <div>
          <span className="text-xs text-muted-foreground">Test Failures</span>
          <ul className="mt-1 space-y-0.5">
            {report.testFailures.map((f, i) => (
              <li key={i} className="text-xs text-red-400 font-mono">
                - {typeof f === "string" ? f : JSON.stringify(f)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {report.issues?.length > 0 && (
        <div>
          <span className="text-xs text-muted-foreground">
            Issues ({report.issues.length})
          </span>
          <div className="mt-1 space-y-1.5">
            {report.issues.map((issue, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <SeverityBadge severity={issue.severity} />
                <div className="min-w-0">
                  <span>{issue.description}</span>
                  {issue.file && (
                    <span className="text-muted-foreground font-mono ml-1">
                      ({issue.file})
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PolishSummaryView({ summary }: { summary: PolishSummary }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-medium">Polish Summary</h4>
        <span className="text-xs text-muted-foreground">
          {summary.totalRounds} rounds, {summary.totalIssuesFound} issues found
        </span>
      </div>
      {summary.lenses?.length > 0 && (
        <div className="space-y-1">
          {summary.lenses.map((lens, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              <span
                className={`w-2 h-2 rounded-full ${lens.converged ? "bg-emerald-400" : "bg-amber-400"}`}
              />
              <span className="font-mono w-28">{lens.lens}</span>
              <span className="text-muted-foreground">
                {lens.rounds} rounds
              </span>
              <span className="text-muted-foreground">
                {lens.issuesFound} issues
              </span>
              <span
                className={
                  lens.converged ? "text-emerald-400" : "text-amber-400"
                }
              >
                {lens.converged ? "converged" : "not converged"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UxReviewView({ review }: { review: UxReviewReport }) {
  const scoreColor =
    review.score >= 8
      ? "text-emerald-400"
      : review.score >= 6
        ? "text-amber-400"
        : "text-red-400";
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-medium">UX Review</h4>
        <span className={`text-sm font-bold ${scoreColor}`}>
          {review.score}/10
        </span>
      </div>
      {review.summary && (
        <p className="text-xs text-muted-foreground">{review.summary}</p>
      )}
      {review.canUserAccomplishGoal?.result &&
        review.canUserAccomplishGoal.result !== "yes" && (
          <div className="text-xs p-2 rounded bg-red-500/10 border border-red-500/20">
            <span className="font-medium text-red-400">User Goal Not Met</span>
            {review.canUserAccomplishGoal.goal && (
              <p className="text-muted-foreground mt-0.5">
                Goal: {review.canUserAccomplishGoal.goal}
              </p>
            )}
            {review.canUserAccomplishGoal.blockers?.map((b, i) => (
              <p key={i} className="text-red-400 mt-0.5">
                - {b}
              </p>
            ))}
          </div>
        )}
      {review.usabilityIssues?.length > 0 && (
        <div>
          <span className="text-xs text-muted-foreground">
            Usability Issues ({review.usabilityIssues.length})
          </span>
          <div className="mt-1 space-y-1.5">
            {review.usabilityIssues.map((issue, i) => (
              <div key={i} className="text-xs">
                <div className="flex items-start gap-2">
                  <SeverityBadge severity={issue.severity} />
                  <span>{issue.description}</span>
                </div>
                {issue.fix && (
                  <p className="text-muted-foreground ml-8 mt-0.5">
                    Fix: {issue.fix}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {review.positives?.length > 0 && (
        <div>
          <span className="text-xs text-muted-foreground">Positives</span>
          <ul className="mt-1">
            {review.positives.map((p, i) => (
              <li key={i} className="text-xs text-emerald-400">
                + {p}
              </li>
            ))}
          </ul>
        </div>
      )}
      {review.mobile && !review.mobile.usable && (
        <div className="text-xs p-2 rounded bg-amber-500/10 border border-amber-500/20">
          <span className="font-medium text-amber-400">Mobile Issues</span>
          {review.mobile.issues?.map((issue, i) => (
            <p key={i} className="text-muted-foreground mt-0.5">
              - {issue}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function toPrettyJson(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function InvalidArtifactView({
  filename,
  data,
  expected,
}: {
  filename: string;
  data: unknown;
  expected: string;
}) {
  return (
    <div className="space-y-2">
      <div className="text-xs p-2 rounded bg-amber-500/10 border border-amber-500/20">
        <p className="font-medium text-amber-400">Unable to parse {expected}</p>
        <p className="text-muted-foreground mt-1">
          Artifact format may be outdated. Showing raw JSON so you can inspect
          it, then retry after syncing daemon/web versions.
        </p>
      </div>
      <h4 className="text-sm font-medium">{filename}</h4>
      <pre className="text-xs font-mono p-3 rounded bg-muted overflow-auto whitespace-pre-wrap max-h-48">
        {toPrettyJson(data)}
      </pre>
    </div>
  );
}

function ArtifactJsonView({
  filename,
  data,
  kind,
}: {
  filename: string;
  data: unknown;
  kind: ArtifactKind;
}) {
  if (kind === "verify") {
    const report = parseVerifyReport(data);
    return report ? (
      <VerifyReportView report={report} />
    ) : (
      <InvalidArtifactView
        filename={filename}
        data={data}
        expected="verify report"
      />
    );
  }

  if (kind === "polish-summary") {
    const summary = parsePolishSummary(data);
    return summary ? (
      <PolishSummaryView summary={summary} />
    ) : (
      <InvalidArtifactView
        filename={filename}
        data={data}
        expected="polish summary"
      />
    );
  }

  if (kind === "ux-review") {
    const review = parseUxReviewReport(data);
    return review ? (
      <UxReviewView review={review} />
    ) : (
      <InvalidArtifactView
        filename={filename}
        data={data}
        expected="UX review report"
      />
    );
  }

  // Generic JSON view for other files
  return (
    <div>
      <h4 className="text-sm font-medium mb-1">{filename}</h4>
      <pre className="text-xs font-mono p-3 rounded bg-muted overflow-auto whitespace-pre-wrap max-h-48">
        {toPrettyJson(data)}
      </pre>
    </div>
  );
}

function ArtifactsTab({ taskId }: { taskId: string }) {
  const { data: artifacts, isLoading } = useTaskArtifactsQuery(taskId);
  const { structuredFiles, plainFiles } = useArtifactFiles({
    files: artifacts?.files ?? [],
    contents: artifacts?.contents,
  });

  if (isLoading)
    return <div className="text-sm text-muted-foreground">Loading...</div>;
  if (!artifacts || (!artifacts.summary && artifacts.files.length === 0)) {
    return <EmptyState icon={FileText} title="No artifacts" />;
  }

  return (
    <div className="space-y-4">
      {artifacts.summary && (
        <div>
          <h3 className="text-sm font-medium mb-2">Summary</h3>
          <pre className="text-xs font-mono p-3 rounded bg-muted overflow-auto whitespace-pre-wrap max-h-64">
            {artifacts.summary}
          </pre>
        </div>
      )}
      {structuredFiles.length > 0 && (
        <div className="space-y-4">
          {structuredFiles.map((entry) => (
            <div key={entry.filename} className="p-3 rounded border border-border">
              <ArtifactJsonView
                filename={entry.filename}
                data={entry.data}
                kind={entry.kind}
              />
            </div>
          ))}
        </div>
      )}
      {plainFiles.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2">Files</h3>
          <ul className="text-sm space-y-1">
            {plainFiles.map((f) => (
              <li key={f} className="font-mono text-xs text-muted-foreground">
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
