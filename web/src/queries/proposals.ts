import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { Proposal } from "@/api/types";

function mutationErrorMessage(
  error: unknown,
  action: string,
  nextStep: string,
): string {
  const detail =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : "unknown error";
  return `${action}: ${detail}. ${nextStep}`;
}

export function useProposalsQuery(status?: string) {
  return useQuery({
    queryKey: ["proposals", status],
    queryFn: () => api.proposals.list(status),
    refetchInterval: 60000,
  });
}

export function useProposalEvaluateQuery(proposalId: string | null) {
  return useQuery({
    queryKey: ["proposal-evaluate", proposalId],
    queryFn: () => api.proposals.evaluate(proposalId!),
    enabled: !!proposalId,
  });
}

export function useApproveProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (proposalId: string) => api.proposals.approve(proposalId),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["proposals"] });
      if (data.taskId) {
        toast.success(`Proposal approved. Task created: ${data.taskId}`);
        return;
      }
      toast.success("Proposal approved.");
    },
    onError: (error) => {
      toast.error(
        mutationErrorMessage(
          error,
          "Failed to approve proposal",
          "Review the proposal details and retry.",
        ),
      );
    },
  });
}

export function useRejectProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (proposalId: string) => api.proposals.reject(proposalId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["proposals"] });
      toast.success("Proposal rejected.");
    },
    onError: (error) => {
      toast.error(
        mutationErrorMessage(
          error,
          "Failed to reject proposal",
          "Refresh proposals and retry.",
        ),
      );
    },
  });
}

export function useDeleteProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (proposalId: string) => api.proposals.delete(proposalId),
    onMutate: async (proposalId) => {
      await qc.cancelQueries({ queryKey: ["proposals"] });
      const previous = qc.getQueriesData<Proposal[]>({
        queryKey: ["proposals"],
      });
      qc.setQueriesData<Proposal[]>({ queryKey: ["proposals"] }, (old) =>
        Array.isArray(old)
          ? old.filter((proposal) => proposal.id !== proposalId)
          : old,
      );
      return { previous };
    },
    onError: (_error, _proposalId, context) => {
      if (context?.previous) {
        for (const [queryKey, snapshot] of context.previous) {
          qc.setQueryData(queryKey, snapshot);
        }
      }
      toast.error(
        mutationErrorMessage(
          _error,
          "Failed to delete proposal",
          "Try again after refreshing proposals.",
        ),
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["proposals"] });
      toast.success("Proposal deleted.");
    },
  });
}

export function useSetProposalPriority() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      proposalId,
      delta,
    }: {
      proposalId: string;
      delta: number;
    }) => api.proposals.priority(proposalId, delta),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["proposals"] }),
    onError: (error) => {
      toast.error(
        mutationErrorMessage(
          error,
          "Failed to update proposal priority",
          "Refresh proposals and retry.",
        ),
      );
    },
  });
}

export function useObserverStatusQuery() {
  return useQuery({
    queryKey: ["observer-status"],
    queryFn: api.observer.status,
    refetchInterval: 30000,
  });
}

export function useRunObserver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.observer.run,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["observer-status"] });
      qc.invalidateQueries({ queryKey: ["proposals"] });
      toast.success("Observer run completed.");
    },
    onError: (error) => {
      toast.error(
        mutationErrorMessage(
          error,
          "Observer run failed",
          "Check daemon status and try again.",
        ),
      );
    },
  });
}

export function useAnalyzeProject() {
  return useMutation({
    mutationFn: (project: string) => api.observer.analyze(project),
    onSuccess: () => {
      toast.success("Project analysis started.");
    },
    onError: (error) => {
      toast.error(
        mutationErrorMessage(
          error,
          "Failed to analyze project",
          "Check project path and daemon status, then retry.",
        ),
      );
    },
  });
}

export function useResearchProject() {
  return useMutation({
    mutationFn: (project: string) => api.observer.research(project),
    onSuccess: () => {
      toast.success("Project research started.");
    },
    onError: (error) => {
      toast.error(
        mutationErrorMessage(
          error,
          "Failed to start research",
          "Check project path and daemon status, then retry.",
        ),
      );
    },
  });
}
