import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/api/client";
import type { Proposal } from "@/api/types";
import { useSmartInterval } from "@/hooks/use-smart-interval";
import { buildActionErrorMessage } from "@/lib/error";
import { requireQueryValue } from "./required-value";

interface PendingToastContext {
  toastId: string | number;
}

export function useProposalsQuery(status?: string, paused = false) {
  const interval = useSmartInterval(60000, paused);
  return useQuery({
    queryKey: ["proposals", status],
    queryFn: () => api.proposals.list(status),
    refetchInterval: interval,
  });
}

export function useProposalEvaluateQuery(proposalId: string | null) {
  return useQuery({
    queryKey: ["proposal-evaluate", proposalId],
    queryFn: () =>
      api.proposals.evaluate(requireQueryValue(proposalId, "proposalId")),
    enabled: !!proposalId,
  });
}

export function useApproveProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (proposalId: string) => api.proposals.approve(proposalId),
    onMutate: (proposalId) =>
      ({
        toastId: toast.loading(`Approving proposal ${proposalId}...`),
      }) satisfies PendingToastContext,
    onSuccess: (data, _vars, context) => {
      if (context?.toastId !== undefined) toast.dismiss(context.toastId);
      qc.invalidateQueries({ queryKey: ["proposals"] });
      if (data.taskId) {
        toast.success(`Proposal approved. Task created: ${data.taskId}`);
        return;
      }
      toast.success("Proposal approved.");
    },
    onError: (error, _vars, context) => {
      if (context?.toastId !== undefined) toast.dismiss(context.toastId);
      toast.error(
        buildActionErrorMessage(
          "Failed to approve proposal",
          error,
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
    onMutate: (proposalId) =>
      ({
        toastId: toast.loading(`Rejecting proposal ${proposalId}...`),
      }) satisfies PendingToastContext,
    onSuccess: (_data, _vars, context) => {
      if (context?.toastId !== undefined) toast.dismiss(context.toastId);
      qc.invalidateQueries({ queryKey: ["proposals"] });
      toast.success("Proposal rejected.");
    },
    onError: (error, _vars, context) => {
      if (context?.toastId !== undefined) toast.dismiss(context.toastId);
      toast.error(
        buildActionErrorMessage(
          "Failed to reject proposal",
          error,
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
      return {
        previous,
        toastId: toast.loading(`Deleting proposal ${proposalId}...`),
      };
    },
    onError: (error, _proposalId, context) => {
      if (context?.toastId !== undefined) toast.dismiss(context.toastId);
      if (context?.previous) {
        for (const [queryKey, snapshot] of context.previous) {
          qc.setQueryData(queryKey, snapshot);
        }
      }
      toast.error(
        buildActionErrorMessage(
          "Failed to delete proposal",
          error,
          "Try again after refreshing proposals.",
        ),
      );
    },
    onSuccess: (_data, _vars, context) => {
      if (context?.toastId !== undefined) toast.dismiss(context.toastId);
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
        buildActionErrorMessage(
          "Failed to update proposal priority",
          error,
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
    refetchInterval: useSmartInterval(30000),
  });
}

export function useRunObserver() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.observer.run,
    onMutate: () =>
      ({
        toastId: toast.loading("Running observer cycle..."),
      }) satisfies PendingToastContext,
    onSuccess: (data, _vars, context) => {
      if (context?.toastId !== undefined) toast.dismiss(context.toastId);
      qc.invalidateQueries({ queryKey: ["observer-status"] });
      qc.invalidateQueries({ queryKey: ["proposals"] });
      toast.success(
        `Observer cycle ${data.cycle} completed. ${data.proposalCount} proposal(s) created.`,
      );
    },
    onError: (error, _vars, context) => {
      if (context?.toastId !== undefined) toast.dismiss(context.toastId);
      toast.error(
        buildActionErrorMessage(
          "Observer run failed",
          error,
          "Check daemon status and try again.",
        ),
      );
    },
  });
}

export function useAnalyzeProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (project: string) => api.observer.analyze(project),
    onMutate: () =>
      ({
        toastId: toast.loading("Analyzing project..."),
      }) satisfies PendingToastContext,
    onSuccess: (data, _vars, context) => {
      if (context?.toastId !== undefined) toast.dismiss(context.toastId);
      qc.invalidateQueries({ queryKey: ["proposals"] });
      toast.success(
        `Project analysis completed. ${data.proposalCount} proposal(s) created for ${data.project}.`,
      );
    },
    onError: (error, _vars, context) => {
      if (context?.toastId !== undefined) toast.dismiss(context.toastId);
      toast.error(
        buildActionErrorMessage(
          "Failed to analyze project",
          error,
          "Check project path and daemon status, then retry.",
        ),
      );
    },
  });
}

export function useResearchProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (project: string) => api.observer.research(project),
    onMutate: () =>
      ({
        toastId: toast.loading("Running project research..."),
      }) satisfies PendingToastContext,
    onSuccess: (data, _vars, context) => {
      if (context?.toastId !== undefined) toast.dismiss(context.toastId);
      qc.invalidateQueries({ queryKey: ["proposals"] });
      toast.success(
        `Project research completed. ${data.proposalCount} proposal(s) created.`,
      );
    },
    onError: (error, _vars, context) => {
      if (context?.toastId !== undefined) toast.dismiss(context.toastId);
      toast.error(
        buildActionErrorMessage(
          "Failed to run research",
          error,
          "Check project path and daemon status, then retry.",
        ),
      );
    },
  });
}
