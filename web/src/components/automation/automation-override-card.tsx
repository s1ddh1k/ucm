import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api, type AutomationConfig } from "@/api/client";
import { cn } from "@/lib/utils";

const TOGGLE_KEYS = ["autoExecute", "autoApprove", "autoPropose", "autoConvert"] as const;
type ToggleKey = typeof TOGGLE_KEYS[number];

const TOGGLE_LABELS: Record<ToggleKey, string> = {
  autoExecute: "Auto Execute",
  autoApprove: "Auto Approve",
  autoPropose: "Auto Propose",
  autoConvert: "Auto Convert",
};

export function AutomationOverrideCard({ projectKey }: { projectKey: string }) {
  const queryClient = useQueryClient();
  const { data: automationConfig } = useQuery({
    queryKey: ["automation"],
    queryFn: () => api.automation.get(),
    staleTime: 5_000,
  });

  const mutation = useMutation({
    mutationFn: (params: Partial<AutomationConfig>) => api.automation.set(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["automation"] });
      queryClient.invalidateQueries({ queryKey: ["config"] });
    },
  });

  const config = automationConfig || { autoExecute: false, autoApprove: false, autoPropose: false, autoConvert: false, projects: {} };

  function setOverride(key: ToggleKey, value: string) {
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Automation Overrides</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {TOGGLE_KEYS.map((key) => {
            const override = config.projects?.[projectKey]?.[key];
            const value = override === true ? "on" : override === false ? "off" : "default";
            const globalValue = config[key] ? "on" : "off";
            return (
              <div key={key} className="space-y-1.5">
                <p className="text-xs font-medium">{TOGGLE_LABELS[key]}</p>
                <TriStateToggle
                  value={value}
                  globalValue={globalValue}
                  onChange={(v) => setOverride(key, v)}
                  disabled={mutation.isPending}
                />
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function TriStateToggle({
  value,
  globalValue,
  onChange,
  disabled,
}: {
  value: "on" | "off" | "default";
  globalValue: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const options = [
    { key: "default", label: `\u2014 (${globalValue})` },
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
