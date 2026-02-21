import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import type { Proposal } from "@/api/types";

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
    onSuccess: () => qc.invalidateQueries({ queryKey: ["proposals"] }),
  });
}

export function useRejectProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (proposalId: string) => api.proposals.reject(proposalId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["proposals"] }),
  });
}

export function useDeleteProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (proposalId: string) => api.proposals.delete(proposalId),
    onMutate: async (proposalId) => {
      await qc.cancelQueries({ queryKey: ["proposals"] });
      const previous = qc.getQueriesData<Proposal[]>({ queryKey: ["proposals"] });
      qc.setQueriesData<Proposal[]>({ queryKey: ["proposals"] }, (old) =>
        Array.isArray(old) ? old.filter((proposal) => proposal.id !== proposalId) : old
      );
      return { previous };
    },
    onError: (_error, _proposalId, context) => {
      if (context?.previous) {
        for (const [queryKey, snapshot] of context.previous) {
          qc.setQueryData(queryKey, snapshot);
        }
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["proposals"] }),
  });
}

export function useSetProposalPriority() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ proposalId, delta }: { proposalId: string; delta: number }) =>
      api.proposals.priority(proposalId, delta),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["proposals"] }),
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
    },
  });
}

export function useAnalyzeProject() {
  return useMutation({
    mutationFn: (project: string) => api.observer.analyze(project),
  });
}

export function useResearchProject() {
  return useMutation({
    mutationFn: (project: string) => api.observer.research(project),
  });
}
