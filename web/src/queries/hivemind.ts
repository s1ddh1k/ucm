import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/api/client";

export function useHivemindSearchQuery(query: string, limit?: number) {
  return useQuery({
    queryKey: ["hivemind-search", query, limit],
    queryFn: () => api.hivemind.search(query, limit),
    enabled: !!query.trim(),
  });
}

export function useHivemindListQuery(kind?: string, limit?: number) {
  return useQuery({
    queryKey: ["hivemind-list", kind, limit],
    queryFn: () => api.hivemind.list(kind, limit),
    refetchInterval: 30000,
  });
}

export function useHivemindShowQuery(id: string | null) {
  return useQuery({
    queryKey: ["hivemind-show", id],
    queryFn: () => api.hivemind.show(id!),
    enabled: !!id,
  });
}

export function useHivemindStatsQuery() {
  return useQuery({
    queryKey: ["hivemind-stats"],
    queryFn: () => api.hivemind.stats(),
    refetchInterval: 30000,
  });
}

export function useDeleteZettel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.hivemind.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hivemind-list"] });
      queryClient.invalidateQueries({ queryKey: ["hivemind-search"] });
      queryClient.invalidateQueries({ queryKey: ["hivemind-stats"] });
      queryClient.invalidateQueries({ queryKey: ["hivemind-show"] });
      toast.success("Zettel deleted.");
    },
    onError: (error) => {
      toast.error(`Failed to delete: ${error instanceof Error ? error.message : "unknown error"}`);
    },
  });
}

export function useRestoreZettel() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.hivemind.restore(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hivemind-list"] });
      queryClient.invalidateQueries({ queryKey: ["hivemind-search"] });
      queryClient.invalidateQueries({ queryKey: ["hivemind-stats"] });
      queryClient.invalidateQueries({ queryKey: ["hivemind-show"] });
      toast.success("Zettel restored.");
    },
    onError: (error) => {
      toast.error(`Failed to restore: ${error instanceof Error ? error.message : "unknown error"}`);
    },
  });
}

export function useGcMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dryRun?: boolean) => api.hivemind.gc(dryRun),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["hivemind-list"] });
      queryClient.invalidateQueries({ queryKey: ["hivemind-stats"] });
      if (data.wouldArchive != null) {
        toast.info(`GC dry run: ${data.wouldArchive} candidates.`);
      } else {
        toast.success(`GC complete: ${data.archived} archived.`);
      }
    },
    onError: (error) => {
      toast.error(`GC failed: ${error instanceof Error ? error.message : "unknown error"}`);
    },
  });
}

export function useReindexMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.hivemind.reindex(),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["hivemind-list"] });
      queryClient.invalidateQueries({ queryKey: ["hivemind-search"] });
      queryClient.invalidateQueries({ queryKey: ["hivemind-stats"] });
      toast.success(`Reindex complete: ${data.zettels} zettels, ${data.keywords} keywords.`);
    },
    onError: (error) => {
      toast.error(`Reindex failed: ${error instanceof Error ? error.message : "unknown error"}`);
    },
  });
}
