import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import type { Task } from "@/api/types";
import { useMutationToast } from "@/hooks/use-mutation-toast";
import { useSmartInterval } from "@/hooks/use-smart-interval";
import { useEventsStore } from "@/stores/events";
import { useUiStore } from "@/stores/ui";

const TASK_LIST_REFETCH_MS = 30000;
const TASK_DETAIL_REFETCH_MS = 20000;
const TASK_LOGS_REFETCH_MS = 8000;

function requireTaskId(taskId: string | null): string {
  if (!taskId) {
    throw new Error("taskId is required");
  }
  return taskId;
}

export function useTasksQuery(status?: string, paused = false) {
  const interval = useSmartInterval(TASK_LIST_REFETCH_MS, paused);
  return useQuery({
    queryKey: ["tasks", status],
    queryFn: () => api.tasks.list(status),
    refetchInterval: interval,
  });
}

export function useTaskQuery(taskId: string | null) {
  return useQuery({
    queryKey: ["task", taskId],
    queryFn: () => api.tasks.status(requireTaskId(taskId)),
    enabled: Boolean(taskId),
    refetchInterval: useSmartInterval(TASK_DETAIL_REFETCH_MS),
  });
}

export function useTaskDiffQuery(taskId: string | null) {
  return useQuery({
    queryKey: ["task-diff", taskId],
    queryFn: () => api.tasks.diff(requireTaskId(taskId)),
    enabled: Boolean(taskId),
  });
}

export function useTaskLogsQuery(
  taskId: string | null,
  lines?: number,
  live = true,
) {
  const smartInterval = useSmartInterval(TASK_LOGS_REFETCH_MS);
  return useQuery({
    queryKey: ["task-logs", taskId, lines],
    queryFn: () => api.tasks.logs(requireTaskId(taskId), lines),
    enabled: Boolean(taskId),
    refetchInterval: live ? smartInterval : false,
  });
}

export function useTaskArtifactsQuery(taskId: string | null) {
  return useQuery({
    queryKey: ["task-artifacts", taskId],
    queryFn: () => api.artifacts.get(requireTaskId(taskId)),
    enabled: Boolean(taskId),
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
  const { notifySuccess, notifyError } = useMutationToast({
    success: "Task created.",
    errorAction: "Failed to create task",
    errorNextStep: "Check required fields and daemon status, then try again.",
  });

  return useMutation({
    mutationFn: api.tasks.submit,
    onSuccess: (data, variables) => {
      invalidateTaskQueries(qc);
      notifySuccess(data, variables);
    },
    onError: notifyError,
  });
}

export function useStartTask() {
  const qc = useQueryClient();
  const { notifySuccess, notifyError } = useMutationToast({
    success: "Task started.",
    errorAction: "Failed to start task",
    errorNextStep: "Check daemon status and retry.",
  });

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
    onError: (error, taskId, context) => {
      if (context?.previousTask) {
        qc.setQueryData(["task", taskId], context.previousTask);
      }
      if (context?.previousTaskLists) {
        for (const [queryKey, snapshot] of context.previousTaskLists) {
          qc.setQueryData(queryKey, snapshot);
        }
      }
      notifyError(error);
    },
    onSuccess: (data, taskId) => {
      invalidateTaskQueries(qc, taskId);
      notifySuccess(data, taskId);
    },
  });
}

export function useApproveTask() {
  const qc = useQueryClient();
  const { notifySuccess, notifyError } = useMutationToast({
    success: "Task approved. Merge is in progress.",
    errorAction: "Failed to approve task",
    errorNextStep: "Review task logs and diff, then retry.",
  });

  return useMutation({
    mutationFn: ({ taskId, score }: { taskId: string; score?: number }) =>
      api.tasks.approve(taskId, score),
    onSuccess: (data, variables) => {
      const { taskId } = variables;
      invalidateTaskQueries(qc, taskId);
      notifySuccess(data, variables);
    },
    onError: notifyError,
  });
}

