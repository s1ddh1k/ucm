import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/api/client";
import { useSmartInterval } from "@/hooks/use-smart-interval";
import { buildActionErrorMessage } from "@/lib/error";

export function useCurationModeQuery() {
  return useQuery({
    queryKey: ["curation-mode"],
    queryFn: api.curation.mode,
    refetchInterval: useSmartInterval(30000),
  });
}

export function useSetCurationMode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ mode, reason }: { mode: string; reason?: string }) =>
      api.curation.setMode(mode, reason),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["curation-mode"] });
      toast.success(`Mode changed to ${data.mode}`);
    },
    onError: (error) => {
      toast.error(buildActionErrorMessage("Failed to set curation mode", error, "Check mode value and retry."));
    },
  });
}

export function useCurationWeightsQuery() {
  return useQuery({
    queryKey: ["curation-weights"],
    queryFn: api.curation.weights,
  });
}

export function useSetCurationWeights() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: { profile?: string; weights?: Record<string, number> }) =>
      api.curation.setWeights(params),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["curation-weights"] });
      qc.invalidateQueries({ queryKey: ["proposals"] });
      qc.invalidateQueries({ queryKey: ["scoring-profiles"] });
      toast.success("Weight profile updated.");
    },
    onError: (error) => {
      toast.error(buildActionErrorMessage("Failed to update weights", error, "Retry."));
    },
  });
}

export function useProposalScoreQuery(proposalId: string | null) {
  return useQuery({
    queryKey: ["proposal-score", proposalId],
    queryFn: () => api.proposals.score(proposalId!),
    enabled: !!proposalId,
  });
}

export function useSetProposalScore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ proposalId, scores }: { proposalId: string; scores: Record<string, number> }) =>
      api.proposals.setScore(proposalId, scores),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["proposals"] });
      qc.invalidateQueries({ queryKey: ["proposal-score"] });
      toast.success("Scores updated.");
    },
    onError: (error) => {
      toast.error(buildActionErrorMessage("Failed to update scores", error, "Retry."));
    },
  });
}

export function useProposalClustersQuery(refresh?: boolean) {
  return useQuery({
    queryKey: ["proposal-clusters", refresh],
    queryFn: () => api.proposals.clusters(refresh),
    refetchInterval: useSmartInterval(60000),
  });
}

export function useMergeCluster() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ proposalIds, representativeId }: { proposalIds: string[]; representativeId?: string }) =>
      api.proposals.mergeCluster(proposalIds, representativeId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["proposal-clusters"] });
      toast.success("Cluster merged.");
    },
    onError: (error) => {
      toast.error(buildActionErrorMessage("Failed to merge cluster", error, "Retry."));
    },
  });
}

export function useSplitCluster() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (proposalId: string) => api.proposals.splitCluster(proposalId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["proposal-clusters"] });
      toast.success("Split from cluster.");
    },
    onError: (error) => {
      toast.error(buildActionErrorMessage("Failed to split cluster", error, "Retry."));
    },
  });
}

export function useProposalConflictsQuery(proposalId: string | null) {
  return useQuery({
    queryKey: ["proposal-conflicts", proposalId],
    queryFn: () => api.proposals.conflicts(proposalId!),
    enabled: !!proposalId,
  });
}

export function useDiscardProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ proposalId, reason }: { proposalId: string; reason: string }) =>
      api.proposals.discard(proposalId, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["proposals"] });
      qc.invalidateQueries({ queryKey: ["discard-history"] });
      toast.success("Proposal discarded.");
    },
    onError: (error) => {
      toast.error(buildActionErrorMessage("Failed to discard proposal", error, "Retry."));
    },
  });
}

export function useDiscardHistoryQuery(limit?: number) {
  return useQuery({
    queryKey: ["discard-history", limit],
    queryFn: () => api.proposals.discardHistory(limit),
  });
}

export function useBigBetChecklistQuery(proposalId: string | null) {
  return useQuery({
    queryKey: ["bigbet-checklist", proposalId],
    queryFn: () => api.proposals.readiness(proposalId!),
    enabled: !!proposalId,
  });
}

export function useScoringProfilesQuery() {
  return useQuery({
    queryKey: ["scoring-profiles"],
    queryFn: api.curation.profiles,
  });
}

export function useRecordProposalFeedback() {
  return useMutation({
    mutationFn: ({ proposalId, taskId, outcome }: { proposalId: string; taskId: string; outcome: Record<string, unknown> }) =>
      api.proposals.feedback(proposalId, taskId, outcome),
    onSuccess: () => {
      toast.success("Feedback recorded.");
    },
    onError: (error) => {
      toast.error(buildActionErrorMessage("Failed to record feedback", error, "Retry."));
    },
  });
}
