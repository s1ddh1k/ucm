import { useState, useMemo } from "react";
import { Play, Check, X, RotateCw, Trash2, Ban, FileText, Pause, ChevronUp, ChevronDown } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTaskQuery, useTaskDiffQuery, useTaskLogsQuery, useTaskArtifactsQuery } from "@/queries/tasks";
import { useEventsStore } from "@/stores/events";
import { useStartTask, useApproveTask, useRejectTask, useCancelTask, useRetryTask, useDeleteTask, useStageGateApprove, useStageGateReject, useUpdatePriority } from "@/queries/tasks";
import type { Task, TaskState } from "@/api/types";
import { TaskStatusBadge } from "./task-status-badge";
import { TaskPipelineStepper } from "./task-pipeline-stepper";
import { TimeAgo } from "@/components/shared/time-ago";
import { formatDate } from "@/lib/format";
import { useAutoScroll } from "@/hooks/use-auto-scroll";
import { EmptyState } from "@/components/shared/empty-state";

interface TaskDetailProps {
  taskId: string;
}

export function TaskDetail({ taskId }: TaskDetailProps) {
  const { data: task } = useTaskQuery(taskId);
  const [feedbackText, setFeedbackText] = useState("");
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const startTask = useStartTask();
  const approveTask = useApproveTask();
  const rejectTask = useRejectTask();
  const cancelTask = useCancelTask();
  const retryTask = useRetryTask();
  const deleteTask = useDeleteTask();
  const gateApprove = useStageGateApprove();
  const gateReject = useStageGateReject();
  const updatePriority = useUpdatePriority();

  if (!task) return null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold truncate">{task.title}</h2>
            <div className="flex items-center gap-2 mt-1">
              <TaskStatusBadge state={task.state as TaskState} />
              {task.pipeline && (
                <span className="text-xs text-muted-foreground">{task.pipeline}</span>
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
      </div>

      {/* Tabs */}
      <Tabs defaultValue={task.state === "review" ? "diff" : "overview"} key={`${taskId}-${task.state}`} className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="mx-4 mt-2 justify-start">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
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
            <Button size="sm" onClick={() => gateApprove.mutate(taskId)} disabled={gateApprove.isPending}>
              <Check className="h-4 w-4" /> Approve Stage
            </Button>
            <Button size="sm" variant="destructive" onClick={() => gateReject.mutate({ taskId })} disabled={gateReject.isPending}>
              <X className="h-4 w-4" /> Reject Stage
            </Button>
          </div>
        )}
        {task.state === "pending" && (
          <Button size="sm" onClick={() => startTask.mutate(taskId)} disabled={startTask.isPending}>
            <Play className="h-4 w-4" /> Start
          </Button>
        )}
        {task.state === "review" && (
          <>
            <Button size="sm" variant="default" onClick={() => setConfirmApprove(true)} disabled={approveTask.isPending}>
              <Check className="h-4 w-4" /> Approve & Merge
            </Button>
            <div className="flex items-center gap-1 flex-1 min-w-0">
              <Input
                placeholder="Feedback for retry..."
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                className="h-8 text-sm"
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
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setConfirmDiscard(true)} disabled={rejectTask.isPending}>
              <Trash2 className="h-4 w-4" /> Discard
            </Button>

            <Dialog open={confirmApprove} onOpenChange={setConfirmApprove}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Approve & Merge Changes?</DialogTitle>
                  <DialogDescription>
                    This will merge the changes into your repository. This action cannot be easily undone.
                  </DialogDescription>
                </DialogHeader>
                <p className="text-sm font-medium truncate">{task.title}</p>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setConfirmApprove(false)}>Cancel</Button>
                  <Button onClick={() => { approveTask.mutate({ taskId }); setConfirmApprove(false); }}>
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
                    This will permanently move the task to failed state and discard all changes. Use &quot;Retry with feedback&quot; instead if you want the AI to try again.
                  </DialogDescription>
                </DialogHeader>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setConfirmDiscard(false)}>Cancel</Button>
                  <Button variant="destructive" onClick={() => { rejectTask.mutate({ taskId }); setConfirmDiscard(false); }}>
                    <Trash2 className="h-4 w-4" /> Discard
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </>
        )}
        {task.state === "pending" && (
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => updatePriority.mutate({ taskId, priority: (task.priority || 0) + 1 })}
              disabled={updatePriority.isPending}
              title="Increase priority"
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
            <span className="text-xs text-muted-foreground w-6 text-center">{task.priority || 0}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => updatePriority.mutate({ taskId, priority: (task.priority || 0) - 1 })}
              disabled={updatePriority.isPending}
              title="Decrease priority"
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          </div>
        )}
        {(task.state === "running" || task.state === "pending") && (
          <Button size="sm" variant="outline" onClick={() => cancelTask.mutate(taskId)} disabled={cancelTask.isPending}>
            <Ban className="h-4 w-4" /> Cancel
          </Button>
        )}
        {task.state === "failed" && (
          <Button size="sm" variant="outline" onClick={() => retryTask.mutate(taskId)} disabled={retryTask.isPending}>
            <RotateCw className="h-4 w-4" /> Retry
          </Button>
        )}
        {(task.state === "done" || task.state === "failed") && (
          <Button size="sm" variant="ghost" onClick={() => deleteTask.mutate(taskId)} disabled={deleteTask.isPending}>
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
        )}
      </div>
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
  return (
    <div className="space-y-3">
      <InfoRow label="ID" value={task.id} mono />
      <InfoRow label="Created" value={formatDate(task.created)} />
      {task.startedAt && <InfoRow label="Started" value={formatDate(task.startedAt)} />}
      {task.completedAt && <InfoRow label="Completed" value={formatDate(task.completedAt)} />}
      {task.project && <InfoRow label="Project" value={task.project} mono />}
      {!task.project && task.projects && task.projects.length > 0 && (
        <div>
          <span className="text-xs text-muted-foreground w-24 shrink-0">Projects</span>
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
      {task.currentStage && <InfoRow label="Current Stage" value={task.currentStage} />}
      {task.suspended && <InfoRow label="Suspended" value={task.suspendedStage ? `Yes (at ${task.suspendedStage})` : "Yes"} />}
      {task.priority !== undefined && <InfoRow label="Priority" value={String(task.priority)} />}

      {/* Token Usage */}
      {task.tokenUsage && (
        <div>
          <span className="text-xs text-muted-foreground">Token Usage</span>
          <div className="flex items-center gap-3 mt-1 text-xs">
            {task.tokenUsage.inputTokens != null && (
              <span className="px-2 py-0.5 rounded bg-muted">
                In: {formatTokenCount(task.tokenUsage.inputTokens)}
              </span>
            )}
            {task.tokenUsage.outputTokens != null && (
              <span className="px-2 py-0.5 rounded bg-muted">
                Out: {formatTokenCount(task.tokenUsage.outputTokens)}
              </span>
            )}
            {task.tokenUsage.totalTokens != null && (
              <span className="px-2 py-0.5 rounded bg-muted font-medium">
                Total: {formatTokenCount(task.tokenUsage.totalTokens)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Stage History */}
      {task.stageHistory && task.stageHistory.length > 0 && (
        <div>
          <span className="text-xs text-muted-foreground">Stage History</span>
          <div className="mt-1 space-y-1">
            {task.stageHistory.map((s, i) => {
              // Count iterations: how many times this stage appears up to index i
              const iteration = task.stageHistory!.slice(0, i + 1).filter((h) => h.stage === s.stage).length;
              const totalForStage = task.stageHistory!.filter((h) => h.stage === s.stage).length;
              const stageTokens = s.tokenUsage ? (s.tokenUsage.input || 0) + (s.tokenUsage.output || 0) : 0;

              return (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className={`w-2 h-2 rounded-full ${
                    s.status === "pass" ? "bg-emerald-400" :
                    s.status === "fail" ? "bg-red-400" :
                    "bg-blue-400"
                  }`} />
                  <span className="font-mono w-20">{s.stage}</span>
                  {totalForStage > 1 && (
                    <span className="text-muted-foreground/60">{iteration}/{totalForStage}</span>
                  )}
                  <span className="text-muted-foreground">{s.status}</span>
                  {s.durationMs != null && (
                    <span className="text-muted-foreground/60">{formatDuration(s.durationMs)}</span>
                  )}
                  {stageTokens > 0 && (
                    <span className="text-muted-foreground/40">{formatTokenCount(stageTokens)} tok</span>
                  )}
                </div>
              );
            })}
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

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs text-muted-foreground w-24 shrink-0">{label}</span>
      <span className={`text-sm truncate ${mono ? "font-mono text-xs" : ""}`}>{value}</span>
    </div>
  );
}

function LogsTab({ taskId, taskState }: { taskId: string; taskState: string }) {
  const logLines = taskState === "failed" ? 500 : 200;
  const { data: logs } = useTaskLogsQuery(taskId, logLines);
  const wsLogs = useEventsStore((s) => s.getTaskLogs(taskId));

  // Merge: HTTP logs as baseline, append any WS lines received after
  const mergedLogs = useMemo(() => {
    if (!logs && wsLogs.length === 0) return null;
    const httpLines = logs || "";
    if (taskState !== "running" || wsLogs.length === 0) return httpLines;
    // Append WS lines that aren't already in the HTTP response
    const lastHttpLine = httpLines.split("\n").filter(Boolean).pop() || "";
    const wsStartIdx = lastHttpLine
      ? wsLogs.findIndex((l) => l.trim() === lastHttpLine.trim()) + 1
      : 0;
    const newLines = wsLogs.slice(wsStartIdx > 0 ? wsStartIdx : wsLogs.length);
    return newLines.length > 0 ? httpLines + "\n" + newLines.join("\n") : httpLines;
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

function DiffLine({ line }: { line: string }) {
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
    return <div className="text-muted-foreground font-bold border-t border-border pt-2 mt-2">{line}</div>;
  }
  return <div className="text-muted-foreground">{line}</div>;
}

function DiffTab({ taskId }: { taskId: string }) {
  const { data: diffs, isLoading } = useTaskDiffQuery(taskId);

  if (isLoading) return <div className="p-4 text-sm text-muted-foreground">Loading diff...</div>;
  if (!diffs?.length) return <EmptyState icon={FileText} title="No diff available" className="h-full" />;

  return (
    <div className="p-4 space-y-4">
      {diffs.map((d, i) => (
        <div key={i}>
          <h3 className="text-sm font-medium mb-2">{d.project}</h3>
          {d.diff ? (
            <div className="text-xs font-mono p-3 rounded bg-muted overflow-auto whitespace-pre">
              {d.diff.split("\n").map((line, j) => (
                <DiffLine key={j} line={line} />
              ))}
            </div>
          ) : (
            <pre className="text-xs font-mono p-3 rounded bg-muted">(empty)</pre>
          )}
        </div>
      ))}
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
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase ${colors[severity] || "bg-muted text-muted-foreground"}`}>
      {severity}
    </span>
  );
}

function PassFailBadge({ passed }: { passed: boolean }) {
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${passed ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
      {passed ? "PASS" : "FAIL"}
    </span>
  );
}

function VerifyReportView({ data }: { data: Record<string, unknown> }) {
  const report = data as unknown as import("@/api/types").VerifyReport;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-medium">Verify Report</h4>
        <PassFailBadge passed={report.passed} />
      </div>
      <div className="flex gap-3 text-xs">
        <span className="flex items-center gap-1">Tests: <PassFailBadge passed={report.testsPassed} /></span>
        <span className="flex items-center gap-1">Review: <PassFailBadge passed={report.reviewPassed} /></span>
      </div>
      {report.summary && (
        <p className="text-xs text-muted-foreground">{report.summary}</p>
      )}
      {report.testFailures?.length > 0 && (
        <div>
          <span className="text-xs text-muted-foreground">Test Failures</span>
          <ul className="mt-1 space-y-0.5">
            {report.testFailures.map((f, i) => (
              <li key={i} className="text-xs text-red-400 font-mono">- {typeof f === "string" ? f : JSON.stringify(f)}</li>
            ))}
          </ul>
        </div>
      )}
      {report.issues?.length > 0 && (
        <div>
          <span className="text-xs text-muted-foreground">Issues ({report.issues.length})</span>
          <div className="mt-1 space-y-1.5">
            {report.issues.map((issue, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <SeverityBadge severity={issue.severity} />
                <div className="min-w-0">
                  <span>{issue.description}</span>
                  {issue.file && <span className="text-muted-foreground font-mono ml-1">({issue.file})</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PolishSummaryView({ data }: { data: Record<string, unknown> }) {
  const summary = data as unknown as import("@/api/types").PolishSummary;
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
              <span className={`w-2 h-2 rounded-full ${lens.converged ? "bg-emerald-400" : "bg-amber-400"}`} />
              <span className="font-mono w-28">{lens.lens}</span>
              <span className="text-muted-foreground">{lens.rounds} rounds</span>
              <span className="text-muted-foreground">{lens.issuesFound} issues</span>
              <span className={lens.converged ? "text-emerald-400" : "text-amber-400"}>
                {lens.converged ? "converged" : "not converged"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UxReviewView({ data }: { data: Record<string, unknown> }) {
  const review = data as unknown as import("@/api/types").UxReviewReport;
  const scoreColor = review.score >= 8 ? "text-emerald-400" : review.score >= 6 ? "text-amber-400" : "text-red-400";
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-medium">UX Review</h4>
        <span className={`text-sm font-bold ${scoreColor}`}>{review.score}/10</span>
      </div>
      {review.summary && (
        <p className="text-xs text-muted-foreground">{review.summary}</p>
      )}
      {review.canUserAccomplishGoal?.result && review.canUserAccomplishGoal.result !== "yes" && (
        <div className="text-xs p-2 rounded bg-red-500/10 border border-red-500/20">
          <span className="font-medium text-red-400">User Goal Not Met</span>
          {review.canUserAccomplishGoal.goal && (
            <p className="text-muted-foreground mt-0.5">Goal: {review.canUserAccomplishGoal.goal}</p>
          )}
          {review.canUserAccomplishGoal.blockers?.map((b, i) => (
            <p key={i} className="text-red-400 mt-0.5">- {b}</p>
          ))}
        </div>
      )}
      {review.usabilityIssues?.length > 0 && (
        <div>
          <span className="text-xs text-muted-foreground">Usability Issues ({review.usabilityIssues.length})</span>
          <div className="mt-1 space-y-1.5">
            {review.usabilityIssues.map((issue, i) => (
              <div key={i} className="text-xs">
                <div className="flex items-start gap-2">
                  <SeverityBadge severity={issue.severity} />
                  <span>{issue.description}</span>
                </div>
                {issue.fix && <p className="text-muted-foreground ml-8 mt-0.5">Fix: {issue.fix}</p>}
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
              <li key={i} className="text-xs text-emerald-400">+ {p}</li>
            ))}
          </ul>
        </div>
      )}
      {review.mobile && !review.mobile.usable && (
        <div className="text-xs p-2 rounded bg-amber-500/10 border border-amber-500/20">
          <span className="font-medium text-amber-400">Mobile Issues</span>
          {review.mobile.issues?.map((issue, i) => (
            <p key={i} className="text-muted-foreground mt-0.5">- {issue}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function ArtifactJsonView({ filename, data }: { filename: string; data: Record<string, unknown> }) {
  // Route to specialized views
  if (filename.match(/^verify(-.*)?\.json$/)) return <VerifyReportView data={data} />;
  if (filename.match(/^polish-summary(-.*)?\.json$/)) return <PolishSummaryView data={data} />;
  if (filename.match(/^ux-review(-.*)?\.json$/)) return <UxReviewView data={data} />;

  // Generic JSON view for other files
  return (
    <div>
      <h4 className="text-sm font-medium mb-1">{filename}</h4>
      <pre className="text-xs font-mono p-3 rounded bg-muted overflow-auto whitespace-pre-wrap max-h-48">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

function ArtifactsTab({ taskId }: { taskId: string }) {
  const { data: artifacts, isLoading } = useTaskArtifactsQuery(taskId);

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading...</div>;
  if (!artifacts || (!artifacts.summary && artifacts.files.length === 0)) {
    return <EmptyState icon={FileText} title="No artifacts" />;
  }

  // Separate structured JSON artifacts from plain files
  const contents = artifacts.contents || {};
  const structuredFiles = Object.keys(contents);
  const plainFiles = artifacts.files.filter((f) => !structuredFiles.includes(f) && f !== "summary.md" && f !== "memory.json");

  // Order: verify, polish-summary, ux-review first, then others
  const orderedKeys = [
    ...structuredFiles.filter((f) => f.match(/^verify(-.*)?\.json$/)),
    ...structuredFiles.filter((f) => f.match(/^polish-summary(-.*)?\.json$/)),
    ...structuredFiles.filter((f) => f.match(/^ux-review(-.*)?\.json$/)),
    ...structuredFiles.filter((f) => !f.match(/^(verify|polish-summary|ux-review)(-.*)?\.json$/)),
  ];

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
      {orderedKeys.length > 0 && (
        <div className="space-y-4">
          {orderedKeys.map((filename) => (
            <div key={filename} className="p-3 rounded border border-border">
              <ArtifactJsonView filename={filename} data={contents[filename] as Record<string, unknown>} />
            </div>
          ))}
        </div>
      )}
      {plainFiles.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2">Files</h3>
          <ul className="text-sm space-y-1">
            {plainFiles.map((f) => (
              <li key={f} className="font-mono text-xs text-muted-foreground">{f}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
