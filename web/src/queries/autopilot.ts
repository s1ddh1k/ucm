import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";

export function useAutopilotStatusQuery() {
  return useQuery({
    queryKey: ["autopilot"],
    queryFn: api.autopilot.status,
    refetchInterval: 10000,
  });
}

export function useAutopilotSessionQuery(sessionId: string | null) {
  return useQuery({
    queryKey: ["autopilot", "session", sessionId],
    queryFn: () => api.autopilot.session(sessionId!),
    enabled: !!sessionId,
    refetchInterval: 5000,
  });
}

export function useAutopilotReleasesQuery(sessionId: string | null) {
  return useQuery({
    queryKey: ["autopilot", "releases", sessionId],
    queryFn: () => api.autopilot.releases(sessionId!),
    enabled: !!sessionId,
  });
}

export function useStartAutopilot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.autopilot.start,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["autopilot"] }),
  });
}

export function usePauseAutopilot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => api.autopilot.pause(sessionId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["autopilot"] }),
  });
}

export function useResumeAutopilot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => api.autopilot.resume(sessionId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["autopilot"] }),
  });
}

export function useStopAutopilot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => api.autopilot.stop(sessionId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["autopilot"] }),
  });
}

export function useApproveAutopilotItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => api.autopilot.approveItem(sessionId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["autopilot"] }),
  });
}

export function useRejectAutopilotItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => api.autopilot.rejectItem(sessionId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["autopilot"] }),
  });
}

export function useFeedbackAutopilotItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      feedback,
    }: {
      sessionId: string;
      feedback: string;
    }) => api.autopilot.feedbackItem(sessionId, feedback),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["autopilot"] }),
  });
}

export function useAddDirective() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, text }: { sessionId: string; text: string }) =>
      api.autopilot.directives.add(sessionId, text),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["autopilot"] }),
  });
}

export function useEditDirective() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      directiveId,
      text,
    }: {
      sessionId: string;
      directiveId: string;
      text: string;
    }) => api.autopilot.directives.edit(sessionId, directiveId, text),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["autopilot"] }),
  });
}

export function useDeleteDirective() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      directiveId,
    }: {
      sessionId: string;
      directiveId: string;
    }) => api.autopilot.directives.delete(sessionId, directiveId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["autopilot"] }),
  });
}
