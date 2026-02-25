import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { buildActionErrorMessage } from "@/lib/error";
import { cn } from "@/lib/utils";
import { api, type AutomationConfig } from "@/api/client";
import { useProjectCatalogQuery } from "@/queries/projects";
import { getProjectKey, getProjectLabel } from "@/lib/project";
import { useTasksQuery } from "@/queries/tasks";
import { useProposalsQuery } from "@/queries/proposals";
import { LoadingSkeleton } from "@/components/shared/loading-skeleton";

const TOGGLE_KEYS = ["autoExecute", "autoApprove", "autoPropose", "autoConvert"] as const;
type ToggleKey = typeof TOGGLE_KEYS[number];

const TOGGLE_META: Record<ToggleKey, { label: string; description: string }> = {
  autoExecute: { label: "Auto Execute", description: "Automatically run forge when a task is created" },
  autoApprove: { label: "Auto Approve", description: "Automatically approve tasks after forge completes (skip review)" },
  autoPropose: { label: "Auto Propose", description: "Observer automatically generates proposals" },
  autoConvert: { label: "Auto Convert", description: "Automatically promote proposals to tasks" },
};

export function AutomationTabContent() {
  const queryClient = useQueryClient();
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const { data: automationConfig, isLoading } = useQuery({
    queryKey: ["automation"],
    queryFn: () => api.automation.get(),
    staleTime: 5_000,
  });
  const { data: tasks } = useTasksQuery();
  const { data: proposals } = useProposalsQuery();
  const { data: projectCatalog } = useProjectCatalogQuery();

  const mutation = useMutation({
    mutationFn: (params: Partial<AutomationConfig>) => api.automation.set(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["automation"] });
      queryClient.invalidateQueries({ queryKey: ["config"] });
      setLastSavedAt(Date.now());
    },
    onError: (error) => {
      toast.error(
        buildActionErrorMessage(
          "Failed to update automation settings",
          error,
          "Verify daemon status, then retry.",
        ),
      );
    },
  });

  if (isLoading) return <LoadingSkeleton />;

  const config = automationConfig || { autoExecute: false, autoApprove: false, autoPropose: false, autoConvert: false, projects: {} };

  const doneCount = tasks?.filter((t) => t.state === "done").length ?? 0;
  const proposedCount = proposals?.filter((p) => p.status === "proposed").length ?? 0;

  function toggleGlobal(key: ToggleKey, value: boolean) {
    mutation.mutate({ [key]: value });
  }

  function setProjectOverride(projectKey: string, key: ToggleKey, value: string) {
    const projects = { ...config.projects };
    if (!projects[projectKey]) projects[projectKey] = {};
    if (value === "default") {
      delete projects[projectKey][key];
      if (Object.keys(projects[projectKey]).length === 0) delete projects[projectKey];
    } else {
      projects[projectKey] = { ...projects[projectKey], [key]: value === "on" };
    }
    mutation.mutate({ projects });
  }

  function getStats(key: ToggleKey): string {
    switch (key) {
      case "autoApprove": return `${doneCount} approved`;
      case "autoExecute": return `${tasks?.length ?? 0} total tasks`;
      case "autoPropose": return `${proposedCount} pending proposals`;
      case "autoConvert": return `${proposedCount} proposed`;
      default: return "";
    }
  }

  return (
    <div className="space-y-6">
      {/* Section A: Global Toggles */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Global Automation</CardTitle>
          <div className="text-xs text-muted-foreground min-h-4">
            {mutation.isPending ? (
              <span className="inline-flex items-center gap-1.5">
                <RotateCw className="h-3 w-3 animate-spin" />
                Saving automation settings...
              </span>
            ) : lastSavedAt ? (
              <span>Saved at {new Date(lastSavedAt).toLocaleTimeString()}</span>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {TOGGLE_KEYS.map((key) => (
            <div key={key} className="flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3">
                  <p className="text-sm font-medium">{TOGGLE_META[key].label}</p>
                  <span className="text-xs text-muted-foreground">{getStats(key)}</span>
                </div>
                <p className="text-xs text-muted-foreground">{TOGGLE_META[key].description}</p>
              </div>
              <Switch
                checked={!!config[key]}
                onCheckedChange={(v) => toggleGlobal(key, v)}
                disabled={mutation.isPending}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Section B: Per-Project Overrides */}
      {projectCatalog && projectCatalog.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Project Overrides</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-4 font-medium">Project</th>
                    {TOGGLE_KEYS.map((key) => (
                      <th key={key} className="text-center py-2 px-2 font-medium whitespace-nowrap">{TOGGLE_META[key].label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {projectCatalog.map((project) => {
                    const projectKey = getProjectKey(project.path);
                    const projectLabel = project.name || getProjectLabel(projectKey);
                    return (
                    <tr key={projectKey} className="border-b last:border-b-0">
                      <td className="py-2 pr-4 font-medium">{projectLabel}</td>
                      {TOGGLE_KEYS.map((key) => {
                        const override = config.projects?.[projectKey]?.[key];
                        const value = override === true ? "on" : override === false ? "off" : "default";
                        return (
                          <td key={key} className="py-2 px-2 text-center">
                            <TriStateToggle
                              value={value}
                              onChange={(v) => setProjectOverride(projectKey, key, v)}
                              disabled={mutation.isPending}
                            />
                          </td>
                        );
                      })}
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TriStateToggle({
  value,
  onChange,
  disabled,
}: {
  value: "on" | "off" | "default";
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const options = [
    { key: "default", label: "\u2014" },
    { key: "on", label: "On" },
    { key: "off", label: "Off" },
  ] as const;
  return (
    <div className="inline-flex rounded-md border text-xs">
      {options.map((opt) => (
        <button
          type="button"
          key={opt.key}
          disabled={disabled}
          onClick={() => onChange(opt.key)}
          className={cn(
            "px-2 py-1 first:rounded-l-md last:rounded-r-md transition-colors",
            value === opt.key
              ? "bg-primary text-primary-foreground"
              : "hover:bg-accent text-muted-foreground",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
