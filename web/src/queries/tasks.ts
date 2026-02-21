import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useEventsStore } from "@/stores/events";
import { useUiStore } from "@/stores/ui";
import type { Task } from "@/api/types";

export function useTasksQuery(status?: string) {
  return useQuery({
    queryKey: ["tasks", status],
    queryFn: () => api.tasks.list(status),
    refetchInterval: 30000,
  });
}

export function useTaskQuery(taskId: string | null) {
  return useQuery({
    queryKey: ["task", taskId],
    queryFn: () => api.tasks.status(taskId!),
    enabled: !!taskId,
    refetchInterval: 20000,
  });
}

export function useTaskDiffQuery(taskId: string | null) {
  return useQuery({
    queryKey: ["task-diff", taskId],
    queryFn: () => api.tasks.diff(taskId!),
    enabled: !!taskId,
  });
}

export function useTaskLogsQuery(taskId: string | null, lines?: number, live = true) {
  return useQuery({
    queryKey: ["task-logs", taskId, lines],
    queryFn: () => api.tasks.logs(taskId!, lines),
    enabled: !!taskId,
    refetchInterval: live ? 8000 : false,
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
function invalidateTaskQueries(qc: ReturnType<typeof useQueryClient>, taskId?: string) {
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
  updater: (task: Task) => Task
) {
  qc.setQueriesData<Task[]>({ queryKey: ["tasks"] }, (old) =>
    Array.isArray(old) ? old.map((task) => (task.id === taskId ? updater(task) : task)) : old
  );
  qc.setQueryData<Task>(["task", taskId], (old) => (old ? updater(old) : old));
}

export function useSubmitTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.tasks.submit,
    onSuccess: () => invalidateTaskQueries(qc),
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
      const previousTaskLists = qc.getQueriesData<Task[]>({ queryKey: ["tasks"] });
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
    },
    onSuccess: (_data, taskId) => invalidateTaskQueries(qc, taskId),
  });
}

export function useApproveTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, score }: { taskId: string; score?: number }) =>
      api.tasks.approve(taskId, score),
    onSuccess: (_data, { taskId }) => invalidateTaskQueries(qc, taskId),
  });
}

export function useRejectTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, feedback }: { taskId: string; feedback?: string }) =>
      api.tasks.reject(taskId, feedback),
    onSuccess: (_data, { taskId }) => invalidateTaskQueries(qc, taskId),
  });
}

export function useCancelTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => api.tasks.cancel(taskId),
    onSuccess: (_data, taskId) => invalidateTaskQueries(qc, taskId),
  });
}

export function useRetryTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => api.tasks.retry(taskId),
    onSuccess: (_data, taskId) => invalidateTaskQueries(qc, taskId),
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
    },
  });
}

export function useUpdatePriority() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, priority }: { taskId: string; priority: number }) =>
      api.tasks.updatePriority(taskId, priority),
    onSuccess: (_data, { taskId }) => invalidateTaskQueries(qc, taskId),
  });
}

export function useStageGateApprove() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => api.tasks.stageGateApprove(taskId),
    onSuccess: (_data, taskId) => invalidateTaskQueries(qc, taskId),
  });
}

export function useStageGateReject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, feedback }: { taskId: string; feedback?: string }) =>
      api.tasks.stageGateReject(taskId, feedback),
    onSuccess: (_data, { taskId }) => invalidateTaskQueries(qc, taskId),
  });
}
