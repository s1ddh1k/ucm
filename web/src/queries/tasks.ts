import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { Task } from "@/api/types";
import { useSmartInterval } from "@/hooks/use-smart-interval";
import { buildActionErrorMessage } from "@/lib/error";
import { useEventsStore } from "@/stores/events";
import { useUiStore } from "@/stores/ui";

export function useTasksQuery(status?: string, paused = false) {
  const interval = useSmartInterval(30000, paused);
  return useQuery({
    queryKey: ["tasks", status],
    queryFn: () => api.tasks.list(status),
    refetchInterval: interval,
  });
}

export function useTaskQuery(taskId: string | null) {
  return useQuery({
    queryKey: ["task", taskId],
    queryFn: () => api.tasks.status(taskId!),
    enabled: !!taskId,
    refetchInterval: useSmartInterval(20000),
  });
}

export function useTaskDiffQuery(taskId: string | null) {
  return useQuery({
    queryKey: ["task-diff", taskId],
    queryFn: () => api.tasks.diff(taskId!),
    enabled: !!taskId,
  });
}

export function useTaskLogsQuery(
  taskId: string | null,
  lines?: number,
  live = true,
) {
  const smartInterval = useSmartInterval(8000);
  return useQuery({
    queryKey: ["task-logs", taskId, lines],
    queryFn: () => api.tasks.logs(taskId!, lines),
    enabled: !!taskId,
    refetchInterval: live ? smartInterval : false,
  });
}

export function useTaskArtifactsQuery(taskId: string | null) {
  return useQuery({
    queryKey: ["task-artifacts", taskId],
    queryFn: () => api.artifacts.get(taskId!),
    enabled: !!taskId,
  });
}

/** Invalidate both the task list and a specific task detail */
function invalidateTaskQueries(
  qc: ReturnType<typeof useQueryClient>,
  taskId?: string,
) {
  qc.invalidateQueries({ queryKey: ["tasks"] });
  if (taskId) {
    qc.invalidateQueries({ queryKey: ["task", taskId] });
    qc.invalidateQueries({ queryKey: ["task-diff", taskId] });
    qc.invalidateQueries({ queryKey: ["task-logs", taskId] });
    qc.invalidateQueries({ queryKey: ["task-artifacts", taskId] });
  }
}

function updateTaskInTaskCaches(
  qc: ReturnType<typeof useQueryClient>,
  taskId: string,
  updater: (task: Task) => Task,
) {
  qc.setQueriesData<Task[]>({ queryKey: ["tasks"] }, (old) =>
    Array.isArray(old)
      ? old.map((task) => (task.id === taskId ? updater(task) : task))
      : old,
  );
  qc.setQueryData<Task>(["task", taskId], (old) => (old ? updater(old) : old));
}

export function useSubmitTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.tasks.submit,
    onSuccess: () => {
      invalidateTaskQueries(qc);
      toast.success("Task created.");
    },
    onError: (error) => {
      toast.error(
        buildActionErrorMessage(
          "Failed to create task",
          error,
          "Check required fields and daemon status, then try again.",
        ),
      );
    },
  });
}

export function useStartTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => api.tasks.start(taskId),
    onMutate: async (taskId) => {
      await Promise.all([
        qc.cancelQueries({ queryKey: ["tasks"] }),
        qc.cancelQueries({ queryKey: ["task", taskId] }),
      ]);

      const previousTask = qc.getQueryData<Task>(["task", taskId]);
      const previousTaskLists = qc.getQueriesData<Task[]>({
        queryKey: ["tasks"],
      });
      const startedAt = new Date().toISOString();

      updateTaskInTaskCaches(qc, taskId, (task) => ({
        ...task,
        state: "running",
        startedAt: task.startedAt || startedAt,
      }));

      return { previousTask, previousTaskLists };
    },
    onError: (_error, taskId, context) => {
      if (context?.previousTask) {
        qc.setQueryData(["task", taskId], context.previousTask);
      }
      if (context?.previousTaskLists) {
        for (const [queryKey, snapshot] of context.previousTaskLists) {
          qc.setQueryData(queryKey, snapshot);
        }
      }
      toast.error(
        buildActionErrorMessage(
          "Failed to start task",
          _error,
          "Check daemon status and retry.",
        ),
      );
    },
    onSuccess: (_data, taskId) => {
      invalidateTaskQueries(qc, taskId);
      toast.success("Task started.");
    },
  });
}

