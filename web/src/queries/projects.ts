import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";

export interface ProjectCatalogItem {
  path: string;
  name?: string;
  createdAt?: string;
}

function normalizeCatalog(raw: unknown): ProjectCatalogItem[] {
  if (!Array.isArray(raw)) return [];
  const unique = new Map<string, ProjectCatalogItem>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const path = String((entry as { path?: unknown }).path || "").trim();
    if (!path) continue;
    const name = String((entry as { name?: unknown }).name || "").trim();
    const createdAt = String(
      (entry as { createdAt?: unknown }).createdAt || "",
    ).trim();
    unique.set(path, {
      path,
      name: name || undefined,
      createdAt: createdAt || undefined,
    });
  }
  return [...unique.values()].sort((a, b) =>
    (a.name || a.path).localeCompare(b.name || b.path),
  );
}

export function useProjectCatalogQuery() {
  return useQuery({
    queryKey: ["project-catalog"],
    queryFn: async () => {
      const config = await api.config.get();
      return normalizeCatalog(config.projectCatalog);
    },
  });
}

export function useUpsertProjectCatalogItem() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (item: { path: string; name?: string }) => {
      const config = await api.config.get();
      const current = normalizeCatalog(config.projectCatalog);
      const path = item.path.trim();
      const name = item.name?.trim();
      const next = [
        ...current.filter((p) => p.path !== path),
        {
          path,
          name: name || undefined,
          createdAt: new Date().toISOString(),
        },
      ];
      return api.config.set({ projectCatalog: normalizeCatalog(next) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["config"] });
      qc.invalidateQueries({ queryKey: ["project-catalog"] });
    },
  });
}

export function useRemoveProjectCatalogItem() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (pathToRemove: string) => {
      const config = await api.config.get();
      const current = normalizeCatalog(config.projectCatalog);
      const next = current.filter((p) => p.path !== pathToRemove.trim());
      return api.config.set({ projectCatalog: normalizeCatalog(next) });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["config"] });
      qc.invalidateQueries({ queryKey: ["project-catalog"] });
    },
  });
}
