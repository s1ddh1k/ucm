import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import type { Proposal, Task } from "@/api/types";
import { wsManager } from "@/api/websocket";
import {
  getStringField,
  parseDaemonStatus,
  parseProposalStatus,
  parseTaskState,
} from "@/lib/ws-event";
import { useDaemonStore } from "@/stores/daemon";
import { useEventsStore } from "@/stores/events";
import { useUiStore } from "@/stores/ui";

const BASE_TITLE = "UCM Dashboard";
const PENDING_TYPES = ["failed", "review", "gate", "pipelineError"] as const;
type PendingType = (typeof PENDING_TYPES)[number];

/**
 * Send a browser notification if the tab is not visible.
 * On first call when permission is "default", requests permission before sending.
 */
function notify(title: string, body: string) {
  if (typeof Notification === "undefined") return;
  if (!document.hidden) return;

  const send = () => {
    if (Notification.permission === "granted") {
      new Notification(title, { body, icon: "/favicon.ico" });
    }
  };

  if (Notification.permission === "granted") {
    send();
  } else if (Notification.permission === "default") {
    Notification.requestPermission().then((perm) => {
      if (perm === "granted") send();
    });
  }
}

export function useWebSocket() {
  const queryClient = useQueryClient();
  const setStatus = useDaemonStore((s) => s.setStatus);
  const setConnected = useDaemonStore((s) => s.setConnected);
  const setStatsLastUpdatedAt = useDaemonStore((s) => s.setStatsLastUpdatedAt);
  const addActivity = useEventsStore((s) => s.addActivity);
  const addTaskLog = useEventsStore((s) => s.addTaskLog);
  const clearTaskLogs = useEventsStore((s) => s.clearTaskLogs);
  const initialized = useRef(false);
  const pendingCount = useRef(0);
  const pendingByType = useRef<Record<PendingType, Set<string>>>({
    failed: new Set<string>(),
    review: new Set<string>(),
    gate: new Set<string>(),
    pipelineError: new Set<string>(),
  });

  // ---------- Tab title badge ----------
  const updateTitleBadge = useCallback((delta: number) => {
    pendingCount.current = Math.max(0, pendingCount.current + delta);
    const count = pendingCount.current;
    document.title = count > 0 ? `(${count}) ${BASE_TITLE}` : BASE_TITLE;
  }, []);

  const resetPendingBadge = useCallback(() => {
    pendingCount.current = 0;
    pendingByType.current.failed.clear();
    pendingByType.current.review.clear();
    pendingByType.current.gate.clear();
    pendingByType.current.pipelineError.clear();
    document.title = BASE_TITLE;
  }, []);

  const markPending = useCallback(
    (type: PendingType, taskId: string | null): boolean => {
      if (!taskId) return false;
      const bucket = pendingByType.current[type];
      if (bucket.has(taskId)) return false;
      bucket.add(taskId);
      updateTitleBadge(1);
      return true;
    },
    [updateTitleBadge],
  );

  const clearPending = useCallback(
    (type: PendingType, taskId: string | null): boolean => {
      if (!taskId) return false;
      const bucket = pendingByType.current[type];
      const removed = bucket.delete(taskId);
      if (removed) updateTitleBadge(-1);
      return removed;
    },
    [updateTitleBadge],
  );

  const clearPendingForTask = useCallback(
    (taskId: string | null) => {
      if (!taskId) return;
      let removed = 0;
      for (const type of PENDING_TYPES) {
        if (pendingByType.current[type].delete(taskId)) {
          removed++;
        }
      }
      if (removed > 0) {
        updateTitleBadge(-removed);
      }
    },
    [updateTitleBadge],
  );

  // Reset the badge when the user focuses the tab
  useEffect(() => {
    const onFocus = () => resetPendingBadge();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [resetPendingBadge]);

  // Request notification permission on mount (non-blocking)
  useEffect(() => {
    if (
      typeof Notification !== "undefined" &&
      Notification.permission === "default"
    ) {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    wsManager.connect();

    const unsubs: Array<() => void> = [];
    const nowIso = () => new Date().toISOString();

    const patchTaskCaches = (taskId: string, updater: (task: Task) => Task) => {
      queryClient.setQueriesData<Task[]>({ queryKey: ["tasks"] }, (old) =>
        Array.isArray(old)
          ? old.map((task) => (task.id === taskId ? updater(task) : task))
          : old,
      );
      queryClient.setQueryData<Task>(["task", taskId], (old) =>
        old ? updater(old) : old,
      );
    };

    const removeTaskFromCaches = (taskId: string) => {
      queryClient.setQueriesData<Task[]>({ queryKey: ["tasks"] }, (old) =>
        Array.isArray(old) ? old.filter((task) => task.id !== taskId) : old,
      );
      queryClient.removeQueries({ queryKey: ["task", taskId], exact: true });
      queryClient.removeQueries({
        queryKey: ["task-diff", taskId],
        exact: true,
      });
      queryClient.removeQueries({
        queryKey: ["task-logs", taskId],
        exact: false,
      });
      queryClient.removeQueries({
        queryKey: ["task-artifacts", taskId],
        exact: true,
      });
    };

    const removeProposalFromCaches = (proposalId: string) => {
      queryClient.setQueriesData<Proposal[]>(
        { queryKey: ["proposals"] },
        (old) =>
          Array.isArray(old)
            ? old.filter((proposal) => proposal.id !== proposalId)
            : old,
      );
    };

    unsubs.push(
      wsManager.on("ws:connected", () => setConnected(true)),
      wsManager.on("ws:disconnected", () => {
        setConnected(false);
        setStatus("offline");
        setStatsLastUpdatedAt(null);
      }),

      // Daemon status
      wsManager.on("daemon:status", (data) => {
        const status = parseDaemonStatus(data.status);
        if (status) {
          setStatus(status);
        }
      }),

      // Task events
      wsManager.on("task:created", (data) => {
        queryClient.invalidateQueries({ queryKey: ["tasks"] });
        addActivity("task:created", data);
      }),
      wsManager.on("task:updated", (data) => {
        const taskId = getStringField(data, "taskId");
        const nextState = parseTaskState(data.state);
        const nextStatus = parseTaskState(data.status);

        if (taskId && nextState) {
          patchTaskCaches(taskId, (task) => {
            const updates: Partial<Task> = {
              state: nextState,
            };
            if (nextState === "running" && !task.startedAt) {
              updates.startedAt = nowIso();
            }
            if (
              (nextState === "review" ||
                nextState === "done" ||
                nextState === "failed") &&
              !task.completedAt
            ) {
              updates.completedAt = nowIso();
            }
            if (nextState === "pending" || nextState === "running") {
              updates.completedAt = undefined;
            }
            return { ...task, ...updates };
          });
          queryClient.invalidateQueries({ queryKey: ["task", taskId] });
        }
        addActivity("task:updated", data);

        const failedEvent = nextState === "failed" || nextStatus === "failed";
        if (failedEvent && markPending("failed", taskId)) {
          const detail = taskId
            ? `Task ${taskId} failed. Open logs, then retry with feedback when ready.`
            : "A task failed. Refresh the task list, open logs, and retry when ready.";
          notify("Task failed", detail);
        } else if (taskId && nextState && nextState !== "failed") {
          clearPending("failed", taskId);
        }

        const reviewEvent = nextState === "review" || nextStatus === "review";
        if (reviewEvent && markPending("review", taskId)) {
          const taskLabel = taskId || "unknown";
          notify(
            "Task ready for review",
            `Task ${taskLabel} is ready for review.`,
          );
        } else if (taskId && nextState && nextState !== "review") {
          clearPending("review", taskId);
        }

        if (
          taskId &&
          (nextState === "pending" ||
            nextState === "running" ||
            nextState === "done")
        ) {
          clearPending("gate", taskId);
          clearPending("pipelineError", taskId);
        }
      }),
      wsManager.on("task:deleted", (data) => {
        const taskId = typeof data.taskId === "string" ? data.taskId : null;
        if (taskId) {
          removeTaskFromCaches(taskId);
          clearTaskLogs(taskId);
          if (useUiStore.getState().selectedTaskId === taskId) {
            useUiStore.getState().setSelectedTaskId(null);
          }
          clearPendingForTask(taskId);
        }
        addActivity("task:deleted", data);
      }),
      wsManager.on("task:log", (data) => {
        if (typeof data.taskId === "string" && data.line != null) {
          addTaskLog(data.taskId, data.line);
        }
      }),

      // Stats events — validate shape before overwriting cache
      wsManager.on("stats:updated", (data) => {
        const daemonStatus = parseDaemonStatus(data.daemonStatus);
        if (
          data &&
          typeof data.pid === "number" &&
          typeof data.uptime === "number" &&
          data.resources &&
          daemonStatus
        ) {
          queryClient.setQueryData(["stats"], data);
          setStatsLastUpdatedAt(Date.now());
          setStatus(daemonStatus);
        }
      }),

      // Proposal events
      wsManager.on("proposal:created", (data) => {
        queryClient.invalidateQueries({ queryKey: ["proposals"] });
        addActivity("proposal:created", data);
      }),
      wsManager.on("proposal:updated", (data) => {
        const proposalId = getStringField(data, "proposalId");
        const status = parseProposalStatus(data.status);
        if (proposalId && status) {
          queryClient.setQueriesData<Proposal[]>(
            { queryKey: ["proposals"] },
            (old) =>
              Array.isArray(old)
                ? old.map((proposal) =>
                    proposal.id === proposalId
                      ? { ...proposal, status }
                      : proposal,
                  )
                : old,
          );
        } else {
          queryClient.invalidateQueries({ queryKey: ["proposals"] });
        }
        addActivity("proposal:updated", data);
      }),
      wsManager.on("proposal:deleted", (data) => {
        const proposalId =
          typeof data.proposalId === "string" ? data.proposalId : null;
        if (proposalId) {
          removeProposalFromCaches(proposalId);
        } else {
          queryClient.invalidateQueries({ queryKey: ["proposals"] });
        }
        addActivity("proposal:deleted", data);
      }),

      // Curation events
      wsManager.on("mode:changed", (data) => {
        queryClient.invalidateQueries({ queryKey: ["curation-mode"] });
        addActivity("mode:changed", data);
      }),
      wsManager.on("proposal:scored", (data) => {
        queryClient.invalidateQueries({ queryKey: ["proposals"] });
        queryClient.invalidateQueries({ queryKey: ["proposal-score"] });
        addActivity("proposal:scored", data);
      }),
      wsManager.on("proposal:clustered", (data) => {
        queryClient.invalidateQueries({ queryKey: ["proposal-clusters"] });
        addActivity("proposal:clustered", data);
      }),
      wsManager.on("proposal:discarded", (data) => {
        const proposalId =
          typeof data.proposalId === "string" ? data.proposalId : null;
        if (proposalId) {
          removeProposalFromCaches(proposalId);
        }
        queryClient.invalidateQueries({ queryKey: ["proposals"] });
        queryClient.invalidateQueries({ queryKey: ["discard-history"] });
        addActivity("proposal:discarded", data);
      }),
      wsManager.on("proposal:conflict_detected", (data) => {
        queryClient.invalidateQueries({ queryKey: ["proposal-conflicts"] });
        addActivity("proposal:conflict_detected", data);
      }),
      wsManager.on("proposal:feedback_recorded", (data) => {
        addActivity("proposal:feedback_recorded", data);
      }),
      wsManager.on("proposal:readiness_checked", (data) => {
        queryClient.invalidateQueries({ queryKey: ["bigbet-checklist"] });
        addActivity("proposal:readiness_checked", data);
      }),

      // Observer events
      wsManager.on("observer:started", (data) => {
        queryClient.invalidateQueries({ queryKey: ["observer-status"] });
        addActivity("observer:started", data);
      }),
      wsManager.on("observer:completed", (data) => {
        queryClient.invalidateQueries({ queryKey: ["observer-status"] });
        queryClient.invalidateQueries({ queryKey: ["proposals"] });
        addActivity("observer:completed", data);
      }),

      // Refinement events
      wsManager.on("refinement:question", (data) => {
        addActivity("refinement:question", data);
      }),

      // Stage events
      wsManager.on("stage:start", (data) => {
        addActivity("stage:started", data);
      }),
      wsManager.on("stage:started", (data) => {
        addActivity("stage:started", data);
      }),
      wsManager.on("stage:complete", (data) => {
        const taskId = typeof data.taskId === "string" ? data.taskId : null;
        if (taskId) {
          queryClient.invalidateQueries({ queryKey: ["task", taskId] });
        }
        addActivity("stage:complete", data);
      }),

      // Config events
      wsManager.on("config:updated", (data) => {
        queryClient.invalidateQueries({ queryKey: ["config"] });
        queryClient.invalidateQueries({ queryKey: ["stats"] });
        queryClient.invalidateQueries({ queryKey: ["project-catalog"] });
        addActivity("config:updated", data);
      }),

      // Stage gate events
      wsManager.on("stage:gate", (data) => {
        const taskId = getStringField(data, "taskId");
        const stageName =
          getStringField(data, "stage") ||
          getStringField(data, "stageName") ||
          "unknown";
        if (taskId) {
          patchTaskCaches(taskId, (task) => ({
            ...task,
            stageGate: stageName,
            currentStage: stageName,
          }));
          queryClient.invalidateQueries({ queryKey: ["task", taskId] });
        }
        addActivity("stage:gate", data);

        // Notify on stage gate awaiting approval
        const taskLabel = taskId || "unknown";
        if (markPending("gate", taskId)) {
          notify(
            "Stage awaiting approval",
            `Task ${taskLabel} is waiting for approval at stage "${stageName}".`,
          );
        }
      }),
      wsManager.on("stage:gate_resolved", (data) => {
        const taskId = typeof data.taskId === "string" ? data.taskId : null;
        if (taskId) {
          patchTaskCaches(taskId, (task) => ({
            ...task,
            stageGate: undefined,
          }));
          queryClient.invalidateQueries({ queryKey: ["task", taskId] });
        }
        addActivity("stage:gate_resolved", data);
        clearPending("gate", taskId);
      }),

      // Pipeline error events
      wsManager.on("pipeline:error", (data) => {
        const taskId = getStringField(data, "taskId");
        if (markPending("pipelineError", taskId)) {
          const detail = taskId
            ? `Task ${taskId} encountered a pipeline error. Review logs and decide whether to retry.`
            : "A pipeline error occurred. Refresh tasks, inspect logs, and retry if appropriate.";
          notify("Task failed", detail);
        }
        addActivity("pipeline:error", data);
      }),
    );

    return () => {
      unsubs.forEach((unsub) => unsub());
      wsManager.disconnect();
      initialized.current = false;
      resetPendingBadge();
    };
  }, [
    queryClient,
    setStatus,
    setConnected,
    setStatsLastUpdatedAt,
    addActivity,
    addTaskLog,
    clearTaskLogs,
    markPending,
    clearPending,
    clearPendingForTask,
    resetPendingBadge,
  ]);
}