export function useApproveTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, score }: { taskId: string; score?: number }) =>
      api.tasks.approve(taskId, score),
    onSuccess: (_data, { taskId }) => {
      invalidateTaskQueries(qc, taskId);
      toast.success("Task approved. Merge is in progress.");
    },
    onError: (error) => {
      toast.error(
        buildActionErrorMessage(
          "Failed to approve task",
          error,
          "Review task logs and diff, then retry.",
        ),
      );
    },
  });
}

export function useRejectTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, feedback }: { taskId: string; feedback?: string }) =>
      api.tasks.reject(taskId, feedback),
    onSuccess: (_data, { taskId, feedback }) => {
      invalidateTaskQueries(qc, taskId);
      toast.success(feedback ? "Task sent back with feedback." : "Task rejected.");
    },
    onError: (error) => {
      toast.error(
        buildActionErrorMessage(
          "Failed to reject task",
          error,
          "Check task status and retry.",
        ),
      );
    },
  });
}

export function useCancelTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => api.tasks.cancel(taskId),
    onSuccess: (_data, taskId) => {
      invalidateTaskQueries(qc, taskId);
      toast.success("Task cancelled.");
    },
    onError: (error) => {
      toast.error(
        buildActionErrorMessage(
          "Failed to cancel task",
          error,
          "Check task status and retry.",
        ),
      );
    },
  });
}

export function useRetryTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => api.tasks.retry(taskId),
    onSuccess: (_data, taskId) => {
      invalidateTaskQueries(qc, taskId);
      toast.success("Task retry started.");
    },
    onError: (error) => {
      toast.error(
        buildActionErrorMessage(
          "Failed to retry task",
          error,
          "Review feedback and logs, then retry.",
        ),
      );
    },
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => api.tasks.delete(taskId),
    onSuccess: (_data, taskId) => {
      invalidateTaskQueries(qc, taskId);
      qc.removeQueries({ queryKey: ["task", taskId], exact: true });
      qc.removeQueries({ queryKey: ["task-diff", taskId], exact: true });
      qc.removeQueries({ queryKey: ["task-logs", taskId], exact: false });
      qc.removeQueries({ queryKey: ["task-artifacts", taskId], exact: true });
      useEventsStore.getState().clearTaskLogs(taskId);
      if (useUiStore.getState().selectedTaskId === taskId) {
        useUiStore.getState().setSelectedTaskId(null);
      }
      toast.success("Task deleted.");
    },
    onError: (error) => {
      toast.error(
        buildActionErrorMessage(
          "Failed to delete task",
          error,
          "Try again after checking daemon status.",
        ),
      );
    },
  });
}

export function useUpdatePriority() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, priority }: { taskId: string; priority: number }) =>
      api.tasks.updatePriority(taskId, priority),
    onSuccess: (_data, { taskId }) => invalidateTaskQueries(qc, taskId),
    onError: (error) => {
      toast.error(
        buildActionErrorMessage(
          "Failed to update task priority",
          error,
          "Check task status and try again.",
        ),
      );
    },
  });
}

export function useStageGateApprove() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => api.tasks.stageGateApprove(taskId),
    onSuccess: (_data, taskId) => {
      invalidateTaskQueries(qc, taskId);
      toast.success("Stage approved. Task resumed.");
    },
    onError: (error) => {
      toast.error(
        buildActionErrorMessage(
          "Failed to approve stage",
          error,
          "Refresh task status and retry.",
        ),
      );
    },
  });
}

export function useStageGateReject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, feedback }: { taskId: string; feedback?: string }) =>
      api.tasks.stageGateReject(taskId, feedback),
    onSuccess: (_data, { taskId }) => {
      invalidateTaskQueries(qc, taskId);
      toast.success("Stage rejected. Task moved to failed state.");
    },
    onError: (error) => {
      toast.error(
        buildActionErrorMessage(
          "Failed to reject stage",
          error,
          "Refresh task status and retry.",
        ),
      );
    },
  });
}