export function useRejectTask() {
  const qc = useQueryClient();
  const { notifySuccess, notifyError } = useMutationToast<
    unknown,
    { taskId: string; feedback?: string }
  >({
    success: (_data, { feedback }) =>
      feedback ? "Task sent back with feedback." : "Task rejected.",
    errorAction: "Failed to reject task",
    errorNextStep: "Check task status and retry.",
  });

  return useMutation({
    mutationFn: ({ taskId, feedback }: { taskId: string; feedback?: string }) =>
      api.tasks.reject(taskId, feedback),
    onSuccess: (data, variables) => {
      const { taskId } = variables;
      invalidateTaskQueries(qc, taskId);
      notifySuccess(data, variables);
    },
    onError: notifyError,
  });
}

export function useCancelTask() {
  const qc = useQueryClient();
  const { notifySuccess, notifyError } = useMutationToast({
    success: "Task cancelled.",
    errorAction: "Failed to cancel task",
    errorNextStep: "Check task status and retry.",
  });

  return useMutation({
    mutationFn: (taskId: string) => api.tasks.cancel(taskId),
    onSuccess: (data, taskId) => {
      invalidateTaskQueries(qc, taskId);
      notifySuccess(data, taskId);
    },
    onError: notifyError,
  });
}

export function useRetryTask() {
  const qc = useQueryClient();
  const { notifySuccess, notifyError } = useMutationToast({
    success: "Task retry started.",
    errorAction: "Failed to retry task",
    errorNextStep: "Review feedback and logs, then retry.",
  });

  return useMutation({
    mutationFn: (taskId: string) => api.tasks.retry(taskId),
    onSuccess: (data, taskId) => {
      invalidateTaskQueries(qc, taskId);
      notifySuccess(data, taskId);
    },
    onError: notifyError,
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  const { notifySuccess, notifyError } = useMutationToast({
    success: "Task deleted.",
    errorAction: "Failed to delete task",
    errorNextStep: "Try again after checking daemon status.",
  });

  return useMutation({
    mutationFn: (taskId: string) => api.tasks.delete(taskId),
    onSuccess: (data, taskId) => {
      invalidateTaskQueries(qc, taskId);
      qc.removeQueries({ queryKey: ["task", taskId], exact: true });
      qc.removeQueries({ queryKey: ["task-diff", taskId], exact: true });
      qc.removeQueries({ queryKey: ["task-logs", taskId], exact: false });
      qc.removeQueries({ queryKey: ["task-artifacts", taskId], exact: true });
      useEventsStore.getState().clearTaskLogs(taskId);
      if (useUiStore.getState().selectedTaskId === taskId) {
        useUiStore.getState().setSelectedTaskId(null);
      }
      notifySuccess(data, taskId);
    },
    onError: notifyError,
  });
}

export function useUpdatePriority() {
  const { notifyError } = useMutationToast({
    errorAction: "Failed to update task priority",
    errorNextStep: "Check task status and try again.",
  });

  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, priority }: { taskId: string; priority: number }) =>
      api.tasks.updatePriority(taskId, priority),
    onSuccess: (_data, { taskId }) => invalidateTaskQueries(qc, taskId),
    onError: notifyError,
  });
}

export function useStageGateApprove() {
  const qc = useQueryClient();
  const { notifySuccess, notifyError } = useMutationToast({
    success: "Stage approved. Task resumed.",
    errorAction: "Failed to approve stage",
    errorNextStep: "Refresh task status and retry.",
  });

  return useMutation({
    mutationFn: (taskId: string) => api.tasks.stageGateApprove(taskId),
    onSuccess: (data, taskId) => {
      invalidateTaskQueries(qc, taskId);
      notifySuccess(data, taskId);
    },
    onError: notifyError,
  });
}

export function useStageGateReject() {
  const qc = useQueryClient();
  const { notifySuccess, notifyError } = useMutationToast({
    success: "Stage rejected. Task moved to failed state.",
    errorAction: "Failed to reject stage",
    errorNextStep: "Refresh task status and retry.",
  });

  return useMutation({
    mutationFn: ({ taskId, feedback }: { taskId: string; feedback?: string }) =>
      api.tasks.stageGateReject(taskId, feedback),
    onSuccess: (data, variables) => {
      const { taskId } = variables;
      invalidateTaskQueries(qc, taskId);
      notifySuccess(data, variables);
    },
    onError: notifyError,
  });
}
