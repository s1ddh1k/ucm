import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useSmartInterval } from "@/hooks/use-smart-interval";
import { useDaemonStore } from "@/stores/daemon";

export function useStatsQuery() {
  return useQuery({
    queryKey: ["stats"],
    queryFn: async () => {
      const data = await api.stats.get();
      useDaemonStore.getState().setStatsLastUpdatedAt(Date.now());
      return data;
    },
    refetchInterval: useSmartInterval(30000),
  });
}

export function useDaemonStatusQuery() {
  return useQuery({
    queryKey: ["daemon-status"],
    queryFn: api.daemon.status,
    refetchInterval: useSmartInterval(10000),
  });
}

export function useStartDaemon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.daemon.start,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["daemon-status"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

export function useStopDaemon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.daemon.stop,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["daemon-status"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

export function usePauseDaemon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.daemon.pause(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["daemon-status"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

export function useResumeDaemon() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.daemon.resume(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["daemon-status"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}
