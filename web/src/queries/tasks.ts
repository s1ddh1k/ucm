import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";

export function useTasksQuery(status?: string) {
  return useQuery({
    queryKey: ["tasks", status],
    queryFn: () => api.tasks.list(status),
    refetchInterval: 60000,
  });
}

export function useTaskQuery(taskId: string | null) {
  return useQuery({
    queryKey: ["task", taskId],
    queryFn: () => api.tasks.status(taskId!),
    enabled: !!taskId,
    refetchInterval: 10000,
  });
}

export function useTaskDiffQuery(taskId: string | null) {
  return useQuery({
    queryKey: ["task-diff", taskId],
    queryFn: () => api.tasks.diff(taskId!),
    enabled: !!taskId,
  });
}

export function useTaskLogsQuery(taskId: string | null, lines?: number) {
  return useQuery({
    queryKey: ["task-logs", taskId, lines],
    queryFn: () => api.tasks.logs(taskId!, lines),
    enabled: !!taskId,
    refetchInterval: 5000,
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
    onSuccess: (_data, taskId) => invalidateTaskQueries(qc, taskId),
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
